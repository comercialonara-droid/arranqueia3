import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { appointments, contacts, effectivePrice, events, leads, messages, vehicles, vehicleTitle } from "../db/repos.js";
import type { Contact, Lead, LeadStage, StoreSettings, TradeIn } from "../types.js";
import { searchInventory, vehicleDetails } from "../services/inventory.js";
import { simulate } from "../services/financing.js";
import { availableSlots, checkSlot } from "../services/schedule.js";
import { scoreLead, type ScoreSignals } from "../services/scoring.js";
import { handoff, pickSeller, type HandoffReason } from "../services/handoff.js";
import { sendConversion } from "../services/capi.js";
import { deliver, deliverSequence, type OutItem } from "../pipeline/outbox.js";
import { brl, formatDateTimeBR } from "../util/time.js";
import { publish } from "../util/bus.js";

export interface ToolContext {
  contact: Contact;
  settings: StoreSettings;
  signals: ScoreSignals;
  /** mensagens enviadas ao cliente neste turno */
  sent: number;
  handedOff: boolean;
}

type ToolDef<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
};

const def = <S extends z.ZodType>(t: ToolDef<S>) => t;

const nul = <T extends z.ZodType>(t: T) => t.nullable().optional();

// ───────────────────────── helpers ─────────────────────────

const STAGE_ORDER: LeadStage[] = ["novo", "qualificando", "quente", "visita_agendada", "negociacao", "vendido"];

/** Só avança o funil — nunca volta (vendido/perdido ficam a cargo do vendedor). */
function advanceStage(cur: LeadStage, target: LeadStage): LeadStage {
  if (cur === "vendido" || cur === "perdido") return cur;
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(cur) ? target : cur;
}

function refreshLead(ctx: ToolContext) {
  const contact = contacts.get(ctx.contact.id)!;
  ctx.contact = contact;
  const lead = leads.get(contact.id)!;
  const inbound = messages.forContact(contact.id, 500).filter((m) => m.direction === "in").length;
  ctx.signals.mensagensCliente = inbound;
  ctx.signals.visitaAgendada = appointments.upcomingForContact(contact.id).length > 0;
  const { score, temperatura, motivos } = scoreLead(lead, contact, ctx.signals);
  let stage = lead.stage;
  const hasInfo = lead.interesse.length || lead.interesse_texto || lead.forma_pagamento || contact.nome;
  if (hasInfo) stage = advanceStage(stage, "qualificando");
  if (temperatura === "quente") stage = advanceStage(stage, "quente");
  if (ctx.signals.visitaAgendada) stage = advanceStage(stage, "visita_agendada");
  const updated = leads.update(contact.id, { score, temperatura, stage })!;
  publish({ type: "lead", contactId: contact.id });

  // Lead com interesse concreto → evento de lead para a Meta (uma vez por contato)
  if ((updated.interesse.length || updated.interesse_texto) && (updated.forma_pagamento || contact.nome || updated.entrada)) {
    void sendConversion(contact.id, "lead");
  }
  return { score, temperatura, stage: updated.stage, motivos };
}

const vehicleOrError = (id: string) => {
  const v = vehicles.get(id);
  if (!v) throw new ToolError(`Veículo "${id}" não existe. Use buscar_estoque para pegar o id certo.`);
  return v;
};

export class ToolError extends Error {}

// ───────────────────────── ferramentas ─────────────────────────

