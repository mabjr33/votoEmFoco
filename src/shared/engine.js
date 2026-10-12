// Motor de simulação de 2º turno — usado no navegador (tempo real) e no servidor (testes).
// Tudo aqui é HIPOTÉTICO: parte dos votos OFICIAIS do 1º turno por UF e aplica premissas
// (transferências, abstenção, apoios, ajustes) definidas pelo usuário.
//
// Unidade (normalizada de EA20): { cd, cands:[{n,vap}], votos:{vb,tvn}, eleitores:{te,a,est,esnt}, ... }

export const FLOW_KEYS = ['A', 'B', 'bn', 'abst'];

export function defaultParams() {
  return {
    // Eleitores de cada finalista no 1º turno
    retencao: {
      A: { stay: 0.95, toOther: 0.01, bn: 0.015, abst: 0.025 },
      B: { stay: 0.95, toOther: 0.01, bn: 0.015, abst: 0.025 },
    },
    // Eleitores dos candidatos eliminados: global[n] e porUf[uf][n]
    transferencias: { global: {}, porUf: {} },
    padraoEliminados: { A: 0.35, B: 0.35, bn: 0.15, abst: 0.15 },
    // Quem votou branco/nulo no 1º turno
    brancoNulo: { A: 0.08, B: 0.08, bn: 0.72, abst: 0.12 },
    // Quem se absteve no 1º turno
    abstencao: { A: 0.035, B: 0.035, bn: 0.01, abst: 0.92 },
    ajusteAbstencaoPp: 0,
    swingPp: 0,
    apoios: [],
    ajustes: [],
    incerteza: { sdNacional: 2.0, sdUf: 1.5, n: 2000, seed: 42 },
  };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x) => clamp(Number(x) || 0, 0, 1);

export function normFlow(f, fallback = { A: 0.25, B: 0.25, bn: 0.25, abst: 0.25 }) {
  const out = {};
  let s = 0;
  for (const k of FLOW_KEYS) { out[k] = Math.max(0, Number(f?.[k]) || 0); s += out[k]; }
  if (s <= 0) return normFlow(fallback);
  for (const k of FLOW_KEYS) out[k] /= s;
  return out;
}

function retFlow(r, self) {
  return self === 'A'
    ? normFlow({ A: r.stay, B: r.toOther, bn: r.bn, abst: r.abst })
    : normFlow({ A: r.toOther, B: r.stay, bn: r.bn, abst: r.abst });
}

export function flowFor(p, uf, n) {
  return normFlow(p.transferencias?.porUf?.[uf]?.[n] || p.transferencias?.global?.[n] || p.padraoEliminados);
}

export function unitBase(u, fa, fb) {
  let A1 = 0, B1 = 0;
  const others = [];
  for (const c of u.cands || []) {
    if (c.n === fa) A1 += c.vap;
    else if (c.n === fb) B1 += c.vap;
    else others.push({ n: c.n, vap: c.vap });
  }
  const BN1 = (u.votos?.vb || 0) + (u.votos?.tvn || 0);
  const te = u.eleitores?.te || 0;
  let AB1 = u.eleitores?.a || 0;
  if (!AB1 && te) AB1 = Math.max(0, te - (A1 + B1 + BN1 + others.reduce((s, o) => s + o.vap, 0)));
  return { A1, B1, BN1, AB1, te, others };
}

function applyAdj(st, aj) {
  const X = Math.max(0, Number(aj.votos) || 0);
  const to = aj.para === 'B' ? 'B' : 'A';
  const opp = to === 'A' ? 'B' : 'A';
  const srcKey = aj.origem === 'adversario' ? opp : aj.origem === 'brancoNulo' ? 'BN' : 'AB';
  const moved = Math.min(X, st[srcKey]);
  st[srcKey] -= moved;
  st[to] += moved;
  return moved;
}

function mergeParams(params) {
  const d = defaultParams();
  const p = { ...d, ...(params || {}) };
  p.retencao = { A: { ...d.retencao.A, ...(params?.retencao?.A || {}) }, B: { ...d.retencao.B, ...(params?.retencao?.B || {}) } };
  p.transferencias = { global: params?.transferencias?.global || {}, porUf: params?.transferencias?.porUf || {} };
  p.incerteza = { ...d.incerteza, ...(params?.incerteza || {}) };
  p.apoios = Array.isArray(params?.apoios) ? params.apoios : [];
  p.ajustes = Array.isArray(params?.ajustes) ? params.ajustes : [];
  return p;
}

