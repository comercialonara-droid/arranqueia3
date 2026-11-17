import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { post } from "@/lib/api";
import { Logo } from "@/components/app/Logo";

export default function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-dvh grid-rows-[1fr_auto] bg-asfalto text-white">
      <main className="grid place-items-center px-6">
        <form
          className="w-full max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErro(null);
            try {
              await post("/api/login", { senha });
              await onLogin();
            } catch (err) {
              setErro((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Logo className="mb-10 text-white" />
          <h1 className="text-4xl font-semibold leading-none">Painel da loja</h1>
          <p className="mt-3 text-white/70">Acompanhe as conversas que a IA está atendendo e assuma quando o cliente estiver pronto.</p>
          <div className="mt-8 space-y-2">
            <Label htmlFor="senha" className="text-white/80">
              Senha
            </Label>
            <Input
              id="senha"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="h-11 border-white/20 bg-white/5 text-white placeholder:text-white/40"
            />
            {erro && <p className="text-sm text-[#ffb4a6]">{erro}</p>}
          </div>
          <Button type="submit" disabled={busy || !senha} className="mt-6 h-11 w-full bg-faixa text-asfalto hover:bg-faixa/90">
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </main>
      <div className="lane-dash h-1.5 w-full opacity-80" aria-hidden />
    </div>
  );
}
