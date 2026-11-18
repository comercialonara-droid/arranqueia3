import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeCheck, CalendarCheck, ClipboardCheck, Flame, Hand, Megaphone, MessagesSquare, Timer, UsersRound } from "lucide-react";
import { get, STAGES, type AgendaItem, type ConversationListItem, type Stats } from "@/lib/api";
import { ago, brl, contactName, dayLabel, num, time, tipoVisitaLabel } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const pausedReason = (r: string | null) => {
  if (!r) return "Atendimento humano";
  if (r.startsWith("handoff:")) {
    const m: Record<string, string> = {
      simulacao_pronta: "Simulação pronta para rodar",
      pronto_para_negociar: "Pronto para negociar",
      pediu_humano: "Pediu para falar com alguém",
      negociacao_de_preco: "Quer saber valores ou negociar",
      avaliacao_de_troca: "Avaliação da troca",
      duvida_sem_resposta: "A IA não soube responder",
      reclamacao: "Reclamação",
      pos_venda: "Pós-venda",
    };
    return m[r.slice(8)] ?? "Transferido pela IA";
  }
  if (r === "vendedor_assumiu" || r === "vendedor_respondeu_pelo_app") return "Vendedor assumiu";
  return "IA pausada no painel";
};

export default function Overview() {
  const [dias, setDias] = useState(7);
  const stats = useQuery({ queryKey: ["stats", dias], queryFn: () => get<Stats>(`/api/stats?dias=${dias}`) });
  const conversas = useQuery({ queryKey: ["conversas", "todas"], queryFn: () => get<ConversationListItem[]>("/api/conversas") });
  const agenda = useQuery({
    queryKey: ["agenda", "proximas"],
    queryFn: () => get<AgendaItem[]>(`/api/agenda?de=${new Date(Date.now() - 2 * 3600_000).toISOString()}&ate=${new Date(Date.now() + 2 * 86400_000).toISOString()}`),
  });

  const atencao = useMemo(() => {
    const list = conversas.data ?? [];
    const humanos = list.filter((c) => c.ia_pausada);
    const quentes = list.filter((c) => !c.ia_pausada && (c.temperatura === "quente" || c.temperatura === "pronto") && !["vendido", "perdido"].includes(c.stage));
    return [...humanos.map((c) => ({ c, kind: "humano" as const })), ...quentes.map((c) => ({ c, kind: "quente" as const }))].slice(0, 7);
  }, [conversas.data]);

  const visitas = (agenda.data ?? []).filter((a) => ["agendada", "confirmada"].includes(a.status));

  const s = stats.data;
  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Visão geral"
        description="Como a IA está atendendo e quem precisa de um vendedor agora."
        actions={
          <Tabs value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
            <TabsList>
              <TabsTrigger value="1">Hoje</TabsTrigger>
              <TabsTrigger value="7">7 dias</TabsTrigger>
              <TabsTrigger value="30">30 dias</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {s ? <Kpis s={s} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <section className="glow-card rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-white">Atendimento por dia</h2>
              <p className="text-sm text-muted-foreground">Conversas novas, simulações enviadas e visitas agendadas</p>
            </div>
            {s && (
              <div className="text-right">
                <p className="num text-[34px] font-semibold leading-none text-white">{num(s.atual.conversas)}</p>
                <p className="text-xs text-muted-foreground">conversas no período</p>
              </div>
            )}
          </div>
          <div className="mt-4 h-64">
            {s && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={s.serie} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b7dff" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#3b7dff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                  <XAxis dataKey="dia" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ stroke: "rgba(91,141,239,.4)" }}
                    contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "#18212b", color: "#e8edf2", fontFamily: "Barlow" }}
                    labelFormatter={(d) => String(d).split("-").reverse().join("/")}
                  />
                  <Area dataKey="conversas" name="Conversas" type="monotone" stroke="#5b8def" strokeWidth={2.5} fill="url(#gConv)" dot={false} activeDot={{ r: 4, fill: "#3b7dff", stroke: "#fff" }} />
                  <Line dataKey="simulacoes" name="Simulações" stroke="var(--faixa)" strokeWidth={2.5} dot={{ r: 2.5, fill: "var(--faixa)" }} type="monotone" />
                  <Bar dataKey="visitas" name="Visitas" fill="var(--verde)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span><span className="mr-1.5 inline-block h-[3px] w-3 rounded bg-[#5b8def] align-middle" />conversas novas</span>
            <span><span className="mr-1.5 inline-block h-[3px] w-3 rounded bg-faixa align-middle" />simulações enviadas</span>
            <span><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-verde align-middle" />visitas agendadas</span>
          </p>
        </section>

        <section className="glow-card lit flex flex-col overflow-hidden rounded-2xl">
          <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
            <div className="flex items-center gap-3">
              <span className="icon-tile vermelho size-10"><Hand className="size-[18px]" /></span>
              <div>
                <h2 className="text-2xl font-semibold leading-none text-white">Precisam de você agora</h2>
                <p className="mt-1 text-sm text-muted-foreground">Pedidos de vendedor e leads quentes</p>
              </div>
            </div>
            <Link to="/conversas" className="shrink-0 text-sm text-placa hover:underline">
              Ver todas
            </Link>
          </header>
          {conversas.isPending ? (
            <ListSkeleton />
          ) : atencao.length === 0 ? (
            <p className="px-5 py-8 text-muted-foreground">Ninguém esperando. A IA está dando conta de todas as conversas.</p>
          ) : (
            <ul className="flex-1 space-y-1.5 px-3 pb-3">
              {atencao.map(({ c, kind }) => (
                <li key={c.id}>
                  <Link to={`/conversas/${c.id}`} className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-white/[0.03]">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", kind === "humano" ? "bg-sinal/15 text-[#ffab9c]" : "bg-faixa/15 text-[#ffd860]")}>
                      {kind === "humano" ? <Hand className="size-[17px]" /> : <Flame className="size-[17px]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{contactName(c)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {kind === "humano" ? pausedReason(c.paused_reason) : `Lead quente, ${c.score} pontos`}
                        {c.interesse_texto ? `, procura ${c.interesse_texto}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ago(c.last_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="glow-line" aria-hidden />
        </section>
      </div>

      <FunnelRoad stats={s} />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="glow-card rounded-2xl">
          <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
            <div className="flex items-center gap-3">
              <span className="icon-tile verde size-10"><CalendarCheck className="size-[18px]" /></span>
              <h2 className="text-2xl font-semibold text-white">Visitas marcadas</h2>
            </div>
            <Link to="/agenda" className="text-sm text-placa hover:underline">
              Agenda
            </Link>
          </header>
          {agenda.isPending ? (
            <ListSkeleton />
          ) : visitas.length === 0 ? (
            <p className="px-5 py-6 text-muted-foreground">Nenhuma visita para hoje ou amanhã.</p>
          ) : (
            <ul className="space-y-1 px-3 pb-3">
              {visitas.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link to={`/conversas/${a.contact_id}`} className="flex items-center gap-4 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]">
                    <span className="w-14 shrink-0 rounded-lg bg-muted px-2 py-1.5 text-center">
                      <span className="num block text-xl font-semibold leading-none text-white">{time(a.inicio)}</span>
                      <span className="text-[11px] text-muted-foreground">{dayLabel(a.inicio)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{contactName(a)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {tipoVisitaLabel[a.tipo]}
                        {a.modelo ? `, ${a.marca} ${a.modelo} ${a.ano_modelo ?? ""}` : ""}
                      </span>
                    </span>
                    {a.status === "confirmada" && <span className="rounded-full bg-verde/15 px-2 py-0.5 text-xs font-medium text-[#9fe3bf]">Confirmou</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glow-card rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="icon-tile amarelo size-10"><Megaphone className="size-[18px]" /></span>
            <h2 className="text-2xl font-semibold text-white">Anúncios que trazem cliente</h2>
          </div>
          <div className="mt-3 grid gap-6 md:grid-cols-[1.5fr_1fr]">
            <div>
              {s && s.anuncios.length === 0 ? (
                <p className="mt-2 text-muted-foreground">Ainda não chegou ninguém por anúncio de clique para o WhatsApp neste período.</p>
              ) : (
                <table className="w-full table-fixed text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-normal">Anúncio</th>
                      <th className="w-[74px] py-1.5 text-right font-normal">Conversas</th>
                      <th className="w-[52px] py-1.5 text-right font-normal">Simul.</th>
                      <th className="w-[52px] py-1.5 text-right font-normal">Visitas</th>
                      <th className="w-[52px] py-1.5 text-right font-normal">Vendas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {s?.anuncios.map((a) => (
                      <tr key={a.anuncio}>
                        <td className="truncate py-2.5 pr-2 text-white/90" title={a.anuncio}>
                          {a.anuncio}
                        </td>
                        <td className="num py-2.5 text-right text-base">{a.conversas}</td>
                        <td className="num py-2.5 text-right text-base">{a.simulacoes}</td>
                        <td className="num py-2.5 text-right text-base">{a.visitas}</td>
                        <td className="num py-2.5 text-right text-base text-faixa">{a.vendas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Mais procurados</h3>
              <ul className="mt-2 space-y-2.5 text-sm">
                {(s?.carros ?? []).map((c) => {
                  const max = Math.max(1, ...(s?.carros ?? []).map((x) => x.procura));
                  return (
                    <li key={c.id}>
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate">{c.titulo}</span>
                        <span className="num text-base text-white">{c.procura}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#1f4e9e] to-[#5b8def]" style={{ width: `${(c.procura / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
                {s && !s.carros.length && <li className="text-muted-foreground">Aparece aqui quando a IA mostrar modelos aos clientes.</li>}
              </ul>
            </div>
          </div>
        </section>
      </div>

      {s && s.vendedores.length > 0 && (
        <section className="glow-card mt-5 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <span className="icon-tile size-10"><UsersRound className="size-[18px]" /></span>
            <h2 className="text-2xl font-semibold text-white">Por vendedor</h2>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 font-normal">Vendedor</th>
                <th className="py-1.5 text-right font-normal">Leads recebidos</th>
                <th className="py-1.5 text-right font-normal">Simulações</th>
                <th className="py-1.5 text-right font-normal">Aprovadas</th>
                <th className="py-1.5 text-right font-normal">Vendas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {s.vendedores.map((v) => (
                <tr key={v.id}>
                  <td className="py-2.5 text-white/90">{v.nome}</td>
                  <td className="num py-2.5 text-right text-base">{v.leads}</td>
                  <td className="num py-2.5 text-right text-base">{v.simulacoes}</td>
                  <td className="num py-2.5 text-right text-base">{v.aprovadas}</td>
                  <td className="num py-2.5 text-right text-base text-faixa">{v.vendas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s && (
        <p className="mt-6 text-sm text-muted-foreground">
          {s.ia.provedor === "mock"
            ? "A IA está em modo de teste (respostas simuladas). Configure a chave da Anthropic para ligar o Claude."
            : `IA: ${s.ia.modelo}. Custo estimado no período: US$ ${s.ia.custo_estimado_usd.toFixed(2)} (${num(s.ia.tokens.input + s.ia.tokens.output)} tokens).`}
        </p>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3 p-5">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

/** O funil desenhado como uma pista: cada etapa é um trecho da estrada até a venda. */
function FunnelRoad({ stats }: { stats?: Stats }) {
  const stages = STAGES.filter((s) => s.id !== "perdido");
  const counts = stages.map((s) => stats?.funil[s.id] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <section className="relative mt-5 overflow-hidden rounded-2xl border border-[#1f2a36] bg-[radial-gradient(120%_140%_at_50%_120%,rgba(59,125,255,.22),transparent_60%),#0a0f14] text-white" aria-label="Funil de leads">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h2 className="text-2xl font-semibold">Da conversa até a venda</h2>
        <p className="text-sm text-white/60">
          {total} leads no funil
          {stats?.funil.perdido ? `, ${stats.funil.perdido} perdidos` : ""}
        </p>
      </div>
      <div className="relative mt-3 overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-7">
          {stages.map((s, i) => (
            <Link key={s.id} to={`/leads#${s.id}`} className="group relative px-5 pb-6 pt-3 transition-colors hover:bg-white/[0.04]">
              <span className={cn("num block text-[44px] font-semibold leading-none md:text-[54px]", i === stages.length - 1 && "text-faixa")}>{stats ? counts[i] : "–"}</span>
              <span className="mt-1 block text-[15px] text-white/70 group-hover:text-white">{s.label}</span>
              {i > 0 && <span className="absolute inset-y-4 left-0 w-px bg-white/10" aria-hidden />}
            </Link>
          ))}
        </div>
        <div className="lane-dash h-[5px] min-w-[860px]" aria-hidden />
        <div className="h-4 min-w-[860px]" />
      </div>
    </section>
  );
}

function delta(cur: number, prev: number): { t: string; up: boolean | null } {
  if (!prev) return { t: cur ? "novo no período" : "", up: null };
  const d = Math.round(((cur - prev) / prev) * 100);
  return { t: `${d > 0 ? "+" : ""}${d}% vs. anterior`, up: d === 0 ? null : d > 0 };
}

function Spark({ data, k, color }: { data: Stats["serie"]; k: "conversas" | "simulacoes" | "visitas"; color: string }) {
  const id = `sp-${k}-${color.replace("#", "")}`;
  return (
    <div className="h-12 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area dataKey={k} type="monotone" stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Kpis({ s }: { s: Stats }) {
  const fr = s.primeira_resposta_mediana_s;
  const big = [
    { label: "Conversas novas", v: num(s.atual.conversas), d: delta(s.atual.conversas, s.anterior.conversas), icon: MessagesSquare, tile: "", k: "conversas" as const, color: "#5b8def" },
    { label: "Leads com interesse real", v: num(s.atual.leads_qualificados), d: delta(s.atual.leads_qualificados, s.anterior.leads_qualificados), icon: Flame, tile: "amarelo", k: "simulacoes" as const, color: "#f2b705" },
    { label: "Simulações enviadas", v: num(s.atual.simulacoes), d: delta(s.atual.simulacoes, s.anterior.simulacoes), icon: ClipboardCheck, tile: "", k: "simulacoes" as const, color: "#8fb3ff" },
    { label: "Vendas registradas", v: num(s.atual.vendas), d: { t: s.atual.faturamento ? brl(s.atual.faturamento) : "marque no funil quando vender", up: null }, icon: BadgeCheck, tile: "verde", k: "visitas" as const, color: "#3fb37a" },
  ];
  const small = [
    { label: "Vieram de anúncio", v: num(s.atual.de_anuncio), d: s.atual.conversas ? `${Math.round((s.atual.de_anuncio / s.atual.conversas) * 100)}% das conversas` : "", icon: Megaphone },
    { label: "Visitas agendadas", v: num(s.atual.visitas_agendadas), d: delta(s.atual.visitas_agendadas, s.anterior.visitas_agendadas).t, icon: CalendarCheck },
    { label: "Primeira resposta", v: fr == null ? "–" : fr < 60 ? `${Math.round(fr)}s` : `${Math.round(fr / 60)}min`, d: "tempo mediano da IA", icon: Timer },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        {big.map((k) => (
          <div key={k.label} className="glow-card rounded-2xl p-4 pb-2">
            <div className="flex items-start justify-between gap-3">
              <span className={cn("icon-tile size-9 md:size-11", k.tile)}>
                <k.icon className="size-5" />
              </span>
              {k.d.t && (
                <span className={cn("hidden rounded-full px-2 py-0.5 text-xs sm:inline", k.d.up === true ? "bg-verde/15 text-[#9fe3bf]" : k.d.up === false ? "bg-sinal/15 text-[#ffab9c]" : "bg-muted text-muted-foreground")}>
                  {k.d.t}
                </span>
              )}
            </div>
            <p className="mt-3 truncate text-sm text-muted-foreground">{k.label}</p>
            <p className="num mt-0.5 text-[32px] font-semibold leading-none text-white md:text-[38px]">{k.v}</p>
            <Spark data={s.serie} k={k.k} color={k.color} />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {small.map((k) => (
          <div key={k.label} className="glow-card flex items-center gap-4 rounded-2xl px-4 py-3.5">
            <span className="icon-tile size-10">
              <k.icon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{k.label}</p>
              <p className="flex items-baseline gap-2">
                <span className="num text-[28px] font-semibold leading-none text-white">{k.v}</span>
                <span className="truncate text-xs text-muted-foreground">{k.d}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
