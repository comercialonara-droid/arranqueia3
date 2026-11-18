import { cn } from "@/lib/utils";

/** Etiqueta no formato da placa Mercosul (faixa azul no topo). Usada para o ano do carro. */
export function PlateChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col overflow-hidden rounded-[4px] border border-asfalto/70 bg-white leading-none", className)}>
      <span className="h-[4px] bg-placa" aria-hidden />
      <span className="num px-1.5 py-[3px] text-[15px] font-semibold tracking-wide text-ink">{children}</span>
    </span>
  );
}
