import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { currentStore, get, post, put } from "@/lib/api";
import { PageHeader } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEGMENTS, segmentOf } from "@/lib/segment";
import type { Segmento } from "@/lib/api";

interface StoreRow {
  id: number;
  nome: string;
  slug: string;
  ativo: boolean;
  wa_phone_number_id: string | null;
  wa_waba_id: string | null;
  meta_dataset_id: string | null;
  token_configurado: boolean;
  whatsapp_ok: boolean;
  contatos: number;
  veiculos: number;
  segmento: Segmento;
}

export default function Stores() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["lojas"], queryFn: () => get<StoreRow[]>("/api/lojas") });
  const [nome, setNome] = useState("");
  const [segmento, setSegmento] = useState<Segmento>("veiculos");
  const [edit, setEdit] = useState<StoreRow | null>(null);
  const create = useMutation({
    mutationFn: () => post<StoreRow>("/api/lojas", { nome, segmento }),
    onSuccess: (s) => {
      setNome("");
      qc.invalidateQueries({ queryKey: ["lojas"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(`Loja ${s.nome} criada. Escolha ela no menu para configurar.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Lojas" description="Cada loja é um cliente separado: conversas, estoque, áudios, respostas prontas, equipe, configurações e WhatsApp são só dela. Para trabalhar numa loja, escolha ela no menu lateral." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.data?.map((s) => (
          <li key={s.id} className="rounded-lg border bg-chapa p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={cn("text-xl font-semibold", !s.ativo && "text-muted-foreground")}>{s.nome}</p>
                <p className="text-sm text-muted-foreground">
                  {segmentOf(s.segmento).nome} · {s.veiculos} {segmentOf(s.segmento).produtos}, {s.contatos} conversas
                </p>
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-xs", s.whatsapp_ok ? "bg-verde/10 text-verde" : "bg-faixa/20 text-foreground")}>{s.whatsapp_ok ? "WhatsApp conectado" : "Sem WhatsApp"}</span>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  currentStore.set(s.id);
                  qc.clear();
                  window.location.href = "/painel/";
                }}
              >
                Abrir loja
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>
                WhatsApp e Meta
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim()) create.mutate();
        }}
      >
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da nova loja" className="w-72 bg-chapa" aria-label="Nome da nova loja" />
        <Select value={segmento} onValueChange={(v) => setSegmento(v as Segmento)}>
          <SelectTrigger className="w-60 bg-chapa" aria-label="Segmento da nova loja">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(SEGMENTS).map((sg) => (
              <SelectItem key={sg.id} value={sg.id}>
                {sg.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!nome.trim()}>
          <Plus /> Criar loja
        </Button>
      </form>
      <StoreSheet store={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function StoreSheet({ store, onClose }: { store: StoreRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, any>>({});
  const [last, setLast] = useState<StoreRow | null>(null);
  if (store !== last) {
    setLast(store);
    setF(store ? { nome: store.nome, segmento: store.segmento, ativo: store.ativo, wa_phone_number_id: store.wa_phone_number_id ?? "", wa_waba_id: store.wa_waba_id ?? "", meta_dataset_id: store.meta_dataset_id ?? "" } : {});
  }
  const save = useMutation({
    mutationFn: () => put(`/api/lojas/${store!.id}`, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lojas"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Loja salva.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const field = (k: string, label: string, hint?: string, type = "text") => (
    <div className="grid gap-1.5">
      <Label htmlFor={`s-${k}`}>{label}</Label>
      <Input id={`s-${k}`} type={type} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return (
    <Sheet open={!!store} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-heading text-3xl">{store?.nome}</SheetTitle>
          <SheetDescription>Os dados ficam no app da Meta, em WhatsApp, Configuração da API. O token é guardado criptografado.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          {field("nome", "Nome da loja")}
          <div className="grid gap-1.5">
            <Label>Segmento</Label>
            <Select value={f.segmento ?? "veiculos"} onValueChange={(v) => setF({ ...f, segmento: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(SEGMENTS).map((sg) => (
                  <SelectItem key={sg.id} value={sg.id}>
                    {sg.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Muda o vocabulário da IA, a ficha dos produtos e a busca no estoque.</p>
          </div>
          {field("wa_phone_number_id", "ID do número de telefone", "Phone number ID do número desta loja")}
          {field("wa_waba_id", "ID da conta do WhatsApp Business (WABA)")}
          {field("wa_access_token", store?.token_configurado ? "Token de acesso (já configurado; preencha só para trocar)" : "Token de acesso permanente", undefined, "password")}
          {field("meta_dataset_id", "ID do dataset (conversões para os anúncios)")}
          <label className="flex items-center justify-between rounded-md border p-3">
            <span>Loja ativa</span>
            <Switch checked={!!f.ativo} onCheckedChange={(v) => setF({ ...f, ativo: v })} />
          </label>
          {store?.token_configurado && (
            <p className="flex items-center gap-1.5 text-sm text-verde">
              <Check className="size-4" /> Token salvo
            </p>
          )}
        </div>
        <SheetFooter className="border-t">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar loja
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
