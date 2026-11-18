import { useEffect, useRef, useState } from "react";
import { useSegment } from "@/lib/segment";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Megaphone, RotateCcw, SendHorizontal } from "lucide-react";
import { get, post, type Conversation, type Me } from "@/lib/api";
import { onLive } from "@/lib/live";
import { PageHeader } from "@/components/app/Shell";
import { ChatBubble, TypingBubble } from "@/components/app/ChatBubble";
import { LeadPanel } from "@/components/app/LeadPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const PHONE = "5521900000000";
const SUGESTOES_BASE = ["Oi, vi o anúncio e queria saber mais", "Ainda tem? Manda foto", "Quanto tá?", "Quero fazer uma simulação", "Quero falar com um vendedor"];

export default function Simulator() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me") });
  const [contactId, setContactId] = useState<number | null>(() => Number(localStorage.getItem("sim-contato")) || null);
  const [nome, setNome] = useState("Marcos");
  const [anuncio, setAnuncio] = useState(true);
  const seg = useSegment();
  const SUGESTOES = [...SUGESTOES_BASE.slice(0, 4), ...seg.exemplos_cliente.slice(1), SUGESTOES_BASE[4]];
  const [headline, setHeadline] = useState(seg.exemplo_anuncio);
  useEffect(() => setHeadline(seg.exemplo_anuncio), [seg.exemplo_anuncio]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const conv = useQuery({
    queryKey: ["conversa", contactId],
    queryFn: () => get<Conversation>(`/api/conversas/${contactId}`),
    enabled: !!contactId,
    retry: false,
  });
  const msgs = conv.data?.mensagens ?? [];
  const firstMessage = msgs.length === 0;

  useEffect(() => onLive((e) => e.type === "typing" && e.contactId === contactId && setTyping(e.on)), [contactId]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typing]);
  useEffect(() => {
    if (conv.isError) {
      localStorage.removeItem("sim-contato");
      setContactId(null);
    }
  }, [conv.isError]);

  async function send(body: Record<string, unknown>) {
    setSending(true);
    try {
      const r = await post<{ contato_id: number }>("/api/simulador/mensagem", {
        telefone: PHONE,
        nome,
        ...(firstMessage && anuncio ? { anuncio: { headline } } : {}),
        ...body,
      });
      setContactId(r.contato_id);
      localStorage.setItem("sim-contato", String(r.contato_id));
      setText("");
      qc.invalidateQueries({ queryKey: ["conversa", r.contato_id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function reset() {
    await post("/api/simulador/limpar", { telefone: PHONE });
    localStorage.removeItem("sim-contato");
    setContactId(null);
    qc.removeQueries({ queryKey: ["conversa"] });
    toast.success("Conversa apagada. Pode começar de novo.");
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Testar a IA"
        description={
          <>
            Converse como se fosse um cliente. A IA usa o estoque e as configurações reais da loja, mas nada sai pelo WhatsApp.

          </>
        }
        actions={
          <Button variant="outline" onClick={reset}>
            <RotateCcw /> Recomeçar conversa
          </Button>
        }
      />

      {me.data?.ia.provedor === "mock" && (
        <div className="mb-5 rounded-lg border-2 border-faixa bg-accent px-4 py-3">
          <p className="font-medium">Modo de teste: quem responde não é a IA de verdade.</p>
          <p className="mt-0.5 text-sm">
            Sem a chave da Anthropic, o sistema usa respostas prontas só para testar o caminho (fotos, simulação, agenda, vendedor). Para conversar com o Claude, coloque{" "}
            <code className="rounded bg-chapa px-1">ANTHROPIC_API_KEY</code> nas variáveis do servidor.
          </p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        <div>
          {/* aparelho */}
          <div className="mx-auto flex h-[680px] max-w-[400px] flex-col overflow-hidden rounded-[28px] border-[6px] border-[#2a3541] bg-[#0b1116] shadow-[0_18px_40px_-18px_rgba(27,35,43,.45)]">
            <div className="flex items-center gap-3 bg-asfalto px-4 py-3 text-white">
              <span className="grid size-9 place-items-center rounded-full bg-faixa font-heading text-lg font-semibold text-ink">{(me.data?.loja_atual?.nome ?? "L")[0]}</span>
              <div className="min-w-0">
                <p className="truncate font-medium">{me.data?.loja_atual?.nome}</p>
                <p className="text-xs text-white/70">{typing ? "digitando…" : "online"}</p>
              </div>
            </div>
            <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {firstMessage && anuncio && (
                <div className="mx-auto max-w-[90%] rounded-md border border-placa/30 bg-chapa p-2.5 text-sm">
                  <p className="flex items-center gap-1.5 text-xs text-placa">
                    <Megaphone className="size-3.5" /> Cliente vindo do anúncio
                  </p>
                  <p className="mt-0.5 font-medium">{headline}</p>
                </div>
              )}
              {msgs.map((m) => (
                <div key={m.id}>
                  <ChatBubble m={m} showSender={false} />
                  {m.direction === "out" && m.type === "buttons" && m.media?.buttons && (
                    <div className="mt-1 flex flex-wrap justify-end gap-1">
                      {m.media.buttons.map((b: { id: string; title: string }) => (
                        <button key={b.id} onClick={() => send({ botao: b })} className="rounded-full bg-asfalto px-3 py-1 text-xs text-white hover:bg-asfalto/85">
                          Tocar em “{b.title}”
                        </button>
                      ))}
                    </div>
                  )}
                  {m.direction === "out" && m.type === "list" && m.media?.rows && (
                    <div className="mt-1 flex flex-wrap justify-end gap-1">
                      {m.media.rows.map((b: { id: string; title: string }) => (
                        <button key={b.id} onClick={() => send({ botao: b })} className="rounded-full bg-asfalto px-3 py-1 text-xs text-white hover:bg-asfalto/85">
                          {b.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {typing && <TypingBubble />}
            </div>
            <form
              className="flex items-center gap-2 bg-chapa p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send({ texto: text.trim() });
              }}
            >
              <button type="button" onClick={() => fileRef.current?.click()} className="grid size-9 place-items-center text-muted-foreground hover:text-foreground" aria-label="Enviar foto">
                <ImagePlus className="size-5" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const b64 = await new Promise<string>((res) => {
                    const r = new FileReader();
                    r.onload = () => res(String(r.result).split(",")[1]);
                    r.readAsDataURL(f);
                  });
                  await send({ imagem_base64: b64, mime: f.type, texto: text || undefined });
                  e.target.value = "";
                }}
              />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem" className="h-10 rounded-full" aria-label="Mensagem do cliente" />
              <Button type="submit" size="icon-lg" className="rounded-full" disabled={!text.trim() || sending} aria-label="Enviar">
                <SendHorizontal />
              </Button>
            </form>
          </div>
          <div className="mx-auto mt-3 flex max-w-[400px] flex-wrap gap-1.5">
            {SUGESTOES.map((s) => (
              <button key={s} onClick={() => send({ texto: s })} disabled={sending} className="rounded-full border bg-chapa px-3 py-1 text-sm hover:bg-muted">
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border bg-chapa p-5">
            <h2 className="text-2xl font-semibold">Quem é o cliente do teste</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="sim-nome">Nome no WhatsApp</Label>
                <Input id="sim-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!firstMessage} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sim-anuncio" className="flex items-center justify-between">
                  Chegou por anúncio
                  <Switch id="sim-anuncio" checked={anuncio} onCheckedChange={setAnuncio} disabled={!firstMessage} />
                </Label>
                <Input value={headline} onChange={(e) => setHeadline(e.target.value)} disabled={!firstMessage || !anuncio} aria-label="Título do anúncio" />
              </div>
            </div>
            {!firstMessage && <p className="mt-2 text-sm text-muted-foreground">Para mudar o cliente, recomece a conversa.</p>}
          </section>

          <section className="rounded-lg border bg-chapa">
            <header className="flex items-baseline justify-between border-b px-5 py-3.5">
              <h2 className="text-2xl font-semibold">O que a IA anotou</h2>
              {contactId && (
                <Link to={`/conversas/${contactId}`} className="text-sm text-placa hover:underline">
                  Abrir em Conversas
                </Link>
              )}
            </header>
            {conv.data ? <LeadPanel data={conv.data} /> : <p className="p-5 text-muted-foreground">Mande a primeira mensagem para ver a ficha do cliente sendo preenchida em tempo real.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
