import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

// v2 usa um arquivo novo: o esquema mudou (várias lojas, usuários, simulações)
const file = process.env.DB_FILE || path.join(config.dataDir, "arranque-v2.db");
export const db = new DatabaseSync(file);

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  wa_phone_number_id TEXT UNIQUE,
  wa_waba_id TEXT,
  wa_access_token TEXT,
  meta_dataset_id TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT,
  whatsapp TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  recebe_leads INTEGER NOT NULL DEFAULT 0,
  leads_recebidos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
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
  videos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disponivel',
  destaque INTEGER NOT NULL DEFAULT 0,
  entrada_sugerida REAL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_vehicles_store ON vehicles(store_id, status);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  nome TEXT,
  nome_perfil TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0,
  bot_paused_until TEXT,
  paused_reason TEXT,
  seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ctwa_clid TEXT,
  ad_id TEXT,
  ad_headline TEXT,
  ad_source_url TEXT,
  origem TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  ai_cursor INTEGER NOT NULL DEFAULT 0,
  UNIQUE(store_id, wa_id)
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
  created_at TEXT NOT NULL DEFAULT ${NOW},
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);

CREATE TABLE IF NOT EXISTS ai_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_ai_turns ON ai_turns(contact_id, session_id, id);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT ${NOW},
  last_at TEXT NOT NULL DEFAULT ${NOW},
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads (
  contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'novo',
  score INTEGER NOT NULL DEFAULT 0,
  temperatura TEXT NOT NULL DEFAULT 'frio',
  score_detalhe TEXT,
  intencao TEXT NOT NULL DEFAULT 'indefinida',
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
  analise TEXT,
  motivo_perda TEXT,
  valor_venda REAL,
  vehicle_sold_id TEXT,
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  stage_changed_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'coletando',
  nome_completo TEXT,
  cpf_enc TEXT,
  data_nascimento TEXT,
  tem_cnh INTEGER,
  forma_pagamento TEXT,
  entrada_dinheiro REAL,
  observacoes TEXT,
  consentimento_em TEXT,
  enviada_em TEXT,
  resultado TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_sim_store ON simulations(store_id, status);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'visita',
  inicio TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendada',
  notas TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_appt ON appointments(store_id, inicio);

CREATE TABLE IF NOT EXISTS audios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  quando_usar TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT NOT NULL,
  duracao_s REAL,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  atalho TEXT NOT NULL,
  texto TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  user_id INTEGER,
  name TEXT NOT NULL,
  payload TEXT,
  capi_status TEXT,
  capi_response TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_events ON events(store_id, name, created_at);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(contact_id, kind, ref)
);
`);

/** Migrações leves para bancos criados por versões anteriores. */
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn("vehicles", "ficha", "TEXT NOT NULL DEFAULT '{}'");

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