const buscarEstoque = def({
  name: "buscar_estoque",
  description:
    "Busca carros disponíveis no estoque da loja. Use SEMPRE antes de falar de qualquer carro, preço ou disponibilidade — nunca invente. " +
    "Aceita busca livre (ex.: 'suv automático até 100 mil', 'corolla', 'carro pra uber') e filtros. Se o cliente falou em parcela, passe parcela_max (e entrada, se souber). " +
    "Devolve no máximo 10 carros com id, título, km, preço, parcela estimada e destaques.",
  schema: z.strictObject({
    consulta: nul(z.string()).describe("Texto livre do que o cliente procura"),
    marca: nul(z.string()),
    modelo: nul(z.string()),
    carroceria: nul(z.enum(["hatch", "sedan", "suv", "picape", "utilitario", "minivan", "cupe", "moto"])),
    cambio: nul(z.enum(["automatico", "manual"])),
    combustivel: nul(z.string()).describe("flex, gasolina, diesel, gnv, hibrido, eletrico"),
    preco_min: nul(z.number()),
    preco_max: nul(z.number()),
    ano_min: nul(z.number().int()),
    km_max: nul(z.number().int()),
    parcela_max: nul(z.number()).describe("Parcela mensal máxima que o cliente quer pagar, em reais"),
    entrada: nul(z.number()).describe("Valor de entrada que o cliente tem, em reais"),
    ordenar: nul(z.enum(["relevancia", "menor_preco", "maior_preco", "mais_novo", "menor_km"])),
    limite: nul(z.number().int()),
  }),
  run: (i, ctx) => {
    const r = searchInventory(ctx.settings, i);
    events.add(ctx.contact.id, "busca_estoque", { filtros: i, total: r.total });
    if (r.total === 0) {
      const alternativas = searchInventory(ctx.settings, { carroceria: i.carroceria, preco_max: i.preco_max ? i.preco_max * 1.25 : null, limite: 4 });
      return {
        total: 0,
        aviso: "Nada exatamente assim no estoque agora. Ofereça alternativas parecidas e registre o que o cliente procura (registrar_cliente.interesse_texto) para a loja avisar quando chegar.",
        alternativas: alternativas.veiculos,
      };
    }
    return r;
  },
});

const detalhesVeiculo = def({
  name: "detalhes_veiculo",
  description: "Ficha completa de um carro do estoque (opcionais, descrição, FIPE, ano, final de placa, fotos disponíveis). Use quando o cliente pedir mais informações de um carro específico.",
  schema: z.strictObject({ veiculo_id: z.string() }),
  run: (i, ctx) => {
    const v = vehicleOrError(i.veiculo_id);
    const lead = leads.get(ctx.contact.id)!;
    if (!lead.interesse.includes(v.id)) leads.update(ctx.contact.id, { interesse: [...lead.interesse, v.id].slice(-5) });
    refreshLead(ctx);
    return vehicleDetails(ctx.settings, v);
  },
});

const enviarFotos = def({
  name: "enviar_fotos",
  description:
    "Envia fotos reais de um carro para o cliente no WhatsApp (a primeira vai com legenda). Use quando o cliente pedir fotos ou logo depois de apresentar um carro que combinou com ele. " +
    "Padrão: 4 fotos. Depois de enviar, continue a conversa com uma pergunta (ex.: se quer ver pessoalmente).",
  schema: z.strictObject({
    veiculo_id: z.string(),
    quantidade: nul(z.number().int()).describe("Quantas fotos (1 a 8)"),
    indices: nul(z.array(z.number().int())).describe("Índices específicos das fotos (ver detalhes_veiculo), ex.: interior"),
    legenda: nul(z.string()).describe("Legenda curta da primeira foto. Se vazio, usa o nome do carro."),
  }),
  run: async (i, ctx) => {
    const v = vehicleOrError(i.veiculo_id);
    if (!v.fotos.length) return { enviadas: 0, aviso: "Esse carro ainda está sem fotos cadastradas. Diga que vai pedir para a equipe mandar e ofereça a visita." };
    const qtd = Math.min(Math.max(i.quantidade ?? 4, 1), 8);
    const escolhidas = (i.indices?.length ? i.indices.map((n) => v.fotos[n]).filter(Boolean) : v.fotos).slice(0, qtd);
    const items: OutItem[] = escolhidas.map((f, n) => ({
      type: "image",
      url: f.url,
      caption: n === 0 ? i.legenda || `${vehicleTitle(v)}${effectivePrice(v) && ctx.settings.atendimento.politica_preco === "informar" ? ` · ${brl(effectivePrice(v))}` : ""}` : f.legenda,
    }));
    const rows = await deliverSequence(ctx.contact, items, "ia");
    ctx.sent += rows.length;
    ctx.signals.pediuFotos = true;
    const lead = leads.get(ctx.contact.id)!;
    if (!lead.interesse.includes(v.id)) leads.update(ctx.contact.id, { interesse: [...lead.interesse, v.id].slice(-5) });
    events.add(ctx.contact.id, "fotos_enviadas", { veiculo_id: v.id, qtd: rows.length });
    refreshLead(ctx);
    const falhas = rows.filter((r) => r.status === "failed").length;
    return { enviadas: rows.length - falhas, falhas, total_fotos_do_carro: v.fotos.length };
  },
});

