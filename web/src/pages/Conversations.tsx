import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, AudioLines, Bot, Hand, IdCard, Megaphone, MessageSquareText, Search, SendHorizontal } from "lucide-react";
import { get, intentLabel, post, type AudioClip, type Conversation, type ConversationListItem, type QuickReply } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMe } from "@/components/app/Shell";
import { ago, contactName, dayLabel, phone } from "@/lib/format";
import { onLive } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatBubble, TypingBubble } from "@/components/app/ChatBubble";
import { LeadPanel } from "@/components/app/LeadPanel";
import { Temperature } from "@/components/app/Temperature";

const FILTERS = [
  { id: "", label: "Todas" },
  { id: "humano", label: "Humano atendendo" },
  { id: "quentes", label: "Quentes" },
  { id: "simulacao", label: "Com simulação" },
  { id: "anuncio", label: "De anúncio" },
  { id: "sem_vendedor", label: "Sem vendedor", manager: true },
];

const senderPrefix: Record<string, string> = { ia: "IA: ", vendedor: "Você: ", sistema: "" };

export default function Conversations() {
  const { id } = useParams();
  const selected = id ? Number(id) : null;
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("");
  const me = useMe();
  const isManager = me?.usuario.role !== "vendedor";
  const list = useQuery({
    queryKey: ["conversas", filtro, q],
    queryFn: () => get<ConversationListItem[]>(`/api/conversas?filtro=${filtro}&q=${encodeURIComponent(q)}`),
  });

  return (
    <div className="grid h-[calc(100dvh-57px-64px)] md:h-dvh md:grid-cols-[340px_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-r bg-chapa", selected && "hidden md:flex")}>
        <div className="space-y-3 border-b p-4">
          <h1 className="text-[30px] font-semibold leading-none">Conversas</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou telefone" className="pl-8" aria-label="Buscar conversa" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar conversas">
            {FILTERS.filter((f) => !f.manager || isManager).map((f) => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                aria-pressed={filtro === f.id}
                className={cn("rounded-full border px-3 py-1 text-sm", filtro === f.id ? "border-asfalto bg-asfalto text-white" : "bg-chapa text-asfalto/80 hover:bg-muted")}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending && (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          )}
          {list.data?.length === 0 && (
            <div className="p-6 text-muted-foreground">
              <p>Nenhuma conversa {filtro ? "neste filtro" : "ainda"}.</p>
              {!filtro && (
                <p className="mt-2 text-sm">
                  Quando um cliente chamar no WhatsApp, ela aparece aqui. Para ver a IA em ação agora, use{" "}
                  <Link to="/simulador" className="text-placa underline">
                    Testar a IA
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
          <ul>
            {list.data?.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/conversas/${c.id}`}
                  className={cn("flex gap-3 border-b px-4 py-3 hover:bg-muted/60", selected === c.id && "bg-accent hover:bg-accent")}
                  aria-current={selected === c.id ? "page" : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{contactName(c)}</span>
                      {c.ctwa_clid && <Megaphone className="size-3.5 shrink-0 text-placa" aria-label="Veio de anúncio" />}
                      {c.ia_pausada && <Hand className="size-3.5 shrink-0 text-sinal" aria-label="Vendedor atendendo" />}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.last_sender && c.last_sender !== "cliente" ? senderPrefix[c.last_sender] ?? "" : ""}
                      {c.last_body ?? "…"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                      {intentLabel[c.intencao] ?? ""}
                      {isManager && c.vendedor_nome ? `, com ${c.vendedor_nome}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-xs text-muted-foreground">{ago(c.last_at)}</span>
                    <Temperature t={c.temperatura} compact />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className={cn("min-h-0", !selected && "hidden md:block")}>
        {selected ? (
          <ChatView key={selected} id={selected} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center text-muted-foreground">
            <div>
              <Bot className="mx-auto size-10 opacity-40" />
              <p className="mt-3">Escolha uma conversa para ver o atendimento da IA.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ChatView({ id }: { id: number }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const conv = useQuery({ queryKey: ["conversa", id], queryFn: () => get<Conversation>(`/api/conversas/${id}`) });
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [fichaOpen, setFichaOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => onLive((e) => e.type === "typing" && e.contactId === id && setTyping(e.on)), [id]);

  const msgs = conv.data?.mensagens ?? [];
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typing]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["conversa", id] });
  const send = useMutation({
    mutationFn: (texto: string) => post(`/api/conversas/${id}/enviar`, { texto }),
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pause = useMutation({ mutationFn: () => post(`/api/conversas/${id}/pausar`), onSuccess: () => (refresh(), toast.success("Você assumiu. A IA não responde este cliente até você devolver.")) });
  const resume = useMutation({
    mutationFn: () => post<{ pendentes: number }>(`/api/conversas/${id}/retomar`, { responder: true }),
    onSuccess: (r) => (refresh(), toast.success(r.pendentes ? "A IA voltou e vai responder a última mensagem." : "A IA voltou a atender este cliente.")),
  });

  // separadores por dia
  const rows = useMemo(() => {
    const out: ({ kind: "day"; label: string } | { kind: "msg"; m: (typeof msgs)[number]; showSender: boolean })[] = [];
    let lastDay = "";
    let lastSender = "";
    for (const m of msgs) {
      const d = new Date(m.created_at).toDateString();
      if (d !== lastDay) {
        out.push({ kind: "day", label: dayLabel(m.created_at) });
        lastDay = d;
        lastSender = "";
      }
      const who = m.direction === "in" ? "cliente" : m.sender;
      out.push({ kind: "msg", m, showSender: who !== lastSender });
      lastSender = who;
    }
    return out;
  }, [msgs]);

  if (conv.isPending) return <div className="p-6"><Skeleton className="h-full min-h-60" /></div>;
  if (!conv.data) return <p className="p-6 text-muted-foreground">Conversa não encontrada.</p>;
  const { contato } = conv.data;
  const paused = contato.ia_pausada;
  const windowClosed = contato.channel === "whatsapp" && !contato.janela_24h_aberta;

  return (
    <div className="grid h-full min-h-0 xl:grid-cols-[1fr_360px]">
      <div className="flex min-h-0 flex-col">
        <header className="flex items-center gap-3 border-b bg-chapa px-4 py-3">
          <button className="md:hidden" onClick={() => nav("/conversas")} aria-label="Voltar para a lista">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-sans text-lg font-semibold">{contactName(contato)}</h2>
            <p className="truncate text-sm text-muted-foreground">
              {phone(contato.wa_id)}
              {contato.vendedor ? `, com ${contato.vendedor.nome}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setFichaOpen(true)}>
            <IdCard /> Ficha
          </Button>
          {paused ? (
            <Button size="sm" variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
              <Bot /> Devolver para a IA
            </Button>
          ) : (
            <Button size="sm" onClick={() => pause.mutate()} disabled={pause.isPending} className="bg-faixa text-asfalto hover:bg-faixa/85">
              <Hand /> Assumir conversa
            </Button>
          )}
        </header>

        <div
          className={cn("flex items-center gap-2 border-b px-4 py-1.5 text-sm", paused ? "bg-[#fdf0c2] text-asfalto" : "bg-[#e4ebf5] text-asfalto/80")}
          role="status"
        >
          {paused ? <Hand className="size-4" /> : <Bot className="size-4" />}
          {paused
            ? `Um humano está atendendo. A IA volta sozinha ${contato.bot_paused_until ? ago(contato.bot_paused_until) : "mais tarde"}, ou antes se você devolver.`
            : "A IA está atendendo este cliente."}
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#e9ecef] px-3 py-4 md:px-6" aria-live="polite">
          {rows.map((r, i) =>
            r.kind === "day" ? (
              <p key={`d${i}`} className="mx-auto w-fit rounded-full bg-chapa/80 px-3 py-0.5 text-xs text-muted-foreground">
                {r.label}
              </p>
            ) : (
              <ChatBubble key={r.m.id} m={r.m} showSender={r.showSender} />
            ),
          )}
          {typing && !paused && <TypingBubble />}
        </div>

        <form
          className="border-t bg-chapa p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send.mutate(text.trim());
          }}
        >
          {windowClosed ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              Passaram 24 horas desde a última mensagem do cliente. Pelo WhatsApp, só dá para retomar com uma mensagem de modelo aprovada pela Meta (configure em Configurações, Follow-up).
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <ComposerExtras contactId={id} onPick={(t) => setText((x) => (x ? `${x}\n${t}` : t))} />
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) send.mutate(text.trim());
                  }
                }}
                rows={1}
                placeholder={paused ? "Escreva para o cliente" : "Escreva para o cliente (a IA pausa quando você enviar)"}
                className="max-h-40 min-h-10 resize-none bg-chapa"
                aria-label="Mensagem"
              />
              <Button type="submit" size="icon-lg" disabled={!text.trim() || send.isPending} aria-label="Enviar">
                <SendHorizontal />
              </Button>
            </div>
          )}
        </form>
      </div>

      <aside className="hidden min-h-0 overflow-y-auto border-l bg-sidebar xl:block">
        <LeadPanel data={conv.data} />
      </aside>
      <Sheet open={fichaOpen} onOpenChange={setFichaOpen}>
        <SheetContent className="w-[92vw] overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="font-heading text-2xl">{contactName(contato)}</SheetTitle>
          </SheetHeader>
          <LeadPanel data={conv.data} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ComposerExtras({ contactId, onPick }: { contactId: number; onPick: (t: string) => void }) {
  const qc = useQueryClient();
  const replies = useQuery({ queryKey: ["respostas-rapidas"], queryFn: () => get<QuickReply[]>("/api/respostas-rapidas") });
  const audios = useQuery({ queryKey: ["audios"], queryFn: () => get<AudioClip[]>("/api/audios") });
  const sendAudio = useMutation({
    mutationFn: (audioId: number) => post(`/api/conversas/${contactId}/audio/${audioId}`),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["conversa", contactId] }), toast.success("Áudio enviado.")),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-lg" aria-label="Respostas rápidas">
            <MessageSquareText />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-80 p-1">
          {(replies.data ?? []).length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma resposta rápida. Cadastre em Configurações.</p>}
          {replies.data?.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.texto)} className="block w-full rounded px-3 py-2 text-left hover:bg-muted">
              <span className="block text-sm font-medium">{r.atalho}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{r.texto}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-lg" aria-label="Enviar áudio gravado">
            <AudioLines />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 p-1">
          {(audios.data ?? []).filter((a) => a.ativo).length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum áudio gravado. Suba em Áudios do vendedor.</p>}
          {audios.data
            ?.filter((a) => a.ativo)
            .map((a) => (
              <button key={a.id} type="button" onClick={() => sendAudio.mutate(a.id)} className="block w-full rounded px-3 py-2 text-left hover:bg-muted">
                <span className="block text-sm font-medium">{a.titulo}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{a.quando_usar}</span>
              </button>
            ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
