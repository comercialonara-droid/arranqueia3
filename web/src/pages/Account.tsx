import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { put } from "@/lib/api";
import { PageHeader, useMe } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Account() {
  const me = useMe();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const save = useMutation({
    mutationFn: () => put("/api/me/senha", { atual, nova }),
    onSuccess: () => {
      toast.success("Senha trocada.");
      setAtual("");
      setNova("");
      setConf("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Minha conta" description={me ? `${me.usuario.nome}, ${me.usuario.email}` : undefined} />
      <form
        className="space-y-4 rounded-lg border bg-chapa p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (nova !== conf) return toast.error("A confirmação não bate com a nova senha.");
          save.mutate();
        }}
      >
        <h2 className="text-2xl font-semibold">Trocar senha</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="p-atual">Senha atual</Label>
          <Input id="p-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-nova">Nova senha (mínimo 8 caracteres)</Label>
          <Input id="p-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-conf">Repita a nova senha</Label>
          <Input id="p-conf" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
        </div>
        <Button type="submit" disabled={!atual || nova.length < 8 || save.isPending}>
          Trocar senha
        </Button>
      </form>
    </div>
  );
}
