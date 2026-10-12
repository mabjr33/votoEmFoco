// Confere configuração e cadastros contra o 1º turno real baixado com `npm run baixar` (data/tse-1turno).
// Sem a pasta, os testes são pulados: nada aqui consulta o TSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEA20, wentToRunoff } from '../src/tse/normalize.js';
import { leanOf } from '../src/shared/presets.js';
import { corPartido } from '../public/js/partidos.js';
import { CIDADES } from '../public/js/mundo.js';
import { normalizar } from '../public/js/util.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(raiz, 'data/tse-1turno/oficial/ele2026');
const skip = existsSync(pasta) ? false : 'sem data/tse-1turno (rode npm run baixar)';
const cfg = JSON.parse(readFileSync(path.join(raiz, 'config/elections.json'), 'utf8'));
const { federal1, estadual1 } = cfg.eleicoes;
const ler = (p) => normalizeEA20(JSON.parse(readFileSync(p, 'utf8')));
const ea20 = (ele, uf, cargo) => path.join(pasta, ele, 'dados', uf, `${uf}-c${cargo}-e${ele.padStart(6, '0')}-u.json`);

test('governador2TurnoFallback bate com os 2º turnos do arquivo real', { skip }, () => {
  const comRunoff = cfg.ufs.filter((uf) => wentToRunoff(ler(ea20(estadual1, uf, '0003'))));
  assert.deepEqual([...cfg.governador2TurnoFallback].sort(), comRunoff.sort());
});

test('todo partido dos dados reais tem cor; eliminados de presidente e governador têm posicionamento', { skip }, () => {
  const unidades = [ler(ea20(federal1, 'br', '0001')), ...cfg.ufs.flatMap((uf) => ['0003', '0005'].map((c) => ler(ea20(estadual1, uf, c))))];
  const semCor = new Set(), semLean = new Set();
  for (const u of unidades) {
    for (const c of u.cands) {
      if (corPartido(c.partido) === corPartido('')) semCor.add(c.partido);
      if (u.cargo !== 5 && !c.eleito && leanOf(c.partido) === null) semLean.add(c.partido);
    }
  }
  assert.deepEqual([...semCor], [], 'partidos sem cor em public/js/partidos.js');
  assert.deepEqual([...semLean], [], 'partidos sem PARTY_LEAN em src/shared/presets.js');
});

test('toda cidade do exterior do TSE está no cadastro do mapa', { skip }, () => {
  const dir = path.join(pasta, federal1, 'config');
  const mun = JSON.parse(readFileSync(path.join(dir, readdirSync(dir).find((f) => f.startsWith('mun-'))), 'utf8'));
  const chaves = new Set(CIDADES.flatMap((c) => c.chaves));
  const zz = mun.abr.find((a) => a.cd === cfg.exterior).mu;
  const fora = zz.filter((m) => { const k = normalizar(m.nm); return !chaves.has(k) && !chaves.has(k.replace(/^CIDADE DE /, '')); });
  assert.deepEqual(fora.map((m) => m.nm), [], 'inclua em scripts/cidades-exterior.mjs e rode gerar-mundo.mjs');
});
