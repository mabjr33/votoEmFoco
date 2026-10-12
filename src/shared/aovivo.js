// Simulador ao vivo em votos válidos nacionais.
// Parte do que já foi apurado (oficial) e estima quantos votos válidos ainda faltam em cada UF.
// O usuário decide como o restante se divide (no país ou por região) e vê o resultado final.
import { monteCarlo } from './engine.js';

export const REGIOES = {
  norte: { nome: 'Norte', ufs: ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'] },
  nordeste: { nome: 'Nordeste', ufs: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'] },
  centrooeste: { nome: 'Centro-Oeste', ufs: ['df', 'go', 'ms', 'mt'] },
  sudeste: { nome: 'Sudeste', ufs: ['es', 'mg', 'rj', 'sp'] },
  sul: { nome: 'Sul', ufs: ['pr', 'rs', 'sc'] },
  exterior: { nome: 'Exterior', ufs: ['zz'] },
};
const UF_REGIAO = Object.fromEntries(Object.entries(REGIOES).flatMap(([k, r]) => r.ufs.map((u) => [u, k])));
export const regiaoDe = (uf) => UF_REGIAO[uf] || 'outros';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/**
 * Situação de cada UF: votos já apurados (a, b) e votos válidos que ainda faltam (rem), com a
 * divisão esperada do restante (share = fração de A). Sem apuração, tudo vem do cenário simulado.
 */
export function pontoDePartida({ live = {}, sim, proj }, [fa, fb]) {
  const out = {};
  for (const [cd, su] of Object.entries(sim.units)) {
    const lu = live[cd];
    let a = 0, b = 0;
    for (const c of lu?.cands || []) { if (c.n === fa) a += c.vap; else if (c.n === fb) b += c.vap; }
    let rem, share;
    const pu = proj?.units?.[cd];
    if (pu) {
      rem = Math.max(0, pu.validos - (a + b));
      share = rem > 0 ? clamp((pu.A - a) / rem) : 0.5;
    } else {
      rem = Math.max(0, su.validos - (a + b));
      share = su.validos ? su.A / su.validos : 0.5;
    }
    out[cd] = { cd, a, b, rem, share, regiao: regiaoDe(cd), apuradoPct: lu?.secoes?.pst ?? 0 };
  }
  return out;
}

export function agruparPorRegiao(pp) {
  const g = {};
  for (const u of Object.values(pp)) {
    const r = (g[u.regiao] ||= { regiao: u.regiao, a: 0, b: 0, rem: 0, remA: 0 });
    r.a += u.a; r.b += u.b; r.rem += u.rem; r.remA += u.rem * u.share;
  }
  for (const r of Object.values(g)) r.share = r.rem ? r.remA / r.rem : 0.5;
  return g;
}

/** Desloca as frações regionais por um mesmo valor d para que o total nacional bata com `alvo`. */
function deslocar(grupos, alvo) {
  const R = grupos.reduce((s, g) => s + g.rem, 0);
  if (!R) return grupos.map((g) => g.share);
  const total = (d) => grupos.reduce((s, g) => s + g.rem * clamp(g.share + d), 0) / R;
  let lo = -1, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (total(m) < alvo) lo = m; else hi = m; }
  const d = (lo + hi) / 2;
  return grupos.map((g) => clamp(g.share + d));
}

/**
 * "Ainda dá para virar?" durante a apuração.
 * a, b: votos válidos já apurados de cada finalista.
 * faltam: votos válidos que ainda faltam, pela estimativa do simulador.
 * esperadoA: fração dos votos que faltam que A deve receber, pela mesma estimativa.
 * eleitoresRestantes: eleitores das seções ainda não totalizadas (TSE, campo esnt). É o teto:
 *   nem com todos eles votando, e votando no mesmo candidato, aparecem mais votos do que isso.
 * Devolve quem está atrás, a diferença e a fração dos votos restantes de que ele precisa.
 */
export function situacaoVirada({ a, b, faltam, esperadoA, eleitoresRestantes }) {
  const atras = a >= b ? 'B' : 'A';
  const diferenca = Math.abs(a - b);
  const precisa = (R) => (R > 0 ? (diferenca + R) / (2 * R) : Infinity);
  const teto = Math.max(0, eleitoresRestantes || 0);
  return {
    atras, diferenca, faltam, teto,
    // fração dos votos válidos que faltam (estimativa) de que quem está atrás precisa para empatar
    precisa: precisa(faltam),
    // quanto quem está atrás deve receber, pela estimativa
    recebe: esperadoA == null ? null : atras === 'A' ? esperadoA : 1 - esperadoA,
    // conta só com dados oficiais: a diferença é maior que todos os eleitores que faltam
    impossivel: diferenca > teto,
    precisaNoTeto: precisa(teto),
  };
}

/**
 * Resultado final do cenário.
 * opcoes.modo: 'nacional' (uma fração para o país) ou 'regional' (uma por região)
 * opcoes.shareNacional: fração de A nos votos que faltam (0..1); null = esperado
 * opcoes.shareRegiao: { regiao: fração } no modo regional
 * opcoes.comparecimento: multiplicador do restante (1 = como estimado)
 * opcoes.ajustes: [{ votos, para: 'A'|'B', origem: 'adversario'|'novos' }]
 */
export function cenarioFinal(pp, opcoes = {}) {
  const { modo = 'nacional', shareNacional = null, shareRegiao = {}, comparecimento = 1, ajustes = [], incerteza } = opcoes;
  const grupos = Object.values(agruparPorRegiao(pp));
  const k = Math.max(0, comparecimento);
  const Ac = grupos.reduce((s, g) => s + g.a, 0);
  const Bc = grupos.reduce((s, g) => s + g.b, 0);
  const R0 = grupos.reduce((s, g) => s + g.rem, 0);
  const R = R0 * k;
  const esperado = R0 ? grupos.reduce((s, g) => s + g.rem * g.share, 0) / R0 : 0.5;

  let shares;
  if (modo === 'regional') shares = grupos.map((g) => clamp(shareRegiao[g.regiao] ?? g.share));
  else shares = shareNacional === null || shareNacional === undefined ? grupos.map((g) => g.share) : deslocar(grupos, clamp(shareNacional));

  const regioes = {};
  let A = 0, B = 0;
  grupos.forEach((g, i) => {
    const ra = g.a + g.rem * k * shares[i], rb = g.b + g.rem * k * (1 - shares[i]);
    regioes[g.regiao] = { regiao: g.regiao, A: ra, B: rb, pA: ra + rb ? (ra / (ra + rb)) * 100 : 0, share: shares[i], rem: g.rem * k, a: g.a, b: g.b };
    A += ra; B += rb;
  });
  const shareUsado = R ? (A - Ac) / R : esperado;

  // Ajustes manuais em votos válidos nacionais
  let dA = 0, dB = 0;
  const aplicados = [];
  for (const aj of ajustes) {
    const X = Math.max(0, Number(aj.votos) || 0);
    const para = aj.para === 'B' ? 'B' : 'A';
    let mov = X;
    if (aj.origem === 'adversario') {
      const disp = para === 'A' ? B + dB : A + dA;
      mov = Math.min(X, disp);
      if (para === 'A') { dA += mov; dB -= mov; } else { dB += mov; dA -= mov; }
    } else if (para === 'A') dA += mov; else dB += mov;
    aplicados.push({ ...aj, aplicado: mov });
  }
  A += dA; B += dB;
  const V = A + B;

  // Ponto de virada: fração dos votos que faltam que cada um precisa para empatar
  const viradaA = R ? (Bc + dB - Ac - dA + R) / (2 * R) : null;
  const viradaB = viradaA === null ? null : 1 - viradaA;

  const items = grupos.map((g, i) => ({ fixedA: g.a, fixedB: g.b, rem: g.rem * k, share: shares[i], scale: 1 }));
  items.push({ fixedA: Math.max(0, dA), fixedB: Math.max(0, dB), rem: 0, share: 0.5, scale: 0 });
  if (dA < 0 || dB < 0) items.push({ fixedA: Math.min(0, dA), fixedB: Math.min(0, dB), rem: 0, share: 0.5, scale: 0 });

  return {
    A, B, validos: V, pA: V ? (A / V) * 100 : 0, pB: V ? (B / V) * 100 : 0, margem: A - B,
    apurado: { A: Ac, B: Bc, validos: Ac + Bc }, faltam: R, faltamEstimado: R0,
    esperado, shareUsado, viradaA, viradaB, regioes, ajustesAplicados: aplicados,
    incerteza: monteCarlo(items, incerteza || { sdNacional: 2, sdUf: 1.5, n: 2000, seed: 7 }),
  };
}
