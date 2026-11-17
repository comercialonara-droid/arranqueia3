import { config } from "../config.js";
import { contacts, leads, messages, simulations } from "../db/repos.js";
import { nowIso } from "../db/index.js";
import type { Intent, LeadAnalysis } from "../types.js";
import { anthropic } from "./runner.js";
import { log } from "../util/log.js";
import { publish } from "../util/bus.js";

const INTENTS: Intent[] = ["so_informacao", "fotos_videos", "simulacao", "visita", "negociar", "vender_carro", "pos_venda", "sem_interesse", "indefinida"];

const schema = {
  type: "object",
  properties: {
    resumo: { type: "string", description: "2 a 4 frases para o vendedor: quem é, o que quer, como pretende pagar, em que ponto está" },
    intencao: { type: "string", enum: INTENTS },
    objecoes: { type: "array", items: { type: "string" } },
    sinais_de_compra: { type: "array", items: { type: "string" } },
    proxima_acao: { type: "string", description: "A próxima ação concreta para o vendedor" },
    perfil: { type: "string", description: "Perfil do cliente em uma frase (ex.: família, primeiro carro, motorista de aplicativo)" },
  },
  required: ["resumo", "intencao", "objecoes", "sinais_de_compra", "proxima_acao", "perfil"],
  additionalProperties: false,
};

function transcript(contactId: number) {
  return messages
    .forContact(contactId, 120)
    .map((m) => {
      const who = m.direction === "in" ? "Cliente" : m.sender === "vendedor" ? "Vendedor" : "Loja (IA)";
      const meta = (m.meta ?? {}) as Record<string, any>;
      const body = m.type === "audio" && meta.transcricao ? `[áudio] ${meta.transcricao}` : m.type === "image" ? `[foto] ${m.body ?? ""}` : m.body ?? `[${m.type}]`;
      return `${who}: ${body}`;
    })
    .join("\n");
}

/** Lê a conversa inteira e devolve uma análise para o vendedor (usado no botão "Analisar conversa"). */
export async function analyzeConversation(contactId: number): Promise<LeadAnalysis> {
  const c = contacts.get(contactId)!;
  const lead = leads.get(contactId)!;
  const sim = simulations.latest(contactId);
  const text = transcript(contactId);
  let result: Omit<LeadAnalysis, "atualizado_em" | "fonte">;

  if (config.ai.provider === "mock") {
    const lower = text.toLowerCase();
    result = {
      resumo: `Conversa com ${c.nome || c.nome_perfil || "o cliente"} (${messages.forContact(contactId, 500).length} mensagens). Análise simulada: ligue a IA para uma leitura de verdade.`,
      intencao: /simula|financ|parcela|entrada/.test(lower) ? "simulacao" : /foto|v[ií]deo/.test(lower) ? "fotos_videos" : /visita|amanh|passar a[ií]/.test(lower) ? "visita" : lead.intencao,
      objecoes: /caro|desconto/.test(lower) ? ["preço"] : [],
      sinais_de_compra: /entrada|troca|financ/.test(lower) ? ["falou de pagamento"] : [],
      proxima_acao: sim?.status === "enviada" ? "Rodar a simulação e retornar ao cliente." : "Retomar a conversa e oferecer a simulação.",
      perfil: "",
    };
  } else {
    const resp = await anthropic().beta.messages.create({
      model: config.ai.model,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system:
        "Você é gerente comercial de uma loja de seminovos. Leia a conversa de WhatsApp e escreva uma análise curta e prática, em português do Brasil, para o vendedor que vai assumir. Seja específico; não invente nada que não esteja na conversa.",
      messages: [
        {
          role: "user",
          content: `Conversa:\n${text}\n\nDados no CRM: forma de pagamento ${lead.forma_pagamento ?? "não informada"}; entrada ${lead.entrada ?? "não informada"}; troca ${lead.tem_troca ? JSON.stringify(lead.troca) : "não"}; simulação ${sim ? sim.status : "não iniciada"}.`,
        },
      ],
    });
    if (resp.stop_reason === "refusal") throw new Error("A IA não conseguiu analisar esta conversa.");
    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Resposta vazia da IA.");
    result = JSON.parse(block.text);
  }

  const analise: LeadAnalysis = { ...result, atualizado_em: nowIso(), fonte: "analise" };
  leads.update(contactId, { analise, intencao: analise.intencao });
  publish({ type: "lead", contactId });
  log.info("conversa analisada", { contactId });
  return analise;
}
