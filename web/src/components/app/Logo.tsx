import { cn } from "@/lib/utils";

/**
 * Marca ArranqueIA (manual de identidade): o "A da pista" — estrada em perspectiva com a faixa amarela
 * tracejada subindo pelo meio — e a palavra "arranque" com o selo IA amarelo.
 * Desenhada com currentColor: em fundo claro use text-asfalto; em fundo escuro, text-white.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden>
      <path d="M8 56 L28 8 L36 8 L56 56 L46.5 56 L32 21 L17.5 56 Z" fill="currentColor" />
      <rect x="30" y="46" width="4" height="9" rx="2" fill="var(--faixa)" />
      <rect x="30.5" y="35.5" width="3" height="6.5" rx="1.5" fill="var(--faixa)" />
      <rect x="31" y="27.5" width="2" height="4.5" rx="1" fill="var(--faixa)" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)} role="img" aria-label="ArranqueIA">
      <LogoMark />
      {!compact && (
        <span className="flex items-center gap-1.5 font-heading leading-none" aria-hidden>
          <span className="text-[28px] font-semibold tracking-[-0.01em]">arranque</span>
          <span className="rounded-[5px] bg-faixa px-1.5 py-0.5 text-[15px] font-bold text-asfalto">IA</span>
        </span>
      )}
    </div>
  );
}
