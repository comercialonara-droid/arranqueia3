import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { appointments, audios, contacts, effectivePrice, events, leads, messages, simulations, vehicles, vehicleShort, vehicleTitle } from "../db/repos.js";
import type { Contact, Lead, LeadStage, StoreSettings, TradeIn } from "../types.js";
import { searchInventory, vehicleDetails } from "../services/inventory.js";
import { simulate } from "../services/financing.js";
import { availableSlots, checkSlot } from "../services/schedule.js";
import { scoreLead, type ScoreSignals } from "../services/scoring.js";
import { handoff, pickSeller, type HandoffReason } from "../services/handoff.js";
import { sendConversion } from "../services/capi.js";
import { deliver, deliverSequence, type OutItem } from "../pipeline/outbox.js";
import { encrypt, isValidCpf, onlyDigits, parseBirthDate } from "../util/crypto.js";
import { brl, formatDateTimeBR } from "../util/time.js";
import { publish } from "../util/bus.js";
import { nowIso } from "../db/index.js";
import { profileOf, vocab } from "../segments.js";

export interface ToolContext {
  contact: Contact;
  storeId: number;
  settings: StoreSettings;
  signals: ScoreSignals;
  sent: number;
  handedOff: boolean;
}

type ToolDef<S extends z.ZodType> = {
  name: string;
  description: string | ((s: StoreSettings) => string);
  schema: S;
  /** Ferramenta só entra no catálogo quando faz sentido para a loja */
  enabled?: (s: StoreSettings) => boolean;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
};
const def = <S extends z.ZodType>(t: ToolDef<S>) => t;
const nul = <T extends z.ZodType>(t: T) => t.nullable().optional();

export class ToolError extends Error {}

const INTENTS = ["so_informacao", "fotos_videos", "simulacao", "visita", "negociar", "vender_carro", "pos_venda", "sem_interesse", "indefinida"] as const;
const PAYMENTS = ["financiamento", "troca_mais_dinheiro", "troca_mais_financiamento", "a_vista", "consorcio", "indefinido"] as const;

// ───────────────────────── funil e pontuação ─────────────────────────

const STAGE_ORDER: LeadStage[] = ["novo", "qualificando", "qualificado", "simulacao", "visita_agendada", "negociacao", "vendido"];
function advanceStage(cur: LeadStage, target: LeadStage): LeadStage {
  if (cur === "vendido" || cur === "perdido") return cur;
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(cur) ? target : cur;
}

export function refreshLead(ctx: ToolContext) {
  const contact = contacts.get(ctx.contact.id)!;
  ctx.contact = contact;
  const lead = leads.get(contact.id)!;
  ctx.signals.mensagensCliente = messages.forContact(contact.id, 500).filter((m) => m.direction === "in").length;
  ctx.signals.visitaAgendada = appointments.upcomingForContact(contact.id).length > 0;
  ctx.signals.simulacao = simulations.latest(contact.id);
  const { score, temperatura, detalhe } = scoreLead(lead, contact, ctx.signals);

  let stage = lead.stage;
  if (lead.interesse.length || lead.interesse_texto || lead.intencao !== "indefinida" || contact.nome) stage = advanceStage(stage, "qualificando");
  const pagamentoClaro = lead.forma_pagamento && lead.forma_pagamento !== "indefinido" && (lead.entrada || lead.tem_troca || lead.forma_pagamento === "a_vista");
  if (pagamentoClaro || temperatura === "quente" || temperatura === "pronto") stage = advanceStage(stage, "qualificado");
  if (ctx.signals.simulacao && ctx.signals.simulacao.status !== "coletando") stage = advanceStage(stage, "simulacao");
  if (ctx.signals.visitaAgendada) stage = advanceStage(stage, "visita_agendada");

  const updated = leads.update(contact.id, { score, temperatura, score_detalhe: detalhe, stage })!;
  publish({ type: "lead", contactId: contact.id });
  if ((updated.interesse.length || updated.interesse_texto) && (updated.forma_pagamento || updated.intencao === "simulacao" || updated.entrada)) {
    void sendConversion(contact.id, "lead");
  }
  return { score, temperatura, etapa: updated.stage };
}

