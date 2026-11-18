import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Bike,
  Motorbike,
  Building2,
  CalendarDays,
  CarFront,
  ClipboardCheck,
  Gauge,
  LogOut,
  Megaphone,
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
  { to: "/marketing", label: "Marketing", icon: Megaphone, roles: ["admin", "dono"] },
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
    n.to === "/estoque" && me.loja_atual?.segmento && me.loja_atual.segmento !== "veiculos" ? { ...n, icon: me.loja_atual.segmento === "motos" ? Motorbike : Bike } : n,
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
    <div className="min-h-dvh md:grid md:grid-cols-[252px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="px-5 pb-3 pt-6">
          <Logo className="text-white" />
          <StoreSwitcher me={me} />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Principal">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-white",
                  isActive && "nav-active font-medium text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={cn("size-[18px]", isActive ? "text-[#a9c4ff]" : "text-sidebar-foreground/60 group-hover:text-white")} strokeWidth={1.8} />
                  <span className="flex-1">{n.label}</span>
                  {n.to === "/conversas" && waiting > 0 && (
                    <span className="num rounded-md bg-sinal px-1.5 text-[13px] font-semibold leading-5 text-white" title="Conversas com um humano atendendo">
                      {waiting}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-2xl border border-sidebar-border bg-sidebar-accent/70 p-3 text-sm">
          <NavLink to="/conta" className="flex items-center gap-3 text-white">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3b7dff] to-[#1f4e9e] font-heading text-lg font-semibold">
              {me.usuario.nome.trim()[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{me.usuario.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">{roleLabel[role]}</span>
            </span>
          </NavLink>
          <button onClick={logout} className="mt-3 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-muted-foreground hover:text-white">
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-sidebar/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Logo className="shrink-0 text-white" compact />
        <div className="min-w-0 flex-1">
          <StoreSwitcher me={me} compact />
        </div>
      </header>

      <div className="min-w-0">
        {!fullBleed && <TopBar me={me} />}
        <main className={cn("min-w-0 pb-20 md:pb-0", !fullBleed && "px-4 py-5 md:px-8 md:py-7")}>{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Principal">
        {nav.slice(0, 4).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("relative flex flex-col items-center gap-0.5 py-2 text-[12px] text-muted-foreground", isActive && "text-white")}>
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
    return <p className={cn("truncate text-sm text-muted-foreground", !compact && "mt-4 rounded-xl border border-sidebar-border bg-sidebar-accent px-3 py-2")}>{me.loja_atual?.nome ?? "Sem loja"}</p>;
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
        <SelectTrigger size="sm" className="w-full rounded-xl border-sidebar-border bg-sidebar-accent" aria-label="Loja">
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
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px]", ok ? "border-verde/30 bg-verde/10 text-[#9fe3bf]" : "border-faixa/30 bg-faixa/10 text-[#ffd860]")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-verde shadow-[0_0_8px_var(--verde)]" : "bg-faixa")} aria-hidden />
      {ok ? on : off}
    </span>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Barra superior do desktop: saudação, data e o estado do WhatsApp e da IA. */
function TopBar({ me }: { me: Me }) {
  const first = me.usuario.nome.trim().split(/\s+/)[0];
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-sidebar-border bg-pista/80 px-8 py-3.5 backdrop-blur-xl md:flex">
      <div className="min-w-0">
        <p className="truncate text-[17px] font-medium text-white">
          {greeting()}, {first}
        </p>
        <p className="truncate text-sm capitalize text-muted-foreground">
          {today}
          {me.loja_atual ? ` · ${me.loja_atual.nome}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusLine ok={me.whatsapp_configurado} on="WhatsApp conectado" off="WhatsApp não conectado" />
        <StatusLine ok={me.ia.provedor === "anthropic"} on="IA ligada · Claude" off="IA em modo de teste" />
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[34px] font-semibold leading-none text-white md:text-[40px]">{title}</h1>
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
