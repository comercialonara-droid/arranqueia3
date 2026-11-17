/**
 * Segmentos atendidos. Cada loja tem o seu (configurações › loja.segmento) e isso muda o vocabulário da IA,
 * os campos da ficha do produto, a busca no estoque e os padrões de uma loja nova.
 */
import type { StoreSettings } from "./types.js";

export type Segmento = "veiculos" | "bikes_eletricas";
export const SEGMENTOS: Segmento[] = ["veiculos", "bikes_eletricas"];

export interface SpecField {
  chave: string;
  rotulo: string;
  /** unidade mostrada depois do valor (ex.: "km", "W") */
  unidade?: string;
  numerico?: boolean;
  exemplo?: string;
}

export interface SegmentProfile {
  id: Segmento;
  nome: string;
  tipo_loja: string;
  /** palavra do dia a dia e suas concordâncias */
  produto: string;
  produtos: string;
  o: string; // "o carro" / "a bike"
  um: string; // "um carro" / "uma bike"
  do: string; // "do carro" / "da bike"
  esse: string; // "esse carro" / "essa bike"
  dele: string; // "dele" / "dela"
  exemplo_nome: string; // "o Corolla" / "a V9 Max"
  exemplos_nome: string;
  test_drive: string;
  /** campos do cadastro de carro que não fazem sentido no segmento */
  esconder: string[];
  ficha: SpecField[];
  categorias: string[];
  sinonimos: Record<string, string[]>;
  formas_pagamento: string;
  troca_item: string; // o que o cliente costuma dar na troca
  foco_atendimento: string;
  saudacao_exemplo: string;
}

const VEICULOS: SegmentProfile = {
  id: "veiculos",
  nome: "Veículos (carros e motos)",
  tipo_loja: "loja de seminovos",
  produto: "carro",
  produtos: "carros",
  o: "o carro",
  um: "um carro",
  do: "do carro",
  esse: "esse carro",
  dele: "dele",
  exemplo_nome: "o Corolla",
  exemplos_nome: '"o Corolla", "a Tracker 2022"',
  test_drive: "test-drive",
  esconder: [],
  ficha: [],
  categorias: ["hatch", "sedan", "suv", "picape", "utilitario", "minivan", "cupe", "moto"],
  sinonimos: {
    automatico: ["automatico", "automatica", "aut", "at", "cvt", "auto"],
    manual: ["manual", "mecanico", "mecanica"],
    suv: ["suv", "utilitario esportivo", "jipe", "crossover"],
    picape: ["picape", "pickup", "pick up", "caminhonete"],
    sedan: ["sedan", "seda", "3 volumes"],
    hatch: ["hatch", "compacto", "popular"],
    gnv: ["gnv", "gas", "kit gas"],
    blindado: ["blindado", "blindada", "blindagem"],
  },
  formas_pagamento: "financiamento; carro na troca como entrada + resto em dinheiro; carro na troca + financiamento; à vista; consórcio",
  troca_item: "carro",
  foco_atendimento:
    "Quem compra carro quer saber de ano, km, câmbio, consumo, opcionais, laudo e documentação. Use o que vem das ferramentas e diga que o resto a equipe confirma.",
  saudacao_exemplo: "Oi! Tenho sim, o Corolla tá aqui na loja 😊 Quer que eu te mande umas fotos dele?",
};