const vehicleOrError = (ctx: ToolContext, id: string) => {
  const v = vehicles.get(id, ctx.storeId);
  if (!v) throw new ToolError(`Veículo "${id}" não existe. Use buscar_estoque para pegar o id certo.`);
  return v;
};
const addInterest = (ctx: ToolContext, id: string) => {
  const lead = leads.get(ctx.contact.id)!;
  if (!lead.interesse.includes(id)) leads.update(ctx.contact.id, { interesse: [...lead.interesse, id].slice(-5) });
};

function simMissing(ctx: ToolContext) {
  const sim = simulations.latest(ctx.contact.id);
  const cfg = ctx.settings.simulacao;
  const lead = leads.get(ctx.contact.id)!;
  const falta: string[] = [];
  if (!sim?.nome_completo) falta.push("nome completo");
  if (cfg.pedir_cpf && !sim?.cpf_enc) falta.push("CPF");
  if (cfg.pedir_nascimento && !sim?.data_nascimento) falta.push("data de nascimento");
  if (cfg.pedir_cnh && sim?.tem_cnh == null) falta.push("se tem CNH");
  if (!lead.forma_pagamento || lead.forma_pagamento === "indefinido") falta.push("forma de pagamento");
  if (lead.forma_pagamento && ["financiamento", "troca_mais_financiamento", "troca_mais_dinheiro"].includes(lead.forma_pagamento) && lead.entrada == null && !lead.tem_troca)
    falta.push("valor de entrada (ou se vai dar carro na troca)");
  if (!lead.interesse.length && !sim?.vehicle_id) falta.push("qual carro");
  return falta;
}

// ───────────────────────── ferramentas ─────────────────────────

const buscarEstoque = def({
  name: "buscar_estoque",
  description: (s) => {
    const p = profileOf(s);
    return p.id === "veiculos"
      ? "Busca carros disponíveis no estoque da loja. Use SEMPRE antes de falar de qualquer carro ou disponibilidade — nunca invente. " +
          "Aceita busca livre (ex.: 'suv automático', 'corolla', 'carro pra uber') e filtros. Categorias: " + p.categorias.join(", ") + "."
      : `Busca ${p.produtos} disponíveis no estoque da loja. Use SEMPRE antes de falar de qualquer modelo ou disponibilidade — nunca invente. ` +
          `Aceita busca livre (ex.: 'duas baterias', 'v9 max', 'pra fazer entrega', 'dobrável') e filtros. Categorias: ${p.categorias.join(", ")}. ` +
          "Para quem precisa rodar bastante, use autonomia_min (km com uma carga). Ignore cambio, combustivel e km_max.";
  },
  schema: z.strictObject({
    consulta: nul(z.string()).describe("Texto livre do que o cliente procura"),
    marca: nul(z.string()),
    modelo: nul(z.string()),
    categoria: nul(z.string()).describe("Tipo do produto, uma das categorias da descrição"),
    cambio: nul(z.enum(["automatico", "manual"])),
    combustivel: nul(z.string()),
    preco_max: nul(z.number()),
    ano_min: nul(z.number().int()),
    km_max: nul(z.number().int()),
    autonomia_min: nul(z.number().int()).describe("Bikes elétricas: autonomia mínima em km"),
    ordenar: nul(z.enum(["relevancia", "menor_preco", "maior_preco", "mais_novo", "menor_km", "maior_autonomia"])),
    limite: nul(z.number().int()),
  }),
  run: (i, ctx) => {
    const { categoria, ...rest } = i;
    const r = searchInventory(ctx.settings, ctx.storeId, { ...rest, carroceria: categoria });
    events.add(ctx.storeId, ctx.contact.id, "busca_estoque", { filtros: i, total: r.total });
    if (r.total === 0) {
      const alt = searchInventory(ctx.settings, ctx.storeId, { carroceria: categoria, limite: 4 });
      return { total: 0, aviso: "Nada exatamente assim agora. Ofereça parecidos e anote o que ele procura (atualizar_ficha.interesse_texto).", alternativas: alt.veiculos };
    }
    return r;
  },
});

const detalhesVeiculo = def({
  name: "detalhes_veiculo",
  description: "Ficha completa de um carro do estoque (opcionais, descrição, destaques, quantas fotos e vídeos tem).",
  schema: z.strictObject({ veiculo_id: z.string() }),
  run: (i, ctx) => {
    const v = vehicleOrError(ctx, i.veiculo_id);
    addInterest(ctx, v.id);
    refreshLead(ctx);
    return vehicleDetails(ctx.settings, v);
  },
});

