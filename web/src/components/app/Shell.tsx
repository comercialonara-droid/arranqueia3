import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CarFront, Gauge, LogOut, MessagesSquare, MoreHorizontal, Settings2, Smartphone, SquareKanban } from "lucide-react";
import { get, post, type ConversationListItem, type Me } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/", label: "Visão geral", icon: Gauge, end: true },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/leads", label: "Funil de leads", icon: SquareKanban },
  { to: "/estoque", label: "Estoque", icon: CarFront },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/simulador", label: "Testar a IA", icon: Smartphone },
  { to: "/configuracoes", label: "Configurações", icon: Settings2 },
];

function useWaiting() {
  const q = useQuery({ queryKey: ["conversas", "humano"], queryFn: () => get<ConversationListItem[]>("/api/conversas?filtro=humano"), refetchInterval: 60_000 });
  return q.data?.length ?? 0;
}

async function logout() {
  await post("/api/logout");
  window.dispatchEvent(new Event("arranque:logout"));
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const waiting = useWaiting();
  const loc = useLocation();
  const fullBleed = loc.pathname.startsWith("/conversas");

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      {/* menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar md:flex">
        <div className="px-5 pb-6 pt-5">
          <Logo className="text-asfalto" />
          <p className="mt-3 truncate text-sm text-muted-foreground" title={me.loja}>
            {me.loja}
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[15px] text-asfalto/75 transition-colors hover:bg-sidebar-accent hover:text-asfalto",
                  isActive && "bg-chapa font-medium text-asfalto shadow-[0_1px_0_var(--border)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="lane-dash-v absolute inset-y-1.5 left-0 w-[3px] rounded-full" aria-hidden />}
                  <n.icon className="size-[18px]" strokeWidth={1.8} />
                  <span className="flex-1">{n.label}</span>
                  {n.to === "/conversas" && waiting > 0 && (
                    <span className="num rounded bg-sinal px-1.5 text-[13px] font-semibold leading-5 text-white" title="Conversas com um humano atendendo">
                      {waiting}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t px-5 py-4 text-sm">
          <StatusLine ok={me.whatsapp_configurado} on="WhatsApp conectado" off="WhatsApp não conectado" />
          <StatusLine ok={me.ia.provedor === "anthropic"} on="IA ligada (Claude)" off="IA em modo de teste" />
          <button onClick={logout} className="flex items-center gap-2 text-muted-foreground hover:text-asfalto">
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      </aside>

      {/* topo (celular) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-sidebar/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Logo className="text-asfalto" />
        <span className="max-w-[45%] truncate text-sm text-muted-foreground">{me.loja}</span>
      </header>

      <main className={cn("min-w-0 pb-20 md:pb-0", !fullBleed && "px-4 py-5 md:px-8 md:py-7")}>{children}</main>

      {/* barra inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-chapa pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Principal">
        {NAV.slice(0, 4).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("relative flex flex-col items-center gap-0.5 py-2 text-[12px] text-muted-foreground", isActive && "text-asfalto")}>
            {({ isActive }) => (
              <>
                {isActive && <span className="lane-dash absolute inset-x-4 top-0 h-[3px]" aria-hidden />}
                <n.icon className="size-5" strokeWidth={1.8} />
                {n.label.split(" ")[0]}
                {n.to === "/conversas" && waiting > 0 && <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-sinal" />}
              </>
            )}
          </NavLink>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex flex-col items-center gap-0.5 py-2 text-[12px] text-muted-foreground">
            <MoreHorizontal className="size-5" />
            Mais
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            {NAV.slice(4).map((n) => (
              <DropdownMenuItem key={n.to} asChild>
                <NavLink to={n.to} className="flex items-center gap-2">
                  <n.icon className="size-4" /> {n.label}
                </NavLink>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={logout} className="flex items-center gap-2">
              <LogOut className="size-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  );
}

function StatusLine({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 rounded-full", ok ? "bg-verde" : "bg-faixa")} aria-hidden />
      <span className={ok ? "text-asfalto/80" : "text-muted-foreground"}>{ok ? on : off}</span>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[34px] font-semibold leading-none md:text-[40px]">{title}</h1>
        {description && <p className="mt-2 max-w-[68ch] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
