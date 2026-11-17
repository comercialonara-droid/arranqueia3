import { db, nowIso, parseJson } from "./index.js";
import { config } from "../config.js";
import { decrypt, encrypt, hashPassword } from "../util/crypto.js";
import type {
  Appointment,
  AudioClip,
  Channel,
  Contact,
  Direction,
  Lead,
  LeadStage,
  MessageRow,
  Note,
  QuickReply,
  Role,
  Sender,
  Simulation,
  Store,
  User,
  Vehicle,
  WaCreds,
} from "../types.js";

type Row = Record<string, any>;
const bool = (v: unknown) => v === 1 || v === true || v === "1";

// ───────────────────────────── Lojas ─────────────────────────────

const mapStore = (r: Row): Store => ({ ...(r as Store), ativo: bool(r.ativo) });

export const stores = {
  all(): Store[] {
    return (db.prepare("SELECT * FROM stores ORDER BY nome").all() as Row[]).map(mapStore);
  },
  get(id: number): Store | null {
    const r = db.prepare("SELECT * FROM stores WHERE id = ?").get(id) as Row | undefined;
    return r ? mapStore(r) : null;
  },
  bySlug(slug: string): Store | null {
    const r = db.prepare("SELECT * FROM stores WHERE slug = ?").get(slug) as Row | undefined;
    return r ? mapStore(r) : null;
  },
  byPhoneNumberId(pid: string): Store | null {
    const r = db.prepare("SELECT * FROM stores WHERE wa_phone_number_id = ?").get(pid) as Row | undefined;
    return r ? mapStore(r) : null;
  },
  create(nome: string, slug: string): Store {
    const r = db.prepare("INSERT INTO stores (nome, slug) VALUES (?, ?)").run(nome, slug);
    return stores.get(Number(r.lastInsertRowid))!;
  },
  update(id: number, patch: Partial<Store> & { wa_access_token_plain?: string | null }) {
    const s = stores.get(id);
    if (!s) return null;
    const token = patch.wa_access_token_plain === undefined ? s.wa_access_token : patch.wa_access_token_plain ? encrypt(patch.wa_access_token_plain) : null;
    db.prepare(
      "UPDATE stores SET nome = ?, ativo = ?, wa_phone_number_id = ?, wa_waba_id = ?, wa_access_token = ?, meta_dataset_id = ? WHERE id = ?",
    ).run(
      patch.nome ?? s.nome,
      (patch.ativo ?? s.ativo) ? 1 : 0,
      patch.wa_phone_number_id === undefined ? s.wa_phone_number_id : patch.wa_phone_number_id || null,
      patch.wa_waba_id === undefined ? s.wa_waba_id : patch.wa_waba_id || null,
      token,
      patch.meta_dataset_id === undefined ? s.meta_dataset_id : patch.meta_dataset_id || null,
      id,
    );
    return stores.get(id);
  },
  remove(id: number) {
    db.prepare("DELETE FROM stores WHERE id = ?").run(id);
  },
  /** Credenciais do WhatsApp da loja (cai para as variáveis de ambiente na loja única/primeira). */
  creds(storeId: number): WaCreds | null {
    const s = stores.get(storeId);
    if (!s) return null;
    const token = decrypt(s.wa_access_token) || null;
    if (s.wa_phone_number_id && token) return { phoneNumberId: s.wa_phone_number_id, accessToken: token, wabaId: s.wa_waba_id };
    // compatibilidade: credenciais no .env valem para a loja cujo número bate (ou para a primeira loja)
    const env = config.whatsapp;
    if (env.phoneNumberId && env.accessToken) {
      const first = (db.prepare("SELECT MIN(id) AS id FROM stores").get() as Row).id;
      if (s.wa_phone_number_id === env.phoneNumberId || (!s.wa_phone_number_id && first === storeId)) {
        return { phoneNumberId: env.phoneNumberId, accessToken: env.accessToken, wabaId: s.wa_waba_id || env.wabaId || null };
      }
    }
    return null;
  },
  /** Resolve a loja de um webhook pelo phone_number_id. */
  forWebhook(phoneNumberId: string | undefined): Store | null {
    if (phoneNumberId) {
      const s = stores.byPhoneNumberId(phoneNumberId);
      if (s) return s;
      if (config.whatsapp.phoneNumberId === phoneNumberId) {
        const r = db.prepare("SELECT * FROM stores ORDER BY id LIMIT 1").get() as Row | undefined;
        return r ? mapStore(r) : null;
      }
    }
    return null;
  },
};

// ───────────────────────────── Usuários ─────────────────────────────

