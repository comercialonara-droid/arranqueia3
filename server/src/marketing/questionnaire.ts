/**
 * Questionário de marketing (diagnóstico da loja). É a base que a IA estrategista usa para montar as campanhas.
 * O painel desenha o formulário a partir desta definição, então perguntas novas entram só aqui.
 */
import type { Segmento } from "../segments.js";

export type QuestionType = "texto" | "texto_longo" | "numero" | "dinheiro" | "percentual" | "opcao" | "multipla" | "sim_nao" | "produtos";

export interface Question {
  id: string;
  rotulo: string;
  ajuda?: string;
  tipo: QuestionType;
  opcoes?: { id: string; rotulo: string }[];
  /** só aparece para estes segmentos */
  segmentos?: Segmento[];
  /** pesa no percentual de preenchimento (as essenciais) */
  essencial?: boolean;
  exemplo?: string;
}

export interface Section {
  id: string;
  titulo: string;
  descricao: string;
  perguntas: Question[];
}

const o = (...xs: [string, string][]) => xs.map(([id, rotulo]) => ({ id, rotulo }));

export const QUESTIONNAIRE: Section[] = [
  {
    id: "negocio",
    titulo: "A loja",
    descricao: "Onde a loja está, quem atende e quanto vende hoje. É o que define a área dos anúncios e as metas.",
    perguntas: [
      { id: "bairros", rotulo: "Bairros e cidades de onde vêm os clientes", tipo: "texto_longo", essencial: true, exemplo: "Barra, Recreio, Jacarepaguá, Campo Grande" },
      { id: "raio_km", rotulo: "Raio de atuação a partir da loja (km)", tipo: "numero", essencial: true, ajuda: "Até onde vale a pena anunciar. Quem mora longe raramente vem." },
      { id: "tempo_mercado", rotulo: "Há quanto tempo a loja existe", tipo: "texto", exemplo: "8 anos" },
      { id: "diferenciais", rotulo: "Por que comprar com vocês e não com o concorrente", tipo: "texto_longo", essencial: true },
      { id: "concorrentes", rotulo: "Principais concorrentes da região", tipo: "texto_longo" },
      { id: "ticket_medio", rotulo: "Ticket médio de venda (R$)", tipo: "dinheiro", essencial: true },
      { id: "margem_pct", rotulo: "Margem média por venda (%)", tipo: "percentual", essencial: true, ajuda: "Usada para calcular o ROI de verdade (lucro sobre o investimento)." },
      { id: "vendas_mes", rotulo: "Vendas por mês hoje", tipo: "numero", essencial: true },
      { id: "meta_vendas_mes", rotulo: "Meta de vendas por mês", tipo: "numero", essencial: true },
    ],
  },
  {
    id: "publico",
    titulo: "Quem compra",
    descricao: "O retrato do cliente que mais compra e o que trava a venda.",
    perguntas: [
      { id: "cliente_ideal", rotulo: "Descreva o cliente que mais compra", tipo: "texto_longo", essencial: true, exemplo: "Homem 28-45, motorista de aplicativo, quer carro econômico com GNV" },
      { id: "faixa_etaria", rotulo: "Faixa de idade principal", tipo: "multipla", opcoes: o(["18-24", "18 a 24"], ["25-34", "25 a 34"], ["35-44", "35 a 44"], ["45-54", "45 a 54"], ["55+", "55 ou mais"]) },
      { id: "renda", rotulo: "Renda familiar mais comum", tipo: "opcao", opcoes: o(["ate_3k", "Até R$ 3 mil"], ["3_6k", "R$ 3 a 6 mil"], ["6_12k", "R$ 6 a 12 mil"], ["12k_mais", "Mais de R$ 12 mil"]) },
      {
        id: "uso",
        rotulo: "Para que o cliente usa",
        tipo: "multipla",
        segmentos: ["veiculos"],
        opcoes: o(["trabalho", "Trabalho / ir ao trabalho"], ["aplicativo", "Motorista de aplicativo"], ["familia", "Família"], ["primeiro", "Primeiro carro"], ["status", "Status / desejo"], ["empresa", "Empresa / frota"]),
      },
      {
        id: "uso",
        rotulo: "Para que o cliente usa",
        tipo: "multipla",
        segmentos: ["motos"],
        opcoes: o(["entrega", "Entrega / motoboy"], ["trabalho", "Ir ao trabalho"], ["economia", "Fugir do trânsito e economizar"], ["lazer", "Lazer / viagem"], ["primeira", "Primeira moto"]),
      },
      {
        id: "uso",
        rotulo: "Para que o cliente usa",
        tipo: "multipla",
        segmentos: ["bikes_eletricas"],
        opcoes: o(["entrega", "Entregas / aplicativo"], ["trabalho", "Ir ao trabalho"], ["lazer", "Lazer e orla"], ["economia", "Economizar com transporte"], ["mobilidade", "Mobilidade (idosos, sem CNH)"]),
      },
      { id: "objecoes", rotulo: "O que mais trava a venda", tipo: "multipla", essencial: true, opcoes: o(["preco", "Preço"], ["credito", "Crédito negado"], ["entrada", "Falta de entrada"], ["confianca", "Desconfiança da loja"], ["distancia", "Distância"], ["concorrencia", "Achou mais barato"], ["indecisao", "Indecisão / vai pensar"]) },
    ],
  },
  {
    id: "oferta",
    titulo: "A oferta",
    descricao: "O que vai nos anúncios. Anúncio de produto específico com condição clara converte mais do que anúncio institucional.",
    perguntas: [
      { id: "produtos_foco", rotulo: "Produtos que devem puxar a campanha", tipo: "produtos", essencial: true, ajuda: "Os que têm melhor margem, giro ou apelo. A IA monta anúncios para eles." },
      { id: "condicoes", rotulo: "Condições que a loja pode anunciar", tipo: "multipla", essencial: true, opcoes: o(["entrada_facilitada", "Entrada facilitada"], ["sem_entrada", "Sem entrada"], ["troca", "Aceita usado na troca"], ["financiamento", "Financiamento"], ["cartao", "Parcelamento no cartão"], ["primeira_parcela", "1ª parcela para depois"], ["negativado", "Aprovação para negativado"]) },
      { id: "gatilhos", rotulo: "Destaques que podem virar gancho de anúncio", tipo: "texto_longo", exemplo: "IPVA 2027 pago, abaixo da FIPE, garantia de 1 ano, pronta entrega" },
      { id: "promocao", rotulo: "Alguma promoção ou data especial no período", tipo: "texto", exemplo: "Black Friday, feirão de fim de mês" },
    ],
  },
  {
    id: "investimento",
    titulo: "Investimento e objetivo",
    descricao: "Quanto investir, por quanto tempo e o que conta como resultado.",
    perguntas: [
      { id: "verba_mensal", rotulo: "Verba mensal de anúncios (R$)", tipo: "dinheiro", essencial: true },
      { id: "duracao_meses", rotulo: "Por quantos meses", tipo: "numero", essencial: true },
      { id: "objetivo", rotulo: "Objetivo principal", tipo: "opcao", essencial: true, opcoes: o(["leads_whatsapp", "Conversas no WhatsApp (leads)"], ["visitas", "Visitas na loja"], ["vendas", "Vendas"], ["marca", "Ser conhecida na região"]) },
      { id: "canais", rotulo: "Onde anunciar", tipo: "multipla", essencial: true, opcoes: o(["meta", "Instagram e Facebook"], ["google", "Google (pesquisa e YouTube)"], ["tiktok", "TikTok"]) },
      { id: "ja_anunciou", rotulo: "Já anunciou antes", tipo: "sim_nao" },
      { id: "historico", rotulo: "Como foi (custo por lead, o que funcionou, o que não)", tipo: "texto_longo" },
    ],
  },
  {
    id: "ativos",
    titulo: "Conteúdo e contas",
    descricao: "O que já existe para os anúncios e para medir resultado.",
    perguntas: [
      { id: "instagram_ativo", rotulo: "O Instagram da loja posta com frequência", tipo: "sim_nao" },
      { id: "material", rotulo: "Material disponível", tipo: "multipla", opcoes: o(["fotos_pro", "Fotos profissionais do estoque"], ["videos", "Vídeos curtos (Reels)"], ["depoimentos", "Vídeos de clientes / entregas"], ["apresentador", "Alguém da loja que grava"], ["nada", "Quase nada ainda"]) },
      { id: "conta_anuncios", rotulo: "Tem conta de anúncios e Business Manager", tipo: "sim_nao", essencial: true },
      { id: "dataset", rotulo: "Tem pixel/dataset configurado", tipo: "sim_nao" },
    ],
  },
  {
    id: "operacao",
    titulo: "Atendimento e vendas",
    descricao: "Tráfego bom morre em atendimento lento. A IA responde na hora; aqui entra o que acontece depois.",
    perguntas: [
      { id: "vendedores", rotulo: "Quantas pessoas vendem", tipo: "numero", essencial: true },
      { id: "capacidade_dia", rotulo: "Quantos leads por dia a equipe consegue atender bem", tipo: "numero", ajuda: "A IA filtra, mas o vendedor fecha. Isso limita a verba diária." },
      { id: "test_drive", rotulo: "Faz test-drive / test ride", tipo: "sim_nao" },
      { id: "observacoes", rotulo: "Mais alguma coisa que a estratégia precisa saber", tipo: "texto_longo" },
    ],
  },
];

