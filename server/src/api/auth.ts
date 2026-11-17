import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

const COOKIE = "arranque_sessao";
const TTL_DAYS = 14;

const sign = (payload: string) => crypto.createHmac("sha256", config.admin.sessionSecret).update(payload).digest("base64url");

export function issueToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_DAYS * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const a = Buffer.from(crypto.createHash("sha256").update(input).digest("hex"));
  const b = Buffer.from(crypto.createHash("sha256").update(config.admin.password).digest("hex"));
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req: FastifyRequest, name: string) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function tokenFrom(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return readCookie(req, COOKIE);
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  const secure = config.publicUrl.startsWith("https://") ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_DAYS * 86400}${secure}`);
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!verifyToken(tokenFrom(req))) return reply.code(401).send({ erro: "Faça login para continuar." });
}