const mapUser = (r: Row): User => ({
  id: r.id,
  store_id: r.store_id,
  role: r.role,
  nome: r.nome,
  email: r.email,
  whatsapp: r.whatsapp,
  ativo: bool(r.ativo),
  recebe_leads: bool(r.recebe_leads),
  leads_recebidos: Number(r.leads_recebidos),
  created_at: r.created_at,
});

export const users = {
  get(id: number): User | null {
    const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? mapUser(r) : null;
  },
  byEmail(email: string): (User & { senha_hash: string | null }) | null {
    const r = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
    return r ? { ...mapUser(r), senha_hash: r.senha_hash } : null;
  },
  forStore(storeId: number): User[] {
    return (db.prepare("SELECT * FROM users WHERE store_id = ? ORDER BY role, nome").all(storeId) as Row[]).map(mapUser);
  },
  admins(): User[] {
    return (db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY nome").all() as Row[]).map(mapUser);
  },
  sellers(storeId: number): User[] {
    return (db.prepare("SELECT * FROM users WHERE store_id = ? AND role IN ('vendedor','dono') ORDER BY nome").all(storeId) as Row[]).map(mapUser);
  },
  create(u: { store_id: number | null; role: Role; nome: string; email: string; senha?: string | null; whatsapp?: string | null; recebe_leads?: boolean }): User {
    const r = db
      .prepare("INSERT INTO users (store_id, role, nome, email, senha_hash, whatsapp, recebe_leads) VALUES (?,?,?,?,?,?,?)")
      .run(u.store_id, u.role, u.nome, u.email.trim().toLowerCase(), u.senha ? hashPassword(u.senha) : null, u.whatsapp ?? null, u.recebe_leads ? 1 : 0);
    return users.get(Number(r.lastInsertRowid))!;
  },
  update(id: number, patch: Partial<User> & { senha?: string }) {
    const u = users.get(id);
    if (!u) return null;
    const m = { ...u, ...patch };
    db.prepare("UPDATE users SET nome = ?, email = ?, whatsapp = ?, ativo = ?, recebe_leads = ?, role = ? WHERE id = ?").run(
      m.nome,
      m.email.trim().toLowerCase(),
      m.whatsapp ?? null,
      m.ativo ? 1 : 0,
      m.recebe_leads ? 1 : 0,
      m.role,
      id,
    );
    if (patch.senha) db.prepare("UPDATE users SET senha_hash = ? WHERE id = ?").run(hashPassword(patch.senha), id);
    return users.get(id);
  },
  remove(id: number) {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  },
  /** Rodízio: quem recebe leads e recebeu menos até agora. */
  nextInRotation(storeId: number): User | null {
    const r = db
      .prepare("SELECT * FROM users WHERE store_id = ? AND ativo = 1 AND recebe_leads = 1 ORDER BY leads_recebidos ASC, id ASC LIMIT 1")
      .get(storeId) as Row | undefined;
    return r ? mapUser(r) : null;
  },
  incrementLeads(id: number) {
    db.prepare("UPDATE users SET leads_recebidos = leads_recebidos + 1 WHERE id = ?").run(id);
  },
  count(): number {
    return Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as Row).n);
  },
};

// ───────────────────────────── Veículos ─────────────────────────────

function mapVehicle(r: Row): Vehicle {
  return {
    ...(r as Vehicle),
    opcionais: parseJson(r.opcionais, []),
    destaques: parseJson(r.destaques, []),
    fotos: parseJson(r.fotos, []),
    videos: parseJson(r.videos, []),
    ficha: parseJson(r.ficha, {}),
    destaque: bool(r.destaque),
  };
}

