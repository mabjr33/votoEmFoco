// Formatação usada na interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtChance } from '../public/js/util.js';

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
