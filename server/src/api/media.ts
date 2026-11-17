import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { requireAuth, userOf } from "./auth.js";
import { storeOfDir } from "../util/storage.js";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", ogg: "audio/ogg", mp3: "audio/mpeg", mp4: "video/mp4" };
const sendMedia = (reply: FastifyReply, full: string) =>
  reply
    .type(MIME[path.extname(full).slice(1).toLowerCase()] ?? "application/octet-stream")
    .header("Cache-Control", "private, max-age=86400")
    .send(fs.createReadStream(full));

/** Mídias recebidas dos clientes (fotos, áudios): só com login, e cada loja só vê as dela. */
export function registerMedia(app: FastifyInstance) {
  // cada loja só abre as mídias dos próprios clientes
  const canSeeStore = (req: any, storeId: number | null) => {
    const u = userOf(req);
    return storeId != null && (u.role === "admin" || u.store_id === storeId);
  };
  app.get("/media/:dir/:file", { preHandler: requireAuth }, async (req, reply) => {
    const { dir, file } = req.params as { dir: string; file: string };
    if (!canSeeStore(req, storeOfDir(dir))) return reply.code(404).send();
    const name = path.basename(file);
    if (!fs.existsSync(path.join(config.dataDir, "media", dir, name))) return reply.code(404).send();
    return sendMedia(reply, path.join(config.dataDir, "media", dir, name));
  });
  // arquivos antigos (antes das pastas por loja): confere a loja pela mensagem
  app.get("/media/:file", { preHandler: requireAuth }, async (req, reply) => {
    const file = path.basename((req.params as any).file);
    const row = db
      .prepare("SELECT c.store_id FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.media LIKE ? LIMIT 1")
      .get(`%"/media/${file}"%`) as { store_id: number } | undefined;
    if (!canSeeStore(req, row?.store_id ?? null)) return reply.code(404).send();
    if (!fs.existsSync(path.join(config.dataDir, "media", file))) return reply.code(404).send();
    return sendMedia(reply, path.join(config.dataDir, "media", file));
  });

}
