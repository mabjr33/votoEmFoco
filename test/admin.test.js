// Painel: senha, aprovação e remoção de pesquisas, bloqueio após tentativas erradas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { Pesquisas, validarPesquisa } from '../src/pesquisas.js';
import { previsoes } from '../src/shared/previsao.js';
import { PESQUISAS_2026_2T } from '../src/shared/historico.js';

const TOKEN = 'senha-de-teste-bem-longa-123';
// Pesquisa fictícia, só para o teste
const NOVA = { registro: 'BR-99999/2026', instituto: 'Instituto Teste', campo: '14–16/10', amostra: 2000, margem: 2, flavioValido: 45, lulaValido: 55, fonteUrl: 'https://example.com/pesquisa' };

function coletorFalso() {
  const c = new EventEmitter();
  Object.assign(c, {
    ready: true, races: new Map(), eventos: [], endorsers: {},
    status: () => ({ ready: true, base: 'x', ambiente: 'oficial', discovery: {}, http: { requests: 0, notFound: 0, errors: 0 } }),
    raceList: () => [], exteriorPayload: () => ({}), foto: async () => null,
  });
  return c;
}
const ouvir = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const auth = { Authorization: `Bearer ${TOKEN}` };

test('validação de pesquisa', () => {
  assert.ok(validarPesquisa(NOVA).pesquisa);
  assert.match(validarPesquisa({ ...NOVA, registro: 'SP-12345/2026' }).erro, /BR-/);
  assert.match(validarPesquisa({ ...NOVA, flavioValido: 45, lulaValido: 50 }).erro, /somar 100/);
  assert.match(validarPesquisa({ ...NOVA, fonteUrl: 'javascript:alert(1)' }).erro, /http/);
  assert.match(validarPesquisa({ ...NOVA, amostra: 12.5 }).erro, /inteiro/);
  assert.equal(validarPesquisa({ ...NOVA, instituto: '<b>x</b>'.repeat(20) }).pesquisa.instituto.length, 60, 'texto limitado');
});

test('painel: sem ADMIN_TOKEN, as rotas não existem', async () => {
  const srv = createApp({}, coletorFalso());
  const base = await ouvir(srv);
  try {
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: auth })).status, 404);
  } finally { srv.close(); }
});

test('painel: aprova, publica, recalcula e remove pesquisa; bloqueia tentativas erradas', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'painel-'));
  const pesquisas = new Pesquisas(dir);
  const srv = createApp({ adminToken: TOKEN }, coletorFalso(), null, { pesquisas, log: { info() {}, warn() {}, error() {} } });
  const base = await ouvir(srv);
  try {
    assert.equal((await fetch(`${base}/api/admin/saude`)).status, 401);
    const s = await (await fetch(`${base}/api/admin/saude`, { headers: auth })).json();
    assert.equal(s.tse.pronto, true);

    const r = await fetch(`${base}/api/admin/pesquisas`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(NOVA) });
    assert.equal(r.status, 201);
    const pub = await (await fetch(`${base}/api/pesquisas`)).json();
    assert.deepEqual(pub.itens.map((p) => p.registro), ['BR-99999/2026']);
    // grava em disco e entra no modelo
    assert.match(await readFile(path.join(dir, 'pesquisas.json'), 'utf8'), /BR-99999\/2026/);
    const antes = previsoes().modelos[0].detalhe.usadas.length;
    const depois = previsoes({ pesquisas: [...pub.itens, ...PESQUISAS_2026_2T] }).modelos[0].detalhe.usadas.length;
    assert.equal(depois, antes + 1);

    const d = await fetch(`${base}/api/admin/pesquisas/${encodeURIComponent('BR-99999/2026')}`, { method: 'DELETE', headers: auth });
    assert.equal(d.status, 200);
    assert.equal((await (await fetch(`${base}/api/pesquisas`)).json()).itens.length, 0);

    // POST fora do painel continua proibido
    assert.equal((await fetch(`${base}/api/pesquisas`, { method: 'POST' })).status, 405);

    // 10 senhas erradas: bloqueia por alguns minutos, até a certa
    for (let i = 0; i < 10; i++) await fetch(`${base}/api/admin/saude`, { headers: { Authorization: 'Bearer errada' } });
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: auth })).status, 429);
  } finally {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});
