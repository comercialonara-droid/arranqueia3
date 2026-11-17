import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Hand, Megaphone } from "lucide-react";
import { get, intentLabel, patch, STAGES, withStore, type BoardLead, type LeadStage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ago, brl, contactName, pagamentoLabel } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { Temperature } from "@/components/app/Temperature";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function Leads() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<LeadStage | null>(null);
  const board = useQuery({ queryKey: ["leads"], queryFn: () => get<BoardLead[]>("/api/leads") });

  const move = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: LeadStage }) => patch(`/api/leads/${id}`, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["leads"] });
      const prev = qc.getQueryData<BoardLead[]>(["leads"]);
      qc.setQueryData<BoardLead[]>(["leads"], (old) => old?.map((l) => (l.contact_id === id ? { ...l, stage } : l)));
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["leads"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (board.data ?? []).filter(
      (l) => !t || contactName(l).toLowerCase().includes(t) || l.veiculos.some((v) => v.titulo.toLowerCase().includes(t)) || (l.tags ?? []).some((x) => x.toLowerCase().includes(t)),
    );
  }, [board.data, q]);

  const byStage = (s: LeadStage) => filtered.filter((l) => l.stage === s);

  return (
    <div>
      <PageHeader
        title="Funil de leads"
        description="Arraste o card para mudar de etapa. Para registrar uma venda com valor, abra a conversa e mude a etapa para Vendido."
        actions={
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, modelo ou etiqueta" className="w-64 bg-chapa" aria-label="Buscar lead" />
            <Button variant="outline" asChild>
              <a href={withStore("/api/leads/exportar")}>
                <Download /> Exportar planilha
              </a>
            </Button>
          </>
        }
      />
      {board.isPending ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80 w-72" />
          ))}
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          <div className="flex gap-3">
            {STAGES.map((s) => {
              const items = byStage(s.id);
              return (
                <section
                  key={s.id}
                  id={s.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(s.id);
                  }}
                  onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    if (dragging == null) return;
                    const lead = board.data?.find((l) => l.contact_id === dragging);
                    if (lead && lead.stage !== s.id) {
                      if (s.id === "vendido") {
                        toast.info("Abra a conversa para registrar a venda com o valor e o modelo.");
                        return;
                      }
                      move.mutate({ id: dragging, stage: s.id });
                    }
                    setDragging(null);
                  }}
                  className={cn("flex w-[268px] shrink-0 flex-col rounded-lg border bg-sidebar transition-colors", over === s.id && "border-faixa bg-accent/60")}
                >
                  <header className="flex items-baseline justify-between px-3.5 pb-2 pt-3">
                    <h2 className="text-xl font-semibold">{s.label}</h2>
                    <span className="num text-xl text-muted-foreground">{items.length}</span>
                  </header>
                  <div className="lane-dash mx-3.5 h-[3px] opacity-70" aria-hidden />
                  <ul className="flex min-h-24 flex-col gap-2 p-2.5">
                    {items.map((l) => (
                      <li
                        key={l.contact_id}
                        draggable
                        onDragStart={() => setDragging(l.contact_id)}
                        onDragEnd={() => setDragging(null)}
                        className={cn("rounded-md border bg-chapa", dragging === l.contact_id && "opacity-50")}
                      >
                        <Link to={`/conversas/${l.contact_id}`} className="block p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 truncate font-medium">{contactName(l)}</span>
                            <Temperature t={l.temperatura} compact />
                          </div>
                          {l.veiculos[0] ? (
                            <div className="mt-2 flex items-center gap-2">
                              {l.veiculos[0].foto ? <img src={l.veiculos[0].foto} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-muted" />}
                              <span className="line-clamp-2 text-sm">{l.veiculos[0].titulo}</span>
                            </div>
                          ) : (
                            l.interesse_texto && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">Procura {l.interesse_texto}</p>
                          )}
                          <p className="mt-1.5 text-xs">{intentLabel[l.intencao]}</p>
                          {(l.tags ?? []).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {l.tags.map((t) => (
                                <span key={t} className="rounded-full border px-1.5 text-[11px]">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {l.forma_pagamento && <span>{pagamentoLabel[l.forma_pagamento]}</span>}
                            {l.entrada ? <span>entrada {brl(l.entrada)}</span> : null}
                            {l.valor_venda ? <span className="text-verde">{brl(l.valor_venda)}</span> : null}
                            {l.ctwa_clid && (
                              <span className="flex items-center gap-1 text-placa">
                                <Megaphone className="size-3" /> anúncio
                              </span>
                            )}
                            {l.bot_paused_until && new Date(l.bot_paused_until) > new Date() && (
                              <span className="flex items-center gap-1 text-sinal">
                                <Hand className="size-3" /> {l.vendedor ?? "humano"}
                              </span>
                            )}
                            <span className="ml-auto">{ago(l.last_at)}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                    {items.length === 0 && <li className="px-1 py-3 text-sm text-muted-foreground">Nenhum lead aqui.</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