const enviarFotos = def({
  name: "enviar_fotos",
  description:
    "Envia fotos reais de um carro no WhatsApp. Padrão: 4 fotos. A legenda é opcional; se usar, escreva algo curto e humano (ex.: 'Olha o interior dele 😍'), nunca uma ficha técnica.",
  schema: z.strictObject({
    veiculo_id: z.string(),
    quantidade: nul(z.number().int()),
    indices: nul(z.array(z.number().int())).describe("Fotos específicas (ver detalhes_veiculo)"),
    legenda: nul(z.string()),
  }),
  run: async (i, ctx) => {
    const v = vehicleOrError(ctx, i.veiculo_id);
    if (!v.fotos.length) return { enviadas: 0, aviso: "Esse carro ainda está sem fotos. Diga que vai pedir para a equipe mandar e ofereça a visita ou um vídeo." };
    const qtd = Math.min(Math.max(i.quantidade ?? 4, 1), 8);
    const fotos = (i.indices?.length ? i.indices.map((n) => v.fotos[n]).filter(Boolean) : v.fotos).slice(0, qtd);
    const rows = await deliverSequence(
      ctx.contact,
      fotos.map((f, n) => ({ type: "image", url: f.url, caption: n === 0 && i.legenda ? i.legenda : undefined }) as OutItem),
    );
    ctx.sent += rows.length;
    ctx.signals.pediuFotos = true;
    addInterest(ctx, v.id);
    events.add(ctx.storeId, ctx.contact.id, "fotos_enviadas", { veiculo_id: v.id, qtd: rows.length });
    refreshLead(ctx);
    return { enviadas: rows.filter((r) => r.status !== "failed").length, total_fotos_do_carro: v.fotos.length, tem_video: v.videos.length > 0 };
  },
});

const enviarVideos = def({
  name: "enviar_videos",
  description: "Envia vídeo(s) reais do carro no WhatsApp. Use quando pedirem vídeo ou quando o carro tiver vídeo e o cliente estiver curioso.",
  schema: z.strictObject({ veiculo_id: z.string(), quantidade: nul(z.number().int()), legenda: nul(z.string()) }),
  run: async (i, ctx) => {
    const v = vehicleOrError(ctx, i.veiculo_id);
    if (!v.videos.length) return { enviados: 0, aviso: "Esse carro ainda não tem vídeo. Ofereça as fotos ou diga que pede para a equipe gravar." };
    const vids = v.videos.slice(0, Math.min(Math.max(i.quantidade ?? 1, 1), 3));
    const rows = await deliverSequence(ctx.contact, vids.map((f, n) => ({ type: "video", url: f.url, caption: n === 0 && i.legenda ? i.legenda : undefined }) as OutItem));
    ctx.sent += rows.length;
    ctx.signals.pediuVideos = true;
    addInterest(ctx, v.id);
    events.add(ctx.storeId, ctx.contact.id, "videos_enviados", { veiculo_id: v.id, qtd: rows.length });
    refreshLead(ctx);
    return { enviados: rows.filter((r) => r.status !== "failed").length };
  },
});

const enviarAudio = def({
  name: "enviar_audio",
  description:
    "Envia um áudio gravado pelo vendedor da loja (lista de áudios no prompt, com quando usar cada um). Deixa o atendimento mais humano. " +
    "No máximo um áudio por resposta, nunca o mesmo áudio duas vezes para o mesmo cliente.",
  schema: z.strictObject({ audio_id: z.number().int() }),
  run: async (i, ctx) => {
    const a = audios.forStore(ctx.storeId, true).find((x) => x.id === i.audio_id);
    if (!a) throw new ToolError("Áudio não encontrado ou desativado.");
    if (audios.sentTo(ctx.contact.id).includes(a.id)) return { enviado: false, aviso: "Esse áudio já foi enviado para este cliente. Responda em texto." };
    const row = await deliver(ctx.contact, { type: "audio", url: a.url, titulo: a.titulo }, "ia", { audio_id: a.id });
    ctx.sent++;
    events.add(ctx.storeId, ctx.contact.id, "audio_enviado", { audio_id: a.id, titulo: a.titulo });
    return { enviado: row.status !== "failed" };
  },
});

