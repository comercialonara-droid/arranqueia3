import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardList, Link2, RefreshCw, Sparkles } from "lucide-react";
import { get, post, put } from "@/lib/api";
import { PageHeader } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useSegment } from "@/lib/segment";
import {
  CANAL_LABEL,
  intf,
  money,
  OBJETIVO_LABEL,
  pctf,
  ratio,
  STATUS_LABEL,
  vsMeta,
  type CampaignListItem,
  type CampaignStatus,
  type Kpis,
  type Questionnaire,
  type StoreMarketing,
} from "@/lib/marketing";

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const cls: Record<CampaignStatus, string> = {
    gerando: "bg-accent text-foreground",
    rascunho: "bg-muted text-foreground",
    ativa: "bg-verde text-white",
    pausada: "bg-faixa text-ink",
    encerrada: "bg-muted text-muted-foreground",
    erro: "bg-sinal text-white",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[13px] font-medium", cls[status])}>{STATUS_LABEL[status]}</span>;
}

/** Número grande com rótulo e comparação com a meta. */
export function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bom" | "ruim" | null }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p title={value} className={cn("num mt-0.5 truncate font-semibold leading-none", value.length > 11 ? "text-[24px]" : "text-[30px]", tone === "ruim" && "text-sinal", tone === "bom" && "text-verde")}>{value}</p>
      {sub && <p className="mt-1 text-xs leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function KpiBand({ k, metas }: { k: Kpis; metas?: { cpl_alvo: number; roas_alvo: number; custo_por_venda_max: number } | null }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg border bg-chapa p-5 sm:grid-cols-4 xl:grid-cols-7">
      <Metric label="Investido" value={money(k.investimento)} sub={k.cpm ? `CPM ${money(k.cpm)}` : undefined} />
      <Metric label="Leads no WhatsApp" value={intf(k.leads)} sub={`custo por lead ${money(k.cpl)}${metas ? ` · meta ${money(metas.cpl_alvo)}` : ""}`} tone={vsMeta(k.cpl, metas?.cpl_alvo)} />
      <Metric label="Qualificados pela IA" value={intf(k.qualificados)} sub={`${pctf(k.taxa_qualificacao_pct)} · ${money(k.custo_qualificado)} cada`} />
      <Metric label="Vendas" value={intf(k.vendas)} sub={`custo por venda ${money(k.custo_por_venda)}`} tone={vsMeta(k.custo_por_venda, metas?.custo_por_venda_max)} />
      <Metric label="Receita" value={money(k.receita)} sub={k.ticket_medio ? `ticket ${money(k.ticket_medio)}` : undefined} />
      <Metric label="ROAS" value={ratio(k.roas)} sub={metas ? `meta ${ratio(metas.roas_alvo)}` : "receita ÷ investido"} tone={vsMeta(k.roas, metas?.roas_alvo, false)} />
      <Metric label="ROI" value={pctf(k.roi_pct)} sub={k.margem_pct ? `margem de ${k.margem_pct}%` : "informe a margem no questionário"} tone={k.roi_pct == null ? null : k.roi_pct >= 0 ? "bom" : "ruim"} />
    </div>
  );
}