export const vehicles = {
  all(storeId: number): Vehicle[] {
    return (db.prepare("SELECT * FROM vehicles WHERE store_id = ? ORDER BY destaque DESC, updated_at DESC").all(storeId) as Row[]).map(mapVehicle);
  },
  available(storeId: number): Vehicle[] {
    return (
      db.prepare("SELECT * FROM vehicles WHERE store_id = ? AND status != 'vendido' ORDER BY destaque DESC, updated_at DESC").all(storeId) as Row[]
    ).map(mapVehicle);
  },
  get(id: string, storeId?: number): Vehicle | null {
    const r = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(id) as Row | undefined;
    if (!r || (storeId != null && r.store_id !== storeId)) return null;
    return mapVehicle(r);
  },
  upsert(v: Partial<Vehicle> & { id: string; store_id: number; marca: string; modelo: string }): Vehicle {
    const existing = vehicles.get(v.id);
    if (existing && existing.store_id !== v.store_id) throw new Error("Esse código de produto pertence a outra loja.");
    const m = { ...(existing ?? {}), ...v } as Vehicle;
    db.prepare(
      `INSERT INTO vehicles (id, store_id, marca, modelo, versao, ano_fab, ano_modelo, km, preco, preco_promocional, fipe, cambio, combustivel,
        carroceria, cor, portas, final_placa, opcionais, destaques, descricao, fotos, videos, status, destaque, entrada_sugerida, ficha, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao, ano_fab=excluded.ano_fab,
        ano_modelo=excluded.ano_modelo, km=excluded.km, preco=excluded.preco, preco_promocional=excluded.preco_promocional,
        fipe=excluded.fipe, cambio=excluded.cambio, combustivel=excluded.combustivel, carroceria=excluded.carroceria, cor=excluded.cor,
        portas=excluded.portas, final_placa=excluded.final_placa, opcionais=excluded.opcionais, destaques=excluded.destaques,
        descricao=excluded.descricao, fotos=excluded.fotos, videos=excluded.videos, status=excluded.status, destaque=excluded.destaque,
        entrada_sugerida=excluded.entrada_sugerida, ficha=excluded.ficha, updated_at=excluded.updated_at
       WHERE vehicles.store_id = excluded.store_id`,
    ).run(
      m.id,
      m.store_id,
      m.marca,
      m.modelo,
      m.versao ?? null,
      m.ano_fab ?? null,
      m.ano_modelo ?? null,
      m.km ?? null,
      m.preco ?? null,
      m.preco_promocional ?? null,
      m.fipe ?? null,
      m.cambio ?? null,
      m.combustivel ?? null,
      m.carroceria ?? null,
      m.cor ?? null,
      m.portas ?? null,
      m.final_placa ?? null,
      JSON.stringify(m.opcionais ?? []),
      JSON.stringify(m.destaques ?? []),
      m.descricao ?? null,
      JSON.stringify(m.fotos ?? []),
      JSON.stringify(m.videos ?? []),
      m.status ?? "disponivel",
      m.destaque ? 1 : 0,
      m.entrada_sugerida ?? null,
      JSON.stringify(m.ficha ?? {}),
      nowIso(),
    );
    return vehicles.get(m.id)!;
  },
  remove(id: string, storeId: number) {
    db.prepare("DELETE FROM vehicles WHERE id = ? AND store_id = ?").run(id, storeId);
  },
  setStatus(id: string, status: Vehicle["status"], storeId: number) {
    db.prepare("UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ? AND store_id = ?").run(status, nowIso(), id, storeId);
  },
};

export function vehicleTitle(v: Pick<Vehicle, "marca" | "modelo" | "versao" | "ano_fab" | "ano_modelo">) {
  const ano = v.ano_fab && v.ano_modelo && v.ano_fab !== v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : `${v.ano_modelo ?? v.ano_fab ?? ""}`;
  return [v.marca, v.modelo, v.versao, ano].filter(Boolean).join(" ").trim();
}
/** Nome curto e natural, do jeito que um vendedor fala: "Corolla 2022". */
export function vehicleShort(v: Pick<Vehicle, "modelo" | "ano_modelo">) {
  return [v.modelo, v.ano_modelo].filter(Boolean).join(" ");
}
export const effectivePrice = (v: Pick<Vehicle, "preco" | "preco_promocional">) => v.preco_promocional ?? v.preco;

// ───────────────────────────── Contatos ─────────────────────────────

const mapContact = (r: Row): Contact => ({ ...(r as Contact), opt_out: bool(r.opt_out), tags: parseJson(r.tags, []) });

