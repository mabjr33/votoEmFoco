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
import { Acesso, validarCredenciais, gerarHash, conferirHash } from '../src/acesso.js';
import { PESQUISAS_2026_2T } from '../src/shared/historico.js';

const TOKEN = 'senha-de-teste-bem-longa-123'; // código de instalação (ADMIN_TOKEN)
const USUARIO = 'marcelo', SENHA = 'sol de outubro na praia';
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
const json = { 'Content-Type': 'application/json' };
const postar = (url, corpo, headers = {}) => fetch(url, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(corpo) });
/** Cria o acesso pelo painel e devolve o cabeçalho da sessão. */
async function criarAcesso(base) {
  const r = await postar(`${base}/api/admin/criar`, { codigo: TOKEN, usuario: USUARIO, senha: SENHA });
  assert.equal(r.status, 201);
  return { Authorization: `Bearer ${(await r.json()).sessao}` };
}

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
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
    assert.equal((await fetch(`${base}/api/admin/estado`)).status, 404);
  } finally { srv.close(); }
});

test('painel: aprova, publica, recalcula e remove pesquisa; bloqueia tentativas erradas', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'painel-'));
  const pesquisas = new Pesquisas(dir);
  const srv = createApp({ adminToken: TOKEN }, coletorFalso(), null, { pesquisas, log: { info() {}, warn() {}, error() {} } });
  const base = await ouvir(srv);
  try {
    assert.equal((await fetch(`${base}/api/admin/saude`)).status, 401);
    const auth = await criarAcesso(base);
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

    // 10 sessões erradas: bloqueia por alguns minutos, até a certa
    for (let i = 0; i < 10; i++) await fetch(`${base}/api/admin/saude`, { headers: { Authorization: 'Bearer errada' } });
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: auth })).status, 429);
  } finally {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('acesso: regras de senha (sem admin/admin nem senha óbvia) e hash scrypt', async () => {
  assert.match(validarCredenciais('admin', 'admin'), /10 caracteres/);
  assert.match(validarCredenciais('admin', 'admin12345'), /usuário|fácil/);
  assert.match(validarCredenciais('ana', 'senha12345'), /fácil/);
  assert.match(validarCredenciais('ana', '1234567890'), /fácil/);
  assert.match(validarCredenciais('ana', 'aaaaaaaaaaaa'), /fácil/);
  assert.match(validarCredenciais('marcelo', 'Marcelo2026!!'), /usuário/);
  assert.match(validarCredenciais('Ma', SENHA), /Usuário/);
  assert.equal(validarCredenciais(USUARIO, SENHA), null);
  const h = await gerarHash(SENHA);
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!h.includes(SENHA));
  assert.equal(await conferirHash(SENHA, h), true);
  assert.equal(await conferirHash('outra senha qualquer', h), false);
  assert.notEqual(await gerarHash(SENHA), h, 'sal diferente a cada vez');
});

test('acesso: criar exige o código de instalação; o código não serve para entrar', async () => {
  const srv = createApp({ adminToken: TOKEN }, coletorFalso(), null, { log: { info() {}, warn() {}, error() {} } });
  const base = await ouvir(srv);
  try {
    assert.deepEqual(await (await fetch(`${base}/api/admin/estado`)).json(), { configurado: false, podeCriar: true });
    assert.equal((await postar(`${base}/api/admin/criar`, { codigo: 'chute', usuario: USUARIO, senha: SENHA })).status, 401);
    assert.equal((await postar(`${base}/api/admin/criar`, { codigo: TOKEN, usuario: 'admin', senha: 'admin' })).status, 422);
    const r = await postar(`${base}/api/admin/criar`, { codigo: TOKEN, usuario: USUARIO, senha: SENHA });
    assert.equal(r.status, 201);
    const { sessao, linhaVariavel } = await r.json();
    assert.match(linhaVariavel, /^ADMIN_LOGIN=marcelo:scrypt\$/);
    assert.ok(!linhaVariavel.includes(SENHA));
    assert.equal((await fetch(`${base}/api/admin/estado`).then((x) => x.json())).configurado, true);
    // O ADMIN_TOKEN não é senha do painel
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: { Authorization: `Bearer ${sessao}` } })).status, 200);
  } finally { srv.close(); }
});

