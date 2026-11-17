import type { Contact, Lead } from "../types.js";

export interface ScoreSignals {
  pediuVisita?: boolean;
  visitaAgendada?: boolean;
  pediuFotos?: boolean;
  simulouFinanciamento?: boolean;
  mensagensCliente?: number;
}

/**
 * Pontuação 0–100 do lead. Simples e explicável: cada sinal de compra soma pontos.
 * A temperatura serve para priorizar o vendedor; o estágio do funil é controlado à parte.
 */
export function scoreLead(lead: Lead, contact: Contact | null, s: ScoreSignals = {}): { score: number; temperatura: Lead["temperatura"]; motivos: string[] } {
  let score = 0;
  const motivos: string[] = [];
  const add = (pts: number, motivo: string) => {
    score += pts;
    motivos.push(`${motivo} (+${pts})`);
  };

  if (contact?.nome) add(5, "informou o nome");
  if (contact?.ctwa_clid) add(5, "veio de anúncio");
  if (lead.interesse.length > 0) add(15, "interesse em carro específico");
  else if (lead.interesse_texto) add(8, "descreveu o carro que procura");
  if (lead.forma_pagamento && lead.forma_pagamento !== "indefinido") add(10, "definiu forma de pagamento");
  if (lead.entrada != null && lead.entrada > 0) add(10, "tem entrada");
  if (lead.orcamento_max != null || lead.parcela_max != null) add(5, "informou orçamento");
  if (lead.tem_troca) add(5, "tem carro na troca");
  if (lead.urgencia === "imediata") add(15, "quer comprar já");
  else if (lead.urgencia === "30_dias") add(8, "compra em até 30 dias");
  if (lead.bairro || lead.cidade) add(3, "informou região");
  if (s.simulouFinanciamento) add(5, "simulou financiamento");
  if (s.pediuFotos) add(4, "pediu fotos");
  if (s.pediuVisita) add(10, "quer visitar a loja");
  if (s.visitaAgendada) add(20, "visita agendada");
  if ((s.mensagensCliente ?? 0) >= 6) add(3, "conversa engajada");

  score = Math.min(100, score);
  const temperatura: Lead["temperatura"] = score >= 60 ? "quente" : score >= 30 ? "morno" : "frio";
  return { score, temperatura, motivos };
}