/** O caminho do anúncio até a venda, com a taxa de passagem entre as etapas. */
export function FunnelStrip({ k }: { k: Kpis }) {
  const steps = [
    { label: "Impressões", v: k.impressoes },
    { label: "Cliques", v: k.cliques },
    { label: "Leads", v: k.leads },
    { label: "Qualificados", v: k.qualificados },
    { label: "Simulações", v: k.simulacoes },
    { label: "Visitas", v: k.visitas },
    { label: "Vendas", v: k.vendas },
  ];
  return (
    <ol className="grid grid-cols-2 overflow-hidden rounded-lg border bg-asfalto text-white sm:grid-cols-4 lg:grid-cols-7" aria-label="Funil do anúncio até a venda">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].v : 0;
        const rate = i > 0 && prev > 0 ? (s.v / prev) * 100 : null;
        return (
          <li key={s.label} className="relative border-white/10 px-4 py-3.5 [&:not(:first-child)]:border-l">
            <p className="text-sm text-white/60">{s.label}</p>
            <p className="num text-[26px] font-semibold leading-tight">{intf(s.v)}</p>
            <p className="h-4 text-xs text-faixa">{rate != null ? `${rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da etapa anterior` : ""}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function SpendChart({ serie }: { serie: { data: string; investimento: number; leads: number }[] }) {
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={serie} margin={{ left: -6, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="data" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis yAxisId="r" tickFormatter={(v: number) => `R$${v}`} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={56} />
          <YAxis yAxisId="l" orientation="right" allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontFamily: "Barlow" }}
            labelFormatter={(d) => String(d).split("-").reverse().join("/")}
            formatter={(v, name) => (name === "Investido" ? money(Number(v)) : String(v))}
          />
          <Bar yAxisId="r" dataKey="investimento" name="Investido" fill="#3b6fd8" radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line yAxisId="l" dataKey="leads" name="Leads" stroke="var(--faixa)" strokeWidth={3} dot={{ r: 2.5, fill: "var(--faixa)" }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Marketing() {
  const [dias, setDias] = useState(30);
  const [nova, setNova] = useState(false);
  const [conta, setConta] = useState(false);
  const res = useQuery({ queryKey: ["mkt-resultados", dias], queryFn: () => get<StoreMarketing>(`/api/marketing/resultados?dias=${dias}`) });
  const camps = useQuery({
    queryKey: ["mkt-campanhas"],
    queryFn: () => get<CampaignListItem[]>("/api/marketing/campanhas"),
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => c.status === "gerando") ? 3000 : false),
  });
  const quest = useQuery({ queryKey: ["mkt-questionario"], queryFn: () => get<Questionnaire>("/api/marketing/questionario") });
  const pct = quest.data?.preenchimento.pct ?? 0;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Marketing"
        description="Campanhas de tráfego pago criadas pela IA e o resultado de cada uma até a venda: quanto custou cada lead, quantos a IA qualificou, quantos compraram e o retorno sobre o investimento."
        actions={
          <>
            <Button variant="outline" onClick={() => setConta(true)}>
              <Link2 /> Conta de anúncios
            </Button>
            <Button onClick={() => setNova(true)}>
              <Sparkles /> Nova campanha com IA
            </Button>
          </>
        }
      />

      {quest.data && pct < 100 && (
        <Link to="/marketing/questionario" className="mb-5 flex items-center gap-4 rounded-lg border border-faixa bg-accent px-5 py-3.5 hover:bg-faixa/25">
          <ClipboardList className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Questionário da loja {pct}% respondido</span>
            <span className="block text-sm text-foreground/75">A IA monta campanhas melhores quando sabe a região, o cliente, a margem e a meta. Faltam {quest.data.preenchimento.faltando.length} respostas essenciais.</span>
          </span>
          <span className="lane-dash hidden h-1.5 w-24 shrink-0 rounded sm:block" aria-hidden />
        </Link>
      )}

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold">Resultado das campanhas</h2>
        <Tabs value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <TabsList>
            <TabsTrigger value="7">7 dias</TabsTrigger>
            <TabsTrigger value="30">30 dias</TabsTrigger>
            <TabsTrigger value="90">90 dias</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {res.data ? (
        <div className="space-y-4">
          <KpiBand k={res.data.total} />
          <FunnelStrip k={res.data.total} />
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <section className="rounded-lg border bg-chapa p-5">
              <h3 className="text-xl font-semibold">Investimento e leads por dia</h3>
              <div className="mt-3">
                <SpendChart serie={res.data.serie} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="mr-1 inline-block size-2.5 rounded-sm bg-[#3b6fd8] align-middle" /> investido
                <span className="ml-4 mr-1 inline-block h-[3px] w-3 bg-faixa align-middle" /> leads das campanhas no WhatsApp
              </p>
            </section>
            <section className="rounded-lg border bg-chapa p-5">
              <h3 className="text-xl font-semibold">De onde vieram os outros leads</h3>
              <dl className="mt-3 divide-y">
                {[
                  ["Anúncio sem campanha cadastrada", res.data.sem_campanha],
                  ["Orgânico (sem anúncio)", res.data.organico],
                ].map(([label, f]) => {
                  const x = f as StoreMarketing["organico"];
                  return (
                    <div key={label as string} className="flex items-baseline justify-between gap-3 py-3">
                      <dt className="text-muted-foreground">{label as string}</dt>
                      <dd className="text-right">
                        <span className="num text-xl font-semibold">{intf(x.leads)}</span> leads
                        <span className="block text-xs text-muted-foreground">
                          {x.qualificados} qualificados · {x.vendas} vendas
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {res.data.sem_campanha.leads > 0 && <p className="mt-2 text-sm text-muted-foreground">Ligue os anúncios às campanhas (IDs da Meta ou palavras do título) para esses leads entrarem no resultado certo.</p>}
            </section>
          </div>
        </div>
      ) : (
        <Skeleton className="h-72" />
      )}

      <div className="mb-3 mt-8 flex items-end justify-between">
        <h2 className="text-2xl font-semibold">Campanhas</h2>
        <p className="text-sm text-muted-foreground">Toque numa campanha para ver o plano, os anúncios e os números.</p>
      </div>
      {camps.isPending ? (
        <Skeleton className="h-40" />
      ) : !camps.data?.length ? (
        <div className="rounded-lg border border-dashed bg-chapa p-10 text-center">
          <p className="text-lg">Nenhuma campanha ainda.</p>
          <p className="mt-1 text-muted-foreground">Responda o questionário e peça a primeira para a IA: ela monta públicos, anúncios, orçamento, metas e regras de otimização.</p>
          <Button className="mt-4" onClick={() => setNova(true)}>
            <Sparkles /> Nova campanha com IA
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-chapa">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Campanha</th>
                <th className="px-3 py-2.5 text-right font-medium">Verba/mês</th>
                <th className="px-3 py-2.5 text-right font-medium">Investido</th>
                <th className="px-3 py-2.5 text-right font-medium">Leads</th>
                <th className="px-3 py-2.5 text-right font-medium">Custo por lead</th>
                <th className="px-3 py-2.5 text-right font-medium">Qualificados</th>
                <th className="px-3 py-2.5 text-right font-medium">Vendas</th>
                <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                <th className="px-4 py-2.5 text-right font-medium">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {camps.data.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link to={`/marketing/campanhas/${c.id}`} className="block">
                      <span className="block font-medium">{c.nome}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={c.status} />
                        {OBJETIVO_LABEL[c.pedido.objetivo] ?? ""}
                        {c.inicio ? ` · desde ${c.inicio.split("-").reverse().join("/")}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="num px-3 py-3 text-right">{money(c.verba_mensal)}</td>
                  <td className="num px-3 py-3 text-right">{money(c.kpis?.investimento)}</td>
                  <td className="num px-3 py-3 text-right">{intf(c.kpis?.leads)}</td>
                  <td className={cn("num px-3 py-3 text-right", vsMeta(c.kpis?.cpl ?? null, c.metas?.cpl_alvo) === "ruim" && "text-sinal", vsMeta(c.kpis?.cpl ?? null, c.metas?.cpl_alvo) === "bom" && "text-verde")}>
                    {money(c.kpis?.cpl)}
                    {c.metas && <span className="block text-xs text-muted-foreground">meta {money(c.metas.cpl_alvo)}</span>}
                  </td>
                  <td className="num px-3 py-3 text-right">{intf(c.kpis?.qualificados)}</td>
                  <td className="num px-3 py-3 text-right">{intf(c.kpis?.vendas)}</td>
                  <td className="num px-3 py-3 text-right">{ratio(c.kpis?.roas)}</td>
                  <td className="num px-4 py-3 text-right">{pctf(c.kpis?.roi_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewCampaignDialog open={nova} onOpenChange={setNova} produtos={quest.data?.produtos ?? []} verbaSugerida={Number(quest.data?.respostas.verba_mensal) || null} />
      <AdsAccountSheet open={conta} onOpenChange={setConta} />
    </div>
  );
}

function NewCampaignDialog({ open, onOpenChange, produtos, verbaSugerida }: { open: boolean; onOpenChange: (o: boolean) => void; produtos: { id: string; titulo: string }[]; verbaSugerida: number | null }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const seg = useSegment();
  const hoje = new Date().toLocaleDateString("sv-SE");
  const [f, setF] = useState({ objetivo: "leads_whatsapp", verba: "", inicio: hoje, fim: "", canais: ["meta"], produtos: [] as string[], observacoes: "" });
  const verba = Number(f.verba.replace(/\./g, "").replace(",", ".")) || verbaSugerida || 0;
  const create = useMutation({
    mutationFn: () =>
      post<{ id: number }>("/api/marketing/campanhas", {
        objetivo: f.objetivo,
        verba_mensal: verba,
        inicio: f.inicio,
        fim: f.fim || null,
        canais: f.canais,
        produtos: f.produtos,
        observacoes: f.observacoes || null,
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["mkt-campanhas"] });
      onOpenChange(false);
      nav(`/marketing/campanhas/${c.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (k: "canais" | "produtos", id: string) => setF((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-3xl">Nova campanha com IA</DialogTitle>
          <DialogDescription>A IA lê o questionário da loja, o estoque e o resultado das campanhas anteriores, e devolve o plano completo para você revisar antes de subir.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Objetivo</Label>
              <Select value={f.objetivo} onValueChange={(v) => setF({ ...f, objetivo: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OBJETIVO_LABEL).map(([id, l]) => (
                    <SelectItem key={id} value={id}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-verba">Verba mensal (R$)</Label>
              <Input id="n-verba" inputMode="numeric" placeholder={verbaSugerida ? String(verbaSugerida) : "3000"} value={f.verba} onChange={(e) => setF({ ...f, verba: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-ini">Começa em</Label>
              <Input id="n-ini" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="n-fim">Termina em (opcional)</Label>
              <Input id="n-fim" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Onde anunciar</legend>
            <div className="flex flex-wrap gap-4">
              {Object.entries(CANAL_LABEL).map(([id, l]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.canais.includes(id)} onCheckedChange={() => toggle("canais", id)} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{seg.Produtos} que puxam a campanha</legend>
            <p className="mb-2 text-xs text-muted-foreground">Sem escolher, a IA usa os destaques e os produtos do questionário.</p>
            <div className="grid max-h-44 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {produtos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={f.produtos.includes(p.id)} onCheckedChange={() => toggle("produtos", p.id)} />
                  <span className="truncate">{p.titulo}</span>
                </label>
              ))}
              {!produtos.length && <p className="p-2 text-sm text-muted-foreground">Cadastre o estoque primeiro.</p>}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="n-obs">Orientações para a IA (opcional)</Label>
            <Textarea id="n-obs" rows={3} placeholder="Ex.: feirão no fim de semana, focar em motoristas de aplicativo, não usar a palavra 'barato'" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} disabled={!verba || !f.inicio || !f.canais.length || create.isPending}>
            <Sparkles /> Criar plano
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdsAccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["mkt-conta"], queryFn: () => get<{ conta: string | null; token_proprio: boolean; conectada: boolean }>("/api/marketing/conta-anuncios"), enabled: open });
  const [conta, setConta] = useState("");
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => put("/api/marketing/conta-anuncios", { conta: conta || st.data?.conta || null, ...(token ? { token } : {}) }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["mkt-conta"] });
      toast.success("Conta de anúncios salva.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => post<{ campanhas: number; dias: number; aviso?: string }>("/api/marketing/meta/sincronizar", { dias: 30 }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mkt-resultados"] });
      qc.invalidateQueries({ queryKey: ["mkt-campanhas"] });
      toast.success(r.aviso ?? `Resultados de ${r.campanhas} campanhas atualizados (${r.dias} dias).`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-heading text-3xl">Conta de anúncios</SheetTitle>
          <SheetDescription>Com a conta da Meta ligada, investimento, impressões e cliques entram sozinhos a cada 3 horas. Sem ela, lance os números do dia na campanha.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <p className={cn("text-sm font-medium", st.data?.conectada ? "text-verde" : "text-muted-foreground")}>{st.data?.conectada ? `Conectada: act_${st.data.conta}` : "Não conectada"}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="c-conta">ID da conta de anúncios</Label>
            <Input id="c-conta" placeholder={st.data?.conta ? `act_${st.data.conta}` : "act_1234567890"} value={conta} onChange={(e) => setConta(e.target.value)} />
            <p className="text-xs text-muted-foreground">No Gerenciador de Anúncios, fica no seletor de contas, no alto à esquerda.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-token">Token com permissão ads_read {st.data?.token_proprio ? "(já salvo; preencha só para trocar)" : "(opcional)"}</Label>
            <Input id="c-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            <p className="text-xs text-muted-foreground">Sem token próprio, o sistema usa o token do WhatsApp da loja, se ele tiver acesso à conta de anúncios.</p>
          </div>
        </div>
        <SheetFooter className="flex-row justify-between border-t">
          <Button variant="outline" onClick={() => sync.mutate()} disabled={!st.data?.conectada || sync.isPending}>
            <RefreshCw className={cn(sync.isPending && "animate-spin")} /> Atualizar resultados agora
          </Button>
          <Button onClick={() => save.mutate()} disabled={(!conta && !token) || save.isPending}>
            Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
