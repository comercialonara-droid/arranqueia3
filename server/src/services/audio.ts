import { spawn } from "node:child_process";
import fs from "node:fs";

/**
 * Converte qualquer áudio enviado no painel para OGG/Opus mono — o formato de "mensagem de voz" do WhatsApp.
 * Se o ffmpeg não estiver instalado, mantém o arquivo original (o WhatsApp mostra como arquivo de áudio).
 */
export async function toVoiceNote(input: string, output: string): Promise<{ ok: boolean; duracao: number | null }> {
  const run = (args: string[]) =>
    new Promise<{ code: number; err: string }>((resolve) => {
      const p = spawn("ffmpeg", args);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", () => resolve({ code: -1, err: "ffmpeg ausente" }));
      p.on("close", (code) => resolve({ code: code ?? -1, err }));
    });
  const r = await run(["-y", "-i", input, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", output]);
  if (r.code !== 0 || !fs.existsSync(output)) return { ok: false, duracao: null };
  const m = r.err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duracao = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  return { ok: true, duracao };
}
