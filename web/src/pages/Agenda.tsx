import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, type AgendaItem, type Appointment } from "@/lib/api";
import { contactName, dayLabel, phone, time, tipoVisitaLabel } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS: { id: Appointment["status"]; label: string }[] = [
  { id: "agendada", label: "Agendada" },
  { id: "confirmada", label: "Confirmada" },
  { id: "realizada", label: "Compareceu" },
  { id: "faltou", label: "Não veio" },
  { id: "cancelada", label: "Cancelada" },
];

export default function Agenda() {
  const qc = useQueryClient();
  const agenda = useQuery({
    queryKey: ["agenda", "lista"],
    queryFn: () => get<AgendaItem[]>(`/api/agenda?de=${new Date(Date.now() - 3 * 86400_000).toISOString()}&ate=${new Date(Date.now() + 21 * 86400_000).toISOString()}`),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patch(`/api/agenda/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda"] }),
  });

  const groups = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const a of agenda.data ?? []) {
      const k = new Date(a.inicio).toDateString();
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [agenda.data]);

  const today = new Date().toDateString();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Agenda"
        description="Visitas e test-drives marcados pela IA ou pela equipe. O cliente recebe lembrete automático algumas horas antes. Marque quem compareceu para medir a conversão."
      />
      {agenda.isPending && <Skeleton className="h-64" />}
      {agenda.data?.length === 0 && <p className="rounded-lg border border-dashed bg-chapa p-8 text-muted-foreground">Nenhuma visita nas próximas três semanas.</p>}
      <div className="space-y-7">
        {groups.map(([day, items]) => (
          <section key={day}>
            <h2 className={cn("mb-2 text-2xl font-semibold first-letter:uppercase", new Date(day) < new Date(today) && "text-muted-foreground")}>{dayLabel(items[0].inicio)}</h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-chapa">
              {items.map((a) => (
                <li key={a.id} className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3", ["cancelada", "faltou"].includes(a.status) && "opacity-60")}>
                  <span className="num w-14 text-[26px] font-semibold leading-none">{time(a.inicio)}</span>
                  <Link to={`/conversas/${a.contact_id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate font-medium">{contactName(a)}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {tipoVisitaLabel[a.tipo]}
                      {a.modelo ? ` do ${a.marca} ${a.modelo} ${a.ano_modelo ?? ""}` : ""}, {phone(a.wa_id)}
                    </span>
                    {a.notas && <span className="block truncate text-sm text-muted-foreground">{a.notas}</span>}
                  </Link>
                  <Select value={a.status} onValueChange={(s) => update.mutate({ id: a.id, status: s })}>
                    <SelectTrigger size="sm" className={cn("w-[140px]", a.status === "confirmada" && "border-verde text-verde")} aria-label="Situação da visita">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
