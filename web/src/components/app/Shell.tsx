import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Bike,
  Building2,
  CalendarDays,
  CarFront,
  ClipboardCheck,
  Gauge,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  Settings2,
  Smartphone,
  SquareKanban,
  UserRound,
  UsersRound,
} from "lucide-react";
import { currentStore, get, post, type ConversationListItem, type Me, type Role } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type NavItem = { to: string; label: string; icon: typeof Gauge; end?: boolean; roles?: Role[] };
const NAV: NavItem[] = [
  { to: "/", label: "Visão geral", icon: Gauge, end: true },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/simulacoes", label: "Simulações", icon: ClipboardCheck },
  { to: "/leads", label: "Funil de leads", icon: SquareKanban },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/estoque", label: "Estoque", icon: CarFront },
  { to: "/simulador", label: "Testar a IA", icon: Smartphone, roles: ["admin", "dono"] },
  { to: "/audios", label: "Áudios do vendedor", icon: AudioLines, roles: ["admin", "dono"] },
  { to: "/equipe", label: "Equipe", icon: UsersRound, roles: ["admin", "dono"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings2, roles: ["admin", "dono"] },
  { to: "/lojas", label: "Lojas", icon: Building2, roles: ["admin"] },
];
const roleLabel: Record<Role, string> = { admin: "Administrador", dono: "Dono da loja", vendedor: "Vendedor" };

async function logout() {
  await post("/api/logout");
  currentStore.set(null);
  window.dispatchEvent(new Event("arranque:logout"));
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const role = me.usuario.role;
  const nav = NAV.filter((n) => !n.roles || n.roles.includes(role)).map((n) =>
    n.to === "/estoque" && me.loja_atual?.segmento === "bikes_eletricas" ? { ...n, icon: Bike } : n,
  );
  const waiting = useQuery({
    queryKey: ["conversas", "humano"],
    queryFn: () => get<ConversationListItem[]>("/api/conversas?filtro=humano"),
    refetchInterval: 60_000,
    enabled: Boolean(me.loja_atual),
  }).data?.length ?? 0;
  const loc = useLocation();
  const fullBleed = loc.pathname.startsWith("/conversas");

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[236px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar md:flex">
        <div className="px-5 pb-4 pt-5">
          <Logo className="text-asfalto" />
          <StoreSwitcher me={me} />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Principal">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-[7px] text-[15px] text-asfalto/75 transition-colors hover:bg-sidebar-accent hover:text-asfalto",
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
        <div className="space-y-2.5 border-t px-5 py-4 text-sm">
          <StatusLine ok={me.whatsapp_configurado} on="WhatsApp conectado" off="WhatsApp não conectado" />
          <StatusLine ok={me.ia.provedor === "anthropic"} on="IA ligada (Claude)" off="IA em modo de teste" />
          <NavLink to="/conta" className="flex items-center gap-2 pt-1 text-asfalto/80 hover:text-asfalto">
            <UserRound className="size-4" />
            <span className="min-w-0 truncate">
              {me.usuario.nome} <span className="text-muted-foreground">({roleLabel[role]})</span>
            </span>
          </NavLink>
          <button onClick={logout} className="flex items-center gap-2 text-muted-foreground hover:text-asfalto">
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-sidebar/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Logo className="shrink-0 text-asfalto" compact />
        <div className="min-w-0 flex-1">
          <StoreSwitcher me={me} compact />
        </div>
      </header>

      <main className={cn("min-w-0 pb-20 md:pb-0", !fullBleed && "px-4 py-5 md:px-8 md:py-7")}>{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-chapa pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Principal">
        {nav.slice(0, 4).map((n) => (
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
          <DropdownMenuContent align="end" side="top" className="w-56">
            {[...nav.slice(4), { to: "/conta", label: "Minha conta", icon: UserRound } as NavItem].map((n) => (
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

function StoreSwitcher({ me, compact = false }: { me: Me; compact?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (me.usuario.role !== "admin" || me.lojas.length < 2) {
    return <p className={cn("truncate text-sm text-muted-foreground", !compact && "mt-3")}>{me.loja_atual?.nome ?? "Sem loja"}</p>;
  }
  return (
    <div className={cn(!compact && "mt-3")}>
      <Select
        value={String(me.loja_atual?.id ?? "")}
        onValueChange={(v) => {
          currentStore.set(Number(v));
          qc.clear();
          navigate("/");
        }}
      >
        <SelectTrigger size="sm" className="w-full bg-chapa" aria-label="Loja">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {me.lojas.map((l) => (
            <SelectItem key={l.id} value={String(l.id)}>
              {l.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
        {description && <p className="mt-2 max-w-[70ch] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Usuário logado (para telas que mudam conforme o papel). */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), staleTime: 60_000 }).data;
}
