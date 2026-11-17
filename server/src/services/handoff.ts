import { config } from "../config.js";
import { contacts, events, leads, simulations, stores, users, vehicles, vehicleTitle } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import type { Contact, User } from "../types.js";
import { decrypt, maskCpf } from "../util/crypto.js";
import { publish } from "../util/bus.js";
import { log } from "../util/log.js";
import { wa } from "../whatsapp/client.js";
import { sendConversion } from "./capi.js";

export type HandoffReason =
  | "simulacao_pronta"
  | "pronto_para_negociar"
  | "pediu_humano"
  | "negociacao_de_preco"
  | "avaliacao_de_troca"
  | "duvida_sem_resposta"
  | "reclamacao"
  | "pos_venda";

export const reasonLabel: Record<HandoffReason, string> = {
  simulacao_pronta: "Simulação pronta para rodar",
  pronto_para_negociar: "Pronto para negociar",
  pediu_humano: "Pediu para falar com uma pessoa",
  negociacao_de_preco: "Quer saber valores ou negociar",
  avaliacao_de_troca: "Avaliação do usado na troca",
  duvida_sem_resposta: "Dúvida que a IA não soube responder",
  reclamacao: "Reclamação",
  pos_venda: "Pós-venda",
};

const pagamento: Record<string, string> = {
  financiamento: "Financiamento",
  troca_mais_dinheiro: "Usado na troca + dinheiro",
  troca_mais_financiamento: "Usado na troca + financiamento",
  a_vista: "À vista",
  consorcio: "Consórcio",
  indefinido: "A definir",
};

export function pickSeller(contact: Contact): User | null {
  if (contact.seller_id) {
    const s = users.get(contact.seller_id);
    if (s?.ativo) return s;
  }
  const s = users.nextInRotation(contact.store_id);
  if (s) {
    users.incrementLeads(s.id);
    contacts.update(contact.id, { seller_id: s.id });
    events.add(contact.store_id, contact.id, "lead_atribuido", { seller_id: s.id, nome: s.nome });
  }
  return s;
}

/** Ficha que o vendedor recebe no WhatsApp. CPF vai mascarado; completo só no painel. */
export function sellerAlert(contact: Contact, motivo: HandoffReason, resumo: string, urgente: boolean) {
  const lead = leads.get(contact.id);
  const s = getSettings(contact.store_id);
  const sim = simulations.latest(contact.id);
  const carros = (lead?.interesse ?? [])
    .map((id) => vehicles.get(id, contact.store_id))
    .filter(Boolean)
    .map((v) => vehicleTitle(v!))
    .join(", ");
  const nome = sim?.nome_completo || contact.nome || contact.nome_perfil || "Cliente";
  const troca = lead?.troca;
  const linhas = [
    `${urgente ? "🔥 " : ""}*${reasonLabel[motivo]}* — ${s.loja.nome}`,
    `${nome} · +${contact.wa_id}`,
    carros ? `Interesse: ${carros}` : lead?.interesse_texto ? `Procura: ${lead.interesse_texto}` : null,
    lead?.forma_pagamento ? `Pagamento: ${pagamento[lead.forma_pagamento] ?? lead.forma_pagamento}` : null,
    lead?.entrada ? `Entrada em dinheiro: R$ ${lead.entrada.toLocaleString("pt-BR")}` : null,
    lead?.tem_troca ? `Troca: ${[troca?.marca, troca?.modelo, troca?.ano, troca?.km ? `${troca.km.toLocaleString("pt-BR")} km` : null, troca?.quitado === false ? "não quitado" : troca?.quitado ? "quitado" : null].filter(Boolean).join(" ") || "sim"}` : null,
    sim && motivo === "simulacao_pronta"
      ? [
          `CPF: ${maskCpf(decrypt(sim.cpf_enc)) ?? "não informado"}`,
          sim.data_nascimento ? `Nascimento: ${sim.data_nascimento.split("-").reverse().join("/")}` : null,
          sim.tem_cnh == null ? null : `CNH: ${sim.tem_cnh ? "tem" : "não tem"}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null,
    contact.ad_headline ? `Anúncio: ${contact.ad_headline}` : null,
    `Resumo: ${resumo}`,
    `Abrir: ${config.publicUrl}/painel/conversas/${contact.id}`,
  ];
  return linhas.filter(Boolean).join("\n");
}

/**
 * Passa o cliente para um vendedor: pausa a IA, sobe o lead no funil, avisa o vendedor
 * e manda o evento de lead qualificado para a Meta.
 */
export async function handoff(contact: Contact, motivo: HandoffReason, resumo: string, urgente: boolean) {
  const s = getSettings(contact.store_id);
  const seller = pickSeller(contact);
  const until = new Date(Date.now() + s.handoff.pausar_ia_horas * 3600_000).toISOString();

  contacts.update(contact.id, { bot_paused_until: until, paused_reason: `handoff:${motivo}` });
  const lead = leads.get(contact.id);
  if (lead && !["vendido", "perdido"].includes(lead.stage)) {
    const stage = motivo === "simulacao_pronta" ? "simulacao" : motivo === "pos_venda" || motivo === "reclamacao" ? lead.stage : lead.stage === "visita_agendada" ? lead.stage : "negociacao";
    leads.update(contact.id, { stage, analise: lead.analise ? { ...lead.analise, proxima_acao: resumo } : lead.analise });
  }
  events.add(contact.store_id, contact.id, "handoff", { motivo, resumo, urgente, seller_id: seller?.id ?? null });
  publish({ type: "contact", contactId: contact.id });
  publish({ type: "lead", contactId: contact.id });

  if (motivo !== "reclamacao" && motivo !== "pos_venda") void sendConversion(contact.id, "qualificado");

  let notificado = false;
  const creds = stores.creds(contact.store_id);
  if (seller?.whatsapp && s.handoff.notificar_vendedor && creds) {
    try {
      if (s.handoff.template_notificacao) {
        await wa.template(creds, seller.whatsapp, s.handoff.template_notificacao.nome, s.handoff.template_notificacao.idioma, [
          contact.nome || contact.nome_perfil || "Cliente",
          `+${contact.wa_id}`,
          reasonLabel[motivo],
          resumo.slice(0, 500),
        ]);
      } else {
        await wa.text(creds, seller.whatsapp, sellerAlert(contacts.get(contact.id)!, motivo, resumo, urgente));
      }
      notificado = true;
    } catch (e) {
      log.warn("não consegui avisar o vendedor", { seller: seller.id, err: (e as Error).message });
    }
  }
  return { vendedor: seller?.nome ?? null, notificado, ia_pausada_ate: until };
}