const simularFinanciamento = def({
  name: "simular_financiamento",
  description:
    "Simula parcelas de financiamento de um carro do estoque (veiculo_id) ou de um valor qualquer. Use quando o cliente perguntar de parcela, entrada ou financiamento. " +
    "Sempre diga que é uma simulação sujeita à análise de crédito. Nunca prometa aprovação nem taxa.",
  schema: z.strictObject({
    veiculo_id: nul(z.string()),
    valor: nul(z.number()).describe("Valor do bem, se não for um carro do estoque"),
    entrada: nul(z.number()).describe("Entrada em reais (se o cliente vai dar o carro usado, some o valor estimado dele)"),
    prazo: nul(z.number().int()).describe("Número de parcelas, se o cliente pediu um prazo específico"),
  }),
  run: (i, ctx) => {
    if (!ctx.settings.atendimento.aceita_financiamento) return { aviso: "A loja não trabalha com financiamento. Ofereça pagamento à vista ou troca." };
    let valor = i.valor ?? null;
    let titulo: string | null = null;
    if (i.veiculo_id) {
      const v = vehicleOrError(i.veiculo_id);
      valor = effectivePrice(v);
      titulo = vehicleTitle(v);
      if (i.entrada == null && v.entrada_sugerida) i.entrada = v.entrada_sugerida;
    }
    if (!valor) throw new ToolError("Sem valor para simular. Informe veiculo_id de um carro com preço ou o valor.");
    const sim = simulate(ctx.settings.financiamento, valor, i.entrada, i.prazo);
    ctx.signals.simulouFinanciamento = true;
    const lead = leads.get(ctx.contact.id)!;
    leads.update(ctx.contact.id, { forma_pagamento: lead.forma_pagamento ?? "financiamento", entrada: i.entrada ?? lead.entrada });
    events.add(ctx.contact.id, "simulacao", { valor, entrada: sim.entrada });
    refreshLead(ctx);
    return {
      carro: titulo,
      valor: brl(sim.valor_veiculo),
      entrada: brl(sim.entrada),
      entrada_minima: brl(sim.entrada_minima),
      entrada_abaixo_do_minimo: sim.entrada_abaixo_do_minimo,
      financiado: brl(sim.valor_financiado),
      opcoes: sim.opcoes.map((o) => `${o.prazo}x de ${brl(o.parcela)}`),
      observacao: sim.observacao,
    };
  },
});

