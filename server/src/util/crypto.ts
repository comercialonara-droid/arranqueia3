import crypto from "node:crypto";
import { config } from "../config.js";

// ───────── criptografia de dados pessoais (AES-256-GCM) ─────────

const key = () => crypto.createHash("sha256").update(config.admin.dataKey || `dados:${config.admin.sessionSecret}`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [v, iv, tag, data] = blob.split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ───────── senhas (scrypt) ─────────

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return `scrypt:${salt.toString("base64")}:${h.toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, salt, hash] = stored.split(":");
  if (alg !== "scrypt") return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, "base64"), 32);
  const expected = Buffer.from(hash, "base64");
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

// ───────── CPF ─────────

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function isValidCpf(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export const formatCpf = (c: string) => {
  const d = onlyDigits(c);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};
export const maskCpf = (c: string | null) => (c ? `***.${onlyDigits(c).slice(3, 6)}.***-${onlyDigits(c).slice(9)}` : null);

/** Aceita "15/03/1990", "15-03-90", "1990-03-15". Devolve AAAA-MM-DD ou null. */
export function parseBirthDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/))) {
    [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
    if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const age = (Date.now() - dt.getTime()) / (365.25 * 86400_000);
  if (age < 18 || age > 100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const randomPassword = () => crypto.randomBytes(6).toString("base64url");
