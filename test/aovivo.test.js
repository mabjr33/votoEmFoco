import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pontoDePartida, cenarioFinal, agruparPorRegiao } from '../src/shared/aovivo.js';

// Três UFs de regiões diferentes; parte já apurada
const pp = {
  sp: { cd: 'sp', a: 6e6, b: 4e6, rem: 10e6, share: 0.55, regiao: 'sudeste' },
  ba: { cd: 'ba', a: 1e6, b: 3e6, rem: 4e6, share: 0.3, regiao: 'nordeste' },
  rs: { cd: 'rs', a: 2e6, b: 1.5e6, rem: 2e6, share: 0.6, regiao: 'sul' },
};

test('sem mudanças, o restante segue a divisão esperada de cada região', () => {
  const r = cenarioFinal(pp);
  const A = 6e6 + 1e6 + 2e6 + 10e6 * 0.55 + 4e6 * 0.3 + 2e6 * 0.6;
  assert.ok(Math.abs(r.A - A) < 1);
  assert.ok(Math.abs(r.validos - (17.5e6 + 16e6)) < 1);
});

test('fração nacional escolhida é respeitada exatamente', () => {
  const r = cenarioFinal(pp, { shareNacional: 0.4 });
  assert.ok(Math.abs(r.shareUsado - 0.4) < 1e-6);
  assert.ok(Math.abs(r.A - (9e6 + 0.4 * 16e6)) < 10);
  // e as regiões mantêm a ordem relativa (Sul continua mais favorável a A que o Nordeste)
  assert.ok(r.regioes.sul.share > r.regioes.nordeste.share);
});

test('ponto de virada: com a fração de virada, termina empatado', () => {
  const r0 = cenarioFinal(pp);
  const r = cenarioFinal(pp, { shareNacional: r0.viradaA });
  assert.ok(Math.abs(r.A - r.B) < 10);
  assert.ok(Math.abs(r0.viradaA + r0.viradaB - 1) < 1e-12);
});

test('modo regional usa a fração de cada região', () => {
  const r = cenarioFinal(pp, { modo: 'regional', shareRegiao: { sudeste: 0.5, nordeste: 0.5, sul: 0.5 } });
  assert.ok(Math.abs(r.A - (9e6 + 8e6)) < 1);
});

test('comparecimento escala só os votos que faltam', () => {
  const r = cenarioFinal(pp, { comparecimento: 0.5 });
  assert.ok(Math.abs(r.validos - (17.5e6 + 8e6)) < 1);
  assert.equal(r.apurado.validos, 17.5e6);
});

test('ajustes: do adversário troca votos; novos somam', () => {
  const r0 = cenarioFinal(pp);
  const r1 = cenarioFinal(pp, { ajustes: [{ votos: 1e6, para: 'B', origem: 'adversario' }] });
  assert.ok(Math.abs(r1.B - r0.B - 1e6) < 1 && Math.abs(r0.A - r1.A - 1e6) < 1);
  const r2 = cenarioFinal(pp, { ajustes: [{ votos: 5e5, para: 'A', origem: 'novos' }] });
  assert.ok(Math.abs(r2.validos - r0.validos - 5e5) < 1);
});

test('tudo apurado: sem incerteza e sem votos faltando', () => {
  const fim = { sp: { cd: 'sp', a: 10, b: 5, rem: 0, share: 0.5, regiao: 'sudeste' } };
  const r = cenarioFinal(fim);
  assert.equal(r.faltam, 0);
  assert.equal(r.incerteza.pVitoriaA, 1);
  assert.equal(r.viradaA, null);
});

test('pontoDePartida usa a projeção quando há apuração', () => {
  const sim = { units: { sp: { validos: 100, A: 50 } } };
  const proj = { units: { sp: { validos: 100, A: 56 } } };
  const live = { sp: { cands: [{ n: 'A', vap: 30 }, { n: 'B', vap: 20 }], secoes: { pst: 50 } } };
  const p = pontoDePartida({ live, sim, proj }, ['A', 'B']).sp;
  assert.equal(p.rem, 50);
  assert.ok(Math.abs(p.share - 0.52) < 1e-9);
  assert.equal(agruparPorRegiao({ sp: p }).sudeste.rem, 50);
});