const atualizarFicha = def({
  name: "atualizar_ficha",
  description:
    "Atualiza a ficha do cliente no CRM e a sua leitura da conversa. Chame sempre que descobrir algo novo e, pelo menos, quando a intenção do cliente mudar. " +
    "Preencha só o que o cliente disse de verdade. O resumo e a próxima ação são para o vendedor ler: seja concreta.",
  schema: z.strictObject({
    nome: nul(z.string()).describe("Como o cliente quer ser chamado"),
    cidade: nul(z.string()),
    bairro: nul(z.string()),
    interesse_veiculo_ids: nul(z.array(z.string())),
    interesse_texto: nul(z.string()).describe("O que procura, em poucas palavras"),
    intencao: nul(z.enum(INTENTS)).describe("O que o cliente quer agora"),
    forma_pagamento: nul(z.enum(PAYMENTS)),
    entrada: nul(z.number()).describe("Entrada em dinheiro, em reais"),
    orcamento_max: nul(z.number()),
    parcela_max: nul(z.number()),
    urgencia: nul(z.enum(["imediata", "30_dias", "pesquisando"])),
    uso: nul(z.string()).describe("Família, trabalho, aplicativo…"),
    objecoes: nul(z.array(z.string())).describe("Dúvidas ou travas que o cliente demonstrou"),
    sinais_de_compra: nul(z.array(z.string())),
    resumo_para_vendedor: nul(z.string()).describe("2 a 3 frases: quem é, o que quer, como paga, em que ponto está"),
    proxima_acao: nul(z.string()).describe("O que o vendedor deve fazer a seguir"),
    observacoes: nul(z.string()),
  }),
  run: (i, ctx) => {
    if (i.nome) contacts.update(ctx.contact.id, { nome: i.nome });
    const lead = leads.get(ctx.contact.id)!;
    const patch: Partial<Lead> = {};
    for (const k of ["cidade", "bairro", "interesse_texto", "intencao", "forma_pagamento", "entrada", "orcamento_max", "parcela_max", "urgencia", "uso"] as const) {
      if (i[k] != null) (patch as any)[k] = i[k];
    }
    if (i.observacoes) patch.observacoes = [lead.observacoes, i.observacoes].filter(Boolean).join(" | ").slice(-1500);
    if (i.interesse_veiculo_ids?.length) {
      const ok = i.interesse_veiculo_ids.filter((id) => vehicles.get(id, ctx.storeId));
      patch.interesse = Array.from(new Set([...lead.interesse, ...ok])).slice(-5);
    }
    if (i.resumo_para_vendedor || i.proxima_acao || i.objecoes || i.sinais_de_compra || i.intencao) {
      const prev = lead.analise;
      patch.analise = {
        resumo: i.resumo_para_vendedor ?? prev?.resumo ?? "",
        intencao: i.intencao ?? prev?.intencao ?? lead.intencao,
        objecoes: i.objecoes ?? prev?.objecoes ?? [],
        sinais_de_compra: i.sinais_de_compra ?? prev?.sinais_de_compra ?? [],
        proxima_acao: i.proxima_acao ?? prev?.proxima_acao ?? "",
        perfil: prev?.perfil ?? "",
        atualizado_em: nowIso(),
        fonte: "conversa",
      };
    }
    leads.update(ctx.contact.id, patch);
    const r = refreshLead(ctx);
    return { salvo: true, ...r };
  },
});

const registrarTroca = def({
  name: "registrar_troca",
  description:
    "Registra o carro que o cliente quer dar na troca (como entrada). Para a loja avaliar: modelo, ano, km, se é quitado e fotos (frente, traseira, laterais, painel ligado). " +
    "Nunca dê valor de avaliação.",
  schema: z.strictObject({
    marca: nul(z.string()),
    modelo: nul(z.string()),
    versao: nul(z.string()),
    ano: nul(z.number().int()),
    km: nul(z.number().int()),
    cor: nul(z.string()),
    quitado: nul(z.boolean()),
    saldo_devedor: nul(z.number()),
    estado: nul(z.string()),
    valor_esperado: nul(z.number()),
    fotos_recebidas: nul(z.boolean()),
  }),
  run: (i, ctx) => {
    if (!ctx.settings.atendimento.aceita_troca) return { aviso: "A loja não aceita carro na troca. Explique com gentileza e ofereça outras formas de pagamento." };
    const lead = leads.get(ctx.contact.id)!;
    const troca: TradeIn = { ...(lead.troca ?? {}) };
    for (const [k, v] of Object.entries(i)) if (v != null) (troca as any)[k] = v;
    const fp = lead.forma_pagamento && lead.forma_pagamento !== "indefinido" ? lead.forma_pagamento : "troca_mais_dinheiro";
    leads.update(ctx.contact.id, { tem_troca: true, troca, forma_pagamento: fp });
    const faltando: string[] = (["modelo", "ano", "km", "quitado"] as const).filter((k) => troca[k] == null);
    if (!troca.fotos_recebidas) faltando.push("fotos");
    const r = refreshLead(ctx);
    return { salvo: true, faltando_para_avaliar: faltando, ...r };
  },
});

