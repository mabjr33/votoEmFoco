import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, defaultParams, calibrateSwing, liveProjection, monteCarlo, normFlow } from '../src/shared/engine.js';
import { suggestedFlow } from '../src/shared/presets.js';

const unit = (cd, A, B, C, bn, abst) => ({
  cd,
  cands: [{ n: 'A', vap: A }, { n: 'B', vap: B }, { n: 'C', vap: C }],
  votos: { vb: bn / 2, tvn: bn / 2 },
  eleitores: { te: A + B + C + bn + abst, a: abst, est: A + B + C + bn + abst, esnt: 0 },
  secoes: { pst: 100 },
});

const base = { xx: unit('xx', 400, 400, 200, 100, 300), yy: unit('yy', 300, 500, 100, 50, 150) };

test('conserva o eleitorado (votos + brancos/nulos + abstenção = eleitores)', () => {
  const r = simulate(base, ['A', 'B'], defaultParams());
  for (const u of Object.values(r.units)) {
    assert.ok(Math.abs(u.A + u.B + u.BN + u.AB - u.te) < 1e-6, `unidade ${u.cd}`);
  }
  assert.ok(Math.abs(r.total.pctA + r.total.pctB - 100) < 1e-9);
});

test('transferência total do 3º colocado para A move o resultado na direção certa', () => {
  const p = defaultParams();
  const r0 = simulate(base, ['A', 'B'], p);
  p.transferencias.global.C = { A: 1, B: 0, bn: 0, abst: 0 };
  const r1 = simulate(base, ['A', 'B'], p);
  assert.ok(r1.total.pctA > r0.total.pctA);
});

test('ajuste manual "do adversário" desloca exatamente X votos', () => {
  const p = defaultParams();
  const r0 = simulate(base, ['A', 'B'], p);
  p.ajustes = [{ votos: 50, para: 'A', origem: 'adversario', escopo: 'br' }];
  const r1 = simulate(base, ['A', 'B'], p);
  assert.ok(Math.abs(r1.total.A - r0.total.A - 50) < 1e-6);
  assert.ok(Math.abs(r0.total.B - r1.total.B - 50) < 1e-6);
  assert.equal(r1.ajustesAplicados[0].aplicado, 50);
});

test('ajuste vindo da abstenção aumenta o comparecimento', () => {
  const p = defaultParams();
  const r0 = simulate(base, ['A', 'B'], p);
  p.ajustes = [{ votos: 30, para: 'B', origem: 'abstencao', escopo: 'yy' }];
  const r1 = simulate(base, ['A', 'B'], p);
  assert.ok(Math.abs(r1.total.comparecimento - r0.total.comparecimento - 30) < 1e-6);
});

test('ajuste não retira mais votos do que existem na origem', () => {
  const p = defaultParams();
  p.ajustes = [{ votos: 1e9, para: 'A', origem: 'brancoNulo', escopo: 'xx' }];
  const r = simulate(base, ['A', 'B'], p);
  assert.ok(r.units.xx.BN >= -1e-9);
  assert.ok(r.ajustesAplicados[0].aplicado < 1e9);
});

test('apoio só afeta a UF indicada', () => {
  const p = defaultParams();
  const r0 = simulate(base, ['A', 'B'], p);
  p.apoios = [{ uf: 'yy', para: 'A', share: 0.5, forca: 0.2 }];
  const r1 = simulate(base, ['A', 'B'], p);
  assert.equal(r1.units.xx.pctA, r0.units.xx.pctA);
  assert.ok(r1.units.yy.pctA > r0.units.yy.pctA);
});

test('calibração encontra o swing que reproduz a pesquisa', () => {
  const p = defaultParams();
  const s = calibrateSwing(base, ['A', 'B'], p, 52);
  const r = simulate(base, ['A', 'B'], { ...p, swingPp: s });
  assert.ok(Math.abs(r.total.pctA - 52) < 0.01);
});

test('projeção com 100% apurado coincide com o oficial', () => {
  const prior = simulate(base, ['A', 'B'], defaultParams());
  const live = {
    xx: { cands: [{ n: 'A', vap: 600 }, { n: 'B', vap: 400 }], eleitores: { te: 1400, est: 1400, esnt: 0 } },
    yy: { cands: [{ n: 'A', vap: 300 }, { n: 'B', vap: 500 }], eleitores: { te: 1100, est: 1100, esnt: 0 } },
  };
  const pr = liveProjection(live, prior, ['A', 'B']);
  assert.ok(Math.abs(pr.total.pctA - 50) < 1e-9);
  assert.ok(pr.incerteza.p95 - pr.incerteza.p05 < 1e-9, 'sem incerteza quando tudo foi apurado');
});

test('projeção sem apuração reproduz o cenário do simulador', () => {
  const prior = simulate(base, ['A', 'B'], defaultParams());
  const pr = liveProjection({}, prior, ['A', 'B']);
  assert.ok(Math.abs(pr.total.pctA - prior.total.pctA) < 1e-9);
});

test('Monte Carlo: cenário empatado dá ~50% de chance; deslocado dá mais', () => {
  const tie = monteCarlo([{ fixedA: 0, fixedB: 0, rem: 1000, share: 0.5, scale: 1 }], { n: 4000, seed: 1 });
  assert.ok(Math.abs(tie.pVitoriaA - 0.5) < 0.05);
  const lead = monteCarlo([{ fixedA: 0, fixedB: 0, rem: 1000, share: 0.53, scale: 1 }], { n: 4000, seed: 1 });
  assert.ok(lead.pVitoriaA > 0.8);
});

test('sugestão ideológica: partido mais próximo de A manda mais votos para A', () => {
  const f = suggestedFlow('NOVO', 'PL', 'PT');
  assert.ok(f.A > f.B);
  const g = suggestedFlow('PSOL', 'PL', 'PT');
  assert.ok(g.B > g.A);
  const n = normFlow(f);
  assert.ok(Math.abs(n.A + n.B + n.bn + n.abst - 1) < 1e-9);
});
