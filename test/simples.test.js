// Simulador simples: contas feitas à mão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gruposDoPrimeiroTurno, cenarioSimples, controlesDeTransferencia } from '../src/shared/simples.js';

const resumo = {
  eleitores: { te: 1000 }, votos: { vv: 800 },
  cands: [{ n: '22', vap: 380 }, { n: '13', vap: 360 }, { n: '70', vap: 40, nmu: 'Cand 70' }, { n: '55', vap: 20, nmu: 'Cand 55' }, { n: '29', vap: 1, nmu: 'Pequeno' }],
};
const neutro = { repeteA: 1, repeteB: 1, demaisEscolhem: 0, demaisParaA: 0.5, ninguemVota: 0, ninguemParaA: 0.5 };

test('grupos: finalistas, demais e quem não escolheu ninguém', () => {
  const g = gruposDoPrimeiroTurno(resumo, '22', '13');
  assert.deepEqual({ ...g, separados: undefined }, { a: 380, b: 360, demais: 60, ninguem: 200, eleitorado: 1000, separados: undefined });
  assert.deepEqual(g.separados.map((c) => c.n), ['70', '55'], 'menos de 0,2% fica em "os demais"');
});

test('cenário: só os eleitores dos finalistas = divisão do 1º turno entre os dois', () => {
  const g = gruposDoPrimeiroTurno(resumo, '22', '13');
  const c = cenarioSimples(g, neutro);
  assert.equal(c.A, 380); assert.equal(c.B, 360);
  assert.ok(Math.abs(c.pA - (100 * 380) / 740) < 1e-9);
  assert.equal(c.vencedor, 'A');
});

test('cenário: cada grupo soma no lugar certo', () => {
  const g = gruposDoPrimeiroTurno(resumo, '22', '13');
  // demais: 60 × 0,5 escolhem; desses, 25% para A → A +7,5, B +22,5
  // ninguém: 200 × 0,1 votam; desses, 0% para A → B +20
  const c = cenarioSimples(g, { ...neutro, demaisEscolhem: 0.5, demaisParaA: 0.25, ninguemVota: 0.1, ninguemParaA: 0 });
  assert.equal(c.A, 387.5); assert.equal(c.B, 402.5);
  assert.equal(c.vencedor, 'B');
  // quem não repete o voto não vai para o adversário
  const r = cenarioSimples(g, { ...neutro, repeteA: 0.9 });
  assert.equal(r.A, 342); assert.equal(r.B, 360);
});

test('cenário: empate e valores fora da faixa', () => {
  const g = { a: 100, b: 100, demais: 0, ninguem: 0 };
  assert.equal(cenarioSimples(g, neutro).vencedor, null);
  assert.equal(cenarioSimples(g, { ...neutro, repeteA: 2, repeteB: -1 }).pA, 100, 'frações limitadas a 0..1');
});

test('transferência das pesquisas vira os dois controles', () => {
  const c = controlesDeTransferencia({ paraA: 0.46, paraB: 0.32 });
  assert.ok(Math.abs(c.demaisEscolhem - 0.78) < 1e-9);
  assert.ok(Math.abs(c.demaisParaA - 0.46 / 0.78) < 1e-9);
});

test('um por um: cada eliminado com seus controles; os menores seguem o controle geral', () => {
  const g = gruposDoPrimeiroTurno(resumo, '22', '13');
  const o = { ...neutro, separado: true, demaisEscolhem: 1, demaisParaA: 0, porCandidato: { 70: { escolhem: 0.5, paraA: 1 }, 55: { escolhem: 1, paraA: 0.25 } } };
  const c = cenarioSimples(g, o);
  // 70: 40 × 0,5 → 20 para A. 55: 20 → 5 A, 15 B. Os demais (60 − 40 − 20 = 0)
  assert.equal(c.A, 380 + 20 + 5);
  assert.equal(c.B, 360 + 15);
  assert.deepEqual(c.porCandidato.map((x) => [x.n, x.paraA, x.paraB]), [['70', 20, 0], ['55', 5, 15]]);
  assert.equal(c.resto.votos, 0);

  // Sem ajuste para um candidato, ele segue o controle geral; juntos ou um por um dão o mesmo total
  const geral = { ...neutro, demaisEscolhem: 0.6, demaisParaA: 0.7 };
  const juntos = cenarioSimples(g, geral), separado = cenarioSimples(g, { ...geral, separado: true, porCandidato: {} });
  assert.ok(Math.abs(juntos.A - separado.A) < 1e-9 && Math.abs(juntos.B - separado.B) < 1e-9);
});
