/** O plano de campanha que a IA estrategista escreve (e o formato que o painel desenha). */

export interface Audience {
  nome: string;
  temperatura: "frio" | "morno" | "quente";
  descricao: string;
  localizacao: string;
  raio_km: number;
  idade_min: number;
  idade_max: number;
  interesses: string[];
  exclusoes: string[];
}

export interface Ad {
  nome: string;
  formato: "video_reels" | "carrossel" | "imagem" | "stories";
  produto_destaque: string;
  gancho: string;
  texto_principal: string;
  titulo: string;
  chamada: string;
  roteiro_criativo: string;
  mensagem_inicial_whatsapp: string;
}

export interface AdSet {
  nome: string;
  publico: string;
  posicionamentos: string;
  orcamento_diario: number;
  anuncios: Ad[];
}

export interface CampaignBlock {
  nome: string;
  plataforma: "meta" | "google" | "tiktok";
  objetivo_plataforma: string;
  otimizacao: string;
  fase: string;
  orcamento_diario: number;
  conjuntos: AdSet[];
}

export interface CampaignPlan {
  nome: string;
  resumo: string;
  diagnostico: string[];
  posicionamento: string;
  oferta_principal: string;
  publicos: Audience[];
  estrutura: CampaignBlock[];
  orcamento: { mensal: number; diario: number; distribuicao: { item: string; percentual: number; valor: number; motivo: string }[] };
  metas: { cpl_alvo: number; leads_mes: number; taxa_qualificacao_pct: number; vendas_mes: number; roas_alvo: number; custo_por_venda_max: number };
  cronograma: { periodo: string; foco: string; acoes: string[] }[];
  regras_otimizacao: { quando: string; acao: string }[];
  integracao_atendimento: string[];
  checklist_lancamento: string[];
  riscos: string[];
}

const str = { type: "string" };
const num = { type: "number" };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const ad = obj({
  nome: str,
  formato: { type: "string", enum: ["video_reels", "carrossel", "imagem", "stories"] },
  produto_destaque: { type: "string", description: "Produto do estoque que o anúncio mostra (ou 'institucional')" },
  gancho: { type: "string", description: "Primeiros 3 segundos / primeira linha que prende a atenção" },
  texto_principal: { type: "string", description: "Texto do anúncio pronto para colar, curto, com a condição e a chamada para o WhatsApp" },
  titulo: { type: "string", description: "Título curto (até 40 caracteres)" },
  chamada: { type: "string", description: "Botão de chamada, ex.: Enviar mensagem" },
  roteiro_criativo: { type: "string", description: "Como gravar ou montar a peça: cenas, texto na tela, duração" },
  mensagem_inicial_whatsapp: { type: "string", description: "Mensagem que o cliente já encontra pronta ao abrir o WhatsApp" },
});

export const PLAN_SCHEMA = obj({
  nome: { type: "string", description: "Nome curto da campanha" },
  resumo: { type: "string", description: "A estratégia em 3 a 5 frases" },
  diagnostico: arr({ type: "string" }),
  posicionamento: str,
  oferta_principal: str,
  publicos: arr(
    obj({
      nome: str,
      temperatura: { type: "string", enum: ["frio", "morno", "quente"] },
      descricao: str,
      localizacao: str,
      raio_km: num,
      idade_min: num,
      idade_max: num,
      interesses: arr(str),
      exclusoes: arr(str),
    }),
  ),
  estrutura: arr(
    obj({
      nome: str,
      plataforma: { type: "string", enum: ["meta", "google", "tiktok"] },
      objetivo_plataforma: { type: "string", description: "Objetivo na plataforma, ex.: Engajamento > Conversas por mensagem" },
      otimizacao: str,
      fase: { type: "string", description: "teste, escala, remarketing…" },
      orcamento_diario: num,
      conjuntos: arr(obj({ nome: str, publico: str, posicionamentos: str, orcamento_diario: num, anuncios: arr(ad) })),
    }),
  ),
  orcamento: obj({ mensal: num, diario: num, distribuicao: arr(obj({ item: str, percentual: num, valor: num, motivo: str })) }),
  metas: obj({ cpl_alvo: num, leads_mes: num, taxa_qualificacao_pct: num, vendas_mes: num, roas_alvo: num, custo_por_venda_max: num }),
  cronograma: arr(obj({ periodo: str, foco: str, acoes: arr(str) })),
  regras_otimizacao: arr(obj({ quando: str, acao: str })),
  integracao_atendimento: arr({ type: "string", description: "Como a IA de atendimento deve tratar os leads desta campanha" }),
  checklist_lancamento: arr(str),
  riscos: arr(str),
});

export interface ResultsAnalysis {
  resumo: string;
  nota: "otima" | "boa" | "atencao" | "critica";
  pontos_fortes: string[];
  problemas: string[];
  acoes: { prioridade: "alta" | "media" | "baixa"; acao: string; motivo: string }[];
  previsao: string;
}

export const ANALYSIS_SCHEMA = obj({
  resumo: str,
  nota: { type: "string", enum: ["otima", "boa", "atencao", "critica"] },
  pontos_fortes: arr(str),
  problemas: arr(str),
  acoes: arr(obj({ prioridade: { type: "string", enum: ["alta", "media", "baixa"] }, acao: str, motivo: str })),
  previsao: { type: "string", description: "O que esperar nas próximas 2 semanas se as ações forem feitas" },
});
