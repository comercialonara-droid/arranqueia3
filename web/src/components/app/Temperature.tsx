import { cn } from "@/lib/utils";
import type { Temp } from "@/lib/api";

const label: Record<Temp, string> = { frio: "Frio", morno: "Morno", quente: "Quente", pronto: "Pronto" };
const level: Record<Temp, number> = { frio: 1, morno: 2, quente: 3, pronto: 4 };
const color: Record<Temp, string> = { frio: "bg-placa", morno: "bg-faixa", quente: "bg-sinal", pronto: "bg-verde" };

/** Medidor de temperatura do lead, como o marcador do painel do carro. */
export function Temperature({ t, score, compact = false }: { t: Temp; score?: number; compact?: boolean }) {
  const filled = level[t] ?? 1;
  return (
    <span className="inline-flex items-center gap-1.5" title={score != null ? `${label[t]}: ${score} de 100 pontos` : label[t]}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[5px] rounded-[1px]", i < filled ? color[t] : "bg-border")} style={{ height: 5 + i * 3.5 }} />
        ))}
      </span>
      {!compact && (
        <span className="text-sm">
          {label[t]}
          {score != null && <span className="num ml-1 text-muted-foreground">{score}</span>}
        </span>
      )}
    </span>
  );
}
