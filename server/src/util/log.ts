type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (order[level] < min) return;
  const line = { t: new Date().toISOString(), level, msg, ...extra };
  const out = JSON.stringify(line, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
  if (level === "error" || level === "warn") console.error(out);
  else console.log(out);
}

export const log = {
  debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
  info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};
