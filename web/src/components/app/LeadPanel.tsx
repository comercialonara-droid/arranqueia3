import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Sparkles, Trash2, X } from "lucide-react";
import { del, get, intentLabel, patch, post, SIM_STATUSES, STAGES, type Conversation, type LeadStage, type Simulation, type User } from "@/lib/api";
import { ago, brl, dayLabel, km, pagamentoLabel, phone, time, tipoVisitaLabel, urgenciaLabel, vehicleTitle, vehicleYear } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Temperature } from "./Temperature";
import { useMe } from "./Shell";
import { cn } from "@/lib/utils";

const capiLabel: Record<string, string> = { enviado: "enviado à Meta", organico: "orgânico", nao_configurado: "Meta não configurada", desativado: "envio desligado", erro: "erro no envio" };
const eventLabel: Record<string, string> = { "capi:lead": "Lead com interesse", "capi:qualificado": "Lead qualificado", "capi:venda": "Venda" };

export function LeadPanel({ data }: { data: Conversation }) {
  const qc = useQueryClient();
  const me = useMe();
  const { contato, lead } = data;
  const isSeller = me?.usuario.role === "vendedor";
  const team = useQuery({ queryKey: ["equipe"], queryFn: () => get<User[]>("/api/equipe") });
  const [vendaOpen, setVendaOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversa", contato.id] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const updateLead = useMutation({ mutationFn: (body: Record<string, unknown>) => patch(`/api/leads/${contato.id}`, body), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const updateContact = useMutation({ mutationFn: (body: Record<string, unknown>) => patch(`/api/conversas/${contato.id}`, body), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const analyze = useMutation({ mutationFn: () => post(`/api/conversas/${contato.id}/analisar`), onSuccess: () => (refresh(), toast.success("Análise atualizada.")), onError: (e: Error) => toast.error(e.message) });

  const sim = data.simulacoes[0];
  const a = lead.analise;
  const sd = lead.score_detalhe;
  const capi = data.eventos.filter((e) => e.name.startsWith("capi:"));
  const sellers = (team.data ?? []).filter((u) => u.ativo && (u.role === "vendedor" || u.role === "dono"));

  return (
    <div className="space-y-6 p-5">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{phone(contato.wa_id)}</p>
            {contato.ad_headline ? <p className="mt-1 text-sm">Veio do anúncio “{contato.ad_headline}”</p> : contato.origem && <p className="mt-1 text-sm text-muted-foreground">Origem: {contato.origem === "organico" ? "orgânico" : contato.origem}</p>}
          </div>
          <Temperature t={lead.temperatura} score={lead.score} />
        </div>
        <p className="mt-2 text-[15px] font-medium">{intentLabel[lead.intencao] ?? lead.intencao}</p>
        <Tags tags={contato.tags} onChange={(tags) => updateContact.mutate({ tags })} />
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label>Etapa do funil</Label>
            <Select value={lead.stage} onValueChange={(v) => (v === "vendido" ? setVendaOpen(true) : updateLead.mutate({ stage: v as LeadStage }))}>
              <SelectTrigger className="w-full bg-chapa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Vendedor responsável</Label>
            <Select value={contato.seller_id ? String(contato.seller_id) : "nenhum"} onValueChange={(v) => updateContact.mutate({ seller_id: v === "nenhum" ? null : Number(v) })}>
              <SelectTrigger className="w-full bg-chapa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!isSeller && <SelectItem value="nenhum">Ninguém ainda</SelectItem>}
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-chapa p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Leitura da IA</h3>
          <Button variant="ghost" size="sm" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
            <Sparkles /> {analyze.isPending ? "Analisando…" : "Analisar agora"}
          </Button>
        </div>
        {a?.resumo ? (
          <div className="mt-2 space-y-2.5 text-[15px]">
            <p>{a.resumo}</p>
            {a.proxima_acao && (
              <p className="rounded-md bg-accent px-3 py-2">
                <span className="font-medium">Próximo passo: </span>
                {a.proxima_acao}
              </p>
            )}
            {a.objecoes?.length > 0 && <p className="text-sm"><span className="text-muted-foreground">Travas: </span>{a.objecoes.join("; ")}</p>}
            {a.sinais_de_compra?.length > 0 && <p className="text-sm"><span className="text-muted-foreground">Sinais de compra: </span>{a.sinais_de_compra.join("; ")}</p>}
            {a.perfil && <p className="text-sm"><span className="text-muted-foreground">Perfil: </span>{a.perfil}</p>}
            <p className="text-xs text-muted-foreground">Atualizada {ago(a.atualizado_em)}</p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">A IA escreve aqui o resumo e o próximo passo conforme conversa. Toque em Analisar agora para ler a conversa inteira.</p>
        )}
        {sd && (
          <div className="mt-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ["Intenção", sd.intencao, 35],
                  ["Capacidade", sd.capacidade, 30],
                  ["Momento", sd.momento, 20],
                  ["Engajamento", sd.engajamento, 15],
                ] as const
              ).map(([l, v, max]) => (
                <div key={l}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-asfalto" style={{ width: `${(v / max) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{l}</p>
                  <p className="num text-sm">
                    {v}/{max}
                  </p>
                </div>
              ))}
            </div>
            {sd.motivos.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{sd.motivos.join(", ")}</p>}
          </div>
        )}
      </section>

      {sim && <SimulationCard sim={sim} onChange={refresh} />}

      <section>
        <h3 className="text-lg font-semibold">O que ele procura</h3>
        {data.interesse.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {data.interesse.map((v) => (
              <li key={v.id} className="flex gap-3 rounded-md border bg-chapa p-2">
                {v.fotos[0] ? <img src={v.fotos[0].url} alt="" className="size-14 rounded object-cover" /> : <div className="size-14 rounded bg-muted" />}
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{vehicleTitle(v)}</p>
                  <p className="text-muted-foreground">
                    {vehicleYear(v)}, {km(v.km)}
                  </p>
                  <p className="num text-base">{v.preco_promocional ?? v.preco ? brl(v.preco_promocional ?? v.preco) : "Preço sob consulta"}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{lead.interesse_texto ?? "Ainda não falou de um modelo específico."}</p>
        )}
      </section>

      <section>
        <h3 className="text-lg font-semibold">Ficha</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Field k="Pagamento" v={lead.forma_pagamento ? pagamentoLabel[lead.forma_pagamento] ?? lead.forma_pagamento : null} />
          <Field k="Entrada" v={lead.entrada ? brl(lead.entrada) : null} />
          <Field k="Troca" v={lead.tem_troca ? [lead.troca?.marca, lead.troca?.modelo, lead.troca?.ano, lead.troca?.km ? km(lead.troca.km) : null].filter(Boolean).join(" ") || "Sim" : lead.tem_troca === false ? "Não" : null} />
          {lead.tem_troca && <Field k="Quitado" v={lead.troca?.quitado == null ? null : lead.troca.quitado ? "Sim" : "Não"} />}
          <Field k="Quando compra" v={lead.urgencia ? urgenciaLabel[lead.urgencia] : null} />
          <Field k="Uso" v={lead.uso} />
          <Field k="Região" v={[lead.bairro, lead.cidade].filter(Boolean).join(", ") || null} />
          {lead.observacoes && <Field k="Anotações da IA" v={lead.observacoes} />}
        </dl>
      </section>

      <Notes data={data} onChange={refresh} />

      {data.visitas.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold">Visitas</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.visitas.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span>
                  {tipoVisitaLabel[v.tipo]}, {dayLabel(v.inicio).toLowerCase()} às {time(v.inicio)}
                </span>
                <span className="text-muted-foreground">{v.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {capi.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold">Retorno para os anúncios</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {capi.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{eventLabel[e.name] ?? e.name}</span>
                <span className={e.capi_status === "enviado" ? "text-verde" : "text-muted-foreground"}>{capiLabel[e.capi_status ?? ""] ?? "pendente"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SaleDialog
        open={vendaOpen}
        onOpenChange={setVendaOpen}
        vehicles={data.interesse}
        onConfirm={(valor, vehicleId) => {
          updateLead.mutate({ stage: "vendido", valor_venda: valor, vehicle_sold_id: vehicleId }, { onSuccess: () => toast.success("Venda registrada.") });
          setVendaOpen(false);
        }}
      />
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={v ? "" : "text-muted-foreground/70"}>{v || "não informado"}</dd>
    </>
  );
}

function Tags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full border bg-chapa px-2 py-0.5 text-xs">
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remover etiqueta ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) onChange([...tags, v.trim()]);
          setV("");
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ etiqueta" className="w-24 rounded-full border border-dashed bg-transparent px-2 py-0.5 text-xs outline-none focus:border-asfalto" aria-label="Nova etiqueta" />
      </form>
    </div>
  );
}

function SimulationCard({ sim, onChange }: { sim: Simulation; onChange: () => void }) {
  const [cpf, setCpf] = useState<string | null>(null);
  const reveal = useMutation({ mutationFn: () => post<{ cpf: string }>(`/api/simulacoes/${sim.id}/revelar-cpf`), onSuccess: (r) => setCpf(r.cpf) });
  const upd = useMutation({ mutationFn: (b: Record<string, unknown>) => patch(`/api/simulacoes/${sim.id}`, b), onSuccess: onChange, onError: (e: Error) => toast.error(e.message) });
  return (
    <section className={cn("rounded-lg border p-4", sim.status === "enviada" ? "border-faixa bg-accent/50" : "bg-chapa")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="whitespace-nowrap text-lg font-semibold">Simulação</h3>
        <Select value={sim.status} onValueChange={(v) => upd.mutate({ status: v })}>
          <SelectTrigger size="sm" className="w-[160px] bg-chapa" aria-label="Situação da simulação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIM_STATUSES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Field k="Nome completo" v={sim.nome_completo} />
        <dt className="text-muted-foreground">CPF</dt>
        <dd className="flex items-center gap-2">
          <span className="num text-base">{cpf ?? sim.cpf ?? "não informado"}</span>
          {sim.tem_cpf && !cpf && (
            <button onClick={() => reveal.mutate()} className="inline-flex items-center gap-1 text-xs text-placa underline">
              <Eye className="size-3" /> mostrar
            </button>
          )}
        </dd>
        <Field k="Nascimento" v={sim.data_nascimento ? sim.data_nascimento.split("-").reverse().join("/") : null} />
        <Field k="CNH" v={sim.tem_cnh == null ? null : sim.tem_cnh ? "Tem" : "Não tem"} />
        <Field k="Pagamento" v={sim.forma_pagamento ? pagamentoLabel[sim.forma_pagamento] ?? sim.forma_pagamento : null} />
        <Field k="Entrada" v={sim.entrada_dinheiro ? brl(sim.entrada_dinheiro) : null} />
        {sim.enviada_em && <Field k="Enviada" v={ago(sim.enviada_em)} />}
      </dl>
      <Textarea
        className="mt-3 bg-chapa text-sm"
        rows={2}
        defaultValue={sim.resultado ?? ""}
        placeholder="Resultado da análise (banco, taxa, entrada mínima…)"
        onBlur={(e) => e.target.value !== (sim.resultado ?? "") && upd.mutate({ resultado: e.target.value })}
        aria-label="Resultado da simulação"
      />
      {sim.consentimento_em && <p className="mt-2 text-xs text-muted-foreground">O cliente autorizou o uso dos dados para a análise. Ver o CPF completo fica registrado.</p>}
    </section>
  );
}

function Notes({ data, onChange }: { data: Conversation; onChange: () => void }) {
  const [texto, setTexto] = useState("");
  const add = useMutation({ mutationFn: () => post(`/api/conversas/${data.contato.id}/notas`, { texto }), onSuccess: () => (setTexto(""), onChange()) });
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/conversas/${data.contato.id}/notas/${id}`), onSuccess: onChange });
  return (
    <section>
      <h3 className="text-lg font-semibold">Notas internas</h3>
      <p className="text-xs text-muted-foreground">Só a equipe vê. A IA não lê.</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) add.mutate();
        }}
      >
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: ligou, vem sábado com a esposa" className="bg-chapa" aria-label="Nova nota" />
        <Button type="submit" variant="outline" disabled={!texto.trim()}>
          Anotar
        </Button>
      </form>
      <ul className="mt-2 space-y-2">
        {data.notas.map((n) => (
          <li key={n.id} className="group rounded-md border bg-chapa px-3 py-2 text-sm">
            <p className="whitespace-pre-wrap">{n.texto}</p>
            <p className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              {n.autor}, {ago(n.created_at)}
              <button className="opacity-0 group-hover:opacity-100" onClick={() => remove.mutate(n.id)} aria-label="Apagar nota">
                <Trash2 className="size-3.5" />
              </button>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SaleDialog({ open, onOpenChange, vehicles, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; vehicles: Conversation["interesse"]; onConfirm: (valor: number | null, vehicleId: string | null) => void }) {
  const [valor, setValor] = useState("");
  const [veiculo, setVeiculo] = useState<string>(vehicles[0]?.id ?? "nenhum");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>O item sai do estoque e, se o cliente veio de anúncio, a Meta recebe a compra para otimizar a campanha.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>O que foi vendido</Label>
            <Select value={veiculo} onValueChange={setVeiculo}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {vehicleTitle(v)} {vehicleYear(v)}
                  </SelectItem>
                ))}
                <SelectItem value="nenhum">Outro / não listado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="valor">Valor da venda (R$)</Label>
            <Input id="valor" inputMode="decimal" placeholder="Ex.: 115900" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(valor ? Number(valor.replace(/\./g, "").replace(",", ".")) : null, veiculo === "nenhum" ? null : veiculo)}>Registrar venda</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
