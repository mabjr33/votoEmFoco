// Servidor que imita a CDN de resultados do TSE (resultados.tse.jus.br) para testes.
// Serve ele-c.json (EA11) e arquivos -u.json (EA20) do 1º turno (finalizado) e de um 2º turno
// SIMULADO que avança ao longo de `durationSec` segundos.
// Duas fontes para o 1º turno: dados sintéticos com nomes fictícios (padrão) ou os arquivos reais
// do TSE salvos por `npm run baixar` (opção dadosReais).

import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  ELEITORADO, LEAN_A, PRES_CANDS, PRES_TOTAL_A, PRES_TOTAL_B, GOV_RUNOFF, govCands, senCands, rng, EXTERIOR_CIDADES,
} from './data.js';
import { carregarDadosReais } from './fonte-real.js';

const AMB = 'oficial';
const CICLO = 'ele2026';
const E = { fed1: 6257, fed2: 6258, est1: 6259, est2: 6260 };
const UFS = Object.keys(ELEITORADO).filter((u) => u !== 'zz');

const pct2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
const pct9 = (x) => (x === 0 || x === 100 ? String(x) : x.toFixed(9).replace('.', ','));
const pad = (n, s) => String(n).padStart(s, '0');
const fmtDate = (d) => `${pad(d.getDate(), 2)}/${pad(d.getMonth() + 1, 2)}/${d.getFullYear()}`;
const fmtTime = (d) => `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;

let IDG = 1000;

/** Monta um EA20 a partir de contagens. */
export function buildEA20({ ele, t, tpabr, cdabr, cargo, cargoNome, cands, te, frac = 1, comp, vb, tvn, tf, and, md, when }) {
  const est = Math.round(te * frac);
  const c = Math.round(comp * frac);
  const vv = cands.reduce((s, x) => s + x.vap, 0);
  const tv = vv + vb + tvn;
  const ts = Math.max(1, Math.round(te / 320));
  const st = Math.round(ts * frac);
  const sorted = [...cands].sort((a, b) => b.vap - a.vap);
  const agr = sorted.map((x, i) => ({
    n: x.n.slice(0, 2), nm: x.partido, tp: 'i',
    par: [{
      n: x.n.slice(0, 2), sg: x.partido, nm: x.partido, tvtn: String(x.vap), tvan: String(x.vap),
      cand: [{
        n: x.n, sqcand: x.sq || `2800${x.n}${cdabr.length}`, nm: (x.nm || x.nmu).toUpperCase(), nmu: x.nmu || x.nm, dt: '01/01/1970', dvt: 'Válido',
        seq: String(i + 1), e: x.e || 'n', st: x.st || '', vap: String(x.vap),
        pvap: pct2(vv ? (x.vap / vv) * 100 : 0), pvapn: pct9(vv ? (x.vap / vv) * 100 : 0),
        vs: [{ tp: cargo === 5 ? 's1' : 'v', sqcand: '1', nm: 'VICE', nmu: 'Vice', sgp: x.partido }],
      }],
    }],
  }));
  return {
    ele: String(ele), t: String(t), f: 'o', sup: 'n', tpabr, cdabr: cdabr.toUpperCase(),
    dg: fmtDate(when), hg: fmtTime(when), idg: String(IDG++), dv: 's',
    dt: fmtDate(when), ht: fmtTime(when), tf, and, ...(md ? { md } : {}),
    esae: 'n', mnae: [],
    carg: [{ cd: String(cargo), nmn: cargoNome, nmm: cargoNome, nmf: cargoNome, nv: '1', agr }],
    s: { ts: String(ts), st: String(st), pst: pct2((st / ts) * 100), pstn: pct9((st / ts) * 100), snt: String(ts - st) },
    e: {
      te: String(te), est: String(est), esnt: String(te - est), esi: String(est), esni: '0',
      c: String(c), pc: pct2(est ? (c / est) * 100 : 0), pcn: pct9(est ? (c / est) * 100 : 0),
      a: String(est - c), pa: pct2(est ? ((est - c) / est) * 100 : 0), pan: pct9(est ? ((est - c) / est) * 100 : 0),
    },
    v: {
      tv: String(tv), vvc: String(vv), vv: String(vv), pvv: pct2(tv ? (vv / tv) * 100 : 0),
      vnom: String(vv), van: '0', vansj: '0', vscv: '0', vb: String(vb), pvb: pct2(tv ? (vb / tv) * 100 : 0),
      tvn: String(tvn), ptvn: pct2(tv ? (tvn / tv) * 100 : 0), vn: String(tvn), vnt: '0',
    },
  };
}

function sumUnits(list) {
  const out = { te: 0, comp: 0, vb: 0, tvn: 0, votes: {} };
  for (const u of list) {
    out.te += u.te; out.comp += u.comp; out.vb += u.vb; out.tvn += u.tvn;
    for (const c of u.cands) out.votes[c.n] = (out.votes[c.n] || 0) + c.vap;
  }
  return out;
}

// ---------- exterior: divide os totais de ZZ entre as cidades (somas batem com o arquivo ZZ) ----------
const WSUM = EXTERIOR_CIDADES.reduce((s, c) => s + c.w, 0);
function dividirExterior({ te, comp, vb, tvn, cands }) {
  const fator = (cid, n) => (n === '22' ? 1 + cid.d : n === '13' ? 1 - cid.d : 1);
  const norm = {};
  for (const c of cands) norm[c.n] = EXTERIOR_CIDADES.reduce((s, cid) => s + cid.w * fator(cid, c.n), 0);
  return EXTERIOR_CIDADES.map((cid) => {
    const w = cid.w / WSUM;
    return {
      cd: cid.cd, nm: cid.nm, te: Math.round(te * w), comp: Math.round(comp * w), vb: Math.round(vb * w), tvn: Math.round(tvn * w),
      cands: cands.map((c) => ({ ...c, vap: Math.round((c.vap * cid.w * fator(cid, c.n)) / norm[c.n]) })),
    };
  });
}

/** Divide totais do exterior entre as cidades com pesos { w (eleitorado), wA, wB (votos de cada finalista) }. */
function dividir2T(cidades, { te, comp, vb, tvn, A, B }) {
  return cidades.map((c) => ({
    cd: c.cd, nm: c.nm, te: Math.round(te * c.w), comp: Math.round(comp * c.w), vb: Math.round(vb * c.w), tvn: Math.round(tvn * c.w),
    A: Math.round(A * c.wA), B: Math.round(B * c.wB),
  }));
}

export function configMunicipios() {
  return {
    dg: '02/10/2026', hg: '18:00:00', f: 'o',
    abr: [
      { cd: 'AC', ds: 'ACRE', mu: [{ cd: '01120', cdi: '1200013', nm: 'ACRELÂNDIA', c: 'N', s: 'S', z: ['0008'] }] },
      { cd: 'ZZ', ds: 'EXTERIOR', mu: EXTERIOR_CIDADES.map((c) => ({ cd: c.cd, cdi: '', nm: c.nm, c: 'N', s: 'S', z: ['0001'] })) },
    ],
  };
}

// ---------- 1º turno (estático, finalizado) ----------
function buildFirstRound(when) {
  const files = new Map();
  const units = {};
  const others = PRES_CANDS.filter((c) => c.share);
  const otherShare = others.reduce((s, c) => s + c.share, 0);
  let rawA = 0, rawB = 0;
  for (const uf of Object.keys(ELEITORADO)) {
    const te = Math.round(ELEITORADO[uf] * 1e6);
    const comp = Math.round(te * (uf === 'zz' ? 0.35 : 0.795));
    const vb = Math.round(comp * 0.021), tvn = Math.round(comp * 0.034);
    const vv = comp - vb - tvn;
    const ab = vv * (1 - otherShare);
    const a = ab * LEAN_A[uf];
    units[uf] = { te, comp, vb, tvn, a, b: ab - a, vv };
    rawA += a; rawB += ab - a;
  }
  const kA = PRES_TOTAL_A / rawA, kB = PRES_TOTAL_B / rawB;
  const presByUf = {};
  for (const [uf, u] of Object.entries(units)) {
    const A = Math.round(u.a * kA), B = Math.round(u.b * kB);
    const cands = [
      { ...PRES_CANDS[0], vap: A, st: '2º turno', e: 's' },
      { ...PRES_CANDS[1], vap: B, st: '2º turno', e: 's' },
      ...others.map((c) => ({ ...c, vap: Math.round(u.vv * c.share), st: 'Não eleito', e: 'n' })),
    ];
    const comp = A + B + cands.slice(2).reduce((s, c) => s + c.vap, 0) + u.vb + u.tvn;
    presByUf[uf] = { te: u.te, comp, vb: u.vb, tvn: u.tvn, cands };
    files.set(`${uf}-c0001-e00${E.fed1}`, buildEA20({
      ele: E.fed1, t: 1, tpabr: 'uf', cdabr: uf, cargo: 1, cargoNome: 'Presidente', cands, te: u.te, comp, vb: u.vb, tvn: u.tvn, tf: 's', and: 'f', when,
    }));
  }
  for (const c of dividirExterior(presByUf.zz)) {
    files.set(`zz${c.cd}-c0001-e00${E.fed1}`, buildEA20({
      ele: E.fed1, t: 1, tpabr: 'mu', cdabr: c.cd, cargo: 1, cargoNome: 'Presidente', cands: c.cands, te: c.te, comp: c.comp, vb: c.vb, tvn: c.tvn, tf: 's', and: 'f', when,
    }));
  }
  const br = sumUnits(Object.values(presByUf));
  files.set(`br-c0001-e00${E.fed1}`, buildEA20({
    ele: E.fed1, t: 1, tpabr: 'br', cdabr: 'br', cargo: 1, cargoNome: 'Presidente',
    cands: presByUf.sp.cands.map((c) => ({ ...c, vap: br.votes[c.n] })), te: br.te, comp: br.comp, vb: br.vb, tvn: br.tvn, tf: 's', and: 'f', when,
  }));

  const govByUf = {};
  for (const uf of UFS) {
    const r = rng(uf.charCodeAt(0) * 31 + uf.charCodeAt(1));
    const p = presByUf[uf];
    const vv = p.comp - p.vb - p.tvn;
    for (const [cargo, nome, list] of [[3, 'Governador', govCands(uf, r)], [5, 'Senador', senCands(uf, r)]]) {
      const cands = list.map((c) => ({ ...c, vap: Math.round(vv * c.p * (cargo === 5 ? 1.6 : 1)) }));
      if (cargo === 3) govByUf[uf] = { te: p.te, comp: p.comp, vb: p.vb, tvn: p.tvn, cands };
      files.set(`${uf}-c${pad(cargo, 4)}-e00${E.est1}`, buildEA20({
        ele: E.est1, t: 1, tpabr: 'uf', cdabr: uf, cargo, cargoNome: nome, cands, te: p.te, comp: p.comp, vb: p.vb, tvn: p.tvn, tf: 's', and: 'f', when,
      }));
    }
  }
  return { files, presByUf, govByUf };
}

// ---------- 2º turno (dinâmico) ----------
function secondRoundTruth(presByUf, govByUf) {
  const truth = { pres: {}, gov: {} };
  for (const [uf, p] of Object.entries(presByUf)) {
    const r = rng(uf.charCodeAt(1) * 97 + 7);
    const comp = Math.round(p.comp * (0.975 + r() * 0.02));
    const vb = Math.round(comp * 0.015), tvn = Math.round(comp * 0.03);
    const vv = comp - vb - tvn;
    const shareA = Math.min(0.85, Math.max(0.15, LEAN_A[uf] + 0.008 + (r() - 0.5) * 0.03));
    truth.pres[uf] = {
      te: p.te, comp, vb, tvn, shareA, vv,
      speed: 1.05 + r() * 0.8, delay: r() * 0.12, earlyBias: (r() - 0.4) * 0.06,
    };
  }
  for (const uf of Object.keys(GOV_RUNOFF)) {
    const r = rng(uf.charCodeAt(0) * 13 + 3);
    const [a, b] = GOV_RUNOFF[uf];
    const g = govByUf[uf];
    const comp = Math.round(g.comp * 0.97), vb = Math.round(comp * 0.03), tvn = Math.round(comp * 0.05);
    const shareA = a.p / (a.p + b.p) + (r() - 0.5) * 0.08;
    truth.gov[uf] = { te: g.te, comp, vb, tvn, vv: comp - vb - tvn, shareA, cands: [a, b], speed: 1.1 + r() * 0.7, delay: r() * 0.1, earlyBias: (r() - 0.5) * 0.06 };
  }
  return truth;
}

function progressOf(t, phase) {
  return Math.max(0, Math.min(1, ((phase - t.delay) / (1 - t.delay)) * t.speed));
}

function liveUnit(t, frac) {
  const share = Math.min(0.95, Math.max(0.05, t.shareA + t.earlyBias * (1 - frac)));
  const vv = Math.round(t.vv * frac);
  const A = Math.round(vv * share);
  return { A, B: vv - A, comp: Math.round(t.comp * frac), vb: Math.round(t.vb * frac), tvn: Math.round(t.tvn * frac) };
}

function fonteSintetica() {
  const t0 = new Date('2026-10-04T21:30:00Z');
  const first = buildFirstRound(t0);
  const truth = secondRoundTruth(first.presByUf, first.govByUf);
  const normA = EXTERIOR_CIDADES.reduce((t, c) => t + c.w * (1 + c.d), 0), normB = EXTERIOR_CIDADES.reduce((t, c) => t + c.w * (1 - c.d), 0);
  return {
    real: false, amb: AMB, ciclo: CICLO, E, truth,
    presFin: [PRES_CANDS[0], PRES_CANDS[1]].map((c) => ({ ...c, nmu: c.nm, sq: `2800${c.n}2` })),
    cidades: EXTERIOR_CIDADES.map((c) => ({ cd: c.cd, nm: c.nm, w: c.w / WSUM, wA: (c.w * (1 + c.d)) / normA, wB: (c.w * (1 - c.d)) / normB })),
    eleC: eleCSintetico,
    arquivo(p) {
      const cm = p.match(new RegExp(`^/${AMB}/${CICLO}/(\\d+)/config/mun-e(\\d{6})-cm\\.json$`));
      if (cm && Number(cm[1]) === Number(cm[2]) && [E.fed1, E.fed2].includes(Number(cm[1]))) return configMunicipios();
      const m = p.match(new RegExp(`^/${AMB}/${CICLO}/(\\d+)/dados/([a-z]{2})/((?:[a-z]{2}|zz\\d{5})-c\\d{4}-e\\d{6})-u\\.json$`));
      const body = m && m[2] === m[3].slice(0, 2) ? first.files.get(m[3]) : null;
      return body && Number(m[1]) === Number(body.ele) ? body : null;
    },
    foto(sq) {
      // Retrato genérico (silhueta) — o TSE real serve JPEG com a foto do registro de candidatura
      const h = (Number(sq) * 47) % 360;
      return { type: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl(${h} 18% 32%)"/><circle cx="40" cy="31" r="14" fill="hsl(${h} 15% 62%)"/><path d="M12 80c2-18 14-26 28-26s26 8 28 26z" fill="hsl(${h} 15% 62%)"/></svg>` };
    },
  };
}