const registrarSimulacao = def({
  name: "registrar_dados_simulacao",
  description:
    "Guarda os dados que o cliente passou para a simulação de crédito (nome completo, CPF, data de nascimento, CNH) e o carro escolhido. " +
    "Pode chamar várias vezes, com o que tiver. Antes de pedir o CPF, avise em uma frase para que serve (o texto de privacidade está no prompt) e marque consentimento=true quando o cliente topar. " +
    "A ferramenta confere o CPF e a data e diz o que ainda falta.",
  enabled: (s) => s.simulacao.ativa,
  schema: z.strictObject({
    veiculo_id: nul(z.string()),
    nome_completo: nul(z.string()),
    cpf: nul(z.string()),
    data_nascimento: nul(z.string()).describe("Como o cliente escreveu, ex.: 15/03/1990"),
    tem_cnh: nul(z.boolean()),
    consentimento: nul(z.boolean()).describe("Cliente concordou em passar os dados para a análise"),
    observacoes: nul(z.string()),
  }),
  run: (i, ctx) => {
    const sim = simulations.open(ctx.contact.id, ctx.storeId)!;
    const patch: Record<string, unknown> = {};
    const problemas: string[] = [];
    if (i.veiculo_id) {
      vehicleOrError(ctx, i.veiculo_id);
      patch.vehicle_id = i.veiculo_id;
      addInterest(ctx, i.veiculo_id);
    } else if (!sim.vehicle_id) {
      const lead = leads.get(ctx.contact.id)!;
      if (lead.interesse.length) patch.vehicle_id = lead.interesse[lead.interesse.length - 1];
    }
    if (i.nome_completo) {
      if (i.nome_completo.trim().split(/\s+/).length < 2) problemas.push("nome completo precisa ter nome e sobrenome");
      else patch.nome_completo = i.nome_completo.trim();
    }
    if (i.cpf) {
      if (!isValidCpf(i.cpf)) problemas.push("CPF inválido: peça para conferir os números com gentileza");
      else patch.cpf_enc = encrypt(onlyDigits(i.cpf));
    }
    if (i.data_nascimento) {
      const d = parseBirthDate(i.data_nascimento);
      if (!d) problemas.push("data de nascimento inválida (ou menor de 18 anos): peça no formato dia/mês/ano");
      else patch.data_nascimento = d;
    }
    if (i.tem_cnh != null) patch.tem_cnh = i.tem_cnh;
    if (i.consentimento) patch.consentimento_em = nowIso();
    if (i.observacoes) patch.observacoes = [sim.observacoes, i.observacoes].filter(Boolean).join(" | ");
    const lead = leads.get(ctx.contact.id)!;
    patch.forma_pagamento = lead.forma_pagamento;
    patch.entrada_dinheiro = lead.entrada;
    simulations.update(sim.id, patch as any);
    if (lead.intencao !== "simulacao") leads.update(ctx.contact.id, { intencao: "simulacao" });
    events.add(ctx.storeId, ctx.contact.id, "simulacao_dados", { campos: Object.keys(patch).filter((k) => k !== "cpf_enc").concat(patch.cpf_enc ? ["cpf"] : []) });
    publish({ type: "lead", contactId: ctx.contact.id });
    refreshLead(ctx);
    const falta = simMissing(ctx);
    return {
      salvo: problemas.length === 0,
      problemas,
      falta,
      pronto_para_enviar: falta.length === 0 && problemas.length === 0,
      proximo_passo: falta.length ? `Peça de forma leve: ${falta.slice(0, 2).join(" e ")}.` : "Tudo certo: chame enviar_simulacao_para_vendedor.",
    };
  },
});

