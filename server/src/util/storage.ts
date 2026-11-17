import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/** Pasta de arquivos de uma loja (cada cliente tem a sua: uploads/loja-3, media/loja-3). */
export function storeDir(kind: "uploads" | "media", storeId: number): string {
  const dir = `loja-${storeId}`;
  fs.mkdirSync(path.join(config.dataDir, kind, dir), { recursive: true });
  return dir;
}

/** Loja dona de uma pasta "loja-N" (ou null se o nome não segue o padrão). */
export function storeOfDir(dir: string): number | null {
  const m = /^loja-(\d+)$/.exec(dir);
  return m ? Number(m[1]) : null;
}
