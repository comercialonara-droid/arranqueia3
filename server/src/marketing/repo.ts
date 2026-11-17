import { db, nowIso, parseJson } from "../db/index.js";
import { norm } from "../services/inventory.js";
import type { CampaignPlan, ResultsAnalysis } from "./plan.js";

db.exec(`
CREATE TABLE IF NOT EXISTS marketing_briefings (
  store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  respostas TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  objetivo TEXT,
  inicio TEXT,
  fim TEXT,
  verba_mensal REAL,
  pedido TEXT NOT NULL DEFAULT '{}',
  plano TEXT,
  analise TEXT,
  erro TEXT,
  meta_campaign_ids TEXT NOT NULL DEFAULT '[]',
  palavras_anuncio TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_store ON campaigns(store_id, status);
CREATE TABLE IF NOT EXISTS campaign_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  investimento REAL NOT NULL DEFAULT 0,
  impressoes INTEGER NOT NULL DEFAULT 0,
  alcance INTEGER NOT NULL DEFAULT 0,
  cliques INTEGER NOT NULL DEFAULT 0,
  conversas INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(campaign_id, data)
);
CREATE INDEX IF NOT EXISTS idx_results_store ON campaign_results(store_id, data);
CREATE TABLE IF NOT EXISTS campaign_ads (
  ad_id TEXT PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nome TEXT
);
`);

function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn("contacts", "campaign_id", "INTEGER REFERENCES campaigns(id) ON DELETE SET NULL");
addColumn("stores", "meta_ad_account_id", "TEXT");
addColumn("stores", "meta_ads_token", "TEXT");

export type CampaignStatus = "gerando" | "rascunho" | "ativa" | "pausada" | "encerrada" | "erro";
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["gerando", "rascunho", "ativa", "pausada", "encerrada", "erro"];

export interface CampaignRequest {
  objetivo: string;
  verba_mensal: number;
  inicio: string;
  fim: string | null;
  canais: string[];
  produtos: string[];
  observacoes: string | null;
}

export interface Campaign {
  id: number;
  store_id: number;
  nome: string;
  status: CampaignStatus;
  objetivo: string | null;
  inicio: string | null;
  fim: string | null;
  verba_mensal: number | null;
  pedido: CampaignRequest;
  plano: CampaignPlan | null;
  analise: (ResultsAnalysis & { atualizado_em: string }) | null;
  erro: string | null;
  meta_campaign_ids: string[];
  palavras_anuncio: string[];
  created_at: string;
  updated_at: string;
}

export interface DailyResult {
  id: number;
  campaign_id: number;
  store_id: number;
  data: string;
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  conversas: number;
  origem: "manual" | "meta";
}

type Row = Record<string, any>;
const mapCampaign = (r: Row): Campaign => ({
  ...(r as Campaign),
  pedido: parseJson(r.pedido, {} as CampaignRequest),
  plano: parseJson(r.plano, null),
  analise: parseJson(r.analise, null),
  meta_campaign_ids: parseJson(r.meta_campaign_ids, []),
  palavras_anuncio: parseJson(r.palavras_anuncio, []),
});