const enviarSimulacao = def({
  name: "enviar_simulacao_para_vendedor",
  description:
    "Quando a ficha de simulação estiver completa, envia para o vendedor rodar a simulação e assumir a conversa. A IA fica pausada nesse cliente depois disso. " +
    "Antes de chamar, avise o cliente que o consultor vai rodar a simulação e falar com ele por aqui mesmo.",
  enabled: (s) => s.simulacao.ativa,
  schema: z.strictObject({ resumo: z.string().describe("Resumo para o vendedor: carro, forma de pagamento, entrada/troca, perfil do cliente") }),
  run: async (i, ctx) => {
    const falta = simMissing(ctx);
    if (falta.length) return { enviado: false, falta, aviso: "Ainda falta informação. Peça ao cliente antes de enviar." };
    const sim = simulations.open(ctx.contact.id, ctx.storeId, false) ?? simulations.latest(ctx.contact.id)!;
    const seller = pickSeller(ctx.contact);
    simulations.update(sim.id, { status: "enviada", enviada_em: nowIso(), seller_id: seller?.id ?? null });
    events.add(ctx.storeId, ctx.contact.id, "simulacao_enviada", { simulation_id: sim.id, seller_id: seller?.id ?? null });
    const r = await handoff(ctx.contact, "simulacao_pronta", i.resumo, true);
    ctx.handedOff = true;
    refreshLead(ctx);
    return {
      enviado: true,
      vendedor: ctx.settings.atendimento.citar_nome_vendedor ? r.vendedor : "um consultor",
      instrucao: "Você foi pausada neste cliente. Se já avisou que o consultor vai chamar, responda [SEM_RESPOSTA]; se não, avise em uma frase curta e animada.",
    };
  },
});

const simularFinanciamento = def({
  name: "simular_financiamento",
  description: "Faz uma conta aproximada de parcela (não é análise de crédito). Sempre diga que é aproximado e sujeito à análise.",
  enabled: (s) => s.atendimento.aceita_financiamento && s.atendimento.politica_preco !== "so_vendedor",
  schema: z.strictObject({ veiculo_id: nul(z.string()), valor: nul(z.number()), entrada: nul(z.number()), prazo: nul(z.number().int()) }),
  run: (i, ctx) => {
    let valor = i.valor ?? null;
    let titulo: string | null = null;
    if (i.veiculo_id) {
      const v = vehicleOrError(ctx, i.veiculo_id);
      valor = effectivePrice(v);
      titulo = vehicleShort(v);
      if (i.entrada == null && v.entrada_sugerida) i.entrada = v.entrada_sugerida;
    }
    if (!valor) throw new ToolError("Sem valor para calcular.");
    const sim = simulate(ctx.settings.financiamento, valor, i.entrada, i.prazo);
    events.add(ctx.storeId, ctx.contact.id, "conta_parcela", { valor, entrada: sim.entrada });
    return { carro: titulo, entrada: brl(sim.entrada), opcoes: sim.opcoes.map((o) => `${o.prazo}x de ${brl(o.parcela)}`), observacao: sim.observacao };
  },
});

const horariosDisponiveis = def({
  name: "horarios_disponiveis",
  description: "Horários livres para visita/test-drive. Ofereça 2 ou 3. Em botões, use rotulo_botao como título e id slot_AAAA-MM-DD_HH:MM.",
  schema: z.strictObject({ data: nul(z.string()).describe("AAAA-MM-DD"), periodo: nul(z.enum(["manha", "tarde"])) }),
  run: (i, ctx) => {
    ctx.signals.pediuVisita = true;
    const slots = availableSlots(ctx.storeId, ctx.settings, { data: i.data, periodo: i.periodo, limite: 8 });
    return slots.length ? { horarios: slots.map((s) => ({ data: s.data, hora: s.hora, texto: s.label, rotulo_botao: s.curto })) } : { horarios: [], aviso: "Sem horários nesse período." };
  },
});

