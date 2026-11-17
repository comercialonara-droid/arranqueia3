import type { StoreSettings } from "../types.js";

export interface FinancingOption {
  prazo: number;
  parcela: number;
}

export interface FinancingSimulation {
  valor_veiculo: number;
  entrada: number;
  valor_financiado: number;
  entrada_minima: number;
  entrada_abaixo_do_minimo: boolean;
  opcoes: FinancingOption[];
  modo: StoreSettings["financiamento"]["modo"];
  observacao: string;
}

/** Parcela pela Tabela Price: PMT = PV · i / (1 − (1 + i)^−n) */
export function pricePmt(pv: number, ratePct: number, n: number): number {
  if (pv <= 0) return 0;
  const i = ratePct / 100;
  if (i === 0) return pv / n;
  return (pv * i) / (1 - Math.pow(1 + i, -n));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function simulate(
  cfg: StoreSettings["financiamento"],
  valorVeiculo: number,
  entradaInformada?: number | null,
  prazoEspecifico?: number | null,
): FinancingSimulation {
  const entradaMinima = round2((valorVeiculo * cfg.entrada_minima_pct) / 100);
  const entrada = Math.max(0, entradaInformada ?? entradaMinima);
  const financiado = Math.max(0, valorVeiculo - entrada);

  let opcoes: FinancingOption[];
  if (cfg.modo === "regra_loja") {
    // Regra prática da loja: a cada R$ X financiados, R$ Y de parcela (num prazo de referência)
    const parcela = round2((financiado / cfg.regra_loja.a_cada) * cfg.regra_loja.parcela);
    opcoes = [{ prazo: cfg.regra_loja.prazo, parcela }];
    if (prazoEspecifico && prazoEspecifico !== cfg.regra_loja.prazo) {
      // aproxima outro prazo mantendo a taxa implícita da regra
      const implicitRate = solveRate(cfg.regra_loja.a_cada, cfg.regra_loja.parcela, cfg.regra_loja.prazo);
      opcoes.push({ prazo: prazoEspecifico, parcela: round2(pricePmt(financiado, implicitRate, prazoEspecifico)) });
    }
  } else {
    const prazos = prazoEspecifico ? [prazoEspecifico] : cfg.prazos;
    opcoes = prazos.map((n) => ({ prazo: n, parcela: round2(pricePmt(financiado, cfg.taxa_mensal_pct, n)) }));
  }

  return {
    valor_veiculo: valorVeiculo,
    entrada: round2(entrada),
    valor_financiado: round2(financiado),
    entrada_minima: entradaMinima,
    entrada_abaixo_do_minimo: entradaInformada != null && entradaInformada < entradaMinima,
    opcoes,
    modo: cfg.modo,
    observacao: cfg.observacao,
  };
}

/** Taxa mensal (%) que faz PV virar PMT em n parcelas — bisseção simples. */
export function solveRate(pv: number, pmt: number, n: number): number {
  if (pmt * n <= pv) return 0;
  let lo = 0,
    hi = 20;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (pricePmt(pv, mid, n) > pmt) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Valor máximo de veículo que cabe numa parcela desejada (para buscar carros por parcela). */
export function maxVehicleForInstallment(cfg: StoreSettings["financiamento"], parcelaMax: number, entrada: number): number {
  if (cfg.modo === "regra_loja") return entrada + (parcelaMax / cfg.regra_loja.parcela) * cfg.regra_loja.a_cada;
  const n = Math.max(...cfg.prazos);
  const i = cfg.taxa_mensal_pct / 100;
  const pv = i === 0 ? parcelaMax * n : (parcelaMax * (1 - Math.pow(1 + i, -n))) / i;
  return entrada + pv;
}