export const contacts = {
  get(id: number): Contact | null {
    const r = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Row | undefined;
    return r ? mapContact(r) : null;
  },
  byWaId(storeId: number, waId: string): Contact | null {
    const r = db.prepare("SELECT * FROM contacts WHERE store_id = ? AND wa_id = ?").get(storeId, waId) as Row | undefined;
    return r ? mapContact(r) : null;
  },
  ensure(storeId: number, waId: string, nomePerfil: string | null, channel: Channel = "whatsapp"): Contact {
    const found = contacts.byWaId(storeId, waId);
    if (found) {
      if (nomePerfil && nomePerfil !== found.nome_perfil) db.prepare("UPDATE contacts SET nome_perfil = ? WHERE id = ?").run(nomePerfil, found.id);
      return contacts.get(found.id)!;
    }
    const r = db.prepare("INSERT INTO contacts (store_id, wa_id, nome_perfil, channel) VALUES (?, ?, ?, ?)").run(storeId, waId, nomePerfil, channel);
    const id = Number(r.lastInsertRowid);
    db.prepare("INSERT INTO leads (contact_id, store_id) VALUES (?, ?)").run(id, storeId);
    return contacts.get(id)!;
  },
  update(id: number, patch: Partial<Contact>) {
    const allowed = [
      "nome",
      "nome_perfil",
      "last_inbound_at",
      "last_outbound_at",
      "opt_out",
      "bot_paused_until",
      "paused_reason",
      "seller_id",
      "ctwa_clid",
      "ad_id",
      "ad_headline",
      "ad_source_url",
      "origem",
      "campaign_id",
      "tags",
      "ai_cursor",
    ] as const;
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (k in patch) {
        sets.push(`${k} = ?`);
        const v = (patch as any)[k];
        vals.push(typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? JSON.stringify(v) : v ?? null);
      }
    }
    if (!sets.length) return;
    db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  },
  isBotPaused(c: Contact) {
    return Boolean(c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now());
  },
  listWithSummary(storeId: number, opts: { q?: string; filtro?: string; sellerId?: number | null; limit?: number } = {}) {
    const where: string[] = ["c.store_id = ?"];
    const vals: any[] = [storeId];
    if (opts.sellerId != null) {
      where.push("c.seller_id = ?");
      vals.push(opts.sellerId);
    }
    if (opts.q) {
      where.push("(c.nome LIKE ? OR c.nome_perfil LIKE ? OR c.wa_id LIKE ? OR c.tags LIKE ?)");
      vals.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
    }
    if (opts.filtro === "humano") where.push("c.bot_paused_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    if (opts.filtro === "quentes") where.push("l.temperatura IN ('quente','pronto')");
    if (opts.filtro === "anuncio") where.push("c.ctwa_clid IS NOT NULL");
    if (opts.filtro === "simulacao") where.push("EXISTS (SELECT 1 FROM simulations s WHERE s.contact_id = c.id)");
    if (opts.filtro === "sem_vendedor") where.push("c.seller_id IS NULL");
    const sql = `
      SELECT c.*, l.stage, l.score, l.temperatura, l.intencao, l.interesse_texto,
        (SELECT body FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT sender FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
        (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
        (SELECT nome FROM users u WHERE u.id = c.seller_id) AS vendedor_nome
      FROM contacts c LEFT JOIN leads l ON l.contact_id = c.id
      WHERE ${where.join(" AND ")}
      ORDER BY last_at DESC NULLS LAST LIMIT ?`;
    return (db.prepare(sql).all(...vals, opts.limit ?? 300) as Row[]).map((r) => ({ ...r, ...mapContact(r) }));
  },
  remove(id: number) {
    db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  },
};

// ───────────────────────────── Mensagens ─────────────────────────────

const mapMessage = (r: Row): MessageRow => ({ ...(r as MessageRow), media: parseJson(r.media, null), meta: parseJson(r.meta, null) });