const BIKES: SegmentProfile = {
  id: "bikes_eletricas",
  nome: "Bicicletas elétricas",
  tipo_loja: "loja de bicicletas elétricas",
  produto: "bike",
  produtos: "bikes",
  o: "a bike",
  um: "uma bike",
  do: "da bike",
  esse: "essa bike",
  dele: "dela",
  exemplo_nome: "a V9 Max",
  exemplos_nome: '"a V9 Max", "a V40 Pro azul"',
  test_drive: "test ride",
  esconder: ["km", "cambio", "combustivel", "portas", "final_placa", "fipe", "ano_fab"],
  ficha: [
    { chave: "motor_w", rotulo: "Motor", unidade: "W", numerico: true, exemplo: "1000" },
    { chave: "bateria", rotulo: "Bateria", exemplo: "48V 15,6Ah removível" },
    { chave: "autonomia_km", rotulo: "Autonomia", unidade: "km", numerico: true, exemplo: "60" },
    { chave: "velocidade_max_kmh", rotulo: "Velocidade máxima", unidade: "km/h", numerico: true, exemplo: "32" },
    { chave: "recarga_h", rotulo: "Tempo de recarga", unidade: "h", exemplo: "6 a 8" },
    { chave: "carga_max_kg", rotulo: "Carga máxima", unidade: "kg", numerico: true, exemplo: "150" },
    { chave: "aro", rotulo: "Aro e pneus", exemplo: "20, slick" },
    { chave: "suspensao", rotulo: "Suspensão", exemplo: "dupla" },
    { chave: "freios", rotulo: "Freios", exemplo: "hidráulicos" },
    { chave: "marchas", rotulo: "Câmbio / marchas", exemplo: "Shimano 7 marchas" },
    { chave: "garantia", rotulo: "Garantia", exemplo: "1 ano no motor e na bateria" },
  ],
  categorias: ["urbana", "scooter", "dobravel", "cargueira", "mountain", "triciclo", "infantil"],
  sinonimos: {
    scooter: ["scooter", "patinete", "moto eletrica", "motinha"],
    dobravel: ["dobravel", "dobra", "compacta"],
    cargueira: ["cargueira", "entrega", "delivery", "carga", "bau"],
    duas_baterias: ["duas baterias", "2 baterias", "bateria extra", "dupla bateria"],
    autonomia: ["autonomia", "alcance", "anda quanto", "quantos km"],
  },
  formas_pagamento: "à vista no Pix ou dinheiro; cartão de crédito parcelado; financiamento/crediário quando a loja oferecer; usado na troca se a loja aceitar",
  troca_item: "bike, patinete ou scooter",
  foco_atendimento:
    "Quem compra bike elétrica quer saber de autonomia (quantos km com uma carga), bateria (se é removível, quanto tempo pra carregar), motor, velocidade, peso que aguenta, conforto e segurança (farol, freio, cadeado, alarme). Muita gente vai usar para trabalhar ou fazer entrega: pergunte o uso e o trajeto do dia a dia para indicar o modelo certo. Sobre CNH, emplacamento, capacete e regras de trânsito, não afirme nada por conta própria: use só o que a loja configurou ou passe para a equipe.",
  saudacao_exemplo: "Oi! Tem sim, a V9 Max tá aqui na loja 😊 Quer ver um vídeo dela andando?",
};

export const PROFILES: Record<Segmento, SegmentProfile> = { veiculos: VEICULOS, bikes_eletricas: BIKES };

export function profileOf(s: Pick<StoreSettings, "loja">): SegmentProfile {
  return PROFILES[(s.loja.segmento as Segmento) ?? "veiculos"] ?? VEICULOS;
}

/** Padrões de uma loja nova de cada segmento (a loja ajusta depois em Configurações). */
export function segmentDefaults(seg: Segmento): Record<string, unknown> {
  if (seg === "bikes_eletricas")
    return {
      loja: { segmento: "bikes_eletricas", tipo_loja: BIKES.tipo_loja },
      atendimento: {
        politica_preco: "informar",
        aceita_troca: false,
        aceita_financiamento: true,
        compra_carro_sem_troca: false,
        garantia: "Garantia de fábrica no motor e na bateria.",
        documentacao: "Nota fiscal e manual entregues na compra.",
        diferenciais: ["Pronta entrega", "Test ride na loja", "Assistência técnica própria"],
      },
      simulacao: { ativa: true, pedir_cpf: false, pedir_nascimento: false, pedir_cnh: false },
      financiamento: { modo: "tabela_price", taxa_mensal_pct: 2.49, prazos: [10, 12, 18, 21], entrada_minima_pct: 0, observacao: "Parcelamento no cartão; valores aproximados." },
      agenda: { duracao_min: 30 },
    };
  return { loja: { segmento: "veiculos", tipo_loja: VEICULOS.tipo_loja } };
}

/** Formata a ficha técnica do segmento para mostrar à IA. */
export function specLines(p: SegmentProfile, ficha: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of p.ficha) {
    const v = ficha?.[f.chave];
    if (v != null && String(v).trim()) out[f.rotulo] = f.unidade && /^\d+([.,]\d+)?$/.test(String(v).trim()) ? `${v} ${f.unidade}` : String(v);
  }
  // campos extras que a loja cadastrou e não estão no modelo
  for (const [k, v] of Object.entries(ficha ?? {})) if (!p.ficha.some((f) => f.chave === k) && String(v).trim()) out[k] = String(v);
  return out;
}

export const specNumber = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Troca o vocabulário de carro pelo do segmento em textos fixos (descrições de ferramentas, avisos). */
export function vocab(text: string, p: SegmentProfile): string {
  if (p.id === "veiculos") return text;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const pairs: [RegExp, string][] = [
    [/\bum carro\b/g, p.um],
    [/\bUm carro\b/g, cap(p.um)],
    [/\bo carro\b/g, p.o],
    [/\bO carro\b/g, cap(p.o)],
    [/\bdo carro\b/g, p.do],
    [/\besse carro\b/g, p.esse],
    [/\bEsse carro\b/g, cap(p.esse)],
    [/\bdesse carro\b/g, `d${p.esse}`],
    [/\bcarros\b/g, p.produtos],
    [/\bcarro\b/g, p.produto],
  ];
  return pairs.reduce((t, [re, to]) => t.replace(re, to), text);
}
