import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mic, Trash2, Upload } from "lucide-react";
import { del, get, put, upload, type AudioClip } from "@/lib/api";
import { PageHeader } from "@/components/app/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const SUGESTOES = [
  { titulo: "Boas-vindas", quando: "Logo na primeira resposta para quem chegou de anúncio, se apresentando como da loja." },
  { titulo: "Convite para simulação", quando: "Quando o cliente demonstra interesse e você vai oferecer a simulação." },
  { titulo: "Simulação recebida", quando: "Depois de enviar a ficha de simulação para o consultor." },
  { titulo: "Convite para visitar", quando: "Quando o cliente quer ver o modelo de perto na loja." },
  { titulo: "Fora do horário", quando: "Quando a loja está fechada e o cliente precisa do consultor." },
];

export default function Audios() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["audios"], queryFn: () => get<AudioClip[]>("/api/audios") });
  const [titulo, setTitulo] = useState("");
  const [quando, setQuando] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["audios"] });
  const upd = useMutation({ mutationFn: (a: Partial<AudioClip> & { id: number }) => put(`/api/audios/${a.id}`, a), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => del(`/api/audios/${id}`), onSuccess: refresh });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Áudios do vendedor"
        description="Grave áudios curtos (10 a 30 segundos) com a voz do vendedor e diga quando a IA deve usar cada um. Ela escolhe o áudio certo na hora certa, sem repetir para o mesmo cliente. Funciona com áudio gravado no próprio WhatsApp ou no gravador do celular."
      />

      <section className="rounded-lg border bg-chapa p-5">
        <h2 className="text-2xl font-semibold">Novo áudio</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.4fr]">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="a-titulo">Nome do áudio</Label>
            <Input id="a-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Convite para simulação" />
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="a-quando">Quando a IA deve mandar</Label>
            <Textarea id="a-quando" rows={2} value={quando} onChange={(e) => setQuando(e.target.value)} placeholder="Ex.: quando o cliente gostar do modelo e for a hora de oferecer a simulação" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Mic /> {file ? file.name : "Escolher arquivo de áudio"}
          </Button>
          <input ref={fileRef} type="file" accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button
            disabled={!file || !titulo || !quando || sending}
            onClick={async () => {
              if (!file) return;
              setSending(true);
              try {
                await upload(file, { titulo, quando_usar: quando }, "/api/audios");
                setTitulo("");
                setQuando("");
                setFile(null);
                refresh();
                toast.success("Áudio salvo. A IA já pode usar.");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSending(false);
              }
            }}
          >
            <Upload /> {sending ? "Enviando…" : "Salvar áudio"}
          </Button>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Sugestões para gravar:{" "}
          {SUGESTOES.map((s, i) => (
            <span key={s.titulo}>
              <button
                className="text-placa underline"
                onClick={() => {
                  setTitulo(s.titulo);
                  setQuando(s.quando);
                }}
              >
                {s.titulo}
              </button>
              {i < SUGESTOES.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      </section>

      <ul className="mt-5 space-y-3">
        {list.data?.length === 0 && <li className="rounded-lg border border-dashed bg-chapa p-6 text-muted-foreground">Nenhum áudio ainda. Sem áudios, a IA responde só em texto.</li>}
        {list.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-4 rounded-lg border bg-chapa p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.titulo}</p>
              <p className="text-sm text-muted-foreground">{a.quando_usar}</p>
              <audio controls src={a.url} preload="none" className="mt-2 h-9 w-full max-w-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={a.ativo} onCheckedChange={(ativo) => upd.mutate({ id: a.id, ativo })} /> {a.ativo ? "Em uso" : "Pausado"}
            </label>
            <Button variant="ghost" size="icon-sm" onClick={() => confirm(`Apagar "${a.titulo}"?`) && remove.mutate(a.id)} aria-label={`Apagar ${a.titulo}`}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