const registrarCliente = def({
  name: "registrar_cliente",
  description:
    "Atualiza a ficha do cliente no CRM com o que ele contou. Chame sempre que descobrir algo novo (nome, região, carro de interesse, orçamento, entrada, forma de pagamento, urgência, uso do carro). " +
    "Preencha só o que o cliente disse de verdade. Não precisa avisar o cliente que salvou.",
  schema: z.strictObject({
    nome: nul(z.string()),
    cidade: nul(z.string()),
    bairro: nul(z.string()),
    interesse_veiculo_ids: nul(z.array(z.string())).describe("ids dos carros do estoque de interesse"),
    interesse_texto: nul(z.string()).describe("O que procura, em poucas palavras (ex.: 'SUV automático até 90 mil')"),
    orcamento_max: nul(z.number()),
    parcela_max: nul(z.number()),
    entrada: nul(z.number()),
    forma_pagamento: nul(z.enum(["a_vista", "financiamento", "consorcio", "troca_mais_diferenca", "indefinido"])),
    urgencia: nul(z.enum(["imediata", "30_dias", "pesquisando"])),
    uso: nul(z.string()).describe("Para que vai usar: família, trabalho, aplicativo, etc."),
    observacoes: nul(z.string()),
  }),
  run: (i, ctx) => {
    if (i.nome) contacts.update(ctx.contact.id, { nome: i.nome });
    const lead = leads.get(ctx.contact.id)!;
    const patch: Partial<Lead> = {};
    for (const k of ["cidade", "bairro", "interesse_texto", "orcamento_max", "parcela_max", "entrada", "forma_pagamento", "urgencia", "uso"] as const) {
      if (i[k] != null) (patch as any)[k] = i[k];
    }
    if (i.observacoes) patch.observacoes = [lead.observacoes, i.observacoes].filter(Boolean).join(" | ").slice(-1500);
    if (i.interesse_veiculo_ids?.length) {
      const validos = i.interesse_veiculo_ids.filter((id) => vehicles.get(id));
      patch.interesse = Array.from(new Set([...lead.interesse, ...validos])).slice(-5);
    }
    leads.update(ctx.contact.id, patch);
    const r = refreshLead(ctx);
    return { salvo: true, score: r.score, temperatura: r.temperatura, etapa: r.stage };
  },
});

const registrarTroca = def({
  name: "registrar_troca",
  description:
    "Registra o carro que o cliente quer dar na troca. Para a loja avaliar, peça: modelo, ano, km, se está quitado e fotos (frente, traseira, laterais, painel ligado mostrando km). " +
    "Nunca dê valor de avaliação — quem avalia é a loja, presencialmente ou pelas fotos.",
  schema: z.strictObject({
    marca: nul(z.string()),
    modelo: nul(z.string()),
    versao: nul(z.string()),
    ano: nul(z.number().int()),
    km: nul(z.number().int()),
    cor: nul(z.string()),
    quitado: nul(z.boolean()),
    saldo_devedor: nul(z.number()),
    estado: nul(z.string()).describe("Conservação, batidas, revisões, etc."),
    valor_esperado: nul(z.number()).describe("Quanto o cliente espera pelo carro, se ele falou"),
    fotos_recebidas: nul(z.boolean()),
  }),
  run: (i, ctx) => {
    if (!ctx.settings.atendimento.aceita_troca) return { aviso: "A loja não aceita carro na troca. Explique com gentileza e ofereça outras formas de pagamento." };
    const lead = leads.get(ctx.contact.id)!;
    const troca: TradeIn = { ...(lead.troca ?? {}) };
    for (const [k, v] of Object.entries(i)) if (v != null) (troca as any)[k] = v;
    leads.update(ctx.contact.id, { tem_troca: true, troca, forma_pagamento: lead.forma_pagamento ?? "troca_mais_diferenca" });
    const faltando = (["modelo", "ano", "km", "quitado"] as const).filter((k) => troca[k] == null);
    if (!troca.fotos_recebidas) faltando.push("fotos" as any);
    const r = refreshLead(ctx);
    return { salvo: true, faltando_para_avaliar: faltando, score: r.score };
  },
});

const horariosDisponiveis = def({
  name: "horarios_disponiveis",
  description: "Lista horários livres para visita/test-drive na loja. Use antes de propor um horário. Ofereça no máximo 2 ou 3 opções ao cliente (se usar enviar_botoes, use rotulo_botao como título e um id como slot_AAAA-MM-DD_HH:MM).",
  schema: z.strictObject({
    data: nul(z.string()).describe("AAAA-MM-DD, se o cliente quer um dia específico"),
    periodo: nul(z.enum(["manha", "tarde"])),
  }),
  run: (i, ctx) => {
    ctx.signals.pediuVisita = true;
    const slots = availableSlots(ctx.settings, { data: i.data, periodo: i.periodo, limite: 8 });
    return slots.length ? { horarios: slots.map((s) => ({ data: s.data, hora: s.hora, texto: s.label, rotulo_botao: s.curto })) } : { horarios: [], aviso: "Sem horários livres nesse período. Sugira outro dia." };
  },
});

