export type Segmento = "veiculos" | "bikes_eletricas";
// Cliente da API do Arranque + tipos usados no painel

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Loja escolhida pelo administrador (dono e vendedor ficam sempre na própria loja). */
export const currentStore = {
  get: () => Number(localStorage.getItem("arranque-loja")) || null,
  set: (id: number | null) => (id ? localStorage.setItem("arranque-loja", String(id)) : localStorage.removeItem("arranque-loja")),
};
const storeHeader = (): Record<string, string> => (currentStore.get() ? { "x-loja": String(currentStore.get()) } : {});
export const withStore = (url: string) => (currentStore.get() ? `${url}${url.includes("?") ? "&" : "?"}loja=${currentStore.get()}` : url);

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...storeHeader(), ...headers },
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

export async function upload(file: File, extra?: Record<string, string>, url = "/api/uploads"): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
  fd.append("file", file);
  const res = await fetch(url, { method: "POST", body: fd, credentials: "same-origin", headers: storeHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.erro ?? "Falha no envio", res.status);
  return data;
}

// ───────── tipos ─────────

export type LeadStage = "novo" | "qualificando" | "qualificado" | "simulacao" | "visita_agendada" | "negociacao" | "vendido" | "perdido";
export const STAGES: { id: LeadStage; label: string }[] = [
  { id: "novo", label: "Novo" },
  { id: "qualificando", label: "Em conversa" },
  { id: "qualificado", label: "Qualificado" },
  { id: "simulacao", label: "Simulação" },
  { id: "visita_agendada", label: "Visita agendada" },
  { id: "negociacao", label: "Negociação" },
  { id: "vendido", label: "Vendido" },
  { id: "perdido", label: "Perdido" },
];
export type Temp = "frio" | "morno" | "quente" | "pronto";
export type Role = "admin" | "dono" | "vendedor";
export type Intent = "so_informacao" | "fotos_videos" | "simulacao" | "visita" | "negociar" | "vender_carro" | "pos_venda" | "sem_interesse" | "indefinida";
export const intentLabel: Record<string, string> = {
  so_informacao: "Só informação",
  fotos_videos: "Quer fotos e vídeos",
  simulacao: "Quer simulação",
  visita: "Quer visitar a loja",
  negociar: "Quer negociar",
  vender_carro: "Quer vender o carro dele",
  pos_venda: "Pós-venda",
  sem_interesse: "Sem interesse",
  indefinida: "Ainda não ficou claro",
};
export interface User {
  id: number;
  store_id: number | null;
  role: Role;
  nome: string;
  email: string;
  whatsapp: string | null;
  ativo: boolean;
  recebe_leads: boolean;
  leads_recebidos: number;
}
export interface Analysis {
  resumo: string;
  intencao: Intent;
  objecoes: string[];
  sinais_de_compra: string[];
  proxima_acao: string;
  perfil: string;
  atualizado_em: string;
  fonte: "conversa" | "analise";
}
export interface ScoreDetail {
  intencao: number;
  capacidade: number;
  momento: number;
  engajamento: number;
  motivos: string[];
}
export type SimStatus = "coletando" | "enviada" | "em_analise" | "aprovada" | "reprovada" | "desistiu";
export const SIM_STATUSES: { id: SimStatus; label: string }[] = [
  { id: "coletando", label: "Coletando dados" },
  { id: "enviada", label: "Nova, para rodar" },
  { id: "em_analise", label: "Em análise no banco" },
  { id: "aprovada", label: "Aprovada" },
  { id: "reprovada", label: "Reprovada" },
  { id: "desistiu", label: "Cliente desistiu" },
];
export interface Simulation {
  id: number;
  contact_id: number;
  vehicle_id: string | null;
  seller_id: number | null;
  status: SimStatus;
  nome_completo: string | null;
  cpf: string | null;
  tem_cpf: boolean;
  data_nascimento: string | null;
  tem_cnh: boolean | null;
  forma_pagamento: string | null;
  entrada_dinheiro: number | null;
  observacoes: string | null;
  resultado: string | null;
  consentimento_em: string | null;
  enviada_em: string | null;
  updated_at: string;
  created_at: string;
  contato_nome?: string | null;
  nome_perfil?: string | null;
  wa_id?: string;
  vendedor?: string | null;
  veiculo?: string | null;
}
export interface AudioClip {
  id: number;
  titulo: string;
  quando_usar: string;
  url: string;
  duracao_s: number | null;
  ativo: boolean;
}
export interface Note {
  id: number;
  autor: string;
  texto: string;
  created_at: string;
}
export interface QuickReply {
  id: number;
  atalho: string;
  texto: string;
}
export const stageLabel = (s: string) => STAGES.find((x) => x.id === s)?.label ?? s;

export interface Me {
  usuario: User;
  loja_atual: { id: number; nome: string; segmento: Segmento } | null;
  lojas: { id: number; nome: string; ativo: boolean; segmento: Segmento }[];
  verify_token?: string;
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
  videos: Photo[];
  status: "disponivel" | "reservado" | "vendido";
  destaque: boolean;
  entrada_sugerida: number | null;
  ficha: Record<string, string>;
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
  tags: string[];
  ia_pausada: boolean;
}

export interface ConversationListItem extends Contact {
  stage: LeadStage;
  score: number;
  temperatura: Temp;
  intencao: Intent;
  vendedor_nome: string | null;
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
  temperatura: Temp;
  score_detalhe: ScoreDetail | null;
  intencao: Intent;
  analise: Analysis | null;
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
  contato: Contact & { janela_24h_aberta: boolean; vendedor: { id: number; nome: string } | null };
  lead: Lead;
  interesse: Vehicle[];
  visitas: Appointment[];
  simulacoes: Simulation[];
  notas: Note[];
  mensagens: Message[];
  eventos: { id: number; name: string; payload: string | null; capi_status: string | null; created_at: string }[];
}

export interface BoardLead extends Lead {
  tags: string[];
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
  simulacoes: number;
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
  serie: { dia: string; conversas: number; simulacoes: number; visitas: number }[];
  anuncios: { anuncio: string; conversas: number; simulacoes: number; visitas: number; vendas: number }[];
  vendedores: { id: number; nome: string; leads: number; simulacoes: number; aprovadas: number; vendas: number }[];
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
    politica_preco: "informar" | "parcela_primeiro" | "so_vendedor";
    citar_nome_vendedor: boolean;
    aceita_troca: boolean;
    aceita_financiamento: boolean;
    compra_carro_sem_troca: boolean;
    garantia: string;
    documentacao: string;
    diferenciais: string[];
    regras_extras: string;
    responder_fora_do_horario: boolean;
  };
  simulacao: { ativa: boolean; pedir_cpf: boolean; pedir_nascimento: boolean; pedir_cnh: boolean; texto_privacidade: string };
  financiamento: { modo: "tabela_price" | "regra_loja"; taxa_mensal_pct: number; prazos: number[]; entrada_minima_pct: number; regra_loja: { a_cada: number; parcela: number; prazo: number }; observacao: string };
  followup: { ativo: boolean; horas: number[]; template_reengajamento: TemplateRef | null; template_lembrete_visita: TemplateRef | null; lembrete_horas_antes: number };
  handoff: { notificar_vendedor: boolean; template_notificacao: TemplateRef | null; pausar_ia_horas: number };
  conversoes: { ativo: boolean; evento_lead: string; evento_qualificado: string; evento_venda: string };
}
