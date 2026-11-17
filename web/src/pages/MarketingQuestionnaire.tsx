import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { get, put } from "@/lib/api";
import { PageHeader } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Question, Questionnaire } from "@/lib/marketing";

export default function MarketingQuestionnaire() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mkt-questionario"], queryFn: () => get<Questionnaire>("/api/marketing/questionario") });
  const [r, setR] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) setR(q.data.respostas);
  }, [q.data, dirty]);
  const save = useMutation({
    mutationFn: () => put<Questionnaire>("/api/marketing/questionario", { respostas: r }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["mkt-questionario"] });
      toast.success("Questionário salvo. A IA usa estas respostas nas próximas campanhas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (id: string, v: unknown) => {
    setR((x) => ({ ...x, [id]: v }));
    setDirty(true);
  };
  if (!q.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  const pct = q.data.preenchimento.pct;

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <Link to="/marketing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-asfalto">
        <ArrowLeft className="size-4" /> Marketing
      </Link>
      <PageHeader title="Questionário da loja" description="O diagnóstico que a IA estrategista lê antes de montar qualquer campanha. As perguntas marcadas com • são as que mais pesam." />
      <div className="mb-6 rounded-lg border bg-chapa p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{pct}% das respostas essenciais</span>
          {q.data.atualizado_em && <span className="text-sm text-muted-foreground">salvo por {q.data.atualizado_por} em {new Date(q.data.atualizado_em).toLocaleDateString("pt-BR")}</span>}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="lane-dash h-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-6"
      >
        {q.data.secoes.map((s) => (
          <fieldset key={s.id} className="rounded-lg border bg-chapa p-5">
            <legend className="sr-only">{s.titulo}</legend>
            <h2 className="text-2xl font-semibold">{s.titulo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.descricao}</p>
            <div className="mt-5 grid gap-5">
              {s.perguntas.map((p) => (
                <Field key={p.id} q={p} value={r[p.id]} onChange={(v) => set(p.id, v)} produtos={q.data!.produtos} />
              ))}
            </div>
          </fieldset>
        ))}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-chapa/95 px-4 py-3 backdrop-blur md:left-[236px]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className={cn("text-sm", dirty ? "text-asfalto" : "text-muted-foreground")}>{dirty ? "Alterações não salvas" : "Tudo salvo"}</span>
            <Button type="submit" disabled={!dirty || save.isPending}>
              Salvar respostas
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ q, value, onChange, produtos }: { q: Question; value: unknown; onChange: (v: unknown) => void; produtos: { id: string; titulo: string }[] }) {
  const id = `q-${q.id}`;
  const label = (
    <Label htmlFor={id} className="text-[15px]">
      {q.rotulo}
      {q.essencial && <span className="ml-1 text-faixa" aria-label="essencial">•</span>}
    </Label>
  );
  const help = q.ajuda && <p className="text-xs text-muted-foreground">{q.ajuda}</p>;
  const arr = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (x: string) => onChange(arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

  if (q.tipo === "texto_longo")
    return (
      <div className="grid gap-1.5">
        {label}
        <Textarea id={id} rows={3} placeholder={q.exemplo} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        {help}
      </div>
    );
  if (q.tipo === "opcao")
    return (
      <div className="grid gap-1.5">
        {label}
        <Select value={(value as string) ?? ""} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full sm:w-80">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {q.opcoes!.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {help}
      </div>
    );
  if (q.tipo === "multipla" || q.tipo === "produtos") {
    const opts = q.tipo === "produtos" ? produtos.map((p) => ({ id: p.id, rotulo: p.titulo })) : q.opcoes!;
    return (
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[15px] font-medium">
          {q.rotulo}
          {q.essencial && <span className="ml-1 text-faixa">•</span>}
        </legend>
        <div className={cn("grid gap-1.5 sm:grid-cols-2", q.tipo === "produtos" && "max-h-56 overflow-y-auto rounded-md border p-2")}>
          {opts.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
              <Checkbox checked={arr.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
              <span className="truncate">{o.rotulo}</span>
            </label>
          ))}
          {!opts.length && <p className="text-sm text-muted-foreground">Cadastre o estoque para escolher.</p>}
        </div>
        {help}
      </fieldset>
    );
  }
  if (q.tipo === "sim_nao")
    return (
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[15px] font-medium">
          {q.rotulo}
          {q.essencial && <span className="ml-1 text-faixa">•</span>}
        </legend>
        <div className="flex gap-2">
          {[
            [true, "Sim"],
            [false, "Não"],
          ].map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={cn("rounded-full border px-4 py-1 text-sm", value === v ? "border-asfalto bg-asfalto text-white" : "hover:bg-muted")}
            >
              {l as string}
            </button>
          ))}
        </div>
        {help}
      </fieldset>
    );
  const numeric = ["numero", "dinheiro", "percentual"].includes(q.tipo);
  return (
    <div className="grid gap-1.5">
      {label}
      <div className="flex items-center gap-2">
        {q.tipo === "dinheiro" && <span className="text-muted-foreground">R$</span>}
        <Input
          id={id}
          inputMode={numeric ? "decimal" : undefined}
          className={cn(numeric && "w-40")}
          placeholder={q.exemplo}
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const t = e.target.value;
            if (!numeric) return onChange(t);
            const n = Number(t.replace(/\./g, "").replace(",", "."));
            onChange(t === "" ? null : Number.isFinite(n) ? n : t);
          }}
        />
        {q.tipo === "percentual" && <span className="text-muted-foreground">%</span>}
      </div>
      {help}
    </div>
  );
}
