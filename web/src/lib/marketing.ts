import { brl } from "./format";

export type CampaignStatus = "gerando" | "rascunho" | "ativa" | "pausada" | "encerrada" | "erro";

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  gerando: "IA escrevendo o plano",
  rascunho: "Rascunho",
  ativa: "No ar",
  pausada: "Pausada",
  encerrada: "Encerrada",
  erro: "Falhou",
};

export const OBJETIVO_LABEL: Record<string, string> = {
  leads_whatsapp: "Conversas no WhatsApp",
  visitas: "Visitas na loja",
  vendas: "Vendas",
  marca: "Marca na região",
};

export const CANAL_LABEL: Record<string, string> = { meta: "Instagram e Facebook", google: "Google", tiktok: "TikTok" };
export const FORMATO_LABEL: Record<string, string> = { video_reels: "Vídeo (Reels)", carrossel: "Carrossel", imagem: "Imagem", stories: "Stories" };
export const NOTA_LABEL: Record<string, { t: string; cls: string }> = {
  otima: { t: "Ótima", cls: "bg-verde text-white" },
  boa: { t: "Boa", cls: "bg-verde/15 text-verde" },
  atencao: { t: "Atenção", cls: "bg-faixa text-ink" },
  critica: { t: "Crítica", cls: "bg-sinal text-white" },
};

export interface Kpis {
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  conversas_plataforma: number;
  leads: number;
  qualificados: number;
  simulacoes: number;
  visitas: number;
  vendas: number;
  receita: number;
  ctr_pct: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  custo_qualificado: number | null;
  custo_por_venda: number | null;
  taxa_qualificacao_pct: number | null;
  taxa_conversao_pct: number | null;
  ticket_medio: number | null;
  roas: number | null;
  lucro_bruto: number | null;
  roi_pct: number | null;
  margem_pct: number | null;
}

export interface Metas {
  cpl_alvo: number;
  leads_mes: number;
  taxa_qualificacao_pct: number;
  vendas_mes: number;
  roas_alvo: number;
  custo_por_venda_max: number;
}

export interface Ad {
  nome: string;
  formato: string;
  produto_destaque: string;
  gancho: string;
  texto_principal: string;
  titulo: string;
  chamada: string;
  roteiro_criativo: string;
  mensagem_inicial_whatsapp: string;
}

export interface Plan {
  nome: string;
  resumo: string;
  diagnostico: string[];
  posicionamento: string;
  oferta_principal: string;
  publicos: { nome: string; temperatura: string; descricao: string; localizacao: string; raio_km: number; idade_min: number; idade_max: number; interesses: string[]; exclusoes: string[] }[];
  estrutura: {
    nome: string;
    plataforma: string;
    objetivo_plataforma: string;
    otimizacao: string;
    fase: string;
    orcamento_diario: number;
    conjuntos: { nome: string; publico: string; posicionamentos: string; orcamento_diario: number; anuncios: Ad[] }[];
  }[];
  orcamento: { mensal: number; diario: number; distribuicao: { item: string; percentual: number; valor: number; motivo: string }[] };
  metas: Metas;
  cronograma: { periodo: string; foco: string; acoes: string[] }[];
  regras_otimizacao: { quando: string; acao: string }[];
  integracao_atendimento: string[];
  checklist_lancamento: string[];
  riscos: string[];
}

export interface Analysis {
  resumo: string;
  nota: string;
  pontos_fortes: string[];
  problemas: string[];
  acoes: { prioridade: "alta" | "media" | "baixa"; acao: string; motivo: string }[];
  previsao: string;
  atualizado_em: string;
}

export interface CampaignBase {
  id: number;
  nome: string;
  status: CampaignStatus;
  objetivo: string | null;
  inicio: string | null;
  fim: string | null;
  verba_mensal: number | null;
  erro: string | null;
  meta_campaign_ids: string[];
  palavras_anuncio: string[];
  pedido: { objetivo: string; verba_mensal: number; inicio: string; fim: string | null; canais: string[]; produtos: string[]; observacoes: string | null };
  created_at: string;
  updated_at: string;
}

export interface CampaignListItem extends CampaignBase {
  resumo: string | null;
  metas: Metas | null;
  nota: string | null;
  kpis: Kpis | null;
}

export interface DailyResult {
  data: string;
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  conversas: number;
  origem: "manual" | "meta";
}

export interface CampaignDetail extends CampaignBase {
  plano: Plan | null;
  analise: Analysis | null;
  metricas: { kpis: Kpis; serie: { data: string; investimento: number; leads: number; cpl: number | null }[]; resultados: DailyResult[]; metas: Metas | null } | null;
  leads: { id: number; nome: string | null; nome_perfil: string | null; created_at: string; ad_headline: string | null; stage: string; temperatura: string; score: number; valor_venda: number | null }[];
}

export interface StoreMarketing {
  periodo: { de: string; ate: string; dias: number };
  total: Kpis;
  campanhas: { id: number; nome: string; status: CampaignStatus; metas: Metas | null; kpis: Kpis }[];
  sem_campanha: { leads: number; qualificados: number; vendas: number; receita: number };
  organico: { leads: number; qualificados: number; vendas: number; receita: number };
  serie: { data: string; investimento: number; leads: number; cpl: number | null }[];
  margem_pct: number | null;
}

export interface Question {
  id: string;
  rotulo: string;
  ajuda?: string;
  tipo: "texto" | "texto_longo" | "numero" | "dinheiro" | "percentual" | "opcao" | "multipla" | "sim_nao" | "produtos";
  opcoes?: { id: string; rotulo: string }[];
  essencial?: boolean;
  exemplo?: string;
}

export interface Questionnaire {
  segmento: string;
  secoes: { id: string; titulo: string; descricao: string; perguntas: Question[] }[];
  respostas: Record<string, unknown>;
  preenchimento: { pct: number; faltando: string[] };
  atualizado_em: string | null;
  atualizado_por: string | null;
  produtos: { id: string; titulo: string }[];
}

export const money = (v: number | null | undefined) =>
  v == null ? "—" : Math.abs(v) >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : brl(v);
export const pctf = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const ratio = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`);
export const intf = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
/** Compara um custo com a meta: abaixo é bom. */
export const vsMeta = (v: number | null, meta: number | null | undefined, menorMelhor = true): "bom" | "ruim" | null => {
  if (v == null || !meta) return null;
  return (menorMelhor ? v <= meta : v >= meta) ? "bom" : "ruim";
};