export const briefings = {
  get(storeId: number): { respostas: Record<string, unknown>; updated_at: string | null; updated_by: string | null } {
    const r = db.prepare("SELECT * FROM marketing_briefings WHERE store_id = ?").get(storeId) as Row | undefined;
    return { respostas: parseJson(r?.respostas, {}), updated_at: r?.updated_at ?? null, updated_by: r?.updated_by ?? null };
  },
  save(storeId: number, respostas: Record<string, unknown>, by: string) {
    db.prepare(
      `INSERT INTO marketing_briefings (store_id, respostas, updated_by, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(store_id) DO UPDATE SET respostas = excluded.respostas, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(storeId, JSON.stringify(respostas), by, nowIso());
    return briefings.get(storeId);
  },
};

export const campaigns = {
  list(storeId: number): Campaign[] {
    return (db.prepare("SELECT * FROM campaigns WHERE store_id = ? ORDER BY CASE status WHEN 'ativa' THEN 0 WHEN 'gerando' THEN 1 WHEN 'rascunho' THEN 2 WHEN 'pausada' THEN 3 ELSE 4 END, id DESC").all(storeId) as Row[]).map(mapCampaign);
  },
  get(id: number, storeId?: number): Campaign | null {
    const r = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Row | undefined;
    if (!r || (storeId != null && r.store_id !== storeId)) return null;
    return mapCampaign(r);
  },
  create(storeId: number, c: { nome: string; status: CampaignStatus; pedido: CampaignRequest }): Campaign {
    const r = db
      .prepare("INSERT INTO campaigns (store_id, nome, status, objetivo, inicio, fim, verba_mensal, pedido) VALUES (?,?,?,?,?,?,?,?)")
      .run(storeId, c.nome, c.status, c.pedido.objetivo, c.pedido.inicio, c.pedido.fim, c.pedido.verba_mensal, JSON.stringify(c.pedido));
    return campaigns.get(Number(r.lastInsertRowid))!;
  },
  update(id: number, patch: Partial<Omit<Campaign, "id" | "store_id" | "created_at">>) {
    const cur = campaigns.get(id);
    if (!cur) return null;
    const m = { ...cur, ...patch };
    db.prepare(
      `UPDATE campaigns SET nome=?, status=?, objetivo=?, inicio=?, fim=?, verba_mensal=?, pedido=?, plano=?, analise=?, erro=?, meta_campaign_ids=?, palavras_anuncio=?, updated_at=? WHERE id=?`,
    ).run(
      m.nome,
      m.status,
      m.objetivo,
      m.inicio,
      m.fim,
      m.verba_mensal,
      JSON.stringify(m.pedido ?? {}),
      m.plano ? JSON.stringify(m.plano) : null,
      m.analise ? JSON.stringify(m.analise) : null,
      m.erro,
      JSON.stringify(m.meta_campaign_ids ?? []),
      JSON.stringify(m.palavras_anuncio ?? []),
      nowIso(),
      id,
    );
    return campaigns.get(id);
  },
  remove(id: number, storeId: number) {
    db.prepare("DELETE FROM campaigns WHERE id = ? AND store_id = ?").run(id, storeId);
  },
  active(storeId: number): Campaign[] {
    return (db.prepare("SELECT * FROM campaigns WHERE store_id = ? AND status = 'ativa' ORDER BY id DESC").all(storeId) as Row[]).map(mapCampaign);
  },
  byMetaCampaignId(storeId: number, metaId: string): Campaign | null {
    return campaigns.list(storeId).find((c) => c.meta_campaign_ids.includes(metaId)) ?? null;
  },
};

export const results = {
  forCampaign(campaignId: number): DailyResult[] {
    return db.prepare("SELECT * FROM campaign_results WHERE campaign_id = ? ORDER BY data").all(campaignId) as unknown as DailyResult[];
  },
  forStore(storeId: number, de: string, ate: string): DailyResult[] {
    return db.prepare("SELECT * FROM campaign_results WHERE store_id = ? AND data BETWEEN ? AND ? ORDER BY data").all(storeId, de, ate) as unknown as DailyResult[];
  },
  upsert(r: Omit<DailyResult, "id">) {
    db.prepare(
      `INSERT INTO campaign_results (campaign_id, store_id, data, investimento, impressoes, alcance, cliques, conversas, origem, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(campaign_id, data) DO UPDATE SET investimento=excluded.investimento, impressoes=excluded.impressoes, alcance=excluded.alcance,
         cliques=excluded.cliques, conversas=excluded.conversas, origem=excluded.origem, updated_at=excluded.updated_at`,
    ).run(r.campaign_id, r.store_id, r.data, r.investimento, r.impressoes, r.alcance, r.cliques, r.conversas, r.origem, nowIso());
  },
  remove(campaignId: number, data: string) {
    db.prepare("DELETE FROM campaign_results WHERE campaign_id = ? AND data = ?").run(campaignId, data);
  },
};

export const campaignAds = {
  set(adId: string, campaignId: number, storeId: number, nome: string | null) {
    db.prepare(
      "INSERT INTO campaign_ads (ad_id, campaign_id, store_id, nome) VALUES (?,?,?,?) ON CONFLICT(ad_id) DO UPDATE SET campaign_id = excluded.campaign_id, nome = excluded.nome WHERE campaign_ads.store_id = excluded.store_id",
    ).run(adId, campaignId, storeId, nome);
  },
  campaignOf(adId: string, storeId: number): number | null {
    const r = db.prepare("SELECT campaign_id FROM campaign_ads WHERE ad_id = ? AND store_id = ?").get(adId, storeId) as Row | undefined;
    return r?.campaign_id ?? null;
  },
};

/**
 * Descobre de qual campanha veio um lead de anúncio: pelo ID do anúncio (sincronizado da Meta),
 * pelas palavras que a campanha usa nos títulos dos anúncios, ou, se só há uma campanha ativa, por ela.
 */
export function matchCampaign(storeId: number, ref: { source_id?: string | null; headline?: string | null; body?: string | null }): number | null {
  if (ref.source_id) {
    const byAd = campaignAds.campaignOf(ref.source_id, storeId);
    if (byAd) return byAd;
  }
  const ativas = campaigns.active(storeId);
  const texto = norm(`${ref.headline ?? ""} ${ref.body ?? ""}`);
  if (texto) {
    const hit = ativas.find((c) => c.palavras_anuncio.some((p) => p.trim() && texto.includes(norm(p))));
    if (hit) return hit.id;
  }
  return ativas.length === 1 ? ativas[0].id : null;
}
