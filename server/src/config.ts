import path from "node:path";
import fs from "node:fs";

/** Lê um arquivo .env simples (sem dependência externa). Variáveis já definidas no ambiente têm prioridade. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(path.resolve(process.cwd(), ".env"));

const env = (k: string, d = "") => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] !== undefined ? v : d;
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const config = {
  port: num("PORT", 3000),
  /** URL pública do servidor (https). Usada para links de fotos enviadas ao WhatsApp. */
  publicUrl: env("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, ""),
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  timezone: env("TZ_LOJA", "America/Sao_Paulo"),

  admin: {
    password: env("ADMIN_PASSWORD", "trocar-esta-senha"),
    sessionSecret: env("SESSION_SECRET", "defina-um-segredo-longo-e-aleatorio"),
  },

  ai: {
    /** anthropic = Claude de verdade · mock = respostas simuladas para testar o fluxo sem custo */
    provider: env("AI_PROVIDER", process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock") as "anthropic" | "mock",
    model: env("AI_MODEL", "claude-opus-5-5"),
    effort: env("AI_EFFORT", "medium") as Effort,
    maxToolRounds: num("AI_MAX_TOOL_ROUNDS", 8),
    /** Fallback automático do lado do servidor quando o modelo recusa (recomendado). */
    serverFallback: env("AI_SERVER_FALLBACK", "on") !== "off",
  },

  whatsapp: {
    graphVersion: env("GRAPH_VERSION", "v25.0"),
    phoneNumberId: env("WA_PHONE_NUMBER_ID"),
    wabaId: env("WA_WABA_ID"),
    accessToken: env("WA_ACCESS_TOKEN"),
    verifyToken: env("WA_VERIFY_TOKEN", "arranque-verify"),
    appSecret: env("WA_APP_SECRET"),
  },

  meta: {
    /** Dataset (pixel) ligado à WABA para a Conversions API de mensagens. */
    datasetId: env("META_DATASET_ID"),
    capiToken: env("META_CAPI_TOKEN") || env("WA_ACCESS_TOKEN"),
    testEventCode: env("META_TEST_EVENT_CODE"),
  },

  transcription: {
    /** Transcrição de áudio (opcional). Hoje suporta a API Whisper da OpenAI. */
    openaiKey: env("OPENAI_API_KEY"),
    model: env("TRANSCRIBE_MODEL", "whisper-1"),
  },

  pipeline: {
    /** Espera após a última mensagem do cliente antes de responder (cliente costuma mandar várias seguidas). */
    debounceMs: num("DEBOUNCE_MS", 6000),
    /** Simula ritmo humano entre mensagens enviadas em sequência. */
    typingDelayMs: num("TYPING_DELAY_MS", 1200),
  },
};

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "media"), { recursive: true });

export const isWhatsAppConfigured = () => Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
