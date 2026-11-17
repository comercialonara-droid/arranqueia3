import { Check, CheckCheck, CircleAlert, MapPin, Mic, FileText, Bot, UserRound, LayoutList } from "lucide-react";
import type { Message } from "@/lib/api";
import { time } from "@/lib/format";
import { cn } from "@/lib/utils";

const senderTag: Record<string, string> = { ia: "IA", vendedor: "Vendedor", sistema: "Sistema" };

function Ticks({ status }: { status: string | null }) {
  if (status === "failed") return <CircleAlert className="size-3.5 text-sinal" aria-label="Falhou" />;
  if (status === "read") return <CheckCheck className="size-3.5 text-placa" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="size-3.5" aria-label="Entregue" />;
  if (status === "sent") return <Check className="size-3.5" aria-label="Enviada" />;
  return null;
}

/** Renderiza o texto com o *negrito* do WhatsApp e quebras de linha. */
function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong> : p))}
    </span>
  );
}

export function ChatBubble({ m, showSender }: { m: Message; showSender: boolean }) {
  const out = m.direction === "out";
  const media = m.media ?? {};
  const isImg = m.type === "image" && media.url;
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className="max-w-[min(82%,520px)]">
        {showSender && out && (
          <p className={cn("mb-0.5 flex items-center justify-end gap-1 text-xs", m.sender === "vendedor" ? "text-asfalto" : "text-muted-foreground")}>
            {m.sender === "ia" ? <Bot className="size-3" /> : <UserRound className="size-3" />}
            {senderTag[m.sender] ?? m.sender}
            {m.meta?.automatico ? " (automático)" : ""}
          </p>
        )}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-[15px] leading-snug shadow-[0_1px_0_rgba(27,35,43,.08)]",
            !out && "rounded-tl-sm bg-chapa",
            out && m.sender === "ia" && "rounded-tr-sm bg-[#e4ebf5]",
            out && m.sender === "vendedor" && "rounded-tr-sm bg-[#fdf0c2]",
            out && m.sender === "sistema" && "rounded-tr-sm bg-muted",
            m.status === "failed" && "ring-1 ring-sinal/60",
            isImg && "p-1",
          )}
        >
          {isImg && (
            <a href={media.url} target="_blank" rel="noreferrer">
              <img src={media.url} alt={m.body ?? "Foto"} className="max-h-72 w-full rounded-md object-cover" loading="lazy" />
            </a>
          )}
          {m.type === "audio" && (
            <div className="mb-1 flex items-center gap-2 text-muted-foreground">
              <Mic className="size-4" /> Áudio
              {media.url && <audio controls src={media.url} className="h-8 max-w-[220px]" />}
            </div>
          )}
          {m.type === "document" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <FileText className="size-4" /> {m.meta?.filename ?? "Documento"}
            </p>
          )}
          {m.type === "location" && (
            <p className="flex items-center gap-2">
              <MapPin className="size-4 text-sinal" />
              <span>{m.body}</span>
            </p>
          )}
          {m.type === "template" && <p className="mb-1 text-xs text-muted-foreground">Mensagem de modelo (template)</p>}
          {m.body && m.type !== "location" && (
            <div className={cn(isImg && "px-2 pb-1 pt-1.5")}>
              <WaText text={m.body} />
            </div>
          )}
          {m.type === "audio" && m.meta?.transcricao && <p className="mt-1 border-t pt-1 text-sm italic text-muted-foreground">“{m.meta.transcricao}”</p>}
          {m.type === "interactive" && !out && <p className="mt-0.5 text-xs text-muted-foreground">tocou no botão</p>}
          <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground", isImg && "px-2 pb-1")}>
            {time(m.created_at)}
            {out && <Ticks status={m.status} />}
          </div>
        </div>
        {m.type === "buttons" && media.buttons && (
          <div className="mt-1 grid gap-1">
            {media.buttons.map((b: { id: string; title: string }) => (
              <span key={b.id} className="rounded-md border bg-chapa px-3 py-1.5 text-center text-sm text-placa">
                {b.title}
              </span>
            ))}
          </div>
        )}
        {m.type === "list" && media.rows && (
          <div className="mt-1 rounded-md border bg-chapa px-3 py-1.5 text-sm">
            <p className="flex items-center justify-center gap-1.5 text-placa">
              <LayoutList className="size-4" /> {media.buttonText}
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {media.rows.map((r: { id: string; title: string }) => (
                <li key={r.id}>{r.title}</li>
              ))}
            </ul>
          </div>
        )}
        {m.status === "failed" && <p className="mt-0.5 text-right text-xs text-sinal">Não enviada: {m.meta?.erro ?? "erro do WhatsApp"}</p>}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="flex justify-end" aria-live="polite">
      <div className="flex items-center gap-1.5 rounded-lg rounded-tr-sm bg-[#e4ebf5] px-3 py-2.5 text-sm text-muted-foreground">
        <Bot className="size-3.5" /> IA escrevendo
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-asfalto/50" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
      </div>
    </div>
  );
}
