import type { Segmento } from "./api";
import { useMe } from "@/components/app/Shell";

export interface SpecField {
  chave: string;
  rotulo: string;
  unidade?: string;
  exemplo?: string;
}

/** Vocabulário e campos de cada segmento (o mesmo modelo do servidor, em server/src/segments.ts). */
export interface SegmentUI {
  id: Segmento;
  nome: string;
  produto: string;
  produtos: string;
  Produto: string;
  Produtos: string;
  um: string;
  o: string;
  do: string;
  novo: string; // "Novo carro" / "Nova bike"
  esconder: string[];
  ficha: SpecField[];
  categorias: string[];
  troca: string;
  exemplo_anuncio: string;
  exemplos_cliente: string[];
}

const VEICULOS: SegmentUI = {
  id: "veiculos",
  nome: "Veículos (carros e motos)",
  produto: "carro",
  produtos: "carros",
  Produto: "Carro",
  Produtos: "Carros",
  um: "um carro",
  o: "o carro",
  do: "do carro",
  novo: "Novo carro",
  esconder: [],
  ficha: [],
  categorias: ["hatch", "sedan", "suv", "picape", "utilitario", "minivan", "cupe", "moto"],
  troca: "carro",
  exemplo_anuncio: "Corolla XEi 2022 com GNV, abaixo da FIPE",
  exemplos_cliente: ["Oi, vi o anúncio do Corolla", "Quanto fica a parcela?", "Tenho um Onix 2019 pra dar na troca", "Posso ver o carro amanhã de manhã?"],
};

const BIKES: SegmentUI = {
  id: "bikes_eletricas",
  nome: "Bicicletas elétricas",
  produto: "bike",
  produtos: "bikes",
  Produto: "Bike",
  Produtos: "Bikes",
  um: "uma bike",
  o: "a bike",
  do: "da bike",
  novo: "Nova bike",
  esconder: ["km", "cambio", "combustivel", "portas", "final_placa", "fipe", "ano_fab"],
  ficha: [
    { chave: "motor_w", rotulo: "Motor", unidade: "W", exemplo: "1000" },
    { chave: "bateria", rotulo: "Bateria", exemplo: "48V 15,6Ah removível" },
    { chave: "autonomia_km", rotulo: "Autonomia", unidade: "km", exemplo: "60" },
    { chave: "velocidade_max_kmh", rotulo: "Velocidade máxima", unidade: "km/h", exemplo: "32" },
    { chave: "recarga_h", rotulo: "Tempo de recarga", unidade: "h", exemplo: "6 a 8" },
    { chave: "carga_max_kg", rotulo: "Carga máxima", unidade: "kg", exemplo: "150" },
    { chave: "aro", rotulo: "Aro e pneus", exemplo: "20, slick" },
    { chave: "suspensao", rotulo: "Suspensão", exemplo: "dupla" },
    { chave: "freios", rotulo: "Freios", exemplo: "hidráulicos" },
    { chave: "marchas", rotulo: "Câmbio / marchas", exemplo: "Shimano 7 marchas" },
    { chave: "garantia", rotulo: "Garantia", exemplo: "1 ano no motor e na bateria" },
  ],
  categorias: ["urbana", "scooter", "dobravel", "cargueira", "mountain", "triciclo", "infantil"],
  troca: "usado",
  exemplo_anuncio: "V9 Max 1000W com cadeado integrado, pronta entrega",
  exemplos_cliente: ["Oi, vi o anúncio da V9 Max", "Quantos km ela faz com uma carga?", "Parcela em quantas vezes no cartão?", "Posso fazer um test ride amanhã?"],
};

export const SEGMENTS: Record<Segmento, SegmentUI> = { veiculos: VEICULOS, bikes_eletricas: BIKES };
export const segmentOf = (s: Segmento | null | undefined) => SEGMENTS[s ?? "veiculos"] ?? VEICULOS;

/** Segmento da loja aberta no painel. */
export function useSegment(): SegmentUI {
  return segmentOf(useMe()?.loja_atual?.segmento);
}
