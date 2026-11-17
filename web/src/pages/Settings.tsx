import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Plus, Trash2, TriangleAlert } from "lucide-react";
import { del, get, post, put, type Me, type Seller, type Settings, type TemplateRef } from "@/lib/api";
import { brl, phone } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Path = (string | number)[];
function setIn<T>(obj: T, path: Path, value: unknown): T {
  const [k, ...rest] = path;
  const copy: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };
  copy[k] = rest.length ? setIn(copy[k] ?? {}, rest, value) : value;
  return copy;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Settings>("/api/config") });
  const [s, setS] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (cfg.data && !dirty) setS(cfg.data);
  }, [cfg.data, dirty]);

  const save = useMutation({
    mutationFn: () => put<Settings>("/api/config", s),
    onSuccess: (d) => {
      qc.setQueryData(["config"], d);
      qc.invalidateQueries({ queryKey: ["me"] });
      setDirty(false);
      toast.success("Configurações salvas. A IA já usa as novas regras na próxima mensagem.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!s) return <Skeleton className="h-96" />;
  const upd = (path: Path, v: unknown) => {
    setS((x) => (x ? setIn(x, path, v) : x));
    setDirty(true);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Configurações"
        description="O jeito que a IA atende, as regras de financiamento e quem recebe os leads."
        actions={
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className={cn(dirty && "bg-faixa text-asfalto hover:bg-faixa/85")}>
            {dirty ? "Salvar alterações" : "Tudo salvo"}
          </Button>
        }
      />
      <Tabs defaultValue="loja">
        <TabsList className="mb-5 h-auto flex-wrap justify-start">
          <TabsTrigger value="loja">Loja</TabsTrigger>
          <TabsTrigger value="atendimento">Atendimento</TabsTrigger>
          <TabsTrigger value="financiamento">Financiamento</TabsTrigger>
          <TabsTrigger value="agenda">Horários e agenda</TabsTrigger>
          <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
          <TabsTrigger value="followup">Retomadas e lembretes</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
        </TabsList>

        <TabsContent value="loja">
          <Card>
            <Grid>
              <Field label="Nome da loja" value={s.loja.nome} onChange={(v) => upd(["loja", "nome"], v)} />
              <Field label="Cidade" value={s.loja.cidade} onChange={(v) => upd(["loja", "cidade"], v)} />
              <Field className="sm:col-span-2" label="Endereço completo" value={s.loja.endereco} onChange={(v) => upd(["loja", "endereco"], v)} />
              <Field label="Ponto de referência" value={s.loja.referencia} onChange={(v) => upd(["loja", "referencia"], v)} />
              <Field label="Link do Google Maps" value={s.loja.maps_url} onChange={(v) => upd(["loja", "maps_url"], v)} />
              <Field label="Latitude" hint="Para mandar o pin da loja no WhatsApp" value={s.loja.lat ?? ""} onChange={(v) => upd(["loja", "lat"], v === "" ? null : Number(v.replace(",", ".")))} />
              <Field label="Longitude" value={s.loja.lng ?? ""} onChange={(v) => upd(["loja", "lng"], v === "" ? null : Number(v.replace(",", ".")))} />
              <Field label="Site" value={s.loja.site} onChange={(v) => upd(["loja", "site"], v)} />
              <Field label="Instagram" value={s.loja.instagram} onChange={(v) => upd(["loja", "instagram"], v)} />
            </Grid>
          </Card>
        </TabsContent>

        <TabsContent value="atendimento">
          <Card>
            <Grid>
              <Field label="Nome da assistente" hint="Como a IA se apresenta" value={s.atendimento.nome_assistente} onChange={(v) => upd(["atendimento", "nome_assistente"], v)} />
              <div className="grid gap-1.5">
                <Label>Como falar de preço</Label>
                <Select value={s.atendimento.politica_preco} onValueChange={(v) => upd(["atendimento", "politica_preco"], v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parcela_primeiro">Destacar entrada e parcela</SelectItem>
                    <SelectItem value="informar">Informar o preço cheio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Area className="sm:col-span-2" label="Tom de voz" value={s.atendimento.tom} onChange={(v) => upd(["atendimento", "tom"], v)} rows={3} />
              <Area className="sm:col-span-2" label="Diferenciais da loja (um por linha)" value={s.atendimento.diferenciais.join("\n")} onChange={(v) => upd(["atendimento", "diferenciais"], v.split("\n"))} rows={4} />
              <Area label="Garantia" value={s.atendimento.garantia} onChange={(v) => upd(["atendimento", "garantia"], v)} />
              <Area label="Documentação" value={s.atendimento.documentacao} onChange={(v) => upd(["atendimento", "documentacao"], v)} />
              <Area
                className="sm:col-span-2"
                label="Regras específicas desta loja"
                hint="Escreva como se estivesse orientando um vendedor novo. Ex.: não falar de valor de avaliação, sempre oferecer garantia estendida."
                value={s.atendimento.regras_extras}
                onChange={(v) => upd(["atendimento", "regras_extras"], v)}
                rows={5}
              />
            </Grid>
            <div className="mt-5 space-y-3">
              <Toggle label="Aceita carro na troca" checked={s.atendimento.aceita_troca} onChange={(v) => upd(["atendimento", "aceita_troca"], v)} />
              <Toggle label="Trabalha com financiamento" checked={s.atendimento.aceita_financiamento} onChange={(v) => upd(["atendimento", "aceita_financiamento"], v)} />
              <Toggle
                label="Responder fora do horário da loja"
                hint="A IA atende e agenda; avisa que o vendedor responde quando a loja abrir."
                checked={s.atendimento.responder_fora_do_horario}
                onChange={(v) => upd(["atendimento", "responder_fora_do_horario"], v)}
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="financiamento">
          <Card>
            <div className="grid gap-1.5">
              <Label>Como calcular a parcela</Label>
              <Select value={s.financiamento.modo} onValueChange={(v) => upd(["financiamento", "modo"], v)}>
                <SelectTrigger className="w-full sm:w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regra_loja">Regra prática da loja</SelectItem>
                  <SelectItem value="tabela_price">Tabela Price com taxa de referência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {s.financiamento.modo === "regra_loja" ? (
              <div className="mt-5">
                <p className="text-[15px]">
                  A cada{" "}
                  <InlineNum value={s.financiamento.regra_loja.a_cada} onChange={(v) => upd(["financiamento", "regra_loja", "a_cada"], v)} /> financiados, a parcela é de{" "}
                  <InlineNum value={s.financiamento.regra_loja.parcela} onChange={(v) => upd(["financiamento", "regra_loja", "parcela"], v)} /> em{" "}
                  <InlineNum value={s.financiamento.regra_loja.prazo} onChange={(v) => upd(["financiamento", "regra_loja", "prazo"], v)} suffix="x" />.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Exemplo: carro de {brl(100000)} com {brl(20000)} de entrada fica em {brl(Math.round((80000 / (s.financiamento.regra_loja.a_cada || 1)) * s.financiamento.regra_loja.parcela))} por mês.
                </p>
              </div>
            ) : (
              <Grid className="mt-5">
                <Field label="Taxa de referência (% ao mês)" value={s.financiamento.taxa_mensal_pct} onChange={(v) => upd(["financiamento", "taxa_mensal_pct"], Number(v.replace(",", ".")) || 0)} />
                <Field
                  label="Prazos oferecidos (meses)"
                  value={s.financiamento.prazos.join(", ")}
                  onChange={(v) => upd(["financiamento", "prazos"], v.split(/[,\s]+/).map(Number).filter((n) => n > 0))}
                />
              </Grid>
            )}
            <Grid className="mt-5">
              <Field label="Entrada mínima (% do valor)" value={s.financiamento.entrada_minima_pct} onChange={(v) => upd(["financiamento", "entrada_minima_pct"], Number(v) || 0)} />
              <Field label="Aviso que acompanha toda simulação" value={s.financiamento.observacao} onChange={(v) => upd(["financiamento", "observacao"], v)} />
            </Grid>
          </Card>
        </TabsContent>

        <TabsContent value="agenda">
          <Card>
            <h3 className="text-xl font-semibold">Horário de funcionamento</h3>
            <ul className="mt-3 divide-y rounded-md border">
              {DIAS.map((d, i) => {
                const h = s.horarios[i];
                return (
                  <li key={d} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="w-24 font-medium">{d}</span>
                    <Switch checked={!!h} onCheckedChange={(on) => upd(["horarios", i], on ? { abre: "09:00", fecha: "18:00" } : null)} aria-label={`Abre ${d}`} />
                    {h ? (
                      <span className="flex items-center gap-2">
                        <Input type="time" value={h.abre} onChange={(e) => upd(["horarios", i, "abre"], e.target.value)} className="w-28" aria-label={`Abre às, ${d}`} />
                        até
                        <Input type="time" value={h.fecha} onChange={(e) => upd(["horarios", i, "fecha"], e.target.value)} className="w-28" aria-label={`Fecha às, ${d}`} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Fechado</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <Grid className="mt-5">
              <Field label="Duração de cada visita (min)" value={s.agenda.duracao_min} onChange={(v) => upd(["agenda", "duracao_min"], Number(v) || 60)} />
              <Field label="Visitas no mesmo horário" value={s.agenda.max_por_horario} onChange={(v) => upd(["agenda", "max_por_horario"], Number(v) || 1)} />
              <Field label="Antecedência mínima (horas)" value={s.agenda.antecedencia_min_horas} onChange={(v) => upd(["agenda", "antecedencia_min_horas"], Number(v) || 0)} />
              <Field label="Agenda aberta para quantos dias" value={s.agenda.dias_a_frente} onChange={(v) => upd(["agenda", "dias_a_frente"], Number(v) || 7)} />
            </Grid>
          </Card>
        </TabsContent>

        <TabsContent value="vendedores">
          <Sellers />
          <Card className="mt-5">
            <h3 className="text-xl font-semibold">Quando a IA passa o cliente</h3>
            <div className="mt-3 space-y-3">
              <Toggle label="Avisar o vendedor no WhatsApp" hint="Ele recebe o resumo do cliente e o link da conversa." checked={s.handoff.notificar_vendedor} onChange={(v) => upd(["handoff", "notificar_vendedor"], v)} />
            </div>
            <Grid className="mt-4">
              <Field label="A IA fica pausada por (horas)" value={s.handoff.pausar_ia_horas} onChange={(v) => upd(["handoff", "pausar_ia_horas"], Number(v) || 1)} />
              <TemplateField
                label="Modelo aprovado para avisar o vendedor"
                hint="Opcional. Sem modelo, o aviso só chega se o vendedor falou com o número da loja nas últimas 24h. Variáveis: nome, telefone, motivo, resumo."
                value={s.handoff.template_notificacao}
                onChange={(v) => upd(["handoff", "template_notificacao"], v)}
              />
            </Grid>
          </Card>
        </TabsContent>

        <TabsContent value="followup">
          <Card>
            <Toggle
              label="Retomar clientes que pararam de responder"
              hint="A IA manda uma mensagem curta e diferente das anteriores. Nunca entre 21h e 8h, e nunca para quem pediu para parar."
              checked={s.followup.ativo}
              onChange={(v) => upd(["followup", "ativo"], v)}
            />
            <Grid className="mt-4">
              <Field
                label="Depois de quantas horas sem resposta"
                hint="Separe por vírgula. Ex.: 2, 20 (dois toques dentro das 24h do WhatsApp)"
                value={s.followup.horas.join(", ")}
                onChange={(v) => upd(["followup", "horas"], v.split(/[,\s]+/).map(Number).filter((n) => n > 0))}
              />
              <Field label="Lembrete de visita (horas antes)" value={s.followup.lembrete_horas_antes} onChange={(v) => upd(["followup", "lembrete_horas_antes"], Number(v) || 3)} />
              <TemplateField
                label="Modelo para retomar depois de 24h"
                hint="Variáveis: primeiro nome, carro de interesse."
                value={s.followup.template_reengajamento}
                onChange={(v) => upd(["followup", "template_reengajamento"], v)}
              />
              <TemplateField
                label="Modelo de lembrete de visita"
                hint="Usado quando o cliente não fala com a loja há mais de 24h. Variáveis: primeiro nome, dia e hora."
                value={s.followup.template_lembrete_visita}
                onChange={(v) => upd(["followup", "template_lembrete_visita"], v)}
              />
            </Grid>
          </Card>
        </TabsContent>

        <TabsContent value="integracoes">
          <Integrations conversoes={s.conversoes} onChange={(k, v) => upd(["conversoes", k], v)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border bg-chapa p-5", className)}>{children}</section>;
}
function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
}
function Field({ label, hint, value, onChange, className }: { label: string; hint?: string; value: string | number; onChange: (v: string) => void; className?: string }) {
  const id = `f-${label.replace(/\W+/g, "-")}`;
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Area({ label, hint, value, onChange, rows = 2, className }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; className?: string }) {
  const id = `a-${label.replace(/\W+/g, "-")}`;
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = `t-${label.replace(/\W+/g, "-")}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id} className="text-[15px]">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
function InlineNum({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input className="num inline-block h-8 w-24 text-base" inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
      {suffix}
    </span>
  );
}
function TemplateField({ label, hint, value, onChange }: { label: string; hint?: string; value: TemplateRef | null; onChange: (v: TemplateRef | null) => void }) {
  return (
    <div className="grid content-start gap-1.5 sm:col-span-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input placeholder="nome_do_modelo" value={value?.nome ?? ""} onChange={(e) => onChange(e.target.value ? { nome: e.target.value, idioma: value?.idioma ?? "pt_BR" } : null)} aria-label={`${label}: nome`} />
        <Input className="w-28" placeholder="pt_BR" value={value?.idioma ?? ""} onChange={(e) => value && onChange({ ...value, idioma: e.target.value })} aria-label={`${label}: idioma`} disabled={!value} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Sellers() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["vendedores"], queryFn: () => get<Seller[]>("/api/vendedores") });
  const [nome, setNome] = useState("");
  const [zap, setZap] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["vendedores"] });
  const add = useMutation({ mutationFn: () => post("/api/vendedores", { nome, whatsapp: zap }), onSuccess: () => (setNome(""), setZap(""), refresh()), onError: (e: Error) => toast.error(e.message) });
  const upd = useMutation({ mutationFn: (s: Partial<Seller> & { id: number }) => put(`/api/vendedores/${s.id}`, s), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/vendedores/${id}`), onSuccess: refresh });

  return (
    <Card>
      <h3 className="text-xl font-semibold">Vendedores</h3>
      <p className="mt-1 text-sm text-muted-foreground">Os leads são distribuídos em rodízio entre os vendedores ativos: quem recebeu menos recebe o próximo.</p>
      <ul className="mt-3 divide-y rounded-md border">
        {(list.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.nome}</span>
              <span className={cn("block text-sm", s.whatsapp ? "text-muted-foreground" : "text-sinal")}>{s.whatsapp ? phone(s.whatsapp) : "Falta o WhatsApp"}</span>
            </span>
            <span className="text-sm text-muted-foreground">
              <span className="num text-base text-asfalto">{s.leads_recebidos}</span> leads
            </span>
            <Switch checked={s.ativo} onCheckedChange={(ativo) => upd.mutate({ id: s.id, ativo })} aria-label={`${s.nome} recebe leads`} disabled={!s.whatsapp && !s.ativo} />
            {!s.whatsapp && (
              <Input
                placeholder="5521999998888"
                className="w-40"
                onBlur={(e) => e.target.value && upd.mutate({ id: s.id, whatsapp: e.target.value.replace(/\D/g, ""), ativo: true })}
                aria-label={`WhatsApp de ${s.nome}`}
              />
            )}
            <Button variant="ghost" size="icon-sm" onClick={() => confirm(`Remover ${s.nome}?`) && remove.mutate(s.id)} aria-label={`Remover ${s.nome}`}>
              <Trash2 />
            </Button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum vendedor cadastrado. Sem vendedor, a IA pausa e o lead fica esperando no painel.</li>}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} className="w-44" aria-label="Nome do vendedor" />
        <Input placeholder="WhatsApp com DDD (5521…)" value={zap} onChange={(e) => setZap(e.target.value)} className="w-56" aria-label="WhatsApp do vendedor" />
        <Button type="submit" variant="outline" disabled={!nome || zap.replace(/\D/g, "").length < 10}>
          <Plus /> Adicionar vendedor
        </Button>
      </form>
    </Card>
  );
}

function Integrations({ conversoes, onChange }: { conversoes: Settings["conversoes"]; onChange: (k: keyof Settings["conversoes"], v: unknown) => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me") });
  const m = me.data;
  if (!m) return <Skeleton className="h-60" />;
  const items = [
    { ok: m.whatsapp_configurado, t: "WhatsApp Cloud API", d: m.whatsapp_configurado ? "Número conectado. As mensagens chegam e saem pela API oficial." : "Preencha WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN e WA_APP_SECRET no arquivo .env do servidor." },
    { ok: m.ia.provedor === "anthropic", t: "Inteligência artificial", d: m.ia.provedor === "anthropic" ? `Claude (${m.ia.modelo}), esforço ${m.ia.esforco}.` : "Modo de teste. Coloque ANTHROPIC_API_KEY no .env para ligar o Claude." },
    { ok: m.transcricao, t: "Transcrição de áudio", d: m.transcricao ? "Áudios dos clientes são transcritos e a IA responde normalmente." : "Opcional. Sem ela, a IA pede com educação para o cliente escrever. Configure OPENAI_API_KEY para ativar." },
    { ok: m.conversoes_configuradas, t: "Conversões para os anúncios (Meta)", d: m.conversoes_configuradas ? "Leads, visitas e vendas de quem veio por anúncio voltam para a Meta." : "Preencha META_DATASET_ID e WA_WABA_ID no .env para a campanha otimizar por lead e venda, não só por conversa." },
  ];
  return (
    <div className="space-y-5">
      {m.senha_padrao && (
        <p className="flex items-center gap-2 rounded-md border border-sinal/40 bg-sinal/5 px-4 py-3 text-sm">
          <TriangleAlert className="size-4 text-sinal" /> A senha do painel ainda é a padrão. Defina ADMIN_PASSWORD no .env antes de colocar no ar.
        </p>
      )}
      <Card>
        <h3 className="text-xl font-semibold">Endereço do webhook</h3>
        <p className="mt-1 text-sm text-muted-foreground">Cole no app da Meta, em WhatsApp, Configuração, Webhook. Assine o campo “messages”.</p>
        <CopyLine value={m.webhook_url} />
      </Card>
      <Card>
        <ul className="space-y-4">
          {items.map((i) => (
            <li key={i.t} className="flex gap-3">
              <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", i.ok ? "bg-verde text-white" : "border-2 border-faixa")}>{i.ok && <Check className="size-4" />}</span>
              <span>
                <span className="block font-medium">{i.t}</span>
                <span className="block text-sm text-muted-foreground">{i.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <Toggle label="Enviar conversões para a Meta" hint="Só para clientes que chegaram por anúncio de clique para o WhatsApp." checked={conversoes.ativo} onChange={(v) => onChange("ativo", v)} />
        <Grid className="mt-4">
          <Field label="Evento quando o lead mostra interesse real" value={conversoes.evento_lead} onChange={(v) => onChange("evento_lead", v)} />
          <Field label="Evento quando agenda visita ou vai para o vendedor" value={conversoes.evento_qualificado} onChange={(v) => onChange("evento_qualificado", v)} />
          <Field label="Evento de venda" value={conversoes.evento_venda} onChange={(v) => onChange("evento_venda", v)} />
        </Grid>
        <p className="mt-3 text-xs text-muted-foreground">A Meta aceita LeadSubmitted, QualifiedLead e Purchase para conversas do WhatsApp. Nomes como Lead ou Schedule são recusados.</p>
      </Card>
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-sm">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        }}
      >
        {ok ? <Check /> : <Copy />} {ok ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}
