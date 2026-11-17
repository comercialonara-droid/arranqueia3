// Tipos de domínio compartilhados

export type VehicleStatus = "disponivel" | "reservado" | "vendido";

export interface VehiclePhoto {
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
  cambio: string | null; // automatico | manual | cvt
  combustivel: string | null; // flex | gasolina | diesel | gnv | hibrido | eletrico
  carroceria: string | null; // hatch | sedan | suv | picape | utilitario | minivan | cupe | moto
  cor: string | null;
  portas: number | null;
  final_placa: string | null;
  opcionais: string[];
  destaques: string[];
  descricao: string | null;
  fotos: VehiclePhoto[];
  status: VehicleStatus;
  destaque: boolean;
  entrada_sugerida: number | null;
  created_at: string;
  updated_at: string;
}

export type Channel = "whatsapp" | "simulador";

export interface Contact {
  id: number;
  wa_id: string;
  nome: string | null;
  nome_perfil: string | null;
  channel: Channel;
  created_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  opt_out: boolean;
  bot_paused_until: string | null;
  paused_reason: string | null;
  seller_id: number | null;
  ctwa_clid: string | null;
  ad_id: string | null;
  ad_headline: string | null;
  ad_source_url: string | null;
  origem: string | null; // anuncio | organico | indicacao | ...
  ai_cursor: number;
}

export type Direction = "in" | "out";
export type Sender = "cliente" | "ia" | "vendedor" | "sistema";

export interface MessageRow {
  id: number;
  contact_id: number;
  direction: Direction;
  sender: Sender;
  type: string;
  body: string | null;
  media: unknown;
  wa_message_id: string | null;
  status: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

export type LeadStage =
  | "novo"
  | "qualificando"
  | "quente"
  | "visita_agendada"
  | "negociacao"
  | "vendido"
  | "perdido";

export const LEAD_STAGES: LeadStage[] = ["novo", "qualificando", "quente", "visita_agendada", "negociacao", "vendido", "perdido"];

export interface TradeIn {
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano?: number | null;
  km?: number | null;
  cor?: string | null;
  quitado?: boolean | null;
  saldo_devedor?: number | null;
  estado?: string | null;
  valor_esperado?: number | null;
  fotos_recebidas?: boolean | null;
}

export interface Lead {
  contact_id: number;
  stage: LeadStage;
  score: number;
  temperatura: "frio" | "morno" | "quente";
  interesse: string[]; // ids de veículos
  interesse_texto: string | null;
  orcamento_max: number | null;
  parcela_max: number | null;
  entrada: number | null;
  forma_pagamento: string | null; // a_vista | financiamento | consorcio | troca_mais_diferenca | indefinido
  tem_troca: boolean | null;
  troca: TradeIn | null;
  cidade: string | null;
  bairro: string | null;
  urgencia: string | null; // imediata | 30_dias | pesquisando
  uso: string | null;
  observacoes: string | null;
  resumo: string | null;
  motivo_perda: string | null;
  valor_venda: number | null;
  vehicle_sold_id: string | null;
  updated_at: string;
  stage_changed_at: string;
}

export interface Appointment {
  id: number;
  contact_id: number;
  vehicle_id: string | null;
  tipo: "visita" | "test_drive" | "avaliacao_troca";
  inicio: string; // ISO UTC
  status: "agendada" | "confirmada" | "realizada" | "faltou" | "cancelada";
  notas: string | null;
  reminder_sent: boolean;
  created_at: string;
}

export interface Seller {
  id: number;
  nome: string;
  whatsapp: string;
  ativo: boolean;
  leads_recebidos: number;
}

export interface WeekHours {
  abre: string; // "09:00"
  fecha: string; // "18:00"
}

export interface TemplateRef {
  nome: string;
  idioma: string;
}

export interface StoreSettings {
  loja: {
    nome: string;
    cidade: string;
    endereco: string;
    referencia: string;
    site: string;
    instagram: string;
    telefone: string;
    maps_url: string;
    lat: number | null;
    lng: number | null;
  };
  /** índice 0 = domingo … 6 = sábado; null = fechado */
  horarios: (WeekHours | null)[];
  agenda: {
    duracao_min: number;
    antecedencia_min_horas: number;
    max_por_horario: number;
    dias_a_frente: number;
  };
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
  financiamento: {
    modo: "tabela_price" | "regra_loja";
    taxa_mensal_pct: number;
    prazos: number[];
    entrada_minima_pct: number;
    regra_loja: { a_cada: number; parcela: number; prazo: number };
    observacao: string;
  };
  followup: {
    ativo: boolean;
    /** horas sem resposta do cliente para mandar um toque dentro da janela de 24h */
    horas: number[];
    template_reengajamento: TemplateRef | null;
    template_lembrete_visita: TemplateRef | null;
    lembrete_horas_antes: number;
  };
  handoff: {
    notificar_vendedor: boolean;
    template_notificacao: TemplateRef | null;
    pausar_ia_horas: number;
    score_para_handoff: number;
  };
  conversoes: {
    ativo: boolean;
    evento_lead: string;
    evento_qualificado: string;
    evento_venda: string;
  };
}
