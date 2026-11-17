/**
 * Carrega a configuração da loja, o estoque e os vendedores a partir de um JSON.
 *   npm run seed                       → seed/fa-veiculos.json
 *   npm run seed -- outro-arquivo.json
 *   npm run seed -- --reset            → apaga o estoque antes
 *   npm run seed -- --fotos-demo       → cria fotos de exemplo (só para testar no simulador)
 * Em produção, defina SEED_FILE=seed/fa-veiculos.json e o servidor carrega sozinho na primeira vez.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { sellers, vehicles } from "../db/repos.js";
import { saveSettings } from "../db/settings.js";

const palettes = [
  ["#1d2630", "#f2c230"],
  ["#2a2320", "#e9e2d0"],
  ["#14202b", "#7fb2d9"],
];
const views = ["Frente", "Lateral 3/4", "Traseira", "Interior", "Painel"];

function demoPhoto(id: string, title: string, i: number) {
  const [bg, fg] = palettes[i % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 1080 810">
  <rect width="1080" height="810" fill="${bg}"/>
  <g fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".9">
    <path d="M190 520 h700 M240 520 l60-120 q20-40 70-40 h330 q50 0 80 40 l90 120"/>
    <circle cx="340" cy="540" r="62"/><circle cx="750" cy="540" r="62"/>
  </g>
  <text x="540" y="680" fill="${fg}" font-family="Arial, sans-serif" font-size="44" text-anchor="middle">${title.replace(/&/g, "&amp;")}</text>
  <text x="540" y="740" fill="${fg}" opacity=".6" font-family="Arial, sans-serif" font-size="30" text-anchor="middle">${views[i]} · foto de exemplo</text>
</svg>`;
  const name = `demo-${id}-${i + 1}.svg`;
  fs.writeFileSync(path.join(config.dataDir, "uploads", name), svg);
  return { url: `/uploads/${name}`, legenda: views[i] };
}

export function runSeed(fileArg: string, opts: { reset?: boolean; fotosDemo?: boolean } = {}) {
  const file = path.resolve(fileArg);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.config) saveSettings(data.config);
  if (opts.reset) db.exec("DELETE FROM vehicles");

  let n = 0;
  for (const v of data.veiculos ?? []) {
    if (vehicles.get(v.id) && !opts.reset) continue;
    const fotos = v.fotos?.length ? v.fotos : opts.fotosDemo ? [0, 1, 2, 3].map((i) => demoPhoto(v.id, `${v.marca} ${v.modelo} ${v.versao ?? ""}`.trim(), i)) : [];
    vehicles.upsert({ status: "disponivel", opcionais: [], destaques: [], ...v, fotos });
    n++;
  }
  if (!sellers.all().length) {
    for (const s of data.vendedores ?? []) {
      const created = sellers.create(s.nome, s.whatsapp ?? "");
      if (s.ativo === false || !s.whatsapp) sellers.update(created.id, { ativo: false });
    }
  }
  return { n, file: path.basename(file) };
}

/** Na primeira inicialização (banco vazio), carrega o SEED_FILE se ele estiver definido. */
export function seedIfEmpty() {
  const file = process.env.SEED_FILE;
  if (!file) return null;
  const hasSettings = db.prepare("SELECT 1 FROM settings WHERE key = 'store'").get();
  if (hasSettings || vehicles.all().length) return null;
  return runSeed(file, { fotosDemo: process.env.SEED_FOTOS_DEMO === "1" });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const r = runSeed(args.find((a) => !a.startsWith("--")) ?? "seed/fa-veiculos.json", { reset: args.includes("--reset"), fotosDemo: args.includes("--fotos-demo") });
  console.log(`Pronto: ${r.n} veículos carregados de ${r.file}${args.includes("--fotos-demo") ? " (com fotos de exemplo)" : ""}.`);
}
