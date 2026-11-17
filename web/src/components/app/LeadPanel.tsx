import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { get, patch, STAGES, type Conversation, type Seller, type LeadStage } from "@/lib/api";
import { brl, dayLabel, km, pagamentoLabel, phone, time, tipoVisitaLabel, urgenciaLabel, vehicleTitle, vehicleYear } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Temperature } from "./Temperature";

const capiLabel: Record<string, string> = {
  enviado: "enviado à Meta",
  organico: "orgânico, não enviado",
  nao_configurado: "Meta não configurada",
  desativado: "envio desligado",
  erro: "erro no envio",
};
const eventLabel: Record<string, string> = {
  "capi:lead": "Lead com interesse",
  "capi:qualificado": "Lead qualificado",
  "capi:venda": "Venda",
};

export function LeadPanel({ data }: { data: Conversation }) {
  const qc = useQueryClient();
  const { contato, lead } = data;
  const sellers = useQuery({ queryKey: ["vendedores"], queryFn: () => get<Seller[]>("/api/vendedores") });
  const [vendaOpen, setVendaOpen] = useState(false);

  const updateLead = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/api/leads/${contato.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversa", contato.id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateContact = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/api/conversas/${contato.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversa", contato.id] }),
  });

  const troca = lead.troca;
  const capi = data.eventos.filter((e) => e.name.startsWith("capi:"));

  return (
    <div className="space-y-6 p-5">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{phone(contato.wa_id)}</p>
            {contato.ad_headline && <p className="mt-1 text-sm">Veio do anúncio “{contato.ad_headline}”</p>}
            {!contato.ad_headline && contato.origem && <p className="mt-1 text-sm text-muted-foreground">Origem: {contato.origem === "organico" ? "orgânico" : contato.origem}</p>}
          </div>
          <Temperature t={lead.temperatura} score={lead.score} />
        </div>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label>Etapa do funil</Label>
            <Select
              value={lead.stage}
              onValueChange={(v) => {
                if (v === "vendido") setVendaOpen(true);
                else updateLead.mutate({ stage: v as LeadStage });
              }}
            >
              <SelectTrigger className="w-full bg-chapa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Vendedor responsável</Label>
            <Select value={contato.seller_id ? String(contato.seller_id) : "nenhum"} onValueChange={(v) => updateContact.mutate({ seller_id: v === "nenhum" ? null : Number(v) })}>
              <SelectTrigger className="w-full bg-chapa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Ninguém ainda</SelectItem>
                {(sellers.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {lead.resumo && (
        <section>
          <h3 className="text-lg font-semibold">Resumo para o vendedor</h3>
          <p className="mt-1 text-[15px]">{lead.resumo}</p>
        </section>
      )}

      <section>
        <h3 className="text-lg font-semibold">O que ele procura</h3>
        {data.interesse.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {data.interesse.map((v) => (
              <li key={v.id} className="flex gap-3 rounded-md border bg-chapa p-2">
                {v.fotos[0] ? <img src={v.fotos[0].url} alt="" className="size-14 rounded object-cover" /> : <div className="size-14 rounded bg-muted" />}
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{vehicleTitle(v)}</p>
                  <p className="text-muted-foreground">
                    {vehicleYear(v)}, {km(v.km)}
                  </p>
                  <p className="num text-base">{v.preco_promocional ?? v.preco ? brl(v.preco_promocional ?? v.preco) : "Preço sob consulta"}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{lead.interesse_texto ?? "Ainda não falou de um carro específico."}</p>
        )}
        {lead.interesse_texto && data.interesse.length > 0 && <p className="mt-2 text-sm text-muted-foreground">Procura: {lead.interesse_texto}</p>}
      </section>

      <section>
        <h3 className="text-lg font-semibold">Ficha</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Field k="Pagamento" v={lead.forma_pagamento ? pagamentoLabel[lead.forma_pagamento] : null} />
          <Field k="Entrada" v={lead.entrada ? brl(lead.entrada) : null} />
          <Field k="Parcela máxima" v={lead.parcela_max ? brl(lead.parcela_max) : null} />
          <Field k="Orçamento" v={lead.orcamento_max ? `até ${brl(lead.orcamento_max)}` : null} />
          <Field k="Quando compra" v={lead.urgencia ? urgenciaLabel[lead.urgencia] : null} />
          <Field k="Uso" v={lead.uso} />
          <Field k="Região" v={[lead.bairro, lead.cidade].filter(Boolean).join(", ") || null} />
          <Field k="Troca" v={lead.tem_troca ? [troca?.marca, troca?.modelo, troca?.ano, troca?.km ? km(troca.km) : null].filter(Boolean).join(" ") || "Sim" : lead.tem_troca === false ? "Não" : null} />
          {lead.tem_troca && <Field k="Quitado" v={troca?.quitado == null ? null : troca.quitado ? "Sim" : "Não"} />}
          {lead.tem_troca && troca?.valor_esperado ? <Field k="Espera pela troca" v={brl(troca.valor_esperado)} /> : null}
          {lead.observacoes && <Field k="Anotações" v={lead.observacoes} />}
        </dl>
      </section>

      {data.visitas.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold">Visitas</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.visitas.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>
                  {tipoVisitaLabel[a.tipo]}, {dayLabel(a.inicio).toLowerCase()} às {time(a.inicio)}
                </span>
                <span className="text-muted-foreground">{a.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {capi.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold">Retorno para os anúncios</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {capi.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{eventLabel[e.name] ?? e.name}</span>
                <span className={e.capi_status === "enviado" ? "text-verde" : "text-muted-foreground"}>{capiLabel[e.capi_status ?? ""] ?? e.capi_status ?? "pendente"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SaleDialog
        open={vendaOpen}
        onOpenChange={setVendaOpen}
        vehicles={data.interesse}
        onConfirm={(valor, vehicleId) => {
          updateLead.mutate({ stage: "vendido", valor_venda: valor, vehicle_sold_id: vehicleId }, { onSuccess: () => toast.success("Venda registrada. Se veio de anúncio, a Meta recebe o evento de compra.") });
          setVendaOpen(false);
        }}
      />
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={v ? "" : "text-muted-foreground/70"}>{v || "não informado"}</dd>
    </>
  );
}

function SaleDialog({
  open,
  onOpenChange,
  vehicles,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicles: Conversation["interesse"];
  onConfirm: (valor: number | null, vehicleId: string | null) => void;
}) {
  const [valor, setValor] = useState("");
  const [veiculo, setVeiculo] = useState<string>(vehicles[0]?.id ?? "nenhum");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar venda</DialogTitle>
          <DialogDescription>O carro sai do estoque e, se o cliente veio de anúncio, a Meta recebe a compra para otimizar a campanha.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Carro vendido</Label>
            <Select value={veiculo} onValueChange={setVeiculo}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {vehicleTitle(v)} {vehicleYear(v)}
                  </SelectItem>
                ))}
                <SelectItem value="nenhum">Outro carro / não listado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="valor">Valor da venda (R$)</Label>
            <Input id="valor" inputMode="decimal" placeholder="Ex.: 115900" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(valor ? Number(valor.replace(/\./g, "").replace(",", ".")) : null, veiculo === "nenhum" ? null : veiculo)}>Registrar venda</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
