import { cn } from "@/lib/utils";

const label = { frio: "Frio", morno: "Morno", quente: "Quente" } as const;

/** Medidor de temperatura do lead, desenhado como o marcador de temperatura do painel do carro. */
export function Temperature({ t, score, compact = false }: { t: "frio" | "morno" | "quente"; score?: number; compact?: boolean }) {
  const filled = t === "quente" ? 3 : t === "morno" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5" title={score != null ? `${label[t]}: ${score} de 100 pontos` : label[t]}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("w-[5px] rounded-[1px]", i < filled ? (t === "quente" ? "bg-sinal" : t === "morno" ? "bg-faixa" : "bg-placa") : "bg-border")}
            style={{ height: 6 + i * 4 }}
          />
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
