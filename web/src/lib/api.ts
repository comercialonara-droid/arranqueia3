// Cliente da API do Arranque + tipos usados no painel

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.endsWith("/login") && path !== "/api/me") window.dispatchEvent(new Event("arranque:logout"));
    throw new ApiError((data as { erro?: string }).erro ?? `Erro ${res.status}`, res.status);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, json?: unknown) => api<T>(p, { method: "POST", json: json ?? {} });
export const put = <T,>(p: string, json: unknown) => api<T>(p, { method: "PUT", json });
export const patch = <T,>(p: string, json: unknown) => api<T>(p, { method: "PATCH", json });
export const del = <T,>(p: string) => api<T>(p, { method: "DELETE" });

export async function upload(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.erro ?? "Falha no envio", res.status);
  return data;
}

// ───────── tipos ─────────

export type LeadStage = "novo" | "qualificando" | "quente" | "visita_agendada" | "negociacao" | "vendido" | "perdido";
export const STAGES: { id: LeadStage; label: string }[] = [
  { id: "novo", label: "Novo" },
  { id: "qualificando", label: "Qualificando" },
  { id: "quente", label: "Quente" },
  { id: "visita_agendada", label: "Visita agendada" },
  { id: "negociacao", label: "Negociação" },
  { id: "vendido", label: "Vendido" },
  { id: "perdido", label: "Perdido" },
];
export const stageLabel = (s: string) => STAGES.find((x) => x.id === s)?.label ?? s;

export interface Me {
  ok: boolean;
  loja: string;
  whatsapp_configurado: boolean;
  ia: { provedor: "anthropic" | "mock"; modelo: string; esforco: string };
  transcricao: boolean;
  conversoes_configuradas: boolean;
  webhook_url: string;
  senha_padrao: boolean;
}

export interface Photo {
  url: string;
  legenda?: string;
}

export interface Vehicle {
  id: string;
  marca: string;
  modelo: string;
  versao: string | null;
  ano_fab: number | null;
  ano_modelo: number | null;
  km: number | null;
  preco: number | null;
  preco_promocional: number | null;
  fipe: number | null;
  cambio: string | null;
  combustivel: string | null;
  carroceria: string | null;
  cor: string | null;
  portas: number | null;
  final_placa: string | null;
  opcionais: string[];
  destaques: string[];
  descricao: string | null;
  fotos: Photo[];
  status: "disponivel" | "reservado" | "vendido";
  destaque: boolean;
  entrada_sugerida: number | null;
  updated_at: string;
}

export interface Contact {
  id: number;
  wa_id: string;
  nome: string | null;
  nome_perfil: string | null;
  channel: "whatsapp" | "simulador";
  created_at: string;
  last_inbound_at: string | null;
  opt_out: boolean;
  bot_paused_until: string | null;
  paused_reason: string | null;
  seller_id: number | null;
  ctwa_clid: string | null;
  ad_headline: string | null;
  origem: string | null;
  ia_pausada: boolean;
}

export interface ConversationListItem extends Contact {
  stage: LeadStage;
  score: number;
  temperatura: "frio" | "morno" | "quente";
  interesse_texto: string | null;
  last_body: string | null;
  last_sender: string | null;
  last_at: string | null;
}

export interface Message {
  id: number;
  contact_id: number;
  direction: "in" | "out";
  sender: "cliente" | "ia" | "vendedor" | "sistema";
  type: string;
  body: string | null;
  media: any;
  status: string | null;
  created_at: string;
  meta: Record<string, any> | null;
}

export interface TradeIn {
  marca?: string | null;
  modelo?: string | null;
  ano?: number | null;
  km?: number | null;
  quitado?: boolean | null;
  estado?: string | null;
  valor_esperado?: number | null;
  fotos_recebidas?: boolean | null;
}