function eleCSintetico(publish2nd) {
  const est2Abr = Object.keys(GOV_RUNOFF).map((uf) => ({ cd: uf, cp: [{ cd: '3', ds: 'Governador', tp: '1' }] }));
  return {
    dg: '09/10/2026', hg: '10:00:00', f: 'o', idg: '1',
    arq: [{ tp: 'u', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>' }, { tp: 'ab', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>' },
      { tp: 'cm', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/config' }, { tp: 'ft', dir: '<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>' }],
    pl: [
      { cd: '3220', cdpr: '1219', c: CICLO, dt: '04/10/2026', dtlim: '04/10/2034', e: [
        { cd: String(E.fed1), cdt2: String(E.fed2), nm: 'Eleição Ordinária Federal - 2026 1º Turno', t: '1', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1', ds: 'Presidente', tp: '1' }] }] },
        { cd: String(E.est1), cdt2: String(E.est2), nm: 'Eleição Ordinária Estadual - 2026 1º Turno', t: '1', tp: '1', abr: [{ cd: 'br', cp: [{ cd: '3', ds: 'Governador', tp: '1' }, { cd: '5', ds: 'Senador', tp: '1' }] }] },
      ] },
      ...(publish2nd ? [{ cd: '3221', cdpr: '1219', c: CICLO, dt: '25/10/2026', dtlim: '25/10/2034', e: [
        { cd: String(E.fed2), cdt2: '', nm: 'Eleição Ordinária Federal - 2026 2º Turno', t: '2', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1', ds: 'Presidente', tp: '1' }] }] },
        { cd: String(E.est2), cdt2: '', nm: 'Eleição Ordinária Estadual - 2026 2º Turno', t: '2', tp: '1', abr: est2Abr },
      ] }] : []),
    ],
  };
}

/**
 * opções: durationSec, startDelaySec, publish2nd, dadosReais (pasta de `npm run baixar`), semente (sorteio do 2º turno real)
 */
export function createMockTse({ durationSec = 180, startDelaySec = 5, publish2nd = true, dadosReais = null, semente } = {}) {
  const fonte = dadosReais ? carregarDadosReais(dadosReais, { semente }) : fonteSintetica();
  const { truth, presFin, cidades } = fonte;
  const AMBX = fonte.amb, CICLOX = fonte.ciclo, EX = fonte.E;
  const startedAt = Date.now() + startDelaySec * 1000;
  const STEP = Math.min(3000, (durationSec * 1000) / 10); // os "arquivos" mudam a cada STEP ms

  function phase() {
    const elapsed = Math.floor((Date.now() - startedAt) / STEP) * STEP;
    return Math.max(0, Math.min(1, elapsed / (durationSec * 1000)));
  }

  function secondRoundFile(key) {
    const m = key.match(/^([a-z]{2}|zz\d{5})-c(\d{4})-e(\d{6})$/);
    if (!m) return null;
    const [, abr, cargoS, eleS] = m;
    const cargo = Number(cargoS), ele = Number(eleS);
    const ph = phase();
    const when = new Date(Date.parse('2026-10-25T20:00:00Z') + ph * 3 * 3600_000);
    const done = ph >= 1;
    if (abr.length > 2) {
      if (ele !== EX.fed2 || cargo !== 1 || !truth.pres.zz) return null;
      const t = truth.pres.zz;
      const frac = progressOf(t, ph);
      const lu = liveUnit(t, frac);
      const cid = dividir2T(cidades, { te: t.te, comp: lu.comp, vb: lu.vb, tvn: lu.tvn, A: lu.A, B: lu.B }).find((c) => `zz${c.cd}` === abr);
      if (!cid) return null;
      return buildEA20({
        ele, t: 2, tpabr: 'mu', cdabr: cid.cd, cargo: 1, cargoNome: 'Presidente', cands: [{ ...presFin[0], vap: cid.A, e: 'n', st: '' }, { ...presFin[1], vap: cid.B, e: 'n', st: '' }],
        te: cid.te, frac, comp: cid.comp / Math.max(frac, 1e-9), vb: cid.vb, tvn: cid.tvn,
        tf: 'n', and: frac === 0 ? 'n' : frac >= 1 ? 'f' : 'p', when,
      });
    }
    if (ele === EX.fed2 && cargo === 1) {
      const ufs = abr === 'br' ? Object.keys(truth.pres) : truth.pres[abr] ? [abr] : null;
      if (!ufs) return null;
      let te = 0, comp = 0, vb = 0, tvn = 0, A = 0, B = 0, est = 0;
      for (const uf of ufs) {
        const t = truth.pres[uf];
        const frac = progressOf(t, ph);
        const lu = liveUnit(t, frac);
        te += t.te; est += t.te * frac; comp += lu.comp; vb += lu.vb; tvn += lu.tvn; A += lu.A; B += lu.B;
      }
      const frac = te ? est / te : 0;
      const finalTot = frac >= 1;
      const ganhaA = A >= B;
      const cands = [
        { ...presFin[0], vap: A, e: finalTot && ganhaA ? 's' : 'n', st: finalTot ? (ganhaA ? 'Eleito' : 'Não eleito') : '' },
        { ...presFin[1], vap: B, e: finalTot && !ganhaA ? 's' : 'n', st: finalTot ? (!ganhaA ? 'Eleito' : 'Não eleito') : '' },
      ];
      return buildEA20({
        ele, t: 2, tpabr: abr === 'br' ? 'br' : 'uf', cdabr: abr, cargo: 1, cargoNome: 'Presidente', cands, te, frac, comp: comp / Math.max(frac, 1e-9), vb, tvn,
        tf: abr === 'br' && done ? 's' : 'n', and: frac === 0 ? 'n' : frac >= 1 ? 'f' : 'p', when,
      });
    }
    if (ele === EX.est2 && cargo === 3 && truth.gov[abr]) {
      const t = truth.gov[abr];
      const frac = progressOf(t, ph);
      const lu = liveUnit(t, frac);
      const fin = frac >= 1;
      const [a, b] = t.cands;
      const winA = lu.A >= lu.B;
      const cands = [
        { ...a, vap: lu.A, e: fin && winA ? 's' : 'n', st: fin ? (winA ? 'Eleito' : 'Não eleito') : '' },
        { ...b, vap: lu.B, e: fin && !winA ? 's' : 'n', st: fin ? (!winA ? 'Eleito' : 'Não eleito') : '' },
      ];
      return buildEA20({
        ele, t: 2, tpabr: 'uf', cdabr: abr, cargo: 3, cargoNome: 'Governador', cands, te: t.te, frac, comp: t.comp, vb: lu.vb, tvn: lu.tvn,
        tf: fin ? 's' : 'n', and: frac === 0 ? 'n' : fin ? 'f' : 'p', when,
      });
    }
    return null;
  }

  const stats = { requests: 0, notFound: 0, notModified: 0 };

  const server = http.createServer((req, res) => {
    stats.requests++;
    const p = new URL(req.url, 'http://x').pathname;
    let body = null;
    const ft = p.match(new RegExp(`^/${AMBX}/${CICLOX}/\\d+/fotos/[a-z]{2}/(\\d+)\\.jpeg$`));
    if (ft) {
      const f = fonte.foto(ft[1]);
      if (!f) { stats.notFound++; res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': f.type });
      return res.end(f.body);
    }
    if (p === `/${AMBX}/comum/config/ele-c.json`) body = fonte.eleC(publish2nd);
    else body = fonte.arquivo(p);
    if (!body && publish2nd) {
      const m = p.match(new RegExp(`^/${AMBX}/${CICLOX}/(\\d+)/dados/([a-z]{2})/((?:[a-z]{2}|zz\\d{5})-c\\d{4}-e(\\d{6}))-u\\.json$`));
      if (m && m[2] === m[3].slice(0, 2) && Number(m[1]) === Number(m[4]) && [EX.fed2, EX.est2].includes(Number(m[1]))) body = secondRoundFile(m[3]);
    }
    if (!body) { stats.notFound++; res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not Found'); }
    const json = JSON.stringify(body, (k, v) => (k === 'idg' ? undefined : v));
    const etag = `"${createHash('sha1').update(json).digest('hex').slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) { stats.notModified++; res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag, 'Access-Control-Allow-Origin': '*' });
    res.end(json);
  });

  return { server, stats, phase, truth, fonte };
}