/**
 * Simula o 2º turno.
 * @param baseline {[cd]: unidade do 1º turno}
 * @param finalists [nA, nB]
 */
export function simulate(baseline, finalists, params) {
  const p = mergeParams(params);
  const [fa, fb] = finalists;
  const units = {};
  const total = { A: 0, B: 0, BN: 0, AB: 0, te: 0, A1: 0, B1: 0 };
  const log = [];

  for (const [cd, u] of Object.entries(baseline || {})) {
    const b = unitBase(u, fa, fb);
    const st = { A: 0, B: 0, BN: 0, AB: 0 };
    const add = (mass, f) => { st.A += mass * f.A; st.B += mass * f.B; st.BN += mass * f.bn; st.AB += mass * f.abst; };
    add(b.A1, retFlow(p.retencao.A, 'A'));
    add(b.B1, retFlow(p.retencao.B, 'B'));
    for (const o of b.others) add(o.vap, flowFor(p, cd, o.n));
    add(b.BN1, normFlow(p.brancoNulo));
    add(b.AB1, normFlow(p.abstencao));

    // Ajuste de abstenção (pp do eleitorado): + aumenta abstenção, − reduz
    const dAb = (Number(p.ajusteAbstencaoPp) || 0) / 100 * b.te;
    if (dAb > 0) {
      const voters = st.A + st.B + st.BN;
      const m = Math.min(dAb, voters);
      if (voters > 0) { const k = 1 - m / voters; st.A *= k; st.B *= k; st.BN *= k; st.AB += m; }
    } else if (dAb < 0) {
      const m = Math.min(-dAb, st.AB);
      const voters = st.A + st.B + st.BN;
      if (voters > 0) { st.A += m * st.A / voters; st.B += m * st.B / voters; st.BN += m * st.BN / voters; st.AB -= m; }
    }

    // Apoios: fração `forca` dos eleitores do apoiador que estariam com o adversário migra.
    // Premissa: eleitores do apoiador distribuem-se como o eleitorado da UF.
    for (const ap of p.apoios) {
      if (ap.uf !== cd) continue;
      const to = ap.para === 'B' ? 'B' : 'A';
      const opp = to === 'A' ? 'B' : 'A';
      const mv = clamp01(ap.forca) * clamp01(ap.share) * st[opp];
      st[opp] -= mv; st[to] += mv;
    }

    // Swing uniforme em pontos percentuais dos votos válidos (positivo favorece A)
    if (p.swingPp) {
      const V = st.A + st.B;
      const newA = clamp(st.A + (p.swingPp / 100) * V, 0, V);
      st.B = V - newA; st.A = newA;
    }

    for (const aj of p.ajustes) {
      if (aj.escopo === cd) log.push({ ...aj, aplicado: applyAdj(st, aj) });
    }

    const V = st.A + st.B;
    units[cd] = {
      cd, ...st, te: b.te, validos: V,
      pctA: V ? (st.A / V) * 100 : 0,
      pctB: V ? (st.B / V) * 100 : 0,
      comparecimento: st.A + st.B + st.BN,
      base: { A1: b.A1, B1: b.B1, BN1: b.BN1, AB1: b.AB1, outros: b.others.reduce((s, o) => s + o.vap, 0) },
    };
    total.A += st.A; total.B += st.B; total.BN += st.BN; total.AB += st.AB; total.te += b.te;
    total.A1 += b.A1; total.B1 += b.B1;
  }

  for (const aj of p.ajustes) {
    if (aj.escopo === 'br') log.push({ ...aj, aplicado: applyAdj(total, aj) });
  }
  const V = total.A + total.B;
  total.validos = V;
  total.pctA = V ? (total.A / V) * 100 : 0;
  total.pctB = V ? (total.B / V) * 100 : 0;
  total.margem = total.A - total.B;
  total.comparecimento = total.A + total.B + total.BN;
  total.pctAbst = total.te ? (total.AB / total.te) * 100 : 0;
  total.pctBN = total.comparecimento ? (total.BN / total.comparecimento) * 100 : 0;
  return { units, total, finalists, ajustesAplicados: log };
}

// ---------- Incerteza (Monte Carlo) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * items: [{ fixedA, fixedB, rem, share (0..1, fração de A no restante), scale (0..1) }]
 * Erro = componente nacional correlacionado + componente por UF, ambos multiplicados por `scale`.
 */