export interface Lead {
  contact_id: number;
  stage: LeadStage;
  score: number;
  temperatura: "frio" | "morno" | "quente";
  interesse: string[];
  interesse_texto: string | null;
  orcamento_max: number | null;
  parcela_max: number | null;
  entrada: number | null;
  forma_pagamento: string | null;
  tem_troca: boolean | null;
  troca: TradeIn | null;
  cidade: string | null;
  bairro: string | null;
  urgencia: string | null;
  uso: string | null;
  observacoes: string | null;
  resumo: string | null;
  motivo_perda: string | null;
  valor_venda: number | null;
  vehicle_sold_id: string | null;
  updated_at: string;
}

export interface Appointment {
  id: number;
  contact_id: number;
  vehicle_id: string | null;
  tipo: "visita" | "test_drive" | "avaliacao_troca";
  inicio: string;
  status: "agendada" | "confirmada" | "realizada" | "faltou" | "cancelada";
  notas: string | null;
}

export interface AgendaItem extends Appointment {
  nome: string | null;
  nome_perfil: string | null;
  wa_id: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano_modelo: number | null;
}

export interface Seller {
  id: number;
  nome: string;
  whatsapp: string;
  ativo: boolean;
  leads_recebidos: number;
}

export interface Conversation {
  contato: Contact & { janela_24h_aberta: boolean; vendedor: Seller | null };
  lead: Lead;
  interesse: Vehicle[];
  visitas: Appointment[];
  mensagens: Message[];
  eventos: { id: number; name: string; payload: string | null; capi_status: string | null; created_at: string }[];
}

export interface BoardLead extends Lead {
  nome: string | null;
  nome_perfil: string | null;
  wa_id: string;
  ctwa_clid: string | null;
  ad_headline: string | null;
  origem: string | null;
  bot_paused_until: string | null;
  channel: string;
  last_at: string | null;
  veiculos: { id: string; titulo: string; foto: string | null }[];
  vendedor: string | null;
}

export interface Kpis {
  conversas: number;
  de_anuncio: number;
  leads_qualificados: number;
  visitas_agendadas: number;
  transferencias: number;
  vendas: number;
  faturamento: number;
}

export interface Stats {
  periodo: { dias: number; inicio: string; fim: string };
  atual: Kpis;
  anterior: Kpis;
  primeira_resposta_mediana_s: number | null;
  funil: Partial<Record<LeadStage, number>>;
  serie: { dia: string; conversas: number; visitas: number; leads: number }[];
  anuncios: { anuncio: string; conversas: number; visitas: number; vendas: number }[];
  carros: { id: string; titulo: string; procura: number; status: string }[];
  ia: { modelo: string; provedor: string; tokens: { input: number; output: number; cache_read: number }; custo_estimado_usd: number };
}

export interface TemplateRef {
  nome: string;
  idioma: string;
}

export interface Settings {
  loja: { nome: string; cidade: string; endereco: string; referencia: string; site: string; instagram: string; telefone: string; maps_url: string; lat: number | null; lng: number | null };
  horarios: ({ abre: string; fecha: string } | null)[];
  agenda: { duracao_min: number; antecedencia_min_horas: number; max_por_horario: number; dias_a_frente: number };
  atendimento: {
    nome_assistente: string;
    tom: string;
    politica_preco: "informar" | "parcela_primeiro";
    aceita_troca: boolean;
    aceita_financiamento: boolean;
    garantia: string;
    documentacao: string;
    diferenciais: string[];
    regras_extras: string;
    responder_fora_do_horario: boolean;
  };
  financiamento: { modo: "tabela_price" | "regra_loja"; taxa_mensal_pct: number; prazos: number[]; entrada_minima_pct: number; regra_loja: { a_cada: number; parcela: number; prazo: number }; observacao: string };
  followup: { ativo: boolean; horas: number[]; template_reengajamento: TemplateRef | null; template_lembrete_visita: TemplateRef | null; lembrete_horas_antes: number };
  handoff: { notificar_vendedor: boolean; template_notificacao: TemplateRef | null; pausar_ia_horas: number; score_para_handoff: number };
  conversoes: { ativo: boolean; evento_lead: string; evento_qualificado: string; evento_venda: string };
}
