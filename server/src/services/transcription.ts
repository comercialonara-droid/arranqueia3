import { config } from "../config.js";
import { log } from "../util/log.js";

export const transcriptionEnabled = () => Boolean(config.transcription.openaiKey);

/** Transcreve áudio do cliente (pt-BR). Retorna null se não houver provedor configurado ou se falhar. */
export async function transcribe(data: Buffer, mime: string): Promise<string | null> {
  if (!transcriptionEnabled()) return null;
  try {
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mime }), `audio.${ext}`);
    form.append("model", config.transcription.model);
    form.append("language", "pt");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.transcription.openaiKey}` },
      body: form,
    });
    const json: any = await res.json();
    if (!res.ok) {
      log.warn("transcrição falhou", { status: res.status, json });
      return null;
    }
    return String(json.text ?? "").trim() || null;
  } catch (e) {
    log.warn("transcrição falhou", { err: (e as Error).message });
    return null;
  }
}
