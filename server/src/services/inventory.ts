import type { StoreSettings, Vehicle } from "../types.js";
import { effectivePrice, vehicles, vehicleTitle, vehicleShort } from "../db/repos.js";
import { maxVehicleForInstallment, simulate } from "./financing.js";
import { brl, kmFmt } from "../util/time.js";
import { profileOf, specLines, specNumber } from "../segments.js";

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

const STOP = ["carro", "bike", "bicicleta", "eletrica", "um", "uma", "de", "do", "da", "com", "ate", "quero", "tem", "voces", "algum", "alguma"];

export interface SearchFilters {
  consulta?: string | null;
  marca?: string | null;
  modelo?: string | null;
  carroceria?: string | null;
  cambio?: string | null;
  combustivel?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
  ano_min?: number | null;
  km_max?: number | null;
  autonomia_min?: number | null;
  parcela_max?: number | null;
  entrada?: number | null;
  ordenar?: "relevancia" | "menor_preco" | "maior_preco" | "mais_novo" | "menor_km" | "maior_autonomia" | null;
  limite?: number | null;
}

function haystack(v: Vehicle) {
  return norm(
    [v.marca, v.modelo, v.versao, v.cor, v.cambio, v.combustivel, v.carroceria, v.ano_modelo, ...(v.opcionais ?? []), ...(v.destaques ?? []), ...Object.values(v.ficha ?? {}), v.descricao].join(
      " ",
    ),
  );
}

function textScore(v: Vehicle, q: string, synonyms: Record<string, string[]>): number {
  const h = haystack(v);
  const tokens = norm(q)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.includes(t));
  if (!tokens.length) return 1;
  let s = 0;
  for (const t of tokens) {
    const variants = Object.values(synonyms).find((list) => list.includes(t)) ?? [t];
    if (variants.some((x) => h.includes(x))) s += norm(v.modelo).includes(t) ? 3 : 1;
  }
  return s / tokens.length;
}

export function searchInventory(settings: StoreSettings, storeId: number, f: SearchFilters) {
  let list = vehicles.available(storeId);
  const SYNONYMS = profileOf(settings).sinonimos;
  const eq = (a: string | null | undefined, b: string) => norm(a).includes(norm(b));

  if (f.marca) list = list.filter((v) => eq(v.marca, f.marca!));
  if (f.modelo) list = list.filter((v) => eq(`${v.modelo} ${v.versao ?? ""}`, f.modelo!));
  if (f.carroceria) list = list.filter((v) => eq(v.carroceria, f.carroceria!));
  if (f.cambio) {
    const auto = (SYNONYMS.automatico ?? ["automatico"]).includes(norm(f.cambio));
    list = list.filter((v) => (auto ? /auto|cvt|at/.test(norm(v.cambio)) : eq(v.cambio, f.cambio!)));
  }
  if (f.combustivel) list = list.filter((v) => eq(v.combustivel, f.combustivel!) || haystack(v).includes(norm(f.combustivel!)));
  if (f.ano_min) list = list.filter((v) => (v.ano_modelo ?? 0) >= f.ano_min!);
  if (f.km_max) list = list.filter((v) => v.km == null || v.km <= f.km_max!);
  const autonomia = (v: Vehicle) => specNumber(v.ficha?.autonomia_km);
  if (f.autonomia_min) list = list.filter((v) => autonomia(v) == null || autonomia(v)! >= f.autonomia_min!);

  let precoMax = f.preco_max ?? null;
  if (f.parcela_max) {
    const teto = maxVehicleForInstallment(settings.financiamento, f.parcela_max, f.entrada ?? 0);
    precoMax = precoMax ? Math.min(precoMax, teto) : teto;
  }
  if (f.preco_min) list = list.filter((v) => (effectivePrice(v) ?? 0) >= f.preco_min!);
  if (precoMax) list = list.filter((v) => effectivePrice(v) == null || effectivePrice(v)! <= precoMax! * 1.05);

  let scored = list.map((v) => ({ v, s: f.consulta ? textScore(v, f.consulta, SYNONYMS) : 1 }));
  if (f.consulta) {
    const best = Math.max(0, ...scored.map((x) => x.s));
    scored = scored.filter((x) => x.s > 0 && x.s >= best * 0.5);
  }

  const by = f.ordenar ?? "relevancia";
  scored.sort((a, b) => {
    const pa = effectivePrice(a.v) ?? Infinity,
      pb = effectivePrice(b.v) ?? Infinity;
    switch (by) {
      case "menor_preco":
        return pa - pb;
      case "maior_preco":
        return pb - pa;
      case "mais_novo":
        return (b.v.ano_modelo ?? 0) - (a.v.ano_modelo ?? 0);
      case "maior_autonomia":
        return (autonomia(b.v) ?? 0) - (autonomia(a.v) ?? 0);
      case "menor_km":
        return (a.v.km ?? 1e9) - (b.v.km ?? 1e9);
      default:
        return b.s - a.s || Number(b.v.destaque) - Number(a.v.destaque);
    }
  });

  const limite = Math.min(f.limite ?? 6, 10);
  return { total: scored.length, veiculos: scored.slice(0, limite).map((x) => vehicleCard(settings, x.v, f.entrada)) };
}