const agendarVisita = def({
  name: "agendar_visita",
  description:
    "Agenda a visita do cliente na loja (ver o carro, test-drive ou avaliação da troca). Só chame depois que o cliente CONFIRMAR dia e hora. " +
    "Se o horário não servir, a ferramenta devolve sugestões. Depois de agendar, confirme com o cliente e mande a localização.",
  schema: z.strictObject({
    data: z.string().describe("AAAA-MM-DD"),
    hora: z.string().describe("HH:MM (24h)"),
    tipo: z.enum(["visita", "test_drive", "avaliacao_troca"]),
    veiculo_id: nul(z.string()),
    observacoes: nul(z.string()),
  }),
  run: async (i, ctx) => {
    if (i.veiculo_id) vehicleOrError(i.veiculo_id);
    const check = checkSlot(ctx.settings, i.data, i.hora);
    if (!check.ok) return { agendado: false, motivo: check.motivo, sugestoes: check.sugestoes.map((s) => s.label) };
    const existentes = appointments.upcomingForContact(ctx.contact.id);
    if (existentes.length) {
      // remarca a visita existente em vez de duplicar
      const a = appointments.update(existentes[0].id, { inicio: check.iso, tipo: i.tipo, vehicle_id: i.veiculo_id ?? existentes[0].vehicle_id, notas: i.observacoes ?? existentes[0].notas, reminder_sent: false })!;
      events.add(ctx.contact.id, "visita_remarcada", { id: a.id, inicio: a.inicio });
      publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
      refreshLead(ctx);
      return { agendado: true, remarcado: true, quando: formatDateTimeBR(new Date(a.inicio)) };
    }
    const a = appointments.create({ contact_id: ctx.contact.id, vehicle_id: i.veiculo_id ?? null, tipo: i.tipo, inicio: check.iso, notas: i.observacoes ?? null });
    events.add(ctx.contact.id, "visita_agendada", { id: a.id, inicio: a.inicio, tipo: a.tipo });
    publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
    ctx.signals.visitaAgendada = true;
    const r = refreshLead(ctx);
    void sendConversion(ctx.contact.id, "qualificado");
    // avisa o vendedor sem pausar a IA (ela continua confirmando e tirando dúvidas)
    const seller = pickSeller(ctx.contact);
    return {
      agendado: true,
      quando: formatDateTimeBR(new Date(a.inicio)),
      vendedor_responsavel: seller?.nome ?? null,
      etapa: r.stage,
      proximo_passo: "Confirme o horário com o cliente e mande a localização da loja (enviar_localizacao_loja).",
    };
  },
});

const alterarVisita = def({
  name: "alterar_visita",
  description: "Remarca ou cancela a visita já agendada do cliente.",
  schema: z.strictObject({
    acao: z.enum(["remarcar", "cancelar", "confirmar"]),
    nova_data: nul(z.string()).describe("AAAA-MM-DD"),
    nova_hora: nul(z.string()).describe("HH:MM"),
    motivo: nul(z.string()),
  }),
  run: (i, ctx) => {
    const [a] = appointments.upcomingForContact(ctx.contact.id);
    if (!a) return { aviso: "O cliente não tem visita futura agendada." };
    if (i.acao === "cancelar") {
      appointments.update(a.id, { status: "cancelada", notas: [a.notas, i.motivo].filter(Boolean).join(" | ") });
      events.add(ctx.contact.id, "visita_cancelada", { id: a.id, motivo: i.motivo });
      publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
      return { cancelada: true };
    }
    if (i.acao === "confirmar") {
      appointments.update(a.id, { status: "confirmada" });
      publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
      return { confirmada: true, quando: formatDateTimeBR(new Date(a.inicio)) };
    }
    if (!i.nova_data || !i.nova_hora) throw new ToolError("Para remarcar, informe nova_data e nova_hora.");
    const check = checkSlot(ctx.settings, i.nova_data, i.nova_hora);
    if (!check.ok) return { remarcada: false, motivo: check.motivo, sugestoes: check.sugestoes.map((s) => s.label) };
    appointments.update(a.id, { inicio: check.iso, status: "agendada", reminder_sent: false });
    events.add(ctx.contact.id, "visita_remarcada", { id: a.id, inicio: check.iso });
    publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
    return { remarcada: true, quando: check.label };
  },
});

