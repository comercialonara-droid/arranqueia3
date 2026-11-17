// Tipos de domínio compartilhados (versão 2: várias lojas, usuários e simulação)

export type Role = "admin" | "dono" | "vendedor";

export interface User {
  id: number;
  store_id: number | null; // admin não tem loja fixa
  role: Role;
  nome: string;
  email: string;
  whatsapp: string | null;
  ativo: boolean;
  recebe_leads: boolean;
  leads_recebidos: number;
  created_at: string;
}

export interface Store {
  id: number;
  slug: string;
  nome: string;
  ativo: boolean;
  wa_phone_number_id: string | null;
  wa_waba_id: string | null;
  wa_access_token: string | null; // criptografado no banco
  meta_dataset_id: string | null;
  created_at: string;
}

export interface WaCreds {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
}

export type VehicleStatus = "disponivel" | "reservado" | "vendido";

export interface VehicleMedia {
  url: string;
  legenda?: string;
}

export interface Vehicle {
  id: string;
  store_id: number;
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
  fotos: VehicleMedia[];
  videos: VehicleMedia[];
  status: VehicleStatus;
  destaque: boolean;
  entrada_sugerida: number | null;
  /** Especificações livres do segmento (bikes: motor, bateria, autonomia…). */
  ficha: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type Channel = "whatsapp" | "simulador";

export interface Contact {
  id: number;
  store_id: number;
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
  origem: string | null;
  tags: string[];
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

export type LeadStage = "novo" | "qualificando" | "qualificado" | "simulacao" | "visita_agendada" | "negociacao" | "vendido" | "perdido";
export const LEAD_STAGES: LeadStage[] = ["novo", "qualificando", "qualificado", "simulacao", "visita_agendada", "negociacao", "vendido", "perdido"];

export type Intent = "so_informacao" | "fotos_videos" | "simulacao" | "visita" | "negociar" | "vender_carro" | "pos_venda" | "sem_interesse" | "indefinida";
export type PaymentKind = "financiamento" | "troca_mais_dinheiro" | "troca_mais_financiamento" | "a_vista" | "consorcio" | "indefinido";
export type Temperature = "frio" | "morno" | "quente" | "pronto";

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

export interface LeadAnalysis {
  resumo: string;
  intencao: Intent;
  objecoes: string[];
  sinais_de_compra: string[];
  proxima_acao: string;
  perfil: string;
  atualizado_em: string;
  fonte: "conversa" | "analise";
}

export interface ScoreBreakdown {
  intencao: number;
  capacidade: number;
  momento: number;
  engajamento: number;
  motivos: string[];
}

export interface Lead {
  contact_id: number;
  store_id: number;
  stage: LeadStage;
  score: number;
  temperatura: Temperature;
  score_detalhe: ScoreBreakdown | null;
  intencao: Intent;
  interesse: string[];
  interesse_texto: string | null;
  orcamento_max: number | null;
  parcela_max: number | null;
  entrada: number | null;
  forma_pagamento: PaymentKind | null;
  tem_troca: boolean | null;
  troca: TradeIn | null;
  cidade: string | null;
  bairro: string | null;
  urgencia: string | null;
  uso: string | null;
  observacoes: string | null;
  analise: LeadAnalysis | null;
  motivo_perda: string | null;
  valor_venda: number | null;
  vehicle_sold_id: string | null;
  updated_at: string;
  stage_changed_at: string;
}

export type SimulationStatus = "coletando" | "enviada" | "em_analise" | "aprovada" | "reprovada" | "desistiu";
export const SIMULATION_STATUSES: SimulationStatus[] = ["coletando", "enviada", "em_analise", "aprovada", "reprovada", "desistiu"];

export interface Simulation {
  id: number;
  store_id: number;
  contact_id: number;
  vehicle_id: string | null;
  seller_id: number | null;
  status: SimulationStatus;
  nome_completo: string | null;
  cpf_enc: string | null;
  data_nascimento: string | null; // AAAA-MM-DD
  tem_cnh: boolean | null;
  forma_pagamento: PaymentKind | null;
  entrada_dinheiro: number | null;
  observacoes: string | null;
  consentimento_em: string | null;
  enviada_em: string | null;
  resultado: string | null;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: number;
  contact_id: number;
  store_id: number;
  vehicle_id: string | null;
  tipo: "visita" | "test_drive" | "avaliacao_troca";
  inicio: string;
  status: "agendada" | "confirmada" | "realizada" | "faltou" | "cancelada";
  notas: string | null;
  reminder_sent: boolean;
  created_at: string;
}

export interface AudioClip {
  id: number;
  store_id: number;
  titulo: string;
  quando_usar: string;
  url: string;
  mime: string;
  duracao_s: number | null;
  ativo: boolean;
  created_at: string;
}

export interface Note {
  id: number;
  contact_id: number;
  user_id: number | null;
  autor: string;
  texto: string;
  created_at: string;
}

export interface QuickReply {
  id: number;
  store_id: number;
  atalho: string;
  texto: string;
}

export interface WeekHours {
  abre: string;
  fecha: string;
}

export interface TemplateRef {
  nome: string;
  idioma: string;
}

export interface StoreSettings {
  loja: {
    nome: string;
    /** segmento da loja: muda vocabulário da IA, ficha do produto e busca */
    segmento: "veiculos" | "bikes_eletricas";
    /** como a IA descreve a loja ("loja de seminovos", "loja de bicicletas elétricas") */
    tipo_loja: string;
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
  horarios: (WeekHours | null)[];
  agenda: { duracao_min: number; antecedencia_min_horas: number; max_por_horario: number; dias_a_frente: number };
  atendimento: {
    nome_assistente: string;
    tom: string;
    /** informar = fala preço · parcela_primeiro = destaca entrada/parcela · so_vendedor = não fala valores */
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
  simulacao: {
    ativa: boolean;
    pedir_cpf: boolean;
    pedir_nascimento: boolean;
    pedir_cnh: boolean;
    texto_privacidade: string;
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
    horas: number[];
    template_reengajamento: TemplateRef | null;
    template_lembrete_visita: TemplateRef | null;
    lembrete_horas_antes: number;
  };
  handoff: {
    notificar_vendedor: boolean;
    template_notificacao: TemplateRef | null;
    pausar_ia_horas: number;
  };
  conversoes: { ativo: boolean; evento_lead: string; evento_qualificado: string; evento_venda: string };
}
