import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, type Me } from "@/lib/api";
import { useLiveUpdates } from "@/lib/live";
import { Shell } from "@/components/app/Shell";
import Login from "@/pages/Login";
const Overview = lazy(() => import("@/pages/Overview"));
const Conversations = lazy(() => import("@/pages/Conversations"));
const Leads = lazy(() => import("@/pages/Leads"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const Simulator = lazy(() => import("@/pages/Simulator"));
const SettingsPage = lazy(() => import("@/pages/Settings"));

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
  useLiveUpdates(authed);

  if (me.isPending) return <div className="grid min-h-dvh place-items-center text-muted-foreground">Carregando…</div>;
  if (!authed)
    return (
      <Login
        onLogin={async () => {
          await me.refetch();
        }}
      />
    );

  return (
    <Shell me={me.data}>
      <Suspense fallback={<div className="p-8 text-muted-foreground">Carregando…</div>}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/conversas" element={<Conversations />} />
        <Route path="/conversas/:id" element={<Conversations />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/estoque" element={<Inventory />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/simulador" element={<Simulator />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Shell>
  );
}