const agendarVisita = def({
  name: "agendar_visita",
  description: "Agenda a visita na loja. Só chame depois que o cliente CONFIRMAR dia e hora. Depois confirme e mande a localização.",
  schema: z.strictObject({
    data: z.string().describe("AAAA-MM-DD"),
    hora: z.string().describe("HH:MM"),
    tipo: z.enum(["visita", "test_drive", "avaliacao_troca"]),
    veiculo_id: nul(z.string()),
    observacoes: nul(z.string()),
  }),
  run: async (i, ctx) => {
    if (i.veiculo_id) vehicleOrError(ctx, i.veiculo_id);
    const check = checkSlot(ctx.storeId, ctx.settings, i.data, i.hora);
    if (!check.ok) return { agendado: false, motivo: check.motivo, sugestoes: check.sugestoes.map((s) => s.label) };
    const [existente] = appointments.upcomingForContact(ctx.contact.id);
    const a = existente
      ? appointments.update(existente.id, { inicio: check.iso, tipo: i.tipo, vehicle_id: i.veiculo_id ?? existente.vehicle_id, notas: i.observacoes ?? existente.notas, reminder_sent: false })!
      : appointments.create({ contact_id: ctx.contact.id, store_id: ctx.storeId, vehicle_id: i.veiculo_id ?? null, tipo: i.tipo, inicio: check.iso, notas: i.observacoes ?? null });
    events.add(ctx.storeId, ctx.contact.id, existente ? "visita_remarcada" : "visita_agendada", { id: a.id, inicio: a.inicio, tipo: a.tipo });
    publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
    ctx.signals.visitaAgendada = true;
    if (!existente) void sendConversion(ctx.contact.id, "qualificado");
    pickSeller(ctx.contact);
    const r = refreshLead(ctx);
    return { agendado: true, quando: formatDateTimeBR(new Date(a.inicio)), etapa: r.etapa, proximo_passo: "Confirme com o cliente e mande a localização." };
  },
});

const alterarVisita = def({
  name: "alterar_visita",
  description: "Confirma, remarca ou cancela a visita já agendada.",
  schema: z.strictObject({ acao: z.enum(["remarcar", "cancelar", "confirmar"]), nova_data: nul(z.string()), nova_hora: nul(z.string()), motivo: nul(z.string()) }),
  run: (i, ctx) => {
    const [a] = appointments.upcomingForContact(ctx.contact.id);
    if (!a) return { aviso: "O cliente não tem visita futura." };
    if (i.acao === "cancelar") {
      appointments.update(a.id, { status: "cancelada", notas: [a.notas, i.motivo].filter(Boolean).join(" | ") });
      events.add(ctx.storeId, ctx.contact.id, "visita_cancelada", { id: a.id, motivo: i.motivo });
      publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
      return { cancelada: true };
    }
    if (i.acao === "confirmar") {
      appointments.update(a.id, { status: "confirmada" });
      publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
      return { confirmada: true, quando: formatDateTimeBR(new Date(a.inicio)) };
    }
    if (!i.nova_data || !i.nova_hora) throw new ToolError("Para remarcar, informe nova_data e nova_hora.");
    const check = checkSlot(ctx.storeId, ctx.settings, i.nova_data, i.nova_hora);
    if (!check.ok) return { remarcada: false, motivo: check.motivo, sugestoes: check.sugestoes.map((s) => s.label) };
    appointments.update(a.id, { inicio: check.iso, status: "agendada", reminder_sent: false });
    publish({ type: "appointment", contactId: ctx.contact.id, appointmentId: a.id });
    return { remarcada: true, quando: check.label };
  },
});

const enviarLocalizacao = def({
  name: "enviar_localizacao_loja",
  description: "Envia a localização da loja (pin no mapa).",
  schema: z.strictObject({}),
  run: async (_i, ctx) => {
    const l = ctx.settings.loja;
    if (l.lat == null || l.lng == null) await deliver(ctx.contact, { type: "text", body: `📍 ${l.endereco}${l.referencia ? ` (${l.referencia})` : ""}${l.maps_url ? `\n${l.maps_url}` : ""}` });
    else await deliver(ctx.contact, { type: "location", lat: l.lat, lng: l.lng, name: l.nome, address: `${l.endereco}${l.referencia ? ` — ${l.referencia}` : ""}` });
    ctx.sent++;
    return { enviado: true };
  },
});

