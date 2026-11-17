import { db, parseJson } from "./index.js";
import type { StoreSettings } from "../types.js";

export const defaultSettings: StoreSettings = {
  loja: {
    nome: "Sua Loja de Veículos",
    segmento: "veiculos",
    tipo_loja: "loja de seminovos",
    cidade: "Rio de Janeiro - RJ",
    endereco: "",
    referencia: "",
    site: "",
    instagram: "",
    telefone: "",
    maps_url: "",
    lat: null,
    lng: null,
  },
  horarios: [
    null,
    { abre: "09:00", fecha: "18:00" },
    { abre: "09:00", fecha: "18:00" },
    { abre: "09:00", fecha: "18:00" },
    { abre: "09:00", fecha: "18:00" },
    { abre: "09:00", fecha: "18:00" },
    { abre: "09:00", fecha: "14:00" },
  ],
  agenda: { duracao_min: 60, antecedencia_min_horas: 1, max_por_horario: 2, dias_a_frente: 14 },
  atendimento: {
    nome_assistente: "Bia",
    tom: "Simpática, direta e segura, como uma vendedora experiente carioca. Frases curtas, sem textão, no máximo um emoji por mensagem.",
    politica_preco: "parcela_primeiro",
    citar_nome_vendedor: false,
    aceita_troca: true,
    aceita_financiamento: true,
    compra_carro_sem_troca: false,
    garantia: "Garantia de motor e câmbio conforme a lei e laudo cautelar aprovado.",
    documentacao: "Transferência feita pela loja.",
    diferenciais: ["Carros revisados", "Aceitamos seu usado na troca", "Financiamento com as principais financeiras"],
    regras_extras: "",
    responder_fora_do_horario: true,
  },
  simulacao: {
    ativa: true,
    pedir_cpf: true,
    pedir_nascimento: true,
    pedir_cnh: true,
    texto_privacidade: "Seus dados são usados só para a análise de crédito da loja e não são compartilhados para outros fins.",
  },
  financiamento: {
    modo: "tabela_price",
    taxa_mensal_pct: 1.99,
    prazos: [24, 36, 48, 60],
    entrada_minima_pct: 20,
    regra_loja: { a_cada: 30000, parcela: 1000, prazo: 48 },
    observacao: "Valores aproximados, sujeitos à análise de crédito.",
  },
  followup: {
    ativo: true,
    horas: [2, 20],
    template_reengajamento: null,
    template_lembrete_visita: null,
    lembrete_horas_antes: 3,
  },
  handoff: {
    notificar_vendedor: true,
    template_notificacao: null,
    pausar_ia_horas: 12,
  },
  conversoes: {
    ativo: true,
    evento_lead: "LeadSubmitted",
    evento_qualificado: "QualifiedLead",
    evento_venda: "Purchase",
  },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mescla profunda: objetos são mesclados, arrays e valores primitivos são substituídos. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

const cache = new Map<number, StoreSettings>();

export function getSettings(storeId: number): StoreSettings {
  const hit = cache.get(storeId);
  if (hit) return hit;
  const row = db.prepare("SELECT settings FROM stores WHERE id = ?").get(storeId) as { settings: string } | undefined;
  const merged = deepMerge(defaultSettings, parseJson(row?.settings, {}));
  cache.set(storeId, merged);
  return merged;
}

export function saveSettings(storeId: number, patch: unknown): StoreSettings {
  const merged = deepMerge(getSettings(storeId), patch);
  db.prepare("UPDATE stores SET settings = ? WHERE id = ?").run(JSON.stringify(merged), storeId);
  if (merged.loja?.nome) db.prepare("UPDATE stores SET nome = ? WHERE id = ?").run(merged.loja.nome, storeId);
  cache.set(storeId, merged);
  return merged;
}

export function resetSettingsCache() {
  cache.clear();
}
