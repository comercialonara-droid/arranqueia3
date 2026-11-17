import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

const file = process.env.DB_FILE || path.join(config.dataDir, "arranque.db");
export const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  versao TEXT,
  ano_fab INTEGER,
  ano_modelo INTEGER,
  km INTEGER,
  preco REAL,
  preco_promocional REAL,
  fipe REAL,
  cambio TEXT,
  combustivel TEXT,
  carroceria TEXT,
  cor TEXT,
  portas INTEGER,
  final_placa TEXT,
  opcionais TEXT NOT NULL DEFAULT '[]',
  destaques TEXT NOT NULL DEFAULT '[]',
  descricao TEXT,
  fotos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disponivel',
  destaque INTEGER NOT NULL DEFAULT 0,
  entrada_sugerida REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  leads_recebidos INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL UNIQUE,
  nome TEXT,
  nome_perfil TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0,
  bot_paused_until TEXT,
  paused_reason TEXT,
  seller_id INTEGER REFERENCES sellers(id) ON DELETE SET NULL,
  ctwa_clid TEXT,
  ad_id TEXT,
  ad_headline TEXT,
  ad_source_url TEXT,
  origem TEXT,
  ai_cursor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT,
  media TEXT,
  wa_message_id TEXT UNIQUE,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);

-- Histórico bruto da conversa com o modelo (somente acréscimo — nunca editar linhas antigas)
CREATE TABLE IF NOT EXISTS ai_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_turns ON ai_turns(contact_id, session_id, id);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads (
  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'novo',
  score INTEGER NOT NULL DEFAULT 0,
  temperatura TEXT NOT NULL DEFAULT 'frio',
  interesse TEXT NOT NULL DEFAULT '[]',
  interesse_texto TEXT,
  orcamento_max REAL,
  parcela_max REAL,
  entrada REAL,
  forma_pagamento TEXT,
  tem_troca INTEGER,
  troca TEXT,
  cidade TEXT,
  bairro TEXT,
  urgencia TEXT,
  uso TEXT,
  observacoes TEXT,
  resumo TEXT,
  motivo_perda TEXT,
  valor_venda REAL,
  vehicle_sold_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  stage_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'visita',
  inicio TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendada',
  notas TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_inicio ON appointments(inicio);

-- Eventos de funil (analytics interno + envio para a Conversions API da Meta)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload TEXT,
  capi_status TEXT,
  capi_response TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, created_at);

-- Follow-ups enviados (evita repetir)
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(contact_id, kind, ref)
);
`);

export const nowIso = () => new Date().toISOString();

export function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