const enviarLocalizacao = def({
  name: "enviar_localizacao_loja",
  description: "Envia o pin de localização da loja no WhatsApp (com endereço). Use depois de agendar visita ou quando perguntarem onde fica.",
  schema: z.strictObject({}),
  run: async (_i, ctx) => {
    const l = ctx.settings.loja;
    if (l.lat == null || l.lng == null) {
      await deliver(ctx.contact, { type: "text", body: `📍 ${l.endereco}${l.referencia ? ` (${l.referencia})` : ""}${l.maps_url ? `\n${l.maps_url}` : ""}` });
    } else {
      await deliver(ctx.contact, { type: "location", lat: l.lat, lng: l.lng, name: l.nome, address: `${l.endereco}${l.referencia ? ` — ${l.referencia}` : ""}` });
    }
    ctx.sent++;
    return { enviado: true };
  },
});

const enviarBotoes = def({
  name: "enviar_botoes",
  description:
    "Envia uma pergunta com botões de resposta rápida (até 3) ou uma lista (4 a 10 opções). Ótimo para qualificar sem o cliente digitar: forma de pagamento, tipo de carro, escolher horário. " +
    "O texto da pergunta vai junto, então não repita a pergunta na sua resposta. Use no máximo uma vez por resposta.",
  schema: z.strictObject({
    texto: z.string().describe("A pergunta (curta)"),
    opcoes: z
      .array(z.strictObject({ id: z.string().describe("identificador curto, ex.: pag_financiamento"), titulo: z.string().describe("até 20 caracteres em botão, 24 em lista") }))
      .describe("2 a 10 opções"),
    texto_botao_lista: nul(z.string()).describe("Texto do botão que abre a lista (só para 4+ opções), ex.: 'Ver horários'"),
  }),
  run: async (i, ctx) => {
    if (i.opcoes.length < 2) throw new ToolError("Mande pelo menos 2 opções.");
    const item: OutItem =
      i.opcoes.length <= 3
        ? { type: "buttons", body: i.texto, buttons: i.opcoes.map((o) => ({ id: o.id, title: o.titulo })) }
        : { type: "list", body: i.texto, buttonText: i.texto_botao_lista || "Ver opções", rows: i.opcoes.slice(0, 10).map((o) => ({ id: o.id, title: o.titulo })) };
    const row = await deliver(ctx.contact, item);
    ctx.sent++;
    return { enviado: row.status !== "failed" };
  },
});

const enviarMensagem = def({
  name: "enviar_mensagem",
  description:
    "Manda uma mensagem de texto ao cliente NA HORA, antes de terminar sua resposta. Use só quando precisar falar algo antes de outra ação demorada " +
    "(ex.: 'Deixa eu ver aqui no estoque 👀' antes de buscar, ou 'Vou te mandar as fotos' antes de enviar_fotos). A resposta final continua sendo o seu texto normal.",
  schema: z.strictObject({ texto: z.string() }),
  run: async (i, ctx) => {
    await deliver(ctx.contact, { type: "text", body: i.texto });
    ctx.sent++;
    return { enviado: true };
  },
});

