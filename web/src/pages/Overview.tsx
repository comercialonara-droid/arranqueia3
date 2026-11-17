import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Hand, Megaphone } from "lucide-react";
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
      pronto_para_negociar: "Pronto para negociar",
      pediu_humano: "Pediu para falar com alguém",
      negociacao_de_preco: "Quer negociar o valor",
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
    const quentes = list.filter((c) => !c.ia_pausada && c.temperatura === "quente" && !["vendido", "perdido"].includes(c.stage));
    return [...humanos.map((c) => ({ c, kind: "humano" as const })), ...quentes.map((c) => ({ c, kind: "quente" as const }))].slice(0, 7);
  }, [conversas.data]);

  const visitas = (agenda.data ?? []).filter((a) => ["agendada", "confirmada"].includes(a.status));

  return (
    <div className="mx-auto max-w-[1280px]">
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

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-lg border bg-chapa">
          <header className="flex items-baseline justify-between border-b px-5 py-3.5">
            <h2 className="text-2xl font-semibold">Precisam de você agora</h2>
            <Link to="/conversas" className="text-sm text-placa hover:underline">
              Ver conversas
            </Link>
          </header>
          {conversas.isPending ? (
            <ListSkeleton />
          ) : atencao.length === 0 ? (
            <p className="px-5 py-8 text-muted-foreground">Ninguém esperando. A IA está dando conta de todas as conversas.</p>
          ) : (
            <ul className="divide-y">
              {atencao.map(({ c, kind }) => (
                <li key={c.id}>
                  <Link to={`/conversas/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", kind === "humano" ? "bg-sinal/10 text-sinal" : "bg-faixa/20 text-asfalto")}>
                      {kind === "humano" ? <Hand className="size-[18px]" /> : <Flame className="size-[18px]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{contactName(c)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {kind === "humano" ? pausedReason(c.paused_reason) : `Lead quente, ${c.score} pontos`}
                        {c.interesse_texto ? `, procura ${c.interesse_texto}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">{ago(c.last_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-chapa">
          <header className="flex items-baseline justify-between border-b px-5 py-3.5">
            <h2 className="text-2xl font-semibold">Visitas marcadas</h2>
            <Link to="/agenda" className="text-sm text-placa hover:underline">
              Abrir agenda
            </Link>
          </header>
          {agenda.isPending ? (
            <ListSkeleton />
          ) : visitas.length === 0 ? (
            <p className="px-5 py-8 text-muted-foreground">Nenhuma visita para hoje ou amanhã.</p>
          ) : (
            <ul className="divide-y">
              {visitas.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link to={`/conversas/${a.contact_id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/60">
                    <span className="w-16 shrink-0">
                      <span className="num block text-2xl font-semibold leading-none">{time(a.inicio)}</span>
                      <span className="text-xs text-muted-foreground">{dayLabel(a.inicio)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{contactName(a)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {tipoVisitaLabel[a.tipo]}
                        {a.modelo ? `, ${a.marca} ${a.modelo} ${a.ano_modelo ?? ""}` : ""}
                      </span>
                    </span>
                    {a.status === "confirmada" && <span className="text-sm font-medium text-verde">Confirmou</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <FunnelRoad stats={stats.data} />

      {stats.data ? <Kpis s={stats.data} /> : <Skeleton className="mt-5 h-28" />}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border bg-chapa p-5">
          <h2 className="text-2xl font-semibold">Conversas e visitas por dia</h2>
          <div className="mt-4 h-60">
            {stats.data && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={stats.data.serie} margin={{ left: -18, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="dia" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontFamily: "Barlow" }}
                    labelFormatter={(d) => String(d).split("-").reverse().join("/")}
                  />
                  <Bar dataKey="conversas" name="Conversas" fill="var(--asfalto)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line dataKey="visitas" name="Visitas" stroke="var(--faixa)" strokeWidth={3} dot={{ r: 3, fill: "var(--faixa)" }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-asfalto align-middle" /> conversas novas
            <span className="ml-4 mr-1 inline-block h-[3px] w-3 bg-faixa align-middle" /> visitas agendadas
          </p>
        </section>

        <section className="rounded-lg border bg-chapa p-5">
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Megaphone className="size-5" /> Anúncios que trazem cliente
          </h2>
          {stats.data && stats.data.anuncios.length === 0 ? (
            <p className="mt-4 text-muted-foreground">Ainda não chegou ninguém por anúncio de clique para o WhatsApp neste período.</p>
          ) : (
            <table className="mt-3 w-full table-fixed text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-normal">Anúncio</th>
                  <th className="w-[76px] py-1.5 text-right font-normal">Conversas</th>
                  <th className="w-[56px] py-1.5 text-right font-normal">Visitas</th>
                  <th className="w-[56px] py-1.5 text-right font-normal">Vendas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.data?.anuncios.map((a) => (
                  <tr key={a.anuncio}>
                    <td className="truncate py-2 pr-2" title={a.anuncio}>
                      {a.anuncio}
                    </td>
                    <td className="num py-2 text-right text-base">{a.conversas}</td>
                    <td className="num py-2 text-right text-base">{a.visitas}</td>
                    <td className="num py-2 text-right text-base">{a.vendas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="mt-6 text-xl font-semibold">Carros mais procurados</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {(stats.data?.carros ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{c.titulo}</span>
                <span className="h-1.5 rounded-full bg-asfalto/80" style={{ width: `${Math.min(100, c.procura * 12)}px` }} aria-hidden />
                <span className="num w-6 text-right text-base">{c.procura}</span>
              </li>
            ))}
            {stats.data && !stats.data.carros.length && <li className="text-muted-foreground">Aparece aqui quando a IA mostrar carros aos clientes.</li>}
          </ul>
        </section>
      </div>

      {stats.data && (
        <p className="mt-6 text-sm text-muted-foreground">
          {stats.data.ia.provedor === "mock"
            ? "A IA está em modo de teste (respostas simuladas). Configure a chave da Anthropic para ligar o Claude."
            : `IA: ${stats.data.ia.modelo}. Custo estimado no período: US$ ${stats.data.ia.custo_estimado_usd.toFixed(2)} (${num(stats.data.ia.tokens.input + stats.data.ia.tokens.output)} tokens).`}
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
    <section className="mt-5 overflow-hidden rounded-lg bg-asfalto text-white" aria-label="Funil de leads">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-2xl font-semibold">Da conversa até a venda</h2>
        <p className="text-sm text-white/60">
          {total} leads no funil
          {stats?.funil.perdido ? `, ${stats.funil.perdido} perdidos` : ""}
        </p>
      </div>
      <div className="relative mt-3 overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-6">
          {stages.map((s, i) => (
            <Link key={s.id} to={`/leads#${s.id}`} className="group relative px-5 pb-6 pt-3 hover:bg-white/[0.04]">
              <span className="num block text-[44px] font-semibold leading-none md:text-[56px]">{stats ? counts[i] : "–"}</span>
              <span className="mt-1 block text-[15px] text-white/75 group-hover:text-white">{s.label}</span>
              {i > 0 && <span className="absolute inset-y-4 left-0 w-px bg-white/10" aria-hidden />}
            </Link>
          ))}
        </div>
        <div className="lane-dash h-[5px] min-w-[720px]" aria-hidden />
        <div className="h-4 min-w-[720px]" />
      </div>
    </section>
  );
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? "novo no período" : "";
  const d = Math.round(((cur - prev) / prev) * 100);
  return `${d > 0 ? "+" : ""}${d}% vs. período anterior`;
}

function Kpis({ s }: { s: Stats }) {
  const fr = s.primeira_resposta_mediana_s;
  const items = [
    { label: "Conversas novas", v: num(s.atual.conversas), d: delta(s.atual.conversas, s.anterior.conversas) },
    { label: "Vieram de anúncio", v: num(s.atual.de_anuncio), d: s.atual.conversas ? `${Math.round((s.atual.de_anuncio / s.atual.conversas) * 100)}% das conversas` : "" },
    { label: "Leads com interesse real", v: num(s.atual.leads_qualificados), d: delta(s.atual.leads_qualificados, s.anterior.leads_qualificados) },
    { label: "Visitas agendadas", v: num(s.atual.visitas_agendadas), d: delta(s.atual.visitas_agendadas, s.anterior.visitas_agendadas) },
    { label: "Vendas registradas", v: num(s.atual.vendas), d: s.atual.faturamento ? brl(s.atual.faturamento) : "marque no funil quando vender" },
    { label: "Primeira resposta", v: fr == null ? "–" : fr < 60 ? `${Math.round(fr)}s` : `${Math.round(fr / 60)}min`, d: "mediana" },
  ];
  return (
    <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className="bg-chapa px-4 py-3.5">
          <p className="text-sm text-muted-foreground">{k.label}</p>
          <p className="num mt-1 text-[32px] font-semibold leading-none">{k.v}</p>
          <p className="mt-1.5 min-h-4 text-xs text-muted-foreground">{k.d}</p>
        </div>
      ))}
    </div>
  );
}