test('acesso: entrar, sair, trocar senha e redefinir com o código', async () => {
  const srv = createApp({ adminToken: TOKEN }, coletorFalso(), null, { log: { info() {}, warn() {}, error() {} } });
  const base = await ouvir(srv);
  try {
    await criarAcesso(base);
    assert.equal((await postar(`${base}/api/admin/entrar`, { usuario: USUARIO, senha: 'senha errada aqui' })).status, 401);
    assert.equal((await postar(`${base}/api/admin/entrar`, { usuario: 'outro', senha: SENHA })).status, 401);
    const e = await postar(`${base}/api/admin/entrar`, { usuario: 'Marcelo', senha: SENHA }); // sem diferença de maiúsculas
    assert.equal(e.status, 200);
    const auth = { Authorization: `Bearer ${(await e.json()).sessao}` };
    assert.equal((await (await fetch(`${base}/api/admin/conta`, { headers: auth })).json()).usuario, USUARIO);

    // Trocar senha: exige a atual; encerra as outras sessões
    assert.equal((await postar(`${base}/api/admin/senha`, { senhaAtual: 'errada errada', novaSenha: 'chuva fina de domingo' }, auth)).status, 401);
    const t = await postar(`${base}/api/admin/senha`, { senhaAtual: SENHA, novaSenha: 'chuva fina de domingo' }, auth);
    assert.equal(t.status, 200);
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: auth })).status, 401, 'sessão antiga encerrada');
    const auth2 = { Authorization: `Bearer ${(await t.json()).sessao}` };
    assert.equal((await postar(`${base}/api/admin/entrar`, { usuario: USUARIO, senha: SENHA })).status, 401);

    // Sair encerra a sessão
    await postar(`${base}/api/admin/sair`, {}, auth2);
    assert.equal((await fetch(`${base}/api/admin/saude`, { headers: auth2 })).status, 401);

    // Esqueceu a senha: o código de instalação permite definir outra
    assert.equal((await postar(`${base}/api/admin/criar`, { codigo: TOKEN, usuario: 'nova.dona', senha: 'outra frase bem minha' })).status, 201);
    assert.equal((await postar(`${base}/api/admin/entrar`, { usuario: 'nova.dona', senha: 'outra frase bem minha' })).status, 200);
  } finally { srv.close(); }
});

test('acesso: guardado em disco e na variável ADMIN_LOGIN; arquivo vale mais que a variável', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'acesso-'));
  try {
    const a = new Acesso({ dataDir: dir, codigoInstalacao: TOKEN });
    await a.carregar();
    const { linhaVariavel } = await a.definir({ codigo: TOKEN, usuario: USUARIO, senha: SENHA });
    assert.match(await readFile(path.join(dir, 'admin-acesso.json'), 'utf8'), /"usuario":"marcelo"/);
    // Outro servidor, só com a variável (disco apagado): entra com a mesma senha, sem código
    const b = new Acesso({ loginEnv: linhaVariavel.slice('ADMIN_LOGIN='.length) });
    await b.carregar();
    assert.equal(b.configurado, true);
    assert.ok((await b.entrar({ usuario: USUARIO, senha: SENHA })).sessao);
    // Mesmo disco com a variável antiga: vale o arquivo (o mais recente)
    await a.trocarSenha(a.abrirSessao(USUARIO), { senhaAtual: SENHA, novaSenha: 'chuva fina de domingo' });
    const c = new Acesso({ dataDir: dir, loginEnv: linhaVariavel.slice('ADMIN_LOGIN='.length) });
    await c.carregar();
    assert.ok((await c.entrar({ usuario: USUARIO, senha: 'chuva fina de domingo' })).sessao);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
