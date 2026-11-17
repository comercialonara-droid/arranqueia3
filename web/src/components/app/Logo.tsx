import { cn } from "@/lib/utils";

/** Marca do produto: um carro estilizado sobre a faixa da pista. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill="currentColor" opacity=".12" />
        <path d="M6 21h20" stroke="var(--faixa)" strokeWidth="3" strokeDasharray="5 3" strokeLinecap="round" />
        <path d="M9 16l3-5.5h8l3 5.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="font-heading text-2xl font-semibold leading-none tracking-tight">Arranque</span>}
    </div>
  );
}
