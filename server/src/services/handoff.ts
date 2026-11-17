import { config, isWhatsAppConfigured } from "../config.js";
import { contacts, events, leads, sellers, vehicles, vehicleTitle } from "../db/repos.js";
import { getSettings } from "../db/settings.js";
import type { Contact, Seller } from "../types.js";
import { publish } from "../util/bus.js";
import { log } from "../util/log.js";
import { wa } from "../whatsapp/client.js";
import { sendConversion } from "./capi.js";

export type HandoffReason =
  | "pronto_para_negociar"
  | "pediu_humano"
  | "negociacao_de_preco"
  | "avaliacao_de_troca"
  | "duvida_sem_resposta"
  | "reclamacao"
  | "pos_venda"
  | "visita_agendada";

const reasonLabel: Record<HandoffReason, string> = {
  pronto_para_negociar: "Pronto para negociar",
  pediu_humano: "Pediu para falar com uma pessoa",
  negociacao_de_preco: "Quer negociar o valor",
  avaliacao_de_troca: "Avaliação de troca",
  duvida_sem_resposta: "Dúvida que a IA não soube responder",
  reclamacao: "Reclamação",
  pos_venda: "Pós-venda",
  visita_agendada: "Visita agendada",
};

export function pickSeller(contact: Contact): Seller | null {
  if (contact.seller_id) {
    const s = sellers.get(contact.seller_id);
    if (s?.ativo) return s;
  }
  const s = sellers.nextInRotation();
  if (s) {
    sellers.incrementLeads(s.id);
    contacts.update(contact.id, { seller_id: s.id });
  }
  return s;
}

/** Texto do alerta enviado ao vendedor. */
export function sellerAlert(contact: Contact, motivo: HandoffReason, resumo: string, urgente: boolean) {
  const lead = leads.get(contact.id);
  const s = getSettings();
  const carros = (lead?.interesse ?? [])
    .map((id) => vehicles.get(id))
    .filter(Boolean)
    .map((v) => vehicleTitle(v!))
    .join(", ");
  const nome = contact.nome || contact.nome_perfil || "Cliente";
  const linhas = [
    `${urgente ? "🔥 " : ""}*Lead para você — ${s.loja.nome}*`,
    `${nome} · +${contact.wa_id}`,
    `Motivo: ${reasonLabel[motivo]}`,
    carros ? `Interesse: ${carros}` : lead?.interesse_texto ? `Procura: ${lead.interesse_texto}` : null,
    lead?.forma_pagamento ? `Pagamento: ${lead.forma_pagamento}${lead.entrada ? ` · entrada R$ ${lead.entrada.toLocaleString("pt-BR")}` : ""}` : null,
    lead?.tem_troca ? `Tem troca: ${[lead.troca?.marca, lead.troca?.modelo, lead.troca?.ano].filter(Boolean).join(" ") || "sim"}` : null,
    contact.ad_headline ? `Anúncio: ${contact.ad_headline}` : null,
    `Resumo: ${resumo}`,
    `Abrir conversa: ${config.publicUrl}/painel/conversas/${contact.id}`,
  ];
  return linhas.filter(Boolean).join("\n");
}

/**
 * Passa o cliente para um vendedor: pausa a IA nesse contato, sobe o lead no funil,
 * avisa o vendedor e manda o evento de lead qualificado para a Meta.
 */
export async function handoff(contact: Contact, motivo: HandoffReason, resumo: string, urgente: boolean) {
  const s = getSettings();
  const seller = pickSeller(contact);
  const until = new Date(Date.now() + s.handoff.pausar_ia_horas * 3600_000).toISOString();

  contacts.update(contact.id, { bot_paused_until: until, paused_reason: `handoff:${motivo}` });
  const lead = leads.get(contact.id);
  if (lead && !["visita_agendada", "vendido"].includes(lead.stage)) leads.update(contact.id, { stage: motivo === "pos_venda" ? lead.stage : "negociacao", resumo });
  else if (lead) leads.update(contact.id, { resumo });
  events.add(contact.id, "handoff", { motivo, resumo, urgente, seller_id: seller?.id ?? null });
  publish({ type: "contact", contactId: contact.id });
  publish({ type: "lead", contactId: contact.id });

  if (motivo !== "reclamacao" && motivo !== "pos_venda") void sendConversion(contact.id, "qualificado");

  let notificado = false;
  if (seller && s.handoff.notificar_vendedor && isWhatsAppConfigured()) {
    const texto = sellerAlert(contacts.get(contact.id)!, motivo, resumo, urgente);
    try {
      if (s.handoff.template_notificacao) {
        // Template aprovado: funciona mesmo fora da janela de 24h com o vendedor
        await wa.template(seller.whatsapp, s.handoff.template_notificacao.nome, s.handoff.template_notificacao.idioma, [
          contact.nome || contact.nome_perfil || "Cliente",
          `+${contact.wa_id}`,
          reasonLabel[motivo],
          resumo.slice(0, 500),
        ]);
      } else {
        await wa.text(seller.whatsapp, texto);
      }
      notificado = true;
    } catch (e) {
      log.warn("não consegui avisar o vendedor", { seller: seller.id, err: (e as Error).message });
    }
  }

  return { vendedor: seller?.nome ?? null, notificado, ia_pausada_ate: until };
}
