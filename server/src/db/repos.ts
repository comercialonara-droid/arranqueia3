import { db, nowIso, parseJson } from "./index.js";
import type {
  Appointment,
  Channel,
  Contact,
  Direction,
  Lead,
  LeadStage,
  MessageRow,
  Seller,
  Sender,
  Vehicle,
} from "../types.js";

type Row = Record<string, any>;
const bool = (v: unknown) => v === 1 || v === true || v === "1";

// ───────────────────────────── Veículos ─────────────────────────────

function mapVehicle(r: Row): Vehicle {
  return {
    ...(r as Vehicle),
    opcionais: parseJson(r.opcionais, []),
    destaques: parseJson(r.destaques, []),
    fotos: parseJson(r.fotos, []),
    destaque: bool(r.destaque),
  };
}

export const vehicles = {
  all(): Vehicle[] {
    return (db.prepare("SELECT * FROM vehicles ORDER BY destaque DESC, updated_at DESC").all() as Row[]).map(mapVehicle);
  },
  available(): Vehicle[] {
    return (db.prepare("SELECT * FROM vehicles WHERE status != 'vendido' ORDER BY destaque DESC, updated_at DESC").all() as Row[]).map(
      mapVehicle,
    );
  },
  get(id: string): Vehicle | null {
    const r = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(id) as Row | undefined;
    return r ? mapVehicle(r) : null;
  },
  upsert(v: Partial<Vehicle> & { id: string; marca: string; modelo: string }): Vehicle {
    const existing = vehicles.get(v.id);
    const merged = { ...(existing ?? {}), ...v } as Vehicle;
    db.prepare(
      `INSERT INTO vehicles (id, marca, modelo, versao, ano_fab, ano_modelo, km, preco, preco_promocional, fipe, cambio, combustivel,
        carroceria, cor, portas, final_placa, opcionais, destaques, descricao, fotos, status, destaque, entrada_sugerida, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET marca=excluded.marca, modelo=excluded.modelo, versao=excluded.versao, ano_fab=excluded.ano_fab,
        ano_modelo=excluded.ano_modelo, km=excluded.km, preco=excluded.preco, preco_promocional=excluded.preco_promocional,
        fipe=excluded.fipe, cambio=excluded.cambio, combustivel=excluded.combustivel, carroceria=excluded.carroceria, cor=excluded.cor,
        portas=excluded.portas, final_placa=excluded.final_placa, opcionais=excluded.opcionais, destaques=excluded.destaques,
        descricao=excluded.descricao, fotos=excluded.fotos, status=excluded.status, destaque=excluded.destaque,
        entrada_sugerida=excluded.entrada_sugerida, updated_at=excluded.updated_at`,
    ).run(
      merged.id,
      merged.marca,
      merged.modelo,
      merged.versao ?? null,
      merged.ano_fab ?? null,
      merged.ano_modelo ?? null,
      merged.km ?? null,
      merged.preco ?? null,
      merged.preco_promocional ?? null,
      merged.fipe ?? null,
      merged.cambio ?? null,
      merged.combustivel ?? null,
      merged.carroceria ?? null,
      merged.cor ?? null,
      merged.portas ?? null,
      merged.final_placa ?? null,
      JSON.stringify(merged.opcionais ?? []),
      JSON.stringify(merged.destaques ?? []),
      merged.descricao ?? null,
      JSON.stringify(merged.fotos ?? []),
      merged.status ?? "disponivel",
      merged.destaque ? 1 : 0,
      merged.entrada_sugerida ?? null,
      nowIso(),
    );
    return vehicles.get(merged.id)!;
  },
  remove(id: string) {
    db.prepare("DELETE FROM vehicles WHERE id = ?").run(id);
  },
  setStatus(id: string, status: Vehicle["status"]) {
    db.prepare("UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  },
};

export function vehicleTitle(v: Pick<Vehicle, "marca" | "modelo" | "versao" | "ano_fab" | "ano_modelo">) {
  const ano = v.ano_fab && v.ano_modelo && v.ano_fab !== v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : `${v.ano_modelo ?? v.ano_fab ?? ""}`;
  return [v.marca, v.modelo, v.versao, ano].filter(Boolean).join(" ").trim();
}

export const effectivePrice = (v: Pick<Vehicle, "preco" | "preco_promocional">) => v.preco_promocional ?? v.preco;

// ───────────────────────────── Vendedores ─────────────────────────────

const mapSeller = (r: Row): Seller => ({ ...(r as Seller), ativo: bool(r.ativo) });

export const sellers = {
  all(): Seller[] {
    return (db.prepare("SELECT * FROM sellers ORDER BY id").all() as Row[]).map(mapSeller);
  },
  get(id: number): Seller | null {
    const r = db.prepare("SELECT * FROM sellers WHERE id = ?").get(id) as Row | undefined;
    return r ? mapSeller(r) : null;
  },
  create(nome: string, whatsapp: string): Seller {
    const r = db.prepare("INSERT INTO sellers (nome, whatsapp) VALUES (?, ?)").run(nome, whatsapp);
    return sellers.get(Number(r.lastInsertRowid))!;
  },
  update(id: number, patch: Partial<Seller>) {
    const s = sellers.get(id);
    if (!s) return null;
    const m = { ...s, ...patch };
    db.prepare("UPDATE sellers SET nome = ?, whatsapp = ?, ativo = ? WHERE id = ?").run(m.nome, m.whatsapp, m.ativo ? 1 : 0, id);
    return sellers.get(id);
  },
  remove(id: number) {
    db.prepare("DELETE FROM sellers WHERE id = ?").run(id);
  },
  /** Rodízio: o vendedor ativo que recebeu menos leads. */
  nextInRotation(): Seller | null {
    const r = db.prepare("SELECT * FROM sellers WHERE ativo = 1 ORDER BY leads_recebidos ASC, id ASC LIMIT 1").get() as Row | undefined;
    return r ? mapSeller(r) : null;
  },
  incrementLeads(id: number) {
    db.prepare("UPDATE sellers SET leads_recebidos = leads_recebidos + 1 WHERE id = ?").run(id);
  },
};

// ───────────────────────────── Contatos ─────────────────────────────

const mapContact = (r: Row): Contact => ({ ...(r as Contact), opt_out: bool(r.opt_out) });

export const contacts = {
  get(id: number): Contact | null {
    const r = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Row | undefined;
    return r ? mapContact(r) : null;
  },
  byWaId(waId: string): Contact | null {
    const r = db.prepare("SELECT * FROM contacts WHERE wa_id = ?").get(waId) as Row | undefined;
    return r ? mapContact(r) : null;
  },
  ensure(waId: string, nomePerfil: string | null, channel: Channel = "whatsapp"): Contact {
    const found = contacts.byWaId(waId);
    if (found) {
      if (nomePerfil && nomePerfil !== found.nome_perfil) db.prepare("UPDATE contacts SET nome_perfil = ? WHERE id = ?").run(nomePerfil, found.id);
      return contacts.get(found.id)!;
    }
    const r = db.prepare("INSERT INTO contacts (wa_id, nome_perfil, channel) VALUES (?, ?, ?)").run(waId, nomePerfil, channel);
    const id = Number(r.lastInsertRowid);
    db.prepare("INSERT INTO leads (contact_id) VALUES (?)").run(id);
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
      "ai_cursor",
    ] as const;
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of allowed) {
      if (k in patch) {
        sets.push(`${k} = ?`);
        const v = (patch as any)[k];
        vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v ?? null);
      }
    }
    if (!sets.length) return;
    db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  },
  isBotPaused(c: Contact) {
    return Boolean(c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now());
  },
  /** Lista para o painel: última mensagem, lead e não lidas. */
  listWithSummary(opts: { q?: string; filtro?: string; limit?: number } = {}) {
    const where: string[] = [];
    const vals: any[] = [];
    if (opts.q) {
      where.push("(c.nome LIKE ? OR c.nome_perfil LIKE ? OR c.wa_id LIKE ?)");
      vals.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
    }
    if (opts.filtro === "humano") where.push("c.bot_paused_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    if (opts.filtro === "quentes") where.push("l.temperatura = 'quente'");
    if (opts.filtro === "anuncio") where.push("c.ctwa_clid IS NOT NULL");
    const sql = `
      SELECT c.*, l.stage, l.score, l.temperatura, l.interesse_texto,
        (SELECT body FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT sender FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
        (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at
      FROM contacts c LEFT JOIN leads l ON l.contact_id = c.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY last_at DESC NULLS LAST LIMIT ?`;
    return (db.prepare(sql).all(...vals, opts.limit ?? 200) as Row[]).map((r) => ({ ...mapContact(r), ...r, opt_out: bool(r.opt_out) }));
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
        .prepare(
          "INSERT INTO messages (contact_id, direction, sender, type, body, media, wa_message_id, status, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
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
      if (String(e?.message).includes("UNIQUE")) return null; // mensagem duplicada (reentrega do webhook)
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
      db.prepare("SELECT * FROM (SELECT * FROM messages WHERE contact_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(
        contactId,
        afterId,
        limit,
      ) as Row[]
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
  lastId(): number {
    const r = db.prepare("SELECT MAX(id) AS m FROM messages").get() as Row;
    return Number(r?.m ?? 0);
  },
  since(afterId: number): MessageRow[] {
    return (db.prepare("SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT 500").all(afterId) as Row[]).map(mapMessage);
  },
};

// ───────────────────────────── Histórico da IA ─────────────────────────────

/** Uma sessão nova começa quando o cliente volta depois de muito tempo; assim o contexto não cresce sem limite. */
const SESSION_GAP_HOURS = 72;

export const aiTurns = {
  currentSession(contactId: number): { id: number; isNew: boolean } {
    const r = db.prepare("SELECT * FROM ai_sessions WHERE contact_id = ? ORDER BY id DESC LIMIT 1").get(contactId) as Row | undefined;
    if (r && Date.now() - new Date(r.last_at).getTime() < SESSION_GAP_HOURS * 3600_000) return { id: r.id, isNew: false };
    const ins = db.prepare("INSERT INTO ai_sessions (contact_id) VALUES (?)").run(contactId);
    return { id: Number(ins.lastInsertRowid), isNew: true };
  },
  history(sessionId: number): { role: "user" | "assistant"; content: unknown }[] {
    return (db.prepare("SELECT role, content FROM ai_turns WHERE session_id = ? ORDER BY id ASC").all(sessionId) as Row[]).map((r) => ({
      role: r.role,
      content: JSON.parse(r.content),
    }));
  },
  append(contactId: number, sessionId: number, role: "user" | "assistant", content: unknown) {
    db.prepare("INSERT INTO ai_turns (contact_id, session_id, role, content) VALUES (?,?,?,?)").run(
      contactId,
      sessionId,
      role,
      JSON.stringify(content),
    );
    db.prepare("UPDATE ai_sessions SET last_at = ? WHERE id = ?").run(nowIso(), sessionId);
  },
  addUsage(sessionId: number, u: { input: number; output: number; cacheRead: number }) {
    db.prepare(
      "UPDATE ai_sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ? WHERE id = ?",
    ).run(u.input, u.output, u.cacheRead, sessionId);
  },
  /** Encerra a sessão atual (ex.: ao limpar a conversa do simulador). */
  endSessions(contactId: number) {
    db.prepare("UPDATE ai_sessions SET last_at = '1970-01-01T00:00:00.000Z' WHERE contact_id = ?").run(contactId);
  },
  usageTotals(sinceIso: string) {
    return db
      .prepare(
        "SELECT COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COALESCE(SUM(cache_read_tokens),0) AS cache_read FROM ai_sessions WHERE started_at >= ?",
      )
      .get(sinceIso) as { input: number; output: number; cache_read: number };
  },
};

// ───────────────────────────── Leads ─────────────────────────────

const mapLead = (r: Row): Lead => ({
  ...(r as Lead),
  interesse: parseJson(r.interesse, []),
  troca: parseJson(r.troca, null),
  tem_troca: r.tem_troca == null ? null : bool(r.tem_troca),
});

export const leads = {
  get(contactId: number): Lead | null {
    const r = db.prepare("SELECT * FROM leads WHERE contact_id = ?").get(contactId) as Row | undefined;
    return r ? mapLead(r) : null;
  },
  update(contactId: number, patch: Partial<Lead>) {
    const cur = leads.get(contactId);
    if (!cur) return null;
    const m = { ...cur, ...patch };
    const stageChanged = patch.stage && patch.stage !== cur.stage;
    db.prepare(
      `UPDATE leads SET stage=?, score=?, temperatura=?, interesse=?, interesse_texto=?, orcamento_max=?, parcela_max=?, entrada=?,
       forma_pagamento=?, tem_troca=?, troca=?, cidade=?, bairro=?, urgencia=?, uso=?, observacoes=?, resumo=?, motivo_perda=?,
       valor_venda=?, vehicle_sold_id=?, updated_at=?, stage_changed_at=? WHERE contact_id=?`,
    ).run(
      m.stage,
      m.score,
      m.temperatura,
      JSON.stringify(m.interesse ?? []),
      m.interesse_texto ?? null,
      m.orcamento_max ?? null,
      m.parcela_max ?? null,
      m.entrada ?? null,
      m.forma_pagamento ?? null,
      m.tem_troca == null ? null : m.tem_troca ? 1 : 0,
      m.troca ? JSON.stringify(m.troca) : null,
      m.cidade ?? null,
      m.bairro ?? null,
      m.urgencia ?? null,
      m.uso ?? null,
      m.observacoes ?? null,
      m.resumo ?? null,
      m.motivo_perda ?? null,
      m.valor_venda ?? null,
      m.vehicle_sold_id ?? null,
      nowIso(),
      stageChanged ? nowIso() : cur.stage_changed_at,
      contactId,
    );
    return leads.get(contactId);
  },
  board() {
    return db
      .prepare(
        `SELECT l.*, c.nome, c.nome_perfil, c.wa_id, c.ctwa_clid, c.ad_headline, c.origem, c.seller_id, c.bot_paused_until, c.channel,
          (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY id DESC LIMIT 1) AS last_at
         FROM leads l JOIN contacts c ON c.id = l.contact_id
         ORDER BY l.updated_at DESC LIMIT 1000`,
      )
      .all()
      .map((r) => mapLead(r as Row) as Lead & Row);
  },
  countByStage(): Record<LeadStage, number> {
    const out: Record<string, number> = {};
    for (const r of db.prepare("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage").all() as Row[]) out[r.stage] = Number(r.n);
    return out as Record<LeadStage, number>;
  },
};

// ───────────────────────────── Agendamentos ─────────────────────────────

const mapAppt = (r: Row): Appointment => ({ ...(r as Appointment), reminder_sent: bool(r.reminder_sent) });

export const appointments = {
  create(a: { contact_id: number; vehicle_id: string | null; tipo: Appointment["tipo"]; inicio: string; notas?: string | null }) {
    const r = db
      .prepare("INSERT INTO appointments (contact_id, vehicle_id, tipo, inicio, notas) VALUES (?,?,?,?,?)")
      .run(a.contact_id, a.vehicle_id, a.tipo, a.inicio, a.notas ?? null);
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
      db
        .prepare("SELECT * FROM appointments WHERE contact_id = ? AND inicio >= ? AND status IN ('agendada','confirmada') ORDER BY inicio")
        .all(contactId, nowIso()) as Row[]
    ).map(mapAppt);
  },
  between(fromIso: string, toIso: string) {
    return db
      .prepare(
        `SELECT a.*, c.nome, c.nome_perfil, c.wa_id, v.marca, v.modelo, v.versao, v.ano_modelo
         FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.inicio >= ? AND a.inicio < ? ORDER BY a.inicio`,
      )
      .all(fromIso, toIso)
      .map((r) => ({ ...mapAppt(r as Row), ...(r as Row), reminder_sent: bool((r as Row).reminder_sent) }));
  },
  countAt(inicioIso: string): number {
    const r = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE inicio = ? AND status IN ('agendada','confirmada')").get(inicioIso) as Row;
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

// ───────────────────────────── Eventos ─────────────────────────────

export const events = {
  add(contactId: number | null, name: string, payload?: Record<string, unknown>): number {
    const r = db.prepare("INSERT INTO events (contact_id, name, payload) VALUES (?,?,?)").run(contactId, name, payload ? JSON.stringify(payload) : null);
    return Number(r.lastInsertRowid);
  },
  has(contactId: number, name: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM events WHERE contact_id = ? AND name = ? LIMIT 1").get(contactId, name));
  },
  setCapi(id: number, status: string, response: unknown) {
    db.prepare("UPDATE events SET capi_status = ?, capi_response = ? WHERE id = ?").run(status, JSON.stringify(response), id);
  },
  countSince(name: string, sinceIso: string): number {
    return Number((db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = ? AND created_at >= ?").get(name, sinceIso) as Row).n);
  },
  recent(limit = 100) {
    return db
      .prepare("SELECT e.*, c.nome, c.nome_perfil, c.wa_id FROM events e LEFT JOIN contacts c ON c.id = e.contact_id ORDER BY e.id DESC LIMIT ?")
      .all(limit);
  },
};

export const followups = {
  /** Registra o follow-up; devolve false se já existia (não envia de novo). */
  claim(contactId: number, kind: string, ref: string): boolean {
    const r = db.prepare("INSERT OR IGNORE INTO followups (contact_id, kind, ref) VALUES (?,?,?)").run(contactId, kind, ref);
    return Number(r.changes) > 0;
  },
};
