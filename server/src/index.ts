import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { config, isWhatsAppConfigured } from "./config.js";
import { log } from "./util/log.js";
import { registerWebhook } from "./whatsapp/webhook.js";
import { registerAdmin } from "./api/admin.js";
import { requireAuth } from "./api/auth.js";
import { startScheduler } from "./services/followups.js";
import { db } from "./db/index.js";
import { seedIfEmpty } from "./scripts/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// funciona tanto rodando de server/src (tsx) quanto de dist/ (build)
const webDist = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")].find((p) => fs.existsSync(path.join(p, "index.html")));

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024, trustProxy: true });

  // guarda o corpo bruto para validar a assinatura do webhook
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch (e) {
      (e as any).statusCode = 400;
      done(e as Error, undefined);
    }
  });

  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  // fotos do estoque: públicas (o WhatsApp baixa por link)
  await app.register(fastifyStatic, { root: path.join(config.dataDir, "uploads"), prefix: "/uploads/", decorateReply: true, maxAge: "7d" });

  // mídias recebidas dos clientes: só com login
  app.get("/media/:file", { preHandler: requireAuth }, async (req, reply) => {
    const file = path.basename((req.params as any).file);
    const full = path.join(config.dataDir, "media", file);
    if (!fs.existsSync(full)) return reply.code(404).send();
    return reply.sendFile(file, path.join(config.dataDir, "media"));
  });

  app.get("/health", async () => {
    db.prepare("SELECT 1").get();
    return { ok: true, whatsapp: isWhatsAppConfigured(), ia: config.ai.provider };
  });

  registerWebhook(app);
  registerAdmin(app);

  if (webDist) {
    const sendIndex = (reply: any) =>
      reply.type("text/html").header("Cache-Control", "no-cache").send(fs.readFileSync(path.join(webDist, "index.html"), "utf8"));
    await app.register(fastifyStatic, { root: webDist, prefix: "/painel/", decorateReply: false, wildcard: false, index: false });
    // Sem redirecionar entre /painel e /painel/: alguns provedores (ex.: Vercel) tiram a barra final
    // e o redirecionamento de volta criava um laço infinito.
    app.get("/painel", async (_req, reply) => sendIndex(reply));
    app.get("/painel/*", async (req, reply) => {
      const rel = (req.params as any)["*"] as string;
      const asset = path.join(webDist, rel);
      if (rel && asset.startsWith(webDist) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return reply.sendFile(rel, webDist);
      return sendIndex(reply);
    });
    app.get("/", async (_req, reply) => reply.redirect("/painel"));
  } else {
    app.get("/", async () => ({ ok: true, aviso: "Painel não compilado. Rode `npm run build:web`." }));
  }

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const seeded = seedIfEmpty();
  if (seeded) log.info("estoque inicial carregado", seeded);
  const app = await buildApp();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  startScheduler();
  log.info("Arranque no ar", {
    porta: config.port,
    painel: `${config.publicUrl}/painel/`,
    webhook: `${config.publicUrl}/webhook`,
    ia: `${config.ai.provider} (${config.ai.model}, esforço ${config.ai.effort})`,
    whatsapp: isWhatsAppConfigured() ? "configurado" : "não configurado (só simulador)",
  });
  const stop = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