/** Resumo compacto que vai para o modelo (economiza tokens e evita alucinação). */
export function vehicleCard(settings: StoreSettings, v: Vehicle, entrada?: number | null) {
  const semValores = settings.atendimento.politica_preco === "so_vendedor";
  const preco = effectivePrice(v);
  let parcela_estimada: string | null = null;
  if (!semValores && preco && settings.atendimento.aceita_financiamento) {
    const sim = simulate(settings.financiamento, preco, entrada ?? v.entrada_sugerida ?? null);
    const melhor = sim.opcoes[sim.opcoes.length - 1];
    if (melhor) parcela_estimada = `entrada ${brl(sim.entrada)} + ${melhor.prazo}x de ${brl(melhor.parcela)}`;
  }
  const p = profileOf(settings);
  const carro = p.id === "veiculos";
  return {
    id: v.id,
    titulo: vehicleTitle(v),
    como_chamar: vehicleShort(v),
    ...(carro ? { km: kmFmt(v.km), cambio: v.cambio, combustivel: v.combustivel } : { tipo: v.carroceria ?? undefined, ficha: specLines(p, v.ficha) }),
    cor: v.cor,
    ...(semValores
      ? { valores: "não informar: preço e condições só com o consultor, na simulação" }
      : {
          preco: preco ? brl(preco) : "sob consulta",
          preco_de: v.preco_promocional && v.preco ? brl(v.preco) : undefined,
          parcela_estimada,
        }),
    abaixo_da_fipe: carro && v.fipe && preco && preco < v.fipe ? (semValores ? "sim, está abaixo da FIPE (pode citar sem dizer valores)" : `${brl(v.fipe - preco)} abaixo da FIPE (${brl(v.fipe)})`) : undefined,
    destaques: v.destaques.slice(0, 6),
    status: v.status === "reservado" ? "reservado (pode entrar na fila)" : "disponível",
    fotos_disponiveis: v.fotos.length,
    videos_disponiveis: v.videos.length,
  };
}

export function vehicleDetails(settings: StoreSettings, v: Vehicle) {
  return {
    ...vehicleCard(settings, v),
    versao: v.versao,
    ano: v.ano_fab && v.ano_modelo ? `${v.ano_fab}/${v.ano_modelo}` : v.ano_modelo,
    ...(profileOf(settings).id === "veiculos" ? { portas: v.portas, final_placa: v.final_placa } : {}),
    carroceria: v.carroceria,
    opcionais: v.opcionais,
    destaques: v.destaques,
    descricao: v.descricao,
    fipe: v.fipe && settings.atendimento.politica_preco !== "so_vendedor" ? brl(v.fipe) : undefined,
    fotos: v.fotos.map((f, i) => ({ indice: i, legenda: f.legenda ?? null })),
    videos: v.videos.map((f, i) => ({ indice: i, legenda: f.legenda ?? null })),
  };
}