export function monteCarlo(items, { sdNacional = 2, sdUf = 1.5, n = 2000, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const draws = new Float64Array(n);
  let winsA = 0;
  for (let i = 0; i < n; i++) {
    const zN = gauss(rng) * sdNacional / 100;
    let A = 0, V = 0;
    for (const it of items) {
      const s = clamp(it.share + it.scale * (zN + gauss(rng) * sdUf / 100), 0, 1);
      A += it.fixedA + s * it.rem;
      V += it.fixedA + it.fixedB + it.rem;
    }
    const pct = V ? (A / V) * 100 : 50;
    draws[i] = pct;
    if (pct > 50) winsA++;
  }
  const sorted = Array.from(draws).sort((a, b) => a - b);
  const bins = new Array(41).fill(0); // 30%..70% em passos de 1pp
  for (const d of sorted) bins[clamp(Math.round(d) - 30, 0, 40)]++;
  return {
    pVitoriaA: winsA / n,
    pVitoriaB: 1 - winsA / n,
    p05: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    histograma: bins.map((c) => c / n),
    n,
  };
}

export function simulationItems(result) {
  return Object.values(result.units).map((u) => ({ fixedA: 0, fixedB: 0, rem: u.validos, share: u.validos ? u.A / u.validos : 0.5, scale: 1 }));
}

export function simulateWithUncertainty(baseline, finalists, params) {
  const res = simulate(baseline, finalists, params);
  const inc = mergeParams(params).incerteza;
  res.incerteza = monteCarlo(simulationItems(res), inc);
  return res;
}

/** Encontra o swing uniforme (pp) que faz o resultado nacional bater com uma pesquisa. */
export function calibrateSwing(baseline, finalists, params, targetPctA) {
  let lo = -40, hi = 40;
  const at = (s) => simulate(baseline, finalists, { ...params, swingPp: s }).total.pctA;
  if (at(lo) > targetPctA || at(hi) < targetPctA) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < targetPctA) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

/**
 * Projeção durante a apuração: votos já totalizados + estimativa do restante por UF.
 * O restante de cada UF combina a tendência observada com o cenário do simulador (prior),
 * ponderados pelo volume apurado (kappa = peso do prior em fração do eleitorado).
 */
export function liveProjection(liveUnits, prior, finalists, { kappa = 0.03, incerteza } = {}) {
  const [fa, fb] = finalists;
  const items = [];
  const units = {};
  let A = 0, B = 0, Aobs = 0, Bobs = 0, teTot = 0, estTot = 0;
  for (const [cd, pu] of Object.entries(prior.units)) {
    const lu = liveUnits?.[cd];
    const te = lu?.eleitores?.te || pu.te || 0;
    const est = lu?.eleitores?.est || 0;
    const esnt = lu ? lu.eleitores.esnt : te;
    let a = 0, b = 0;
    for (const c of lu?.cands || []) { if (c.n === fa) a += c.vap; else if (c.n === fb) b += c.vap; }
    const vObs = a + b;
    const priorShare = pu.validos ? pu.A / pu.validos : 0.5;
    const priorRate = te ? pu.validos / te : 0;
    const rate = est > 0.02 * te && vObs > 0 ? vObs / est : priorRate;
    const rem = Math.max(0, rate * esnt);
    const n0 = kappa * te * (priorRate || rate);
    const share = vObs + n0 > 0 ? (a + n0 * priorShare) / (vObs + n0) : priorShare;
    const projA = a + share * rem;
    const projB = b + (1 - share) * rem;
    const scale = vObs + rem > 0 ? rem / (vObs + rem) : 1;
    items.push({ fixedA: a, fixedB: b, rem, share, scale });
    units[cd] = {
      cd, A: projA, B: projB, validos: projA + projB,
      pctA: projA + projB ? (projA / (projA + projB)) * 100 : 0,
      pctB: projA + projB ? (projB / (projA + projB)) * 100 : 0,
      apuradoPct: te ? (est / te) * 100 : 0,
      obsPctA: vObs ? (a / vObs) * 100 : null,
    };
    A += projA; B += projB; Aobs += a; Bobs += b; teTot += te; estTot += est;
  }
  const V = A + B;
  return {
    units,
    total: {
      A, B, validos: V,
      pctA: V ? (A / V) * 100 : 0, pctB: V ? (B / V) * 100 : 0,
      apuradoA: Aobs, apuradoB: Bobs,
      eleitoradoApuradoPct: teTot ? (estTot / teTot) * 100 : 0,
    },
    incerteza: monteCarlo(items, incerteza || defaultParams().incerteza),
  };
}
