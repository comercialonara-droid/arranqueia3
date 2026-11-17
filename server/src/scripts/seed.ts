/**
 * Cria (ou atualiza) uma loja a partir de um JSON: configuração, estoque e equipe.
 *   npm run seed                       → seed/fa-veiculos.json
 *   npm run seed -- outra-loja.json
 *   npm run seed -- --reset            → apaga o estoque da loja antes
 *   npm run seed -- --fotos-demo       → cria fotos de exemplo (só para testar no simulador)
 * Em produção, defina SEED_FILE=seed/fa-veiculos.json e o servidor carrega sozinho quando não há nenhuma loja.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { stores, users, vehicles } from "../db/repos.js";
import { saveSettings } from "../db/settings.js";
import { storeDir } from "../util/storage.js";

const palettes = [
  ["#1d2630", "#f2c230"],
  ["#2a2320", "#e9e2d0"],
  ["#14202b", "#7fb2d9"],
];
const views = ["Frente", "Lateral 3/4", "Traseira", "Interior", "Painel"];

const CAR = `<path d="M190 520 h700 M240 520 l60-120 q20-40 70-40 h330 q50 0 80 40 l90 120"/>
    <circle cx="340" cy="540" r="62"/><circle cx="750" cy="540" r="62"/>`;
const BIKE = `<circle cx="330" cy="500" r="120"/><circle cx="750" cy="500" r="120"/>
    <path d="M330 500 l150-200 h210 l60 200 M480 300 l-40-60 h-60 M690 300 l-30-80 h70 M480 300 l120 200 h150"/>
    <rect x="520" y="330" width="110" height="60" rx="14"/>`;

function demoPhoto(storeId: number, id: string, title: string, i: number, bike = false) {
  const [bg, fg] = palettes[i % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 1080 810">
  <rect width="1080" height="810" fill="${bg}"/>
  <g fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".9">
    ${bike ? BIKE : CAR}
  </g>
  <text x="540" y="680" fill="${fg}" font-family="Arial, sans-serif" font-size="44" text-anchor="middle">${title.replace(/&/g, "&amp;")}</text>
  <text x="540" y="740" fill="${fg}" opacity=".6" font-family="Arial, sans-serif" font-size="30" text-anchor="middle">${views[i]} · foto de exemplo</text>
</svg>`;
  const name = `${storeDir("uploads", storeId)}/demo-${id}-${i + 1}.svg`;
  fs.writeFileSync(path.join(config.dataDir, "uploads", name), svg);
  return { url: `/uploads/${name}`, legenda: views[i] };
}

export function runSeed(fileArg: string, opts: { reset?: boolean; fotosDemo?: boolean } = {}) {
  const file = path.resolve(fileArg);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const slug: string = data.loja?.slug ?? path.basename(file, ".json");
  const nome: string = data.loja?.nome ?? data.config?.loja?.nome ?? slug;
  const store = stores.bySlug(slug) ?? stores.create(nome, slug);
  if (data.config) saveSettings(store.id, data.config);
  if (opts.reset) db.prepare("DELETE FROM vehicles WHERE store_id = ?").run(store.id);

  let n = 0;
  for (const v of data.veiculos ?? []) {
    // o código do produto é único no sistema: se outra loja já usa, ganha o prefixo desta loja
    const ex = vehicles.get(String(v.id));
    const id = ex && ex.store_id !== store.id ? `${slug}-${v.id}` : String(v.id);
    if (vehicles.get(id) && !opts.reset) continue;
    const bike = (data.config?.loja?.segmento ?? "veiculos") === "bikes_eletricas";
    const fotos = v.fotos?.length ? v.fotos : opts.fotosDemo ? [0, 1, 2, 3].map((i) => demoPhoto(store.id, id, `${v.marca} ${v.modelo} ${v.versao ?? ""}`.trim(), i, bike)) : [];
    vehicles.upsert({ status: "disponivel", opcionais: [], destaques: [], videos: [], ...v, id, store_id: store.id, fotos });
    n++;
  }
  for (const p of data.equipe ?? []) {
    if (users.byEmail(p.email)) continue;
    const u = users.create({ store_id: store.id, role: p.role ?? "vendedor", nome: p.nome, email: p.email, senha: p.senha ?? null, whatsapp: p.whatsapp || null, recebe_leads: p.recebe_leads ?? p.role !== "dono" });
    if (!p.whatsapp && p.recebe_leads) users.update(u.id, { recebe_leads: false }); // sem WhatsApp, não entra no rodízio
  }
  return { loja: store.nome, store_id: store.id, n, file: path.basename(file) };
}

/** Na primeira inicialização (nenhuma loja), carrega o SEED_FILE se ele estiver definido. */
export function seedIfEmpty() {
  const file = process.env.SEED_FILE;
  if (!file || stores.all().length) return null;
  return runSeed(file, { fotosDemo: process.env.SEED_FOTOS_DEMO === "1" });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const r = runSeed(args.find((a) => !a.startsWith("--")) ?? "seed/fa-veiculos.json", { reset: args.includes("--reset"), fotosDemo: args.includes("--fotos-demo") });
  console.log(`Pronto: loja ${r.loja} com ${r.n} produtos novos no estoque (${r.file}).`);
}