const enviarBotoes = def({
  name: "enviar_botoes",
  description:
    "Envia uma pergunta com botões de resposta rápida (até 3) ou lista (4 a 10). Use com moderação — no máximo uma vez a cada poucas mensagens — para escolhas simples " +
    "(como vai pagar, escolher horário). O texto vai junto: não repita a pergunta na resposta.",
  schema: z.strictObject({
    texto: z.string(),
    opcoes: z.array(z.strictObject({ id: z.string(), titulo: z.string().describe("até 20 caracteres") })),
    texto_botao_lista: nul(z.string()),
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
  description: "Manda um texto ao cliente NA HORA, antes de outra ação (ex.: 'Vou te mandar as fotos 👀' antes de enviar_fotos). A resposta final continua sendo seu texto normal.",
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
    "Passa a conversa para um vendedor e pausa você neste cliente. Use quando: pediu uma pessoa; quer saber preço/condição e a loja só passa com o consultor; quer negociar; " +
    "mandou fotos da troca e quer avaliação; reclamação; pós-venda; dúvida importante sem resposta. Para simulação, prefira enviar_simulacao_para_vendedor.",
  schema: z.strictObject({
    motivo: z.enum(["pronto_para_negociar", "pediu_humano", "negociacao_de_preco", "avaliacao_de_troca", "duvida_sem_resposta", "reclamacao", "pos_venda"]),
    resumo: z.string(),
    urgente: z.boolean(),
  }),
  run: async (i, ctx) => {
    const r = await handoff(ctx.contact, i.motivo as HandoffReason, i.resumo, i.urgente);
    ctx.handedOff = true;
    return {
      transferido: true,
      vendedor: ctx.settings.atendimento.citar_nome_vendedor ? r.vendedor : "um consultor",
      instrucao: "Você foi pausada neste cliente. Se já avisou, responda [SEM_RESPOSTA]; se não, uma frase curta avisando, sem perguntas.",
    };
  },
});

const semInteresse = def({
  name: "registrar_sem_interesse",
  description: "Cliente disse claramente que não quer mais (comprou em outro lugar, desistiu, número errado) ou pediu para não receber mensagens.",
  schema: z.strictObject({
    motivo: z.enum(["comprou_em_outro_lugar", "desistiu", "sem_credito", "preco", "numero_errado", "pediu_para_parar", "outro"]),
    detalhe: nul(z.string()),
  }),
  run: (i, ctx) => {
    const lead = leads.get(ctx.contact.id)!;
    if (lead.stage !== "vendido") leads.update(ctx.contact.id, { stage: "perdido", intencao: "sem_interesse", motivo_perda: [i.motivo, i.detalhe].filter(Boolean).join(": ") });
    if (i.motivo === "pediu_para_parar" || i.motivo === "numero_errado") contacts.update(ctx.contact.id, { opt_out: true });
    events.add(ctx.storeId, ctx.contact.id, "lead_perdido", { motivo: i.motivo, detalhe: i.detalhe });
    publish({ type: "lead", contactId: ctx.contact.id });
    return { registrado: true };
  },
});

export const TOOLS = [
  buscarEstoque,
  detalhesVeiculo,
  enviarFotos,
  enviarVideos,
  enviarAudio,
  atualizarFicha,
  registrarTroca,
  registrarSimulacao,
  enviarSimulacao,
  simularFinanciamento,
  horariosDisponiveis,
  agendarVisita,
  alterarVisita,
  enviarLocalizacao,
  enviarBotoes,
  enviarMensagem,
  transferirVendedor,
  semInteresse,
] as const;

const byName = new Map<string, ToolDef<any>>(TOOLS.map((t) => [t.name, t as ToolDef<any>]));

const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern"];

/** Deixa o JSON Schema dentro do que o modo strict aceita (o zod valida o resto antes de executar). */
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

/** Catálogo de ferramentas da loja (ordem fixa; só muda quando as configurações mudam). */
export function toolDefinitions(s: StoreSettings): Anthropic.Beta.BetaTool[] {
  return TOOLS.filter((t) => !t.enabled || t.enabled(s)).map((t) => ({
    name: t.name,
    description: vocab(typeof t.description === "function" ? t.description(s) : t.description, profileOf(s)),
    input_schema: sanitizeSchema(z.toJSONSchema(t.schema)) as Anthropic.Beta.BetaTool["input_schema"],
    strict: true,
  }));
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = byName.get(name);
  if (!t || (t.enabled && !t.enabled(ctx.settings))) return { content: JSON.stringify({ erro: `Ferramenta indisponível: ${name}` }), isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { content: JSON.stringify({ erro: "Parâmetros inválidos", detalhes: parsed.error.issues.slice(0, 5) }), isError: true };
  try {
    return { content: vocab(JSON.stringify(await t.run(parsed.data, ctx)), profileOf(ctx.settings)), isError: false };
  } catch (e) {
    return { content: JSON.stringify({ erro: e instanceof ToolError ? e.message : `Falha interna: ${(e as Error).message}` }), isError: true };
  }
}
