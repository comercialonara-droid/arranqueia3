import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { contacts, stores, users } from "../db/repos.js";
import type { Contact, Role, User } from "../types.js";

const COOKIE = "arranque_sessao";
const TTL_DAYS = 14;

const sign = (payload: string) => crypto.createHmac("sha256", config.admin.sessionSecret).update(payload).digest("base64url");

export function issueToken(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TTL_DAYS * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined | null): { uid: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.exp > Date.now() && typeof p.uid === "number" ? { uid: p.uid } : null;
  } catch {
    return null;
  }
}

function readCookie(req: FastifyRequest, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
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

export const userOf = (req: FastifyRequest) => (req as any).user as User;

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const t = readToken(tokenFrom(req));
  const u = t ? users.get(t.uid) : null;
  if (!u || !u.ativo) return reply.code(401).send({ erro: "Faça login para continuar." });
  (req as any).user = u;
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(userOf(req).role)) return reply.code(403).send({ erro: "Seu acesso não permite esta ação." });
  };
}

/** Loja em uso: admin escolhe pelo cabeçalho x-loja (ou ?loja=); dono e vendedor ficam na própria loja. */
export function storeOf(req: FastifyRequest): number {
  const u = userOf(req);
  if (u.role !== "admin") return u.store_id!;
  const raw = (req.headers["x-loja"] as string) || ((req.query as any)?.loja as string);
  const id = Number(raw);
  if (id && stores.get(id)) return id;
  const first = stores.all()[0];
  return first?.id ?? 0;
}

/** Vendedor só enxerga os próprios leads. */
export const sellerScope = (req: FastifyRequest): number | null => (userOf(req).role === "vendedor" ? userOf(req).id : null);

/** Carrega um contato garantindo que o usuário pode vê-lo. */
export function contactFor(req: FastifyRequest, id: number): Contact | null {
  const c = contacts.get(id);
  if (!c || c.store_id !== storeOf(req)) return null;
  const s = sellerScope(req);
  if (s != null && c.seller_id !== s) return null;
  return c;
}
