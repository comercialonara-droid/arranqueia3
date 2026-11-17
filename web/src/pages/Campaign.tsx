import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { del, get, patch, post } from "@/lib/api";
import { PageHeader } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Temperature } from "@/components/app/Temperature";
import { cn } from "@/lib/utils";
import { STAGES } from "@/lib/api";
import { FORMATO_LABEL, intf, money, NOTA_LABEL, OBJETIVO_LABEL, pctf, ratio, CANAL_LABEL, type Ad, type CampaignDetail, type Plan } from "@/lib/marketing";
import { FunnelStrip, KpiBand, SpendChart, StatusBadge } from "./Marketing";

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

export default function Campaign() {
  const { id } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [refazer, setRefazer] = useState(false);
  const q = useQuery({
    queryKey: ["mkt-campanha", id],
    queryFn: () => get<CampaignDetail>(`/api/marketing/campanhas/${id}`),
    refetchInterval: (x) => (x.state.data?.status === "gerando" ? 3000 : false),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["mkt-campanha", id] });
    qc.invalidateQueries({ queryKey: ["mkt-campanhas"] });
    qc.invalidateQueries({ queryKey: ["mkt-resultados"] });
  };
  const upd = useMutation({ mutationFn: (b: Record<string, unknown>) => patch(`/api/marketing/campanhas/${id}`, b), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const remove = useMutation({
    mutationFn: () => del(`/api/marketing/campanhas/${id}`),
    onSuccess: () => {
      refresh();
      nav("/marketing");
    },
  });

  const c = q.data;
  if (!c) return <Skeleton className="mx-auto h-96 max-w-[1300px]" />;

  return (
    <div className="mx-auto max-w-[1300px]">
      <Link to="/marketing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-asfalto">
        <ArrowLeft className="size-4" /> Marketing
      </Link>
      <PageHeader
        title={c.nome}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={c.status} />
            <span>{OBJETIVO_LABEL[c.pedido.objetivo]}</span>
            <span>{money(c.verba_mensal)} por mês</span>
            <span>
              {fmtDate(c.inicio)}
              {c.fim ? ` a ${fmtDate(c.fim)}` : ", contínua"}
            </span>
            <span>{c.pedido.canais.map((x) => CANAL_LABEL[x]).join(", ")}</span>
          </span>
        }
        actions={
          c.status !== "gerando" && (
            <>
              {c.plano && (
                <Select value={c.status === "erro" ? "rascunho" : c.status} onValueChange={(v) => upd.mutate({ status: v })}>
                  <SelectTrigger className="w-40 bg-chapa" aria-label="Situação da campanha">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rascunho">Rascunho</SelectItem>
                    <SelectItem value="ativa">No ar</SelectItem>
                    <SelectItem value="pausada">Pausada</SelectItem>
                    <SelectItem value="encerrada">Encerrada</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" onClick={() => setRefazer(true)}>
                <RefreshCw /> Refazer plano
              </Button>
              <Button variant="ghost" size="icon" aria-label="Excluir campanha" onClick={() => confirm("Excluir esta campanha e os resultados lançados nela?") && remove.mutate()}>
                <Trash2 />
              </Button>
            </>
          )
        }
      />

      {c.status === "gerando" ? (
        <Generating />
      ) : c.status === "erro" && !c.plano ? (
        <div className="rounded-lg border border-sinal/40 bg-chapa p-6">
          <p className="text-lg font-medium">A IA não conseguiu montar o plano.</p>
          <p className="mt-1 text-muted-foreground">{c.erro}</p>
          <Button className="mt-4" onClick={() => setRefazer(true)}>
            <RefreshCw /> Tentar de novo
          </Button>
        </div>
      ) : (
        <Tabs defaultValue={c.status === "ativa" || c.status === "encerrada" ? "resultados" : "estrategia"}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="estrategia">Estratégia</TabsTrigger>
            <TabsTrigger value="anuncios">Anúncios</TabsTrigger>
            <TabsTrigger value="resultados">Resultados</TabsTrigger>
            <TabsTrigger value="leads">Leads ({c.leads.length})</TabsTrigger>
            <TabsTrigger value="analise">Análise da IA</TabsTrigger>
            <TabsTrigger value="ligacao">Ligar anúncios</TabsTrigger>
          </TabsList>
          <TabsContent value="estrategia">{c.plano && <Strategy p={c.plano} />}</TabsContent>
          <TabsContent value="anuncios">{c.plano && <Ads p={c.plano} />}</TabsContent>
          <TabsContent value="resultados">
            <Results c={c} onChange={refresh} />
          </TabsContent>
          <TabsContent value="leads">
            <Leads c={c} />
          </TabsContent>
          <TabsContent value="analise">
            <AnalysisTab c={c} onChange={refresh} />
          </TabsContent>
          <TabsContent value="ligacao">
            <Linking c={c} onSave={(b) => upd.mutate(b, { onSuccess: () => toast.success("Ligação salva.") })} />
          </TabsContent>
        </Tabs>
      )}

      <RedoDialog open={refazer} onOpenChange={setRefazer} id={c.id} onDone={refresh} />
    </div>
  );
}

function Generating() {
  return (
    <div className="overflow-hidden rounded-lg border bg-asfalto text-white">
      <div className="p-8">
        <p className="flex items-center gap-2 text-faixa">
          <Sparkles className="size-5" /> A IA está montando a estratégia
        </p>
        <p className="mt-3 max-w-[60ch] text-lg text-white/85">Lendo o questionário da loja, o estoque e o histórico de campanhas para escrever públicos, anúncios, orçamento, metas e regras de otimização. Leva de 1 a 3 minutos; pode sair desta tela.</p>
      </div>
      <div className="relative h-2 overflow-hidden bg-white/10" aria-hidden>
        <div className="lane-dash absolute inset-y-0 -left-full w-[200%] animate-[road_1.6s_linear_infinite] motion-reduce:animate-none" />
      </div>
      <style>{`@keyframes road { to { transform: translateX(38px) } }`}</style>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-chapa p-5", className)}>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Strategy({ p }: { p: Plan }) {
  const m = p.metas;
  return (
    <div className="grid gap-4">
      <section className="rounded-lg border bg-asfalto p-6 text-white">
        <p className="text-sm text-white/60">A estratégia</p>
        <p className="mt-2 max-w-[75ch] text-lg leading-relaxed">{p.resumo}</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-sm text-white/60">Posicionamento</p>
            <p className="mt-1">{p.posicionamento}</p>
          </div>
          <div>
            <p className="text-sm text-white/60">Oferta principal</p>
            <p className="mt-1 font-medium text-faixa">{p.oferta_principal}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Metas do mês">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              ["Leads", intf(m.leads_mes)],
              ["Custo por lead", money(m.cpl_alvo)],
              ["Qualificação", pctf(m.taxa_qualificacao_pct)],
              ["Vendas", intf(m.vendas_mes)],
              ["Custo por venda máx.", money(m.custo_por_venda_max)],
              ["ROAS", ratio(m.roas_alvo)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="num text-[28px] font-semibold leading-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Orçamento">
          <p className="num text-[28px] font-semibold leading-none">
            {money(p.orcamento.mensal)} <span className="text-base font-normal text-muted-foreground">por mês · {money(p.orcamento.diario)} por dia</span>
          </p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
            {p.orcamento.distribuicao.map((d, i) => (
              <span key={d.item} style={{ width: `${d.percentual}%` }} className={["bg-asfalto", "bg-faixa", "bg-placa", "bg-verde", "bg-[#8a959f]"][i % 5]} />
            ))}
          </div>
          <ul className="mt-3 space-y-2.5">
            {p.orcamento.distribuicao.map((d, i) => (
              <li key={d.item} className="flex gap-3">
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-sm", ["bg-asfalto", "bg-faixa", "bg-placa", "bg-verde", "bg-[#8a959f]"][i % 5])} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.item}</span> <span className="num text-muted-foreground">· {d.percentual}% · {money(d.valor)}</span>
                  <span className="block text-sm text-muted-foreground">{d.motivo}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Públicos">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {p.publicos.map((a) => (
            <article key={a.nome} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-semibold">{a.nome}</h3>
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", a.temperatura === "quente" ? "bg-sinal/10 text-sinal" : a.temperatura === "morno" ? "bg-faixa/25" : "bg-placa/10 text-placa")}>público {a.temperatura}</span>
              </div>
              <p className="mt-1 text-sm">{a.descricao}</p>
              <dl className="mt-3 space-y-1 text-sm">
                <div>
                  <dt className="inline text-muted-foreground">Onde: </dt>
                  <dd className="inline">
                    {a.localizacao}, raio de {a.raio_km} km
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Idade: </dt>
                  <dd className="inline">
                    {a.idade_min} a {a.idade_max}
                  </dd>
                </div>
                {a.interesses.length > 0 && (
                  <div>
                    <dt className="inline text-muted-foreground">Interesses: </dt>
                    <dd className="inline">{a.interesses.join(", ")}</dd>
                  </div>
                )}
                {a.exclusoes.length > 0 && (
                  <div>
                    <dt className="inline text-muted-foreground">Excluir: </dt>
                    <dd className="inline">{a.exclusoes.join(", ")}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Cronograma">
          <ol className="space-y-4">
            {p.cronograma.map((x, i) => (
              <li key={i} className="grid grid-cols-[28px_1fr] gap-3">
                <span className="num grid size-7 place-items-center rounded bg-asfalto text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-medium">
                    {x.periodo} <span className="font-normal text-muted-foreground">· {x.foco}</span>
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                    {x.acoes.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Regras de otimização">
          <ul className="divide-y">
            {p.regras_otimizacao.map((r) => (
              <li key={r.quando} className="py-2.5">
                <p className="text-sm text-muted-foreground">Quando {r.quando.replace(/^quando\s+/i, "")}</p>
                <p className="font-medium">{r.acao}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Diagnóstico">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {p.diagnostico.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
        <Section title="Como a IA atende esses leads">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {p.integracao_atendimento.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
        <Section title="Antes de subir">
          <ul className="space-y-1.5 text-sm">
            {p.checklist_lancamento.map((x) => (
              <li key={x} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-verde" />
                {x}
              </li>
            ))}
          </ul>
          {p.riscos.length > 0 && (
            <>
              <p className="mt-4 text-sm font-medium text-sinal">Cuidados</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {p.riscos.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function CopyButton({ text, label = "Copiar texto" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check /> : <Copy />} {ok ? "Copiado" : label}
    </Button>
  );
}

function AdCard({ a }: { a: Ad }) {
  return (
    <article className="flex flex-col rounded-md border">
      <header className="flex items-start justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.nome}</p>
          <p className="text-xs text-muted-foreground">
            {FORMATO_LABEL[a.formato] ?? a.formato} · {a.produto_destaque}
          </p>
        </div>
        <CopyButton text={`${a.texto_principal}\n\nTítulo: ${a.titulo}\nBotão: ${a.chamada}`} />
      </header>
      <div className="grid flex-1 gap-3 p-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Gancho</p>
          <p className="text-base font-semibold">{a.gancho}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Texto do anúncio</p>
          <p className="whitespace-pre-line">{a.texto_principal}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <p>
            <span className="text-muted-foreground">Título: </span>
            {a.titulo}
          </p>
          <p>
            <span className="text-muted-foreground">Botão: </span>
            {a.chamada}
          </p>
        </div>
        <div className="rounded bg-muted p-3">
          <p className="text-xs text-muted-foreground">Como gravar ou montar</p>
          <p className="whitespace-pre-line">{a.roteiro_criativo}</p>
        </div>
        <div className="rounded border border-verde/30 bg-verde/5 p-3">
          <p className="text-xs text-verde">Mensagem que o cliente encontra no WhatsApp</p>
          <p>{a.mensagem_inicial_whatsapp}</p>
        </div>
      </div>
    </article>
  );
}

function Ads({ p }: { p: Plan }) {
  return (
    <div className="grid gap-5">
      {p.estrutura.map((e) => (
        <section key={e.nome} className="rounded-lg border bg-chapa">
          <header className="flex flex-wrap items-end justify-between gap-2 border-b px-5 py-4">
            <div>
              <h2 className="text-2xl font-semibold">{e.nome}</h2>
              <p className="text-sm text-muted-foreground">
                {CANAL_LABEL[e.plataforma] ?? e.plataforma} · {e.objetivo_plataforma} · otimizar para {e.otimizacao} · fase de {e.fase}
              </p>
            </div>
            <p className="num text-xl font-semibold">{money(e.orcamento_diario)}/dia</p>
          </header>
          <div className="divide-y">
            {e.conjuntos.map((cj) => (
              <div key={cj.nome} className="p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold">
                    {cj.nome} <span className="text-sm font-normal text-muted-foreground">· público {cj.publico} · {cj.posicionamentos}</span>
                  </h3>
                  <span className="num text-sm text-muted-foreground">{money(cj.orcamento_diario)}/dia</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {cj.anuncios.map((a) => (
                    <AdCard key={a.nome} a={a} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Results({ c, onChange }: { c: CampaignDetail; onChange: () => void }) {
  const m = c.metricas;
  const hoje = new Date().toLocaleDateString("sv-SE");
  const [f, setF] = useState({ data: hoje, investimento: "", impressoes: "", cliques: "", conversas: "" });
  const n = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  const add = useMutation({
    mutationFn: () => post(`/api/marketing/campanhas/${c.id}/resultados`, { data: f.data, investimento: n(f.investimento), impressoes: Math.round(n(f.impressoes)), cliques: Math.round(n(f.cliques)), conversas: Math.round(n(f.conversas)) }),
    onSuccess: () => {
      setF({ ...f, investimento: "", impressoes: "", cliques: "", conversas: "" });
      onChange();
      toast.success("Números do dia salvos.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rm = useMutation({ mutationFn: (d: string) => del(`/api/marketing/campanhas/${c.id}/resultados/${d}`), onSuccess: onChange });
  if (!m) return null;
  return (
    <div className="grid gap-4">
      <KpiBand k={m.kpis} metas={m.metas} />
      <FunnelStrip k={m.kpis} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Investimento e leads por dia">{m.serie.length ? <SpendChart serie={m.serie} /> : <p className="text-muted-foreground">Os números aparecem aqui assim que a campanha tiver investimento ou leads.</p>}</Section>
        <Section title="Lançar números do dia">
          <p className="mb-3 text-sm text-muted-foreground">Copie do Gerenciador de Anúncios. Com a conta de anúncios ligada, isso entra sozinho.</p>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="r-data">Dia</Label>
              <Input id="r-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-inv">Investido (R$)</Label>
              <Input id="r-inv" inputMode="decimal" value={f.investimento} onChange={(e) => setF({ ...f, investimento: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-imp">Impressões</Label>
              <Input id="r-imp" inputMode="numeric" value={f.impressoes} onChange={(e) => setF({ ...f, impressoes: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-cli">Cliques</Label>
              <Input id="r-cli" inputMode="numeric" value={f.cliques} onChange={(e) => setF({ ...f, cliques: e.target.value })} />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="r-conv">Conversas iniciadas (na Meta)</Label>
              <Input id="r-conv" inputMode="numeric" value={f.conversas} onChange={(e) => setF({ ...f, conversas: e.target.value })} />
            </div>
            <Button type="submit" className="col-span-2" disabled={!f.investimento || add.isPending}>
              Salvar dia
            </Button>
          </form>
        </Section>
      </div>
      {m.resultados.length > 0 && (
        <Section title="Dia a dia">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Dia</th>
                  <th className="py-2 text-right font-medium">Investido</th>
                  <th className="py-2 text-right font-medium">Impressões</th>
                  <th className="py-2 text-right font-medium">Cliques</th>
                  <th className="py-2 text-right font-medium">Conversas</th>
                  <th className="py-2 text-right font-medium">Leads</th>
                  <th className="py-2 text-right font-medium">Custo por lead</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...m.resultados].reverse().map((r) => {
                  const s = m.serie.find((x) => x.data === r.data);
                  return (
                    <tr key={r.data}>
                      <td className="py-2">
                        {fmtDate(r.data)} {r.origem === "meta" && <span className="ml-1 text-xs text-placa">Meta</span>}
                      </td>
                      <td className="num py-2 text-right">{money(r.investimento)}</td>
                      <td className="num py-2 text-right">{intf(r.impressoes)}</td>
                      <td className="num py-2 text-right">{intf(r.cliques)}</td>
                      <td className="num py-2 text-right">{intf(r.conversas)}</td>
                      <td className="num py-2 text-right">{intf(s?.leads ?? 0)}</td>
                      <td className="num py-2 text-right">{money(s?.cpl ?? null)}</td>
                      <td className="py-2 text-right">
                        <button className="text-xs text-muted-foreground hover:text-sinal" onClick={() => rm.mutate(r.data)} aria-label={`Apagar ${fmtDate(r.data)}`}>
                          apagar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function Leads({ c }: { c: CampaignDetail }) {
  if (!c.leads.length)
    return (
      <div className="rounded-lg border border-dashed bg-chapa p-8 text-center text-muted-foreground">
        Nenhum lead desta campanha ainda. Quem clicar no anúncio e chamar no WhatsApp aparece aqui, com a etapa do funil.
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border bg-chapa">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Cliente</th>
            <th className="px-3 py-2.5 font-medium">Anúncio</th>
            <th className="px-3 py-2.5 font-medium">Etapa</th>
            <th className="px-3 py-2.5 font-medium">Temperatura</th>
            <th className="px-4 py-2.5 text-right font-medium">Venda</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {c.leads.map((l) => (
            <tr key={l.id} className="hover:bg-muted/50">
              <td className="px-4 py-2.5">
                <Link to={`/conversas/${l.id}`} className="font-medium hover:underline">
                  {l.nome || l.nome_perfil || "Cliente"}
                </Link>
                <span className="block text-xs text-muted-foreground">{new Date(l.created_at).toLocaleDateString("pt-BR")}</span>
              </td>
              <td className="max-w-[260px] truncate px-3 py-2.5 text-muted-foreground">{l.ad_headline ?? "—"}</td>
              <td className="px-3 py-2.5">{STAGES.find((s) => s.id === l.stage)?.label ?? l.stage}</td>
              <td className="px-3 py-2.5">
                <Temperature t={l.temperatura as any} score={l.score} />
              </td>
              <td className="num px-4 py-2.5 text-right">{l.valor_venda ? money(l.valor_venda) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisTab({ c, onChange }: { c: CampaignDetail; onChange: () => void }) {
  const run = useMutation({ mutationFn: () => post(`/api/marketing/campanhas/${c.id}/analisar`), onSuccess: onChange, onError: (e: Error) => toast.error(e.message) });
  const a = c.analise;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-chapa p-5">
        <div>
          <p className="text-lg font-medium">Leitura dos resultados</p>
          <p className="text-sm text-muted-foreground">A IA olha o custo por lead, a qualificação, as vendas e o retorno, compara com as metas e diz o que mudar.</p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          <Sparkles className={cn(run.isPending && "animate-pulse")} /> {run.isPending ? "Analisando…" : a ? "Analisar de novo" : "Analisar agora"}
        </Button>
      </div>
      {a && (
        <>
          <section className="rounded-lg border bg-chapa p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("rounded px-2 py-0.5 text-sm font-semibold", NOTA_LABEL[a.nota]?.cls)}>{NOTA_LABEL[a.nota]?.t ?? a.nota}</span>
              <span className="text-sm text-muted-foreground">em {new Date(a.atualizado_em).toLocaleString("pt-BR")}</span>
            </div>
            <p className="mt-3 max-w-[80ch] text-lg">{a.resumo}</p>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="O que está funcionando">
              <ul className="list-disc space-y-1 pl-5">{a.pontos_fortes.length ? a.pontos_fortes.map((x) => <li key={x}>{x}</li>) : <li className="list-none text-muted-foreground">Nada a destacar ainda.</li>}</ul>
            </Section>
            <Section title="O que está travando">
              <ul className="list-disc space-y-1 pl-5">{a.problemas.length ? a.problemas.map((x) => <li key={x}>{x}</li>) : <li className="list-none text-muted-foreground">Nenhum problema relevante.</li>}</ul>
            </Section>
          </div>
          <Section title="Ações">
            <ul className="divide-y">
              {a.acoes.map((x) => (
                <li key={x.acao} className="flex gap-3 py-3">
                  <span className={cn("mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold", x.prioridade === "alta" ? "bg-sinal text-white" : x.prioridade === "media" ? "bg-faixa text-asfalto" : "bg-muted")}>
                    {x.prioridade === "media" ? "média" : x.prioridade}
                  </span>
                  <span>
                    <span className="font-medium">{x.acao}</span>
                    <span className="block text-sm text-muted-foreground">{x.motivo}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Próximas semanas: </span>
              {a.previsao}
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

function Linking({ c, onSave }: { c: CampaignDetail; onSave: (b: Record<string, unknown>) => void }) {
  const [ids, setIds] = useState(c.meta_campaign_ids.join(", "));
  const [palavras, setPalavras] = useState(c.palavras_anuncio.join(", "));
  const meta = useQuery({ queryKey: ["mkt-meta-campanhas"], queryFn: () => get<{ id: string; name: string; status: string }[]>("/api/marketing/meta/campanhas"), retry: false });
  const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Campanhas da Meta que fazem parte desta">
        <p className="mb-3 text-sm text-muted-foreground">Com os IDs, investimento e cliques entram sozinhos e cada lead fica ligado ao anúncio exato que clicou.</p>
        {meta.data?.length ? (
          <ul className="mb-3 max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {meta.data.map((m) => {
              const on = list(ids).includes(m.id);
              return (
                <li key={m.id}>
                  <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                    <input type="checkbox" checked={on} onChange={() => setIds((on ? list(ids).filter((x) => x !== m.id) : [...list(ids), m.id]).join(", "))} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.status === "ACTIVE" ? "ativa" : m.status.toLowerCase()}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">{meta.isError ? "Ligue a conta de anúncios (em Marketing) para escolher da lista, ou cole os IDs." : "Carregando…"}</p>
        )}
        <Label htmlFor="l-ids">IDs das campanhas na Meta</Label>
        <Textarea id="l-ids" rows={2} className="mt-1.5" value={ids} onChange={(e) => setIds(e.target.value)} placeholder="120200000000000001, 120200000000000002" />
      </Section>
      <Section title="Palavras do título do anúncio">
        <p className="mb-3 text-sm text-muted-foreground">Quando o cliente chega pelo anúncio, o WhatsApp manda o título dele. Se tiver uma destas palavras, o lead entra nesta campanha. Com uma campanha só no ar, todos os leads de anúncio entram nela.</p>
        <Input value={palavras} onChange={(e) => setPalavras(e.target.value)} placeholder="Corolla, Tracker, feirão" />
      </Section>
      <div className="lg:col-span-2">
        <Button onClick={() => onSave({ meta_campaign_ids: list(ids).filter((x) => /^\d+$/.test(x)), palavras_anuncio: list(palavras) })}>Salvar ligação</Button>
      </div>
    </div>
  );
}

function RedoDialog({ open, onOpenChange, id, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; id: number; onDone: () => void }) {
  const [obs, setObs] = useState("");
  const run = useMutation({
    mutationFn: () => post(`/api/marketing/campanhas/${id}/refazer`, { observacoes: obs }),
    onSuccess: () => {
      setObs("");
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refazer o plano</DialogTitle>
          <DialogDescription>A IA escreve um plano novo com o questionário e o estoque de hoje. Diga o que mudar.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: menos públicos, mais foco em remarketing, incluir a XRE 300" aria-label="O que mudar" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            <Sparkles /> Refazer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