export const messages = {
  add(m: {
    contact_id: number;
    direction: Direction;
    sender: Sender;
    type: string;
    body?: string | null;
    media?: unknown;
    wa_message_id?: string | null;
    status?: string | null;
    meta?: Record<string, unknown> | null;
    created_at?: string;
  }): MessageRow | null {
    try {
      const r = db
        .prepare("INSERT INTO messages (contact_id, direction, sender, type, body, media, wa_message_id, status, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(
          m.contact_id,
          m.direction,
          m.sender,
          m.type,
          m.body ?? null,
          m.media ? JSON.stringify(m.media) : null,
          m.wa_message_id ?? null,
          m.status ?? null,
          m.meta ? JSON.stringify(m.meta) : null,
          m.created_at ?? nowIso(),
        );
      return messages.get(Number(r.lastInsertRowid));
    } catch (e: any) {
      if (String(e?.message).includes("UNIQUE")) return null;
      throw e;
    }
  },
  get(id: number): MessageRow | null {
    const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined;
    return r ? mapMessage(r) : null;
  },
  byWaId(waId: string) {
    const r = db.prepare("SELECT * FROM messages WHERE wa_message_id = ?").get(waId) as Row | undefined;
    return r ? mapMessage(r) : null;
  },
  forContact(contactId: number, limit = 200, afterId = 0): MessageRow[] {
    return (
      db.prepare("SELECT * FROM (SELECT * FROM messages WHERE contact_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(contactId, afterId, limit) as Row[]
    ).map(mapMessage);
  },
  setStatus(waMessageId: string, status: string) {
    const order = ["sent", "delivered", "read", "failed"];
    const cur = messages.byWaId(waMessageId);
    if (!cur) return;
    if (status !== "failed" && cur.status && order.indexOf(cur.status) >= order.indexOf(status)) return;
    db.prepare("UPDATE messages SET status = ? WHERE wa_message_id = ?").run(status, waMessageId);
  },
  setWaId(id: number, waMessageId: string, status = "sent") {
    db.prepare("UPDATE messages SET wa_message_id = ?, status = ? WHERE id = ?").run(waMessageId, status, id);
  },
  setFailed(id: number, reason: string) {
    db.prepare("UPDATE messages SET status = 'failed', meta = json_set(COALESCE(meta,'{}'), '$.erro', ?) WHERE id = ?").run(reason, id);
  },
};

// ───────────────────────────── Histórico da IA ─────────────────────────────

const SESSION_GAP_HOURS = 72;

export const aiTurns = {
  currentSession(contactId: number): { id: number; isNew: boolean } {
    const r = db.prepare("SELECT * FROM ai_sessions WHERE contact_id = ? ORDER BY id DESC LIMIT 1").get(contactId) as Row | undefined;
    if (r && Date.now() - new Date(r.last_at).getTime() < SESSION_GAP_HOURS * 3600_000) return { id: r.id, isNew: false };
    const ins = db.prepare("INSERT INTO ai_sessions (contact_id) VALUES (?)").run(contactId);
    return { id: Number(ins.lastInsertRowid), isNew: true };
  },
  history(sessionId: number): { role: string; content: unknown }[] {
    return (db.prepare("SELECT role, content FROM ai_turns WHERE session_id = ? ORDER BY id ASC").all(sessionId) as Row[]).map((r) => ({
      role: r.role,
      content: JSON.parse(r.content),
    }));
  },
  append(contactId: number, sessionId: number, role: "user" | "assistant" | "system", content: unknown) {
    db.prepare("INSERT INTO ai_turns (contact_id, session_id, role, content) VALUES (?,?,?,?)").run(contactId, sessionId, role, JSON.stringify(content));
    db.prepare("UPDATE ai_sessions SET last_at = ? WHERE id = ?").run(nowIso(), sessionId);
  },
  addUsage(sessionId: number, u: { input: number; output: number; cacheRead: number }) {
    db.prepare(
      "UPDATE ai_sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ? WHERE id = ?",
    ).run(u.input, u.output, u.cacheRead, sessionId);
  },
  endSessions(contactId: number) {
    db.prepare("UPDATE ai_sessions SET last_at = '1970-01-01T00:00:00.000Z' WHERE contact_id = ?").run(contactId);
  },
  usageTotals(storeId: number, sinceIso: string) {
    return db
      .prepare(
        `SELECT COALESCE(SUM(s.input_tokens),0) AS input, COALESCE(SUM(s.output_tokens),0) AS output, COALESCE(SUM(s.cache_read_tokens),0) AS cache_read
         FROM ai_sessions s JOIN contacts c ON c.id = s.contact_id WHERE c.store_id = ? AND s.started_at >= ?`,
      )
      .get(storeId, sinceIso) as { input: number; output: number; cache_read: number };
  },
};

// ───────────────────────────── Leads ─────────────────────────────

const mapLead = (r: Row): Lead => ({
  ...(r as Lead),
  interesse: parseJson(r.interesse, []),
  troca: parseJson(r.troca, null),
  analise: parseJson(r.analise, null),
  score_detalhe: parseJson(r.score_detalhe, null),
  tem_troca: r.tem_troca == null ? null : bool(r.tem_troca),
});

const LEAD_COLS = [
  "stage",
  "score",
  "temperatura",
  "score_detalhe",
  "intencao",
  "interesse",
  "interesse_texto",
  "orcamento_max",
  "parcela_max",
  "entrada",
  "forma_pagamento",
  "tem_troca",
  "troca",
  "cidade",
  "bairro",
  "urgencia",
  "uso",
  "observacoes",
  "analise",
  "motivo_perda",
  "valor_venda",
  "vehicle_sold_id",
] as const;

export const leads = {
  get(contactId: number): Lead | null {
    const r = db.prepare("SELECT * FROM leads WHERE contact_id = ?").get(contactId) as Row | undefined;
    return r ? mapLead(r) : null;
  },
  update(contactId: number, patch: Partial<Lead>) {
    const cur = leads.get(contactId);
    if (!cur) return null;
    const m: any = { ...cur, ...patch };
    const stageChanged = patch.stage && patch.stage !== cur.stage;
    const vals = LEAD_COLS.map((k) => {
      const v = m[k];
      if (k === "tem_troca") return v == null ? null : v ? 1 : 0;
      if (v != null && typeof v === "object") return JSON.stringify(v);
      return v ?? null;
    });
    db.prepare(`UPDATE leads SET ${LEAD_COLS.map((k) => `${k} = ?`).join(", ")}, updated_at = ?, stage_changed_at = ? WHERE contact_id = ?`).run(
      ...vals,
      nowIso(),
      stageChanged ? nowIso() : cur.stage_changed_at,
      contactId,
    );
    return leads.get(contactId);
  },
  board(storeId: number, sellerId?: number | null) {
    return db
      .prepare(
        `SELECT l.*, c.nome, c.nome_perfil, c.wa_id, c.ctwa_clid, c.ad_headline, c.origem, c.seller_id, c.bot_paused_until, c.channel, c.tags,
          (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY id DESC LIMIT 1) AS last_at,
          (SELECT nome FROM users u WHERE u.id = c.seller_id) AS vendedor
         FROM leads l JOIN contacts c ON c.id = l.contact_id
         WHERE l.store_id = ? ${sellerId != null ? "AND c.seller_id = ?" : ""}
         ORDER BY l.updated_at DESC LIMIT 1000`,
      )
      .all(...(sellerId != null ? [storeId, sellerId] : [storeId]))
      .map((r) => ({ ...mapLead(r as Row), ...(r as Row), interesse: parseJson((r as Row).interesse, []), troca: parseJson((r as Row).troca, null), analise: parseJson((r as Row).analise, null), score_detalhe: parseJson((r as Row).score_detalhe, null), tags: parseJson((r as Row).tags, []) }));
  },
  countByStage(storeId: number, sellerId?: number | null): Record<LeadStage, number> {
    const out: Record<string, number> = {};
    const rows = (
      sellerId != null
        ? db.prepare("SELECT l.stage, COUNT(*) AS n FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE l.store_id = ? AND c.seller_id = ? GROUP BY l.stage").all(storeId, sellerId)
        : db.prepare("SELECT stage, COUNT(*) AS n FROM leads WHERE store_id = ? GROUP BY stage").all(storeId)
    ) as Row[];
    for (const r of rows) out[r.stage] = Number(r.n);
    return out as Record<LeadStage, number>;
  },
};

// ───────────────────────────── Simulações ─────────────────────────────

const mapSim = (r: Row): Simulation => ({ ...(r as Simulation), tem_cnh: r.tem_cnh == null ? null : bool(r.tem_cnh) });

export const simulations = {
  get(id: number): Simulation | null {
    const r = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as Row | undefined;
    return r ? mapSim(r) : null;
  },
  /** Simulação em aberto do contato (coletando ou recém-enviada); cria se não existir. */
  open(contactId: number, storeId: number, create = true): Simulation | null {
    const r = db
      .prepare("SELECT * FROM simulations WHERE contact_id = ? AND status IN ('coletando') ORDER BY id DESC LIMIT 1")
      .get(contactId) as Row | undefined;
    if (r) return mapSim(r);
    if (!create) return null;
    const ins = db.prepare("INSERT INTO simulations (store_id, contact_id) VALUES (?, ?)").run(storeId, contactId);
    return simulations.get(Number(ins.lastInsertRowid));
  },
  latest(contactId: number): Simulation | null {
    const r = db.prepare("SELECT * FROM simulations WHERE contact_id = ? ORDER BY id DESC LIMIT 1").get(contactId) as Row | undefined;
    return r ? mapSim(r) : null;
  },
  forContact(contactId: number): Simulation[] {
    return (db.prepare("SELECT * FROM simulations WHERE contact_id = ? ORDER BY id DESC").all(contactId) as Row[]).map(mapSim);
  },
  update(id: number, patch: Partial<Simulation>) {
    const s = simulations.get(id);
    if (!s) return null;
    const m: any = { ...s, ...patch };
    db.prepare(
      `UPDATE simulations SET vehicle_id=?, seller_id=?, status=?, nome_completo=?, cpf_enc=?, data_nascimento=?, tem_cnh=?, forma_pagamento=?,
        entrada_dinheiro=?, observacoes=?, consentimento_em=?, enviada_em=?, resultado=?, updated_at=? WHERE id=?`,
    ).run(
      m.vehicle_id ?? null,
      m.seller_id ?? null,
      m.status,
      m.nome_completo ?? null,
      m.cpf_enc ?? null,
      m.data_nascimento ?? null,
      m.tem_cnh == null ? null : m.tem_cnh ? 1 : 0,
      m.forma_pagamento ?? null,
      m.entrada_dinheiro ?? null,
      m.observacoes ?? null,
      m.consentimento_em ?? null,
      m.enviada_em ?? null,
      m.resultado ?? null,
      nowIso(),
      id,
    );
    return simulations.get(id);
  },
  list(storeId: number, sellerId?: number | null) {
    return db
      .prepare(
        `SELECT s.*, c.nome AS contato_nome, c.nome_perfil, c.wa_id, u.nome AS vendedor, v.marca, v.modelo, v.versao, v.ano_modelo
         FROM simulations s JOIN contacts c ON c.id = s.contact_id LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
         WHERE s.store_id = ? ${sellerId != null ? "AND s.seller_id = ?" : ""} ORDER BY s.updated_at DESC LIMIT 500`,
      )
      .all(...(sellerId != null ? [storeId, sellerId] : [storeId]))
      .map((r) => mapSim(r as Row) as Simulation & Row);
  },
};

// ───────────────────────────── Agendamentos ─────────────────────────────

const mapAppt = (r: Row): Appointment => ({ ...(r as Appointment), reminder_sent: bool(r.reminder_sent) });

export const appointments = {
  create(a: { contact_id: number; store_id: number; vehicle_id: string | null; tipo: Appointment["tipo"]; inicio: string; notas?: string | null }) {
    const r = db
      .prepare("INSERT INTO appointments (contact_id, store_id, vehicle_id, tipo, inicio, notas) VALUES (?,?,?,?,?,?)")
      .run(a.contact_id, a.store_id, a.vehicle_id, a.tipo, a.inicio, a.notas ?? null);
    return appointments.get(Number(r.lastInsertRowid))!;
  },
  get(id: number): Appointment | null {
    const r = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as Row | undefined;
    return r ? mapAppt(r) : null;
  },
  forContact(contactId: number): Appointment[] {
    return (db.prepare("SELECT * FROM appointments WHERE contact_id = ? ORDER BY inicio DESC").all(contactId) as Row[]).map(mapAppt);
  },
  upcomingForContact(contactId: number): Appointment[] {
    return (
      db.prepare("SELECT * FROM appointments WHERE contact_id = ? AND inicio >= ? AND status IN ('agendada','confirmada') ORDER BY inicio").all(contactId, nowIso()) as Row[]
    ).map(mapAppt);
  },
  between(storeId: number, fromIso: string, toIso: string, sellerId?: number | null) {
    return db
      .prepare(
        `SELECT a.*, c.nome, c.nome_perfil, c.wa_id, c.seller_id, v.marca, v.modelo, v.versao, v.ano_modelo
         FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.store_id = ? AND a.inicio >= ? AND a.inicio < ? ${sellerId != null ? "AND c.seller_id = ?" : ""} ORDER BY a.inicio`,
      )
      .all(...(sellerId != null ? [storeId, fromIso, toIso, sellerId] : [storeId, fromIso, toIso]))
      .map((r) => ({ ...(r as Row), ...mapAppt(r as Row) }));
  },
  countAt(storeId: number, inicioIso: string): number {
    const r = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE store_id = ? AND inicio = ? AND status IN ('agendada','confirmada')").get(storeId, inicioIso) as Row;
    return Number(r.n);
  },
  update(id: number, patch: Partial<Appointment>) {
    const a = appointments.get(id);
    if (!a) return null;
    const m = { ...a, ...patch };
    db.prepare("UPDATE appointments SET vehicle_id=?, tipo=?, inicio=?, status=?, notas=?, reminder_sent=? WHERE id=?").run(
      m.vehicle_id,
      m.tipo,
      m.inicio,
      m.status,
      m.notas,
      m.reminder_sent ? 1 : 0,
      id,
    );
    return appointments.get(id);
  },
  dueReminders(windowStartIso: string, windowEndIso: string): Appointment[] {
    return (
      db
        .prepare("SELECT * FROM appointments WHERE reminder_sent = 0 AND status IN ('agendada','confirmada') AND inicio >= ? AND inicio <= ?")
        .all(windowStartIso, windowEndIso) as Row[]
    ).map(mapAppt);
  },
};

// ───────────────────────────── Áudios ─────────────────────────────

const mapAudio = (r: Row): AudioClip => ({ ...(r as AudioClip), ativo: bool(r.ativo) });

export const audios = {
  forStore(storeId: number, onlyActive = false): AudioClip[] {
    return (
      db.prepare(`SELECT * FROM audios WHERE store_id = ? ${onlyActive ? "AND ativo = 1" : ""} ORDER BY id`).all(storeId) as Row[]
    ).map(mapAudio);
  },
  get(id: number): AudioClip | null {
    const r = db.prepare("SELECT * FROM audios WHERE id = ?").get(id) as Row | undefined;
    return r ? mapAudio(r) : null;
  },
  create(a: Omit<AudioClip, "id" | "created_at" | "ativo">) {
    const r = db.prepare("INSERT INTO audios (store_id, titulo, quando_usar, url, mime, duracao_s) VALUES (?,?,?,?,?,?)").run(a.store_id, a.titulo, a.quando_usar, a.url, a.mime, a.duracao_s);
    return audios.get(Number(r.lastInsertRowid))!;
  },
  update(id: number, patch: Partial<AudioClip>) {
    const a = audios.get(id);
    if (!a) return null;
    const m = { ...a, ...patch };
    db.prepare("UPDATE audios SET titulo = ?, quando_usar = ?, ativo = ? WHERE id = ?").run(m.titulo, m.quando_usar, m.ativo ? 1 : 0, id);
    return audios.get(id);
  },
  remove(id: number) {
    db.prepare("DELETE FROM audios WHERE id = ?").run(id);
  },
  sentTo(contactId: number): number[] {
    return (
      db.prepare("SELECT json_extract(meta,'$.audio_id') AS a FROM messages WHERE contact_id = ? AND type = 'audio' AND direction = 'out'").all(contactId) as Row[]
    )
      .map((r) => Number(r.a))
      .filter(Boolean);
  },
};

// ───────────────────────────── Notas e respostas rápidas ─────────────────────────────

export const notes = {
  forContact(contactId: number): Note[] {
    return db.prepare("SELECT * FROM notes WHERE contact_id = ? ORDER BY id DESC").all(contactId) as unknown as Note[];
  },
  add(contactId: number, userId: number | null, autor: string, texto: string): Note {
    const r = db.prepare("INSERT INTO notes (contact_id, user_id, autor, texto) VALUES (?,?,?,?)").run(contactId, userId, autor, texto);
    return db.prepare("SELECT * FROM notes WHERE id = ?").get(Number(r.lastInsertRowid)) as unknown as Note;
  },
  remove(id: number, contactId: number) {
    db.prepare("DELETE FROM notes WHERE id = ? AND contact_id = ?").run(id, contactId);
  },
};

export const quickReplies = {
  forStore(storeId: number): QuickReply[] {
    return db.prepare("SELECT * FROM quick_replies WHERE store_id = ? ORDER BY atalho").all(storeId) as unknown as QuickReply[];
  },
  create(storeId: number, atalho: string, texto: string) {
    const r = db.prepare("INSERT INTO quick_replies (store_id, atalho, texto) VALUES (?,?,?)").run(storeId, atalho, texto);
    return db.prepare("SELECT * FROM quick_replies WHERE id = ?").get(Number(r.lastInsertRowid));
  },
  remove(id: number, storeId: number) {
    db.prepare("DELETE FROM quick_replies WHERE id = ? AND store_id = ?").run(id, storeId);
  },
};

// ───────────────────────────── Eventos ─────────────────────────────

export const events = {
  add(storeId: number | null, contactId: number | null, name: string, payload?: Record<string, unknown>, userId?: number | null): number {
    const r = db
      .prepare("INSERT INTO events (store_id, contact_id, user_id, name, payload) VALUES (?,?,?,?,?)")
      .run(storeId, contactId, userId ?? null, name, payload ? JSON.stringify(payload) : null);
    return Number(r.lastInsertRowid);
  },
  has(contactId: number, name: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM events WHERE contact_id = ? AND name = ? LIMIT 1").get(contactId, name));
  },
  setCapi(id: number, status: string, response: unknown) {
    db.prepare("UPDATE events SET capi_status = ?, capi_response = ? WHERE id = ?").run(status, JSON.stringify(response), id);
  },
  forContact(contactId: number, limit = 60) {
    return db.prepare("SELECT * FROM events WHERE contact_id = ? ORDER BY id DESC LIMIT ?").all(contactId, limit);
  },
};

export const followups = {
  claim(contactId: number, kind: string, ref: string): boolean {
    const r = db.prepare("INSERT OR IGNORE INTO followups (contact_id, kind, ref) VALUES (?,?,?)").run(contactId, kind, ref);
    return Number(r.changes) > 0;
  },
};

/** Garante o administrador geral na primeira inicialização. */
export function ensureAdmin() {
  if (users.admins().length) return null;
  return users.create({ store_id: null, role: "admin", nome: "Administrador", email: config.admin.email, senha: config.admin.password });
}
