import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { currentStore, get, type Me } from "@/lib/api";
import { useLiveUpdates } from "@/lib/live";
import { Shell } from "@/components/app/Shell";
import Login from "@/pages/Login";

const Overview = lazy(() => import("@/pages/Overview"));
const Marketing = lazy(() => import("@/pages/Marketing"));
const Campaign = lazy(() => import("@/pages/Campaign"));
const MarketingQuestionnaire = lazy(() => import("@/pages/MarketingQuestionnaire"));
const Conversations = lazy(() => import("@/pages/Conversations"));
const Leads = lazy(() => import("@/pages/Leads"));
const Simulations = lazy(() => import("@/pages/Simulations"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const Simulator = lazy(() => import("@/pages/Simulator"));
const Audios = lazy(() => import("@/pages/Audios"));
const Team = lazy(() => import("@/pages/Team"));
const Stores = lazy(() => import("@/pages/Stores"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Account = lazy(() => import("@/pages/Account"));

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false, staleTime: 60_000 });

  useEffect(() => {
    const h = () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      void qc.resetQueries({ queryKey: ["me"] });
    };
    window.addEventListener("arranque:logout", h);
    return () => window.removeEventListener("arranque:logout", h);
  }, [qc]);

  const authed = me.isSuccess;
  useLiveUpdates(authed, me.data?.loja_atual?.id ?? null);

  if (me.isPending) return <div className="grid min-h-dvh place-items-center text-muted-foreground">Carregando…</div>;
  if (!authed)
    return (
      <Login
        onLogin={async () => {
          currentStore.set(null);
          await me.refetch();
        }}
      />
    );

  const role = me.data.usuario.role;
  const manager = role !== "vendedor";
  if (!me.data.loja_atual && role === "admin")
    return (
      <Shell me={me.data}>
        <Suspense fallback={null}>
          <Stores />
        </Suspense>
      </Shell>
    );

  return (
    <Shell me={me.data}>
      <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando…</div>}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/conversas" element={<Conversations />} />
          <Route path="/conversas/:id" element={<Conversations />} />
          <Route path="/simulacoes" element={<Simulations />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/estoque" element={<Inventory />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/conta" element={<Account />} />
          {manager && <Route path="/marketing" element={<Marketing />} />}
          {manager && <Route path="/marketing/campanhas/:id" element={<Campaign />} />}
          {manager && <Route path="/marketing/questionario" element={<MarketingQuestionnaire />} />}
          {manager && <Route path="/simulador" element={<Simulator />} />}
          {manager && <Route path="/audios" element={<Audios />} />}
          {manager && <Route path="/equipe" element={<Team />} />}
          {manager && <Route path="/configuracoes" element={<SettingsPage />} />}
          {role === "admin" && <Route path="/lojas" element={<Stores />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
