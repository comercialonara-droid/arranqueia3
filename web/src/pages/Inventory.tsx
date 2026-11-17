import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileUp, Film, ImagePlus, Plus, Star, Trash2, X } from "lucide-react";
import { useMe } from "@/components/app/Shell";
import { del, get, post, put, upload, type Vehicle } from "@/lib/api";
import { brl, km, vehicleTitle, vehicleYear } from "@/lib/format";
import { PageHeader } from "@/components/app/Shell";
import { PlateChip } from "@/components/app/PlateChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSegment, type SegmentUI } from "@/lib/segment";

const STATUS = [
  { id: "disponivel", label: "Disponível" },
  { id: "reservado", label: "Reservado" },
  { id: "vendido", label: "Vendido" },
] as const;

type Draft = Partial<Vehicle> & { opcionaisTxt?: string; destaquesTxt?: string };

export default function Inventory() {
  const qc = useQueryClient();
  const me = useMe();
  const canEdit = me?.usuario.role !== "vendedor";
  const seg = useSegment();
  const list = useQuery({ queryKey: ["veiculos"], queryFn: () => get<Vehicle[]>("/api/veiculos") });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [filtro, setFiltro] = useState<"todos" | Vehicle["status"]>("disponivel");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((v) => (filtro === "todos" || v.status === filtro) && (!t || `${vehicleTitle(v)} ${v.ano_modelo ?? ""} ${v.cor ?? ""}`.toLowerCase().includes(t)));
  }, [list.data, filtro, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: list.data?.length ?? 0 };
    for (const v of list.data ?? []) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [list.data]);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Vehicle["status"] }) => put(`/api/veiculos/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["veiculos"] }),
  });

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Estoque"
        description={`A IA só oferece o que está aqui. ${seg.Produto} com fotos e preço vende mais: ela manda as fotos e calcula a parcela na hora.`}
        actions={
          canEdit && (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Importar planilha
            </Button>
            <Button onClick={() => setEditing({ status: "disponivel", fotos: [], videos: [], opcionaisTxt: "", destaquesTxt: "" })}>
              <Plus /> Adicionar {seg.produto}
            </Button>
          </>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(["disponivel", "reservado", "vendido", "todos"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFiltro(s)}
            aria-pressed={filtro === s}
            className={cn("rounded-full border px-3 py-1 text-sm", filtro === s ? "border-asfalto bg-asfalto text-white" : "bg-chapa hover:bg-muted")}
          >
            {s === "todos" ? "Todos" : STATUS.find((x) => x.id === s)!.label}
            <span className="num ml-1.5 opacity-70">{counts[s] ?? 0}</span>
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo, ano, cor" className="ml-auto w-60 bg-chapa" aria-label="Buscar no estoque" />
      </div>

      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-chapa p-10 text-center">
          <p className="text-lg">Nenhum{seg.id === "veiculos" ? "" : "a"} {seg.produto} {filtro !== "todos" ? "nesta situação" : seg.id === "veiculos" ? "cadastrado" : "cadastrada"}.</p>
          <p className="mt-1 text-muted-foreground">Adicione um por um ou importe a planilha do estoque.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((v) => {
            const preco = v.preco_promocional ?? v.preco;
            const abaixo = v.fipe && preco && preco < v.fipe ? v.fipe - preco : null;
            return (
              <li key={v.id} className="flex flex-col overflow-hidden rounded-lg border bg-chapa">
                <button className="relative block aspect-[4/3] w-full bg-muted text-left" onClick={() => canEdit && setEditing(toDraft(v))} aria-label={`Editar ${vehicleTitle(v)}`}>
                  {v.fotos[0] ? (
                    <img src={v.fotos[0].url} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="grid size-full place-items-center text-sm text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <ImagePlus className="size-4" /> Sem fotos ainda
                      </span>
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 flex gap-1.5">
                    {v.fotos.length > 0 && <span className="rounded bg-asfalto/85 px-1.5 py-0.5 text-xs text-white">{v.fotos.length} fotos</span>}
                    {v.videos?.length > 0 && <span className="rounded bg-asfalto/85 px-1.5 py-0.5 text-xs text-white">{v.videos.length} {v.videos.length === 1 ? "vídeo" : "vídeos"}</span>}
                    {v.destaque && (
                      <span className="flex items-center gap-1 rounded bg-faixa px-1.5 py-0.5 text-xs font-medium text-asfalto">
                        <Star className="size-3" /> Destaque
                      </span>
                    )}
                  </span>
                </button>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{v.marca}</p>
                      <h2 className="truncate text-[26px] font-semibold leading-tight">{v.modelo}</h2>
                      {v.versao && <p className="truncate text-sm">{v.versao}</p>}
                    </div>
                    {vehicleYear(v) && <PlateChip className="mt-1 shrink-0">{vehicleYear(v)}</PlateChip>}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{summaryLine(v, seg)}</p>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                    <div>
                      <p className="num text-[28px] font-semibold leading-none">{preco ? brl(preco) : "Sem preço"}</p>
                      {abaixo ? <p className="mt-1 text-xs text-verde">{brl(abaixo)} abaixo da FIPE</p> : v.entrada_sugerida ? <p className="mt-1 text-xs text-muted-foreground">entrada sugerida {brl(v.entrada_sugerida)}</p> : null}
                    </div>
                    <Select value={v.status} onValueChange={(s) => setStatus.mutate({ id: v.id, status: s as Vehicle["status"] })}>
                      <SelectTrigger size="sm" className={cn("w-[120px]", v.status === "vendido" && "text-muted-foreground", v.status === "reservado" && "border-faixa")} aria-label="Situação">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <VehicleSheet draft={editing} onClose={() => setEditing(null)} seg={seg} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} seg={seg} />
    </div>
  );
}

/** Linha de resumo do card: carro mostra km/câmbio; bike mostra autonomia/motor. */
function summaryLine(v: Vehicle, seg: SegmentUI) {
  if (seg.id === "veiculos") return [km(v.km), v.cambio === "automatico" ? "automático" : v.cambio, v.combustivel, v.cor].filter(Boolean).join(", ");
  const f = v.ficha ?? {};
  return [f.autonomia_km && `${f.autonomia_km} km de autonomia`, f.motor_w && `${f.motor_w}W`, f.bateria, v.cor].filter(Boolean).join(", ");
}

function toDraft(v: Vehicle): Draft {
  return { ...v, opcionaisTxt: v.opcionais.join("\n"), destaquesTxt: v.destaques.join("\n") };
}

const numOrNull = (s: string) => {
  const t = s.replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}\b)/g, ""));
  return Number.isFinite(n) ? n : null;
};

function VehicleSheet({ draft, onClose, seg }: { draft: Draft | null; onClose: () => void; seg: SegmentUI }) {
  const show = (k: string) => !seg.esconder.includes(k);
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [lastDraft, setLastDraft] = useState<Draft | null>(null);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    setD(draft ?? {});
  }
  const isNew = !draft?.id;
  const set = (k: keyof Draft, v: unknown) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...d,
        opcionais: (d.opcionaisTxt ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        destaques: (d.destaquesTxt ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      };
      delete (body as any).opcionaisTxt;
      delete (body as any).destaquesTxt;
      delete (body as any).updated_at;
      delete (body as any).created_at;
      return isNew ? post<Vehicle>("/api/veiculos", body) : put<Vehicle>(`/api/veiculos/${d.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["veiculos"] });
      toast.success(isNew ? `${seg.Produto} adicionad${seg.id === "veiculos" ? "o" : "a"} ao estoque.` : "Alterações salvas.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/veiculos/${d.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["veiculos"] });
      toast.success(`${seg.Produto} removid${seg.id === "veiculos" ? "o" : "a"} do estoque.`);
      onClose();
    },
  });

  const fotos = d.fotos ?? [];
  const moveFoto = (i: number, dir: -1 | 1) => {
    const arr = [...fotos];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("fotos", arr);
  };

  const text = (k: keyof Draft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`v-${String(k)}`}>{label}</Label>
      <Input id={`v-${String(k)}`} value={(d[k] as string | number | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );
  const numeric = (k: keyof Draft, label: string, placeholder?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`v-${String(k)}`}>{label}</Label>
      <Input id={`v-${String(k)}`} inputMode="numeric" placeholder={placeholder} value={(d[k] as number | null | undefined) ?? ""} onChange={(e) => set(k, numOrNull(e.target.value))} />
    </div>
  );

  return (
    <Sheet open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-heading text-3xl">{isNew ? seg.novo : vehicleTitle(d as Vehicle)}</SheetTitle>
          <SheetDescription>Tudo o que estiver aqui a IA pode usar para responder o cliente. O preço fica guardado mesmo se a loja não passar valores pelo WhatsApp.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-4">
          <section>
            <Label>Fotos (a primeira é a capa)</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {fotos.map((f, i) => (
                <div key={f.url + i} className="group relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
                  <img src={f.url} alt={f.legenda ?? ""} className="size-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-asfalto/70 p-1 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button type="button" onClick={() => moveFoto(i, -1)} aria-label="Mover para a esquerda">
                      <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" onClick={() => set("fotos", fotos.filter((_, j) => j !== i))} aria-label="Remover foto">
                      <X className="size-4" />
                    </button>
                    <button type="button" onClick={() => moveFoto(i, 1)} aria-label="Mover para a direita">
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="grid aspect-[4/3] place-items-center rounded-md border border-dashed text-sm text-muted-foreground hover:bg-muted"
              >
                <span className="flex flex-col items-center gap-1">
                  <ImagePlus className="size-5" />
                  {uploading ? "Enviando…" : "Adicionar fotos"}
                </span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                setUploading(true);
                try {
                  const urls: { url: string }[] = [];
                  for (const f of files) urls.push(await upload(f));
                  setD((x) => ({ ...x, fotos: [...(x.fotos ?? []), ...urls] }));
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">Use fotos reais {seg.do}, em JPG ou PNG. O WhatsApp não aceita outros formatos.</p>
          </section>

          <section>
            <Label>Vídeos (MP4 de até 16 MB)</Label>
            <ul className="mt-2 space-y-2">
              {(d.videos ?? []).map((v, i) => (
                <li key={v.url + i} className="flex items-center gap-2">
                  <video src={v.url} className="h-16 w-28 rounded bg-black object-cover" preload="metadata" />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Vídeo {i + 1}</span>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => set("videos", (d.videos ?? []).filter((_, j) => j !== i))} aria-label="Remover vídeo">
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" className="mt-2" disabled={uploading} onClick={() => videoRef.current?.click()}>
              <Film /> {uploading ? "Enviando…" : "Adicionar vídeo"}
            </Button>
            <input
              ref={videoRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  const r = await upload(f);
                  setD((x) => ({ ...x, videos: [...(x.videos ?? []), { url: r.url }] }));
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </section>

          <div className="grid grid-cols-2 gap-3">
            {text("marca", "Marca", { placeholder: seg.id === "veiculos" ? "Toyota" : "INOW" })}
            {text("modelo", "Modelo", { placeholder: seg.id === "veiculos" ? "Corolla" : "V40 Pro" })}
            <div className="col-span-2">{text("versao", "Versão", { placeholder: seg.id === "veiculos" ? "XEi 2.0 Flex" : "2026, banco caramelo" })}</div>
            {show("ano_fab") && numeric("ano_fab", "Ano de fabricação")}
            {numeric("ano_modelo", seg.id === "veiculos" ? "Ano do modelo" : "Ano")}
            {show("km") && numeric("km", "Quilometragem")}
            {text("cor", "Cor")}
            {show("cambio") && <div className="grid gap-1.5">
              <Label>Câmbio</Label>
              <Select value={d.cambio ?? ""} onValueChange={(v) => set("cambio", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatico">Automático</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="cvt">CVT</SelectItem>
                </SelectContent>
              </Select>
            </div>}
            <div className="grid gap-1.5">
              <Label>{seg.id === "veiculos" ? "Carroceria" : "Tipo"}</Label>
              <Select value={d.carroceria ?? ""} onValueChange={(v) => set("carroceria", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {seg.categorias.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === "suv" ? "SUV" : c[0].toUpperCase() + c.slice(1).replace("utilitario", "Utilitário").replace("cupe", "Cupê").replace("dobravel", "Dobrável").replace("cargueira", "Cargueira")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {show("combustivel") && text("combustivel", "Combustível", { placeholder: "flex, flex + GNV, diesel" })}
            {show("final_placa") && text("final_placa", "Final da placa")}
          </div>

          {seg.ficha.length > 0 && (
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">Ficha técnica</legend>
              <div className="grid grid-cols-2 gap-3">
                {seg.ficha.map((f) => (
                  <div key={f.chave} className="grid gap-1.5">
                    <Label htmlFor={`f-${f.chave}`}>
                      {f.rotulo}
                      {f.unidade ? ` (${f.unidade})` : ""}
                    </Label>
                    <Input
                      id={`f-${f.chave}`}
                      placeholder={f.exemplo}
                      value={d.ficha?.[f.chave] ?? ""}
                      onChange={(e) => setD((x) => ({ ...x, ficha: { ...(x.ficha ?? {}), [f.chave]: e.target.value } }))}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid grid-cols-2 gap-3">
            {numeric("preco", "Preço (R$)")}
            {numeric("preco_promocional", "Preço promocional (R$)")}
            {show("fipe") && numeric("fipe", "Tabela FIPE (R$)")}
            {numeric("entrada_sugerida", "Entrada sugerida (R$)")}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="v-destaques">Destaques para a IA usar na venda (um por linha)</Label>
            <Textarea id="v-destaques" rows={3} placeholder={seg.id === "veiculos" ? "IPVA 2027 pago\nÚnico dono\nRevisões na concessionária" : "Cadeado integrado na roda\nPainel com NFC\nPronta entrega"} value={d.destaquesTxt ?? ""} onChange={(e) => set("destaquesTxt", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-opcionais">Opcionais (um por linha)</Label>
            <Textarea id="v-opcionais" rows={3} value={d.opcionaisTxt ?? ""} onChange={(e) => set("opcionaisTxt", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-desc">Descrição</Label>
            <Textarea id="v-desc" rows={3} value={d.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="v-dest">{seg.Produto} em destaque</Label>
              <p className="text-sm text-muted-foreground">A IA sugere primeiro quando o cliente não sabe o que quer.</p>
            </div>
            <Switch id="v-dest" checked={Boolean(d.destaque)} onCheckedChange={(c) => set("destaque", c)} />
          </div>
        </div>
        <SheetFooter className="flex-row justify-between border-t">
          {!isNew ? (
            <Button variant="destructive" onClick={() => confirm(`Remover ${seg.id === "veiculos" ? "este" : "esta"} ${seg.produto} do estoque?`) && remove.mutate()}>
              <Trash2 /> Remover
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => save.mutate()} disabled={!d.marca || !d.modelo || save.isPending}>
            {isNew ? "Adicionar ao estoque" : "Salvar alterações"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const CSV_MODELO: Record<SegmentUI["id"], string> = {
  veiculos:
    "marca;modelo;versao;ano_fab;ano_modelo;km;preco;fipe;cambio;combustivel;carroceria;cor;destaques;fotos\n" +
    "Toyota;Corolla;XEi 2.0;2021;2022;117000;115900;118844;automatico;flex + GNV;sedan;cinza;IPVA 2027 pago|GNV 5ª geração;https://seusite.com/fotos/corolla-1.jpg https://seusite.com/fotos/corolla-2.jpg\n",
  bikes_eletricas:
    "marca;modelo;ano_modelo;preco;preco_promocional;categoria;cor;motor_w;bateria;autonomia_km;velocidade_max_kmh;carga_max_kg;destaques;fotos\n" +
    "VOLTTA;V9 Max;2026;8599;7999;urbana;preta;1000;48V 15,6Ah removível;50;48;150;Cadeado integrado na roda|NFC|Alarme;https://seusite.com/fotos/v9-1.jpg\n",
};

function ImportDialog({ open, onOpenChange, seg }: { open: boolean; onOpenChange: (o: boolean) => void; seg: SegmentUI }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const run = useMutation({
    mutationFn: () => post<{ importados: number; erros: string[] }>("/api/veiculos/importar", { csv }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["veiculos"] });
      toast.success(`${r.importados} ${seg.produtos} importad${seg.id === "veiculos" ? "os" : "as"}.`);
      if (r.erros.length) toast.warning(r.erros.slice(0, 3).join("\n"));
      setCsv("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar estoque de uma planilha</DialogTitle>
          <DialogDescription>
            Exporte a planilha como CSV e cole aqui, ou escolha o arquivo. Colunas aceitas:{" "}
            {seg.id === "veiculos"
              ? "marca, modelo, versao, ano_fab, ano_modelo, km, preco, fipe, cambio, combustivel, carroceria, cor"
              : `marca, modelo, versao, ano_modelo, preco, preco_promocional, categoria, cor, ${seg.ficha.map((f) => f.chave).join(", ")}`}
            , destaques, opcionais e fotos (links separados por espaço).
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={CSV_MODELO[seg.id]} className="font-[ui-monospace,monospace] text-xs" aria-label="Conteúdo CSV" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer text-placa underline">
            Escolher arquivo CSV
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </label>
          <button type="button" className="text-placa underline" onClick={() => setCsv(CSV_MODELO[seg.id])}>
            Usar exemplo
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => run.mutate()} disabled={!csv.trim() || run.isPending}>
            Importar {seg.produtos}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
