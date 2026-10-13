// Formatação usada na interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtChance, tseParado } from '../public/js/util.js';

test('faixa de dados parados só durante a apuração', () => {
  const base = { ready: true, pollIntervalMs: 15_000, apuracaoComecaEm: null };
  assert.equal(tseParado({ ...base, tseSemRespostaMs: 30_000 }), false);
  assert.equal(tseParado({ ...base, tseSemRespostaMs: 120_000 }), true, 'apuração em andamento e TSE calado há 2 min');
  assert.equal(tseParado({ ...base, tseSemRespostaMs: null }), true, 'nunca falou com o TSE');
  // Antes do dia 25 o servidor só lê a configuração a cada 2 min: não é dado parado
  assert.equal(tseParado({ ...base, tseSemRespostaMs: 125_000, apuracaoComecaEm: '2026-10-25T16:00:00-03:00' }), false);
  assert.equal(tseParado({ ...base, ready: false, tseSemRespostaMs: null }), false);
});

test('chance nunca aparece como 100% ou 0%', () => {
  assert.equal(fmtChance(1), 'mais de 99%');
  assert.equal(fmtChance(0.9996), 'mais de 99%');
  assert.equal(fmtChance(0.995), 'mais de 99%', 'não arredonda para 100%');
  assert.equal(fmtChance(0.99), '99%');
  assert.equal(fmtChance(0.78), '78%');
  assert.equal(fmtChance(0.005), 'menos de 1%', 'não arredonda para 0%');
  assert.equal(fmtChance(0), 'menos de 1%');
  assert.equal(fmtChance(NaN), '–');
});