const transferirVendedor = def({
  name: "transferir_para_vendedor",
  description:
    "Passa a conversa para um vendedor humano e pausa você neste contato. Use quando: o cliente pedir para falar com uma pessoa; quiser negociar valor/desconto; estiver pronto para fechar " +
    "(já escolheu o carro e a forma de pagamento); precisar de avaliação de troca com fotos recebidas; houver reclamação; ou você não souber responder algo importante. " +
    "Antes de chamar, avise o cliente que um consultor vai continuar o atendimento aqui mesmo em instantes. Depois de chamar, não faça mais perguntas.",
  schema: z.strictObject({
    motivo: z.enum(["pronto_para_negociar", "pediu_humano", "negociacao_de_preco", "avaliacao_de_troca", "duvida_sem_resposta", "reclamacao", "pos_venda"]),
    resumo: z.string().describe("Resumo para o vendedor em 1-3 frases: quem é, qual carro, como quer pagar, o que falta"),
    urgente: z.boolean(),
  }),
  run: async (i, ctx) => {
    const r = await handoff(ctx.contact, i.motivo as HandoffReason, i.resumo, i.urgente);
    ctx.handedOff = true;
    return { transferido: true, ...r, instrucao: "Você foi pausada neste contato. Se já avisou o cliente que um consultor vai continuar, responda apenas [SEM_RESPOSTA]. Se não avisou, mande uma frase curta avisando, sem perguntas." };
  },
});

const encerrarInteresse = def({
  name: "registrar_sem_interesse",
  description:
    "Use quando o cliente disser claramente que não quer mais (comprou em outro lugar, desistiu, número errado) ou pedir para não receber mensagens. " +
    "Para de mandar lembretes automáticos para ele.",
  schema: z.strictObject({
    motivo: z.enum(["comprou_em_outro_lugar", "desistiu", "sem_credito", "preco", "numero_errado", "pediu_para_parar", "outro"]),
    detalhe: nul(z.string()),
  }),
  run: (i, ctx) => {
    const lead = leads.get(ctx.contact.id)!;
    if (lead.stage !== "vendido") leads.update(ctx.contact.id, { stage: "perdido", motivo_perda: [i.motivo, i.detalhe].filter(Boolean).join(": ") });
    if (i.motivo === "pediu_para_parar" || i.motivo === "numero_errado") contacts.update(ctx.contact.id, { opt_out: true });
    events.add(ctx.contact.id, "lead_perdido", { motivo: i.motivo, detalhe: i.detalhe });
    publish({ type: "lead", contactId: ctx.contact.id });
    return { registrado: true };
  },
});

export const TOOLS = [
  buscarEstoque,
  detalhesVeiculo,
  enviarFotos,
  simularFinanciamento,
  registrarCliente,
  registrarTroca,
  horariosDisponiveis,
  agendarVisita,
  alterarVisita,
  enviarLocalizacao,
  enviarBotoes,
  enviarMensagem,
  transferirVendedor,
  encerrarInteresse,
] as const;

const byName = new Map<string, ToolDef<any>>(TOOLS.map((t) => [t.name, t as ToolDef<any>]));

const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern"];

/**
 * Deixa o JSON Schema dentro do que o modo strict aceita: tira limites numéricos/de tamanho
 * (o zod coloca min/max em inteiros) e troca `type: [X, "null"]` por `anyOf`.
 * A validação completa continua sendo feita pelo zod antes de executar a ferramenta.
 */
export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$schema" || UNSUPPORTED.includes(k)) continue;
    out[k] = sanitizeSchema(v);
  }
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const { type: _t, description, ...rest } = out;
    return { ...(description ? { description } : {}), anyOf: types.map((t) => (t === "null" ? { type: "null" } : { type: t, ...rest })) };
  }
  return out;
}

/** Definições no formato da API (ordem fixa para não quebrar o cache do prompt). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const schema = sanitizeSchema(z.toJSONSchema(t.schema)) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
      strict: true,
    };
  });
}

/** Executa uma ferramenta validando a entrada. Erros voltam para o modelo como tool_result com is_error. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = byName.get(name);
  if (!t) return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${name}` }), isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { content: JSON.stringify({ erro: "Parâmetros inválidos", detalhes: parsed.error.issues.slice(0, 5) }), isError: true };
  try {
    const out = await t.run(parsed.data, ctx);
    return { content: JSON.stringify(out), isError: false };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : `Falha interna: ${(e as Error).message}`;
    return { content: JSON.stringify({ erro: msg }), isError: true };
  }
}