export function questionsFor(seg: Segmento): Section[] {
  return QUESTIONNAIRE.map((s) => ({ ...s, perguntas: s.perguntas.filter((q) => !q.segmentos || q.segmentos.includes(seg)) }));
}

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "");

export function completeness(seg: Segmento, answers: Record<string, unknown>) {
  const ess = questionsFor(seg).flatMap((s) => s.perguntas.filter((q) => q.essencial));
  const ok = ess.filter((q) => filled(answers[q.id]));
  return { pct: Math.round((ok.length / Math.max(ess.length, 1)) * 100), faltando: ess.filter((q) => !filled(answers[q.id])).map((q) => q.rotulo) };
}

/** Questionário respondido em texto, para a IA ler. */
export function briefingText(seg: Segmento, answers: Record<string, unknown>, productName: (id: string) => string | null) {
  const lines: string[] = [];
  for (const s of questionsFor(seg)) {
    const rows = s.perguntas
      .filter((q) => filled(answers[q.id]))
      .map((q) => {
        const v = answers[q.id];
        let txt: string;
        if (q.tipo === "produtos") txt = (v as string[]).map((id) => productName(id) ?? id).join("; ");
        else if (q.opcoes) txt = ([] as unknown[]).concat(v).map((x) => q.opcoes!.find((op) => op.id === x)?.rotulo ?? String(x)).join(", ");
        else if (q.tipo === "sim_nao") txt = v ? "sim" : "não";
        else if (q.tipo === "dinheiro") txt = `R$ ${Number(v).toLocaleString("pt-BR")}`;
        else if (q.tipo === "percentual") txt = `${v}%`;
        else txt = String(v);
        return `- ${q.rotulo}: ${txt}`;
      });
    if (rows.length) lines.push(`## ${s.titulo}\n${rows.join("\n")}`);
  }
  return lines.join("\n\n") || "(questionário ainda não respondido)";
}
