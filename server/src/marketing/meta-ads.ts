/**
 * Puxa os números das campanhas direto da conta de anúncios da Meta (Marketing API, insights por anúncio e por dia).
 * Cada campanha da ArranqueIA guarda os IDs das campanhas da Meta que fazem parte dela.
 */
import { config } from "../config.js";
import { db } from "../db/index.js";
import { decrypt, encrypt } from "../util/crypto.js";
import { log } from "../util/log.js";
import { campaignAds, campaigns, results } from "./repo.js";

export interface AdsCreds {
  adAccountId: string;
  token: string;
}

export function adsCreds(storeId: number): AdsCreds | null {
  const r = db.prepare("SELECT meta_ad_account_id, meta_ads_token, wa_access_token FROM stores WHERE id = ?").get(storeId) as Record<string, string | null> | undefined;
  if (!r?.meta_ad_account_id) return null;
  const token = decrypt(r.meta_ads_token) || decrypt(r.wa_access_token) || config.meta.capiToken || "";
  return token ? { adAccountId: r.meta_ad_account_id.replace(/^act_/, ""), token } : null;
}

export function saveAdsCreds(storeId: number, adAccountId: string | null, token: string | null | undefined) {
  db.prepare("UPDATE stores SET meta_ad_account_id = ? WHERE id = ?").run(adAccountId ? adAccountId.replace(/^act_/, "").trim() : null, storeId);
  if (token !== undefined) db.prepare("UPDATE stores SET meta_ads_token = ? WHERE id = ?").run(token ? encrypt(token) : null, storeId);
}

export function adsStatus(storeId: number) {
  const r = db.prepare("SELECT meta_ad_account_id, meta_ads_token FROM stores WHERE id = ?").get(storeId) as Record<string, string | null> | undefined;
  return { conta: r?.meta_ad_account_id ?? null, token_proprio: Boolean(r?.meta_ads_token), conectada: Boolean(adsCreds(storeId)) };
}

interface InsightRow {
  campaign_id: string;
  campaign_name?: string;
  ad_id: string;
  ad_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
}

const CONVERSA = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];

/** Lista as campanhas da conta (para o gestor escolher quais pertencem a cada campanha da ArranqueIA). */
export async function listMetaCampaigns(storeId: number) {
  const c = adsCreds(storeId);
  if (!c) throw new Error("Conecte a conta de anúncios da loja primeiro.");
  const url = new URL(`https://graph.facebook.com/${config.whatsapp.graphVersion}/act_${c.adAccountId}/campaigns`);
  url.searchParams.set("fields", "id,name,status,objective");
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", c.token);
  const r = await fetch(url);
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(j?.error?.message ?? `Meta respondeu ${r.status}`);
  return (j.data ?? []) as { id: string; name: string; status: string; objective: string }[];
}

/** Sincroniza os últimos dias de resultados das campanhas da loja que têm IDs da Meta. */
export async function syncMetaResults(storeId: number, dias = 30) {
  const c = adsCreds(storeId);
  if (!c) throw new Error("Conecte a conta de anúncios da loja primeiro.");
  const ours = campaigns.list(storeId).filter((x) => x.meta_campaign_ids.length);
  if (!ours.length) return { campanhas: 0, dias: 0, aviso: "Nenhuma campanha tem IDs da Meta. Ligue as campanhas da Meta nas campanhas daqui." };
  const ate = new Date();
  const de = new Date(ate.getTime() - (dias - 1) * 86400_000);
  const url = new URL(`https://graph.facebook.com/${config.whatsapp.graphVersion}/act_${c.adAccountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("fields", "campaign_id,campaign_name,ad_id,ad_name,spend,impressions,reach,clicks,actions");
  url.searchParams.set("time_range", JSON.stringify({ since: de.toISOString().slice(0, 10), until: ate.toISOString().slice(0, 10) }));
  url.searchParams.set("filtering", JSON.stringify([{ field: "campaign.id", operator: "IN", value: ours.flatMap((x) => x.meta_campaign_ids) }]));
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", c.token);

  const rows: InsightRow[] = [];
  let next: string | null = url.toString();
  for (let page = 0; next && page < 40; page++) {
    const r = await fetch(next);
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(j?.error?.message ?? `Meta respondeu ${r.status}`);
    rows.push(...(j.data ?? []));
    next = j.paging?.next ?? null;
  }

  // soma por campanha da ArranqueIA e por dia
  const acc = new Map<string, { campaign_id: number; data: string; investimento: number; impressoes: number; alcance: number; cliques: number; conversas: number }>();
  for (const row of rows) {
    const mine = ours.find((x) => x.meta_campaign_ids.includes(row.campaign_id));
    if (!mine) continue;
    campaignAds.set(row.ad_id, mine.id, storeId, row.ad_name ?? null);
    const key = `${mine.id}|${row.date_start}`;
    const cur = acc.get(key) ?? { campaign_id: mine.id, data: row.date_start, investimento: 0, impressoes: 0, alcance: 0, cliques: 0, conversas: 0 };
    cur.investimento += Number(row.spend ?? 0);
    cur.impressoes += Number(row.impressions ?? 0);
    cur.alcance += Number(row.reach ?? 0);
    cur.cliques += Number(row.clicks ?? 0);
    cur.conversas += Number(row.actions?.find((a) => CONVERSA.includes(a.action_type))?.value ?? 0);
    acc.set(key, cur);
  }
  for (const v of acc.values()) results.upsert({ ...v, store_id: storeId, investimento: Math.round(v.investimento * 100) / 100, origem: "meta" });
  log.info("resultados da Meta sincronizados", { storeId, linhas: rows.length, dias: acc.size });
  return { campanhas: ours.length, dias: acc.size, anuncios: new Set(rows.map((r) => r.ad_id)).size };
}

/** Roda de tempos em tempos para todas as lojas conectadas. */
export async function syncAllStores() {
  const ids = (db.prepare("SELECT id FROM stores WHERE ativo = 1 AND meta_ad_account_id IS NOT NULL").all() as { id: number }[]).map((r) => r.id);
  for (const id of ids) {
    try {
      await syncMetaResults(id, 3);
    } catch (e) {
      log.warn("falha ao sincronizar anúncios", { storeId: id, err: (e as Error).message });
    }
  }
}
