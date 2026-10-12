// Fonte do modo de teste com dados reais: lê a pasta salva por `npm run baixar`, serve o 1º turno
// exatamente como o TSE publicou e prepara um 2º turno SIMULADO a partir dele.
//
// O 2º turno simulado parte do cenário-base do simulador (votos do 1º turno de cada estado, com os
// eleitores dos eliminados divididos pela proximidade dos partidos) e soma um deslocamento nacional
// ALEATÓRIO a cada execução. Não é previsão: serve só para ver o site funcionando.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeEA20, finalistsFrom, wentToRunoff } from '../tse/normalize.js';
import { defaultParams, simulate } from '../shared/engine.js';
import { suggestedFlow } from '../shared/presets.js';
import { rng } from './data.js';

const pad6 = (n) => String(n).padStart(6, '0');

function listar(dir, base = dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) listar(p, base, out);
    else out.push('/' + path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

export const temDadosReais = (dir) => existsSync(path.join(dir, 'manifesto.json'));

/** Uma normal padrão a partir de um gerador uniforme. */
function gauss(r) {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function paramsBase(unit, fa, fb) {
  const p = defaultParams();
  const A = unit.cands.find((c) => c.n === fa), B = unit.cands.find((c) => c.n === fb);
  for (const c of unit.cands) if (c.n !== fa && c.n !== fb) p.transferencias.global[c.n] = suggestedFlow(c.partido, A?.partido, B?.partido);
  return p;
}

export function carregarDadosReais(dir, { semente = Date.now() % 1e9 } = {}) {
  const manifesto = JSON.parse(readFileSync(path.join(dir, 'manifesto.json'), 'utf8'));
  const arquivos = new Map(listar(dir).filter((p) => p !== '/manifesto.json').map((p) => [p, path.join(dir, p)]));
  const cacheJson = new Map();
  const ler = (p) => {
    if (!cacheJson.has(p)) cacheJson.set(p, JSON.parse(readFileSync(arquivos.get(p), 'utf8')));
    return cacheJson.get(p);
  };
  const amb = manifesto.ambiente || 'oficial';
  const ciclo = manifesto.ciclo || 'ele2026';
  const fed1 = Number(manifesto.eleicoes.federal1), est1 = Number(manifesto.eleicoes.estadual1);
  const fed2 = Number(manifesto.eleicoes.federal2 || fed1 + 1), est2 = Number(manifesto.eleicoes.estadual2 || est1 + 1);
  const E = { fed1, fed2, est1, est2 };

  // 1º turno por abrangência
  const re = (cargo, ele) => new RegExp(`/dados/[a-z]{2}/((?:[a-z]{2})|zz\\d{5})-c${String(cargo).padStart(4, '0')}-e${pad6(ele)}-u\\.json$`);
  const presArq = {}, cidadesArq = {}, govArq = {};
  for (const p of arquivos.keys()) {
    let m = p.match(re(1, fed1));
    if (m) { if (m[1].length > 2) cidadesArq[m[1].slice(2)] = p; else presArq[m[1]] = p; continue; }
    m = p.match(re(3, est1));
    if (m) govArq[m[1]] = p;
  }
  if (!presArq.br) throw new Error('A pasta de dados reais não tem o arquivo nacional de Presidente. Rode `npm run baixar` de novo.');
  const presUnits = Object.fromEntries(Object.entries(presArq).map(([abr, p]) => [abr, normalizeEA20(ler(p))]));
  const brUnit = presUnits.br;
  const [fa, fb] = finalistsFrom(brUnit);
  const cand = (u, n) => {
    const c = u.cands.find((x) => x.n === n);
    return { n: c.n, nm: c.nm || c.nmu, nmu: c.nmu, partido: c.partido, sq: c.sq };
  };
  const presFin = [cand(brUnit, fa), cand(brUnit, fb)];

  // 2º turno simulado: cenário-base por estado + deslocamento nacional aleatório
  const r = rng(semente);
  const deslocNacional = Math.max(-0.05, Math.min(0.05, gauss(r) * 0.025));
  const ufUnits = Object.fromEntries(Object.entries(presUnits).filter(([abr]) => abr !== 'br'));
  const sim = simulate(ufUnits, [fa, fb], paramsBase(brUnit, fa, fb));
  const truth = { pres: {}, gov: {} };
  for (const [uf, u] of Object.entries(sim.units)) {
    const te = ufUnits[uf].eleitores.te;
    const comp = Math.round(u.A + u.B + u.BN);
    const bn = Math.round(u.BN);
    const vb = Math.round(bn * 0.35), tvn = bn - vb;
    const shareA = Math.min(0.92, Math.max(0.08, u.A / (u.A + u.B) + deslocNacional + gauss(r) * 0.01));
    truth.pres[uf] = { te, comp, vb, tvn, vv: comp - bn, shareA, speed: 1.05 + r() * 0.8, delay: r() * 0.12, earlyBias: (r() - 0.45) * 0.05 };
  }
  for (const [uf, p] of Object.entries(govArq)) {
    const u = normalizeEA20(ler(p));
    if (!wentToRunoff(u)) continue;
    const [ga, gb] = finalistsFrom(u);
    const s = simulate({ [uf]: u }, [ga, gb], paramsBase(u, ga, gb)).units[uf];
    if (!s) continue;
    const comp = Math.round(s.A + s.B + s.BN), bn = Math.round(s.BN), vb = Math.round(bn * 0.35);
    truth.gov[uf] = {
      te: u.eleitores.te, comp, vb, tvn: bn - vb, vv: comp - bn,
      shareA: Math.min(0.92, Math.max(0.08, s.A / (s.A + s.B) + gauss(r) * 0.04)),
      cands: [cand(u, ga), cand(u, gb)], speed: 1.1 + r() * 0.7, delay: r() * 0.1, earlyBias: (r() - 0.5) * 0.05,
    };
  }

  // Cidades do exterior: pesos pelo 1º turno de cada cidade
  const munP = [...arquivos.keys()].find((p) => p.endsWith(`/config/mun-e${pad6(fed1)}-cm.json`));
  const nomes = {};
  if (munP) {
    const zz = (ler(munP).abr || []).find((a) => String(a.cd).toUpperCase() === 'ZZ');
    for (const m of zz?.mu || []) nomes[m.cd] = m.nm;
  }
  const cid = Object.entries(cidadesArq).map(([cd, p]) => {
    const u = normalizeEA20(ler(p));
    const voto = (n) => u.cands.find((c) => c.n === n)?.vap || 0;
    return { cd, nm: nomes[cd] || cd, te: u.eleitores.te, a: voto(fa), b: voto(fb) };
  });
  const soma = (k) => cid.reduce((t, c) => t + c[k], 0) || 1;
  const [ST, SA, SB] = [soma('te'), soma('a'), soma('b')];
  const cidades = cid.map((c) => ({ cd: c.cd, nm: c.nm, w: c.te / ST, wA: c.a / SA, wB: c.b / SB }));

  // Fotos por número do candidato no TSE
  const fotos = new Map();
  for (const p of arquivos.keys()) { const m = p.match(/\/fotos\/[a-z]{2}\/(\d+)\.jpe?g$/); if (m) fotos.set(m[1], arquivos.get(p)); }

  // Configuração: a do TSE, com o 2º turno declarado (a lista de UFs vem dos arquivos de governador)
  const ufs2 = Object.keys(truth.gov);
  function eleC(publicar2) {
    const j = structuredClone(ler(`/${amb}/comum/config/ele-c.json`));
    for (const pl of j.pl || []) {
      pl.e = (pl.e || []).filter((e) => ![fed2, est2].includes(Number(e.cd)));
      for (const e of pl.e) {
        if (Number(e.cd) === fed1) e.cdt2 = String(fed2);
        if (Number(e.cd) === est1) e.cdt2 = String(est2);
      }
    }
    j.pl = (j.pl || []).filter((pl) => pl.e.length);
    if (publicar2) {
      j.pl.push({ cd: '9999', c: ciclo, dt: '25/10/2026', e: [
        { cd: String(fed2), cdt2: '', nm: 'Eleição Ordinária Federal - 2026 2º Turno (simulado)', t: '2', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1', ds: 'Presidente', tp: '1' }] }] },
        { cd: String(est2), cdt2: '', nm: 'Eleição Ordinária Estadual - 2026 2º Turno (simulado)', t: '2', tp: '1', abr: ufs2.map((uf) => ({ cd: uf, cp: [{ cd: '3', ds: 'Governador', tp: '1' }] })) },
      ] });
    }
    return j;
  }

  return {
    real: true, manifesto, semente, deslocNacional, amb, ciclo, E, presFin, truth, cidades,
    eleC,
    /** Arquivos do 1º turno exatamente como baixados; a lista de cidades serve também para o 2º turno. */
    arquivo(p) {
      if (p === `/${amb}/comum/config/ele-c.json`) return null;
      if (arquivos.has(p) && p.endsWith('.json')) return ler(p);
      if (munP && p === munP.replaceAll(String(fed1), String(fed2)).replace(pad6(fed1), pad6(fed2))) return ler(munP);
      return null;
    },
    foto(sq) {
      const f = fotos.get(String(sq));
      return f ? { type: 'image/jpeg', body: readFileSync(f) } : null;
    },
  };
}

/** Resumo legível do que foi baixado. */
export function fmtResumo(m) {
  const r = m.resumo;
  const pct = (x) => (Number(x) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhas = [
    `1º turno baixado do TSE (${m.origem}), configuração de ${m.configTse || '?'}.`,
    `Presidente (${pct(r.secoesPct)}% das seções, totalizado em ${r.totalizadoEm}):`,
    ...r.presidente.slice(0, 6).map((c) => `  ${c.nome.padEnd(28)} ${c.partido.padEnd(13)} ${pct(c.pct).padStart(6)}%  ${c.situacao}`),
    `Finalistas: ${r.finalistas.join(' × ')}`,
    `Eleitorado ${r.eleitorado.toLocaleString('pt-BR')}, abstenção ${pct(r.abstencaoPct)}%. Estados: ${r.estadosPresidente}. Cidades no exterior: ${r.cidadesExterior}.`,
    `Governadores: ${r.governadoresEleitos1T} eleitos no 1º turno; 2º turno em ${r.governadores2T.length} estados:`,
    ...r.governadores2T.map((g) => `  ${g.uf.toUpperCase()}: ${g.candidatos.map((c) => `${c.nome} (${c.partido}) ${pct(c.pct)}%`).join(' × ')}`),
    `Senadores eleitos: ${r.senadoresEleitos}. Arquivos: ${m.arquivos}, fotos: ${m.fotos}.`,
  ];
  if (m.avisos.length) linhas.push('Avisos:', ...m.avisos.map((a) => `  - ${a}`));
  if (m.falhas.length) linhas.push(`Arquivos que não vieram: ${m.falhas.length} (detalhes em manifesto.json)`);
  return linhas.join('\n');
}
