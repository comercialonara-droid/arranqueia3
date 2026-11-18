import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { del, get, post, put, type User } from "@/lib/api";
import { phone } from "@/lib/format";
import { PageHeader, useMe } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const roleLabel = { dono: "Dono da loja", vendedor: "Vendedor", admin: "Administrador" } as const;

export default function Team() {
  const qc = useQueryClient();
  const me = useMe();
  const list = useQuery({ queryKey: ["equipe"], queryFn: () => get<User[]>("/api/equipe") });
  const [form, setForm] = useState({ nome: "", email: "", role: "vendedor", whatsapp: "" });
  const [cred, setCred] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["equipe"] });

  const add = useMutation({
    mutationFn: () => post<User & { senha_inicial: string }>("/api/equipe", { ...form, recebe_leads: form.role === "vendedor" && !!form.whatsapp }),
    onSuccess: (u) => {
      setCred({ nome: u.nome, email: u.email, senha: u.senha_inicial });
      setForm({ nome: "", email: "", role: "vendedor", whatsapp: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const upd = useMutation({
    mutationFn: (b: Partial<User> & { id: number; nova_senha?: boolean }) => put<User & { senha_inicial?: string }>(`/api/equipe/${b.id}`, b),
    onSuccess: (u) => {
      if (u.senha_inicial) setCred({ nome: u.nome, email: u.email, senha: u.senha_inicial });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/equipe/${id}`), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Equipe"
        description="Quem acessa o painel desta loja. O dono vê tudo da loja; o vendedor vê só os clientes dele. Quem recebe leads entra no rodízio e é avisado no WhatsApp quando a IA passa um cliente."
      />
      <ul className="divide-y overflow-hidden rounded-lg border bg-chapa">
        {list.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {u.nome} <span className="text-sm font-normal text-muted-foreground">{roleLabel[u.role]}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {u.email}
                {u.whatsapp ? `, ${phone(u.whatsapp)}` : ""}
              </p>
              {!u.whatsapp && u.role === "vendedor" && (
                <Input
                  placeholder="WhatsApp com DDD, ex.: 5521999998888"
                  className="mt-1.5 h-8 w-64"
                  onBlur={(e) => e.target.value && upd.mutate({ id: u.id, whatsapp: e.target.value, recebe_leads: true })}
                  aria-label={`WhatsApp de ${u.nome}`}
                />
              )}
            </div>
            {u.role === "vendedor" && (
              <span className="text-sm text-muted-foreground">
                <span className="num text-base text-foreground">{u.leads_recebidos}</span> leads
              </span>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={u.recebe_leads} disabled={!u.whatsapp} onCheckedChange={(v) => upd.mutate({ id: u.id, recebe_leads: v })} />
              Recebe leads
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={u.ativo} disabled={u.id === me?.usuario.id} onCheckedChange={(v) => upd.mutate({ id: u.id, ativo: v })} />
              Acesso
            </label>
            <Button variant="outline" size="sm" onClick={() => confirm(`Gerar uma nova senha para ${u.nome}? A senha atual deixa de funcionar.`) && upd.mutate({ id: u.id, nova_senha: true })}>
              <KeyRound /> Nova senha
            </Button>
            {u.id !== me?.usuario.id && (
              <Button variant="ghost" size="icon-sm" onClick={() => confirm(`Remover ${u.nome}?`) && remove.mutate(u.id)} aria-label={`Remover ${u.nome}`}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-6 rounded-lg border bg-chapa p-5">
        <h2 className="text-2xl font-semibold">Adicionar pessoa</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="t-nome">Nome</Label>
            <Input id="t-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-email">E-mail (é o login)</Label>
            <Input id="t-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo de acesso</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendedor">Vendedor (vê só os clientes dele)</SelectItem>
                <SelectItem value="dono">Dono da loja (vê tudo da loja)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-zap">WhatsApp (para receber os leads)</Label>
            <Input id="t-zap" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="5521999998888" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!form.nome || !form.email || add.isPending}>
              <Plus /> Adicionar e gerar senha
            </Button>
          </div>
        </form>
      </section>

      <Dialog open={!!cred} onOpenChange={(o) => !o && setCred(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso de {cred?.nome}</DialogTitle>
            <DialogDescription>Mande estes dados para a pessoa. Por segurança, a senha não aparece de novo; ela pode trocar em Minha conta.</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/60 p-4 text-[15px]">
            <p>
              Endereço: <strong>{window.location.origin}/painel</strong>
            </p>
            <p>
              E-mail: <strong>{cred?.email}</strong>
            </p>
            <p>
              Senha: <strong className="num text-lg">{cred?.senha}</strong>
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(`Painel: ${window.location.origin}/painel\nE-mail: ${cred?.email}\nSenha: ${cred?.senha}`);
                toast.success("Copiado.");
              }}
            >
              Copiar
            </Button>
            <Button onClick={() => setCred(null)}>Pronto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
