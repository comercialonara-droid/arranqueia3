import type { Contact, Lead, ScoreBreakdown, Simulation, Temperature } from "../types.js";

export interface ScoreSignals {
  pediuFotos?: boolean;
  pediuVideos?: boolean;
  pediuVisita?: boolean;
  visitaAgendada?: boolean;
  mensagensCliente?: number;
  simulacao?: Simulation | null;
}

/**
 * Qualificação do lead em 4 dimensões (0–100 no total), com o motivo de cada ponto:
 *  - Intenção (até 35): o que a pessoa quer fazer — só olhar, ver fotos, simular, visitar, negociar.
 *  - Capacidade (até 30): como vai pagar — forma de pagamento, entrada, carro na troca, dados de simulação.
 *  - Momento (até 20): quando pretende comprar.
 *  - Engajamento (até 15): quanto conversa, se veio de anúncio, se se identificou.
 */
export function scoreLead(lead: Lead, contact: Contact | null, s: ScoreSignals = {}): { score: number; temperatura: Temperature; detalhe: ScoreBreakdown } {
  const motivos: string[] = [];
  const pts = { intencao: 0, capacidade: 0, momento: 0, engajamento: 0 };
  const add = (dim: keyof typeof pts, n: number, motivo: string) => {
    pts[dim] += n;
    motivos.push(`${motivo} (+${n})`);
  };

  // Intenção
  const intentPts: Partial<Record<Lead["intencao"], [number, string]>> = {
    so_informacao: [5, "quer informações"],
    fotos_videos: [12, "quer ver fotos/vídeos"],
    visita: [25, "quer ver o produto na loja"],
    simulacao: [30, "quer fazer simulação"],
    negociar: [35, "quer negociar/fechar"],
    pos_venda: [0, "pós-venda"],
  };
  const ip = intentPts[lead.intencao];
  if (ip && ip[0] > 0) add("intencao", ip[0], ip[1]);
  if (lead.interesse.length) add("intencao", 5, "modelo específico em mente");
  else if (lead.interesse_texto) add("intencao", 3, "descreveu o que procura");
  if (s.pediuVisita && lead.intencao !== "visita") add("intencao", 5, "perguntou de visita");

  // Capacidade
  if (lead.forma_pagamento && lead.forma_pagamento !== "indefinido") add("capacidade", 8, "definiu como vai pagar");
  if (lead.entrada != null && lead.entrada > 0) add("capacidade", 8, "tem entrada em dinheiro");
  if (lead.tem_troca) add("capacidade", lead.troca?.modelo && lead.troca?.ano ? 7 : 4, lead.troca?.modelo ? "usado na troca identificado" : "tem usado na troca");
  if (lead.forma_pagamento === "a_vista") add("capacidade", 7, "pagamento à vista");
  const sim = s.simulacao;
  if (sim && (sim.cpf_enc || sim.data_nascimento)) add("capacidade", 5, "passou dados para simulação");
  if (sim?.tem_cnh) add("capacidade", 2, "tem CNH");

  // Momento
  if (lead.urgencia === "imediata") add("momento", 20, "quer comprar já");
  else if (lead.urgencia === "30_dias") add("momento", 12, "compra em até 30 dias");
  else if (lead.urgencia === "pesquisando") add("momento", 3, "ainda pesquisando");
  if (s.visitaAgendada) add("momento", 10, "visita agendada");

  // Engajamento
  if (contact?.ctwa_clid) add("engajamento", 3, "veio de anúncio");
  if (contact?.nome) add("engajamento", 3, "se identificou");
  if ((s.mensagensCliente ?? 0) >= 4) add("engajamento", 4, "conversa ativa");
  if ((s.mensagensCliente ?? 0) >= 10) add("engajamento", 3, "conversa longa");
  if (s.pediuFotos || s.pediuVideos) add("engajamento", 2, "viu fotos/vídeos");

  const cap = { intencao: 35, capacidade: 30, momento: 20, engajamento: 15 };
  for (const k of Object.keys(pts) as (keyof typeof pts)[]) pts[k] = Math.min(pts[k], cap[k]);
  let score = pts.intencao + pts.capacidade + pts.momento + pts.engajamento;
  if (lead.intencao === "sem_interesse") score = Math.min(score, 10);

  let temperatura: Temperature = score >= 75 ? "pronto" : score >= 50 ? "quente" : score >= 25 ? "morno" : "frio";
  if (sim && ["enviada", "em_analise", "aprovada"].includes(sim.status)) temperatura = "pronto";

  return { score, temperatura, detalhe: { ...pts, motivos } };
}
