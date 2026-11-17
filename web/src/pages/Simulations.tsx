import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { get, patch, SIM_STATUSES, type Simulation, type SimStatus } from "@/lib/api";
import { ago, brl, pagamentoLabel, phone } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ORDER: SimStatus[] = ["enviada", "em_analise", "aprovada", "coletando", "reprovada", "desistiu"];

export default function Simulations() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["simulacoes"], queryFn: () => get<Simulation[]>("/api/simulacoes") });
  const [filtro, setFiltro] = useState<SimStatus | "todas">("enviada");
  const upd = useMutation({
    mutationFn: ({ id, status }: { id: number; status: SimStatus }) => patch(`/api/simulacoes/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["simulacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: list.data?.length ?? 0 };
    for (const s of list.data ?? []) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [list.data]);
  const items = (list.data ?? []).filter((s) => filtro === "todas" || s.status === filtro);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Simulações"
        description="Fichas que a IA coletou no WhatsApp. As novas estão prontas para rodar no banco: abra, rode a simulação e mude a situação para o funil acompanhar."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[...ORDER.map((id) => SIM_STATUSES.find((s) => s.id === id)!), { id: "todas" as const, label: "Todas" }].map((s) => (
          <button
            key={s.id}
            onClick={() => setFiltro(s.id)}
            aria-pressed={filtro === s.id}
            className={cn("rounded-full border px-3 py-1 text-sm", filtro === s.id ? "border-asfalto bg-asfalto text-white" : "bg-chapa hover:bg-muted")}
          >
            {s.label}
            <span className="num ml-1.5 opacity-70">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>
      {list.isPending && <Skeleton className="h-60" />}
      {list.data && items.length === 0 && (
        <p className="rounded-lg border border-dashed bg-chapa p-8 text-muted-foreground">
          {filtro === "enviada" ? "Nenhuma simulação nova esperando. Quando a IA completar uma ficha, ela aparece aqui e o vendedor recebe um aviso." : "Nada nesta situação."}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((s) => (
          <li key={s.id} className={cn("rounded-lg border bg-chapa p-4", s.status === "enviada" && "border-faixa")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Link to={`/conversas/${s.contact_id}`} className="min-w-0 hover:underline">
                <p className="text-lg font-medium">{s.nome_completo ?? s.contato_nome ?? s.nome_perfil ?? "Cliente"}</p>
                <p className="text-sm text-muted-foreground">
                  {phone(s.wa_id ?? "")}
                  {s.vendedor ? `, com ${s.vendedor}` : ", sem vendedor"}
                  {s.enviada_em ? `, enviada ${ago(s.enviada_em)}` : `, atualizada ${ago(s.updated_at)}`}
                </p>
              </Link>
              <Select value={s.status} onValueChange={(v) => upd.mutate({ id: s.id, status: v as SimStatus })}>
                <SelectTrigger size="sm" className="w-[190px]" aria-label="Situação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIM_STATUSES.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Item k="Interesse" v={s.veiculo} />
              <Item k="Pagamento" v={s.forma_pagamento ? pagamentoLabel[s.forma_pagamento] ?? s.forma_pagamento : null} />
              <Item k="Entrada" v={s.entrada_dinheiro ? brl(s.entrada_dinheiro) : null} />
              <Item k="CPF" v={s.cpf} />
              <Item k="Nascimento" v={s.data_nascimento ? s.data_nascimento.split("-").reverse().join("/") : null} />
              <Item k="CNH" v={s.tem_cnh == null ? null : s.tem_cnh ? "Tem" : "Não tem"} />
              {s.resultado && <Item k="Resultado" v={s.resultado} wide />}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Item({ k, v, wide }: { k: string; v: string | null | undefined; wide?: boolean }) {
  return (
    <div className={cn(wide && "col-span-2 sm:col-span-4")}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={v ? "" : "text-muted-foreground/70"}>{v || "não informado"}</dd>
    </div>
  );
}
