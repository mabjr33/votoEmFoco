// Banco (Supabase): testado com um PostgREST falso em memória, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BancoSupabase, criarBanco } from '../src/banco.js';
import { Pesquisas } from '../src/pesquisas.js';
import { Acesso, gerarHash } from '../src/acesso.js';

const CHAVE = 'chave-servico-de-teste';
const silencioso = { warn() {}, info() {}, error() {} };

/** PostgREST mínimo: tabelas em memória, só o que src/banco.js usa. */
function supabaseFalso({ fora = false } = {}) {
  const tabelas = { pesquisas: new Map(), pesquisas_ignoradas: new Map(), painel_acesso: new Map() };
  const chaves = { pesquisas: 'registro', pesquisas_ignoradas: 'registro', painel_acesso: 'id' };
  const pedidos = [];
  async function fetch(url, { method, headers, body }) {
    pedidos.push({ method, url, headers });
    const resp = (status, obj) => ({ ok: status < 300, status, text: async () => (obj === undefined ? '' : JSON.stringify(obj)) });
    if (fora) throw new Error('fetch failed');
    if (headers.apikey !== CHAVE || headers.Authorization !== `Bearer ${CHAVE}`) return resp(401, { message: 'sem chave' });
    const u = new URL(url);
    const nome = u.pathname.replace('/rest/v1/', '');
    const t = tabelas[nome];
    if (!t) return resp(404, { message: 'tabela' });
    const linhas = [...t.values()];
    if (method === 'GET') {
      const id = u.searchParams.get('id');
      return resp(200, id ? linhas.filter((l) => `eq.${l.id}` === id) : linhas);
    }
    if (method === 'POST') {
      for (const l of JSON.parse(body)) {
        const k = l[chaves[nome]];
        if (t.has(k) && headers.Prefer.includes('ignore-duplicates')) continue;
        t.set(k, { ...t.get(k), ...l });
      }
      return resp(201);
    }
    if (method === 'DELETE') {
      const f = u.searchParams.get('registro');
      if (f === 'not.is.null') t.clear();
      else {
        const manter = new Set(f.replace(/^not\.in\.\(/, '').replace(/\)$/, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
        for (const k of [...t.keys()]) if (!manter.has(k)) t.delete(k);
      }
      return resp(204);
    }
    return resp(405);
  }
  return { fetch, tabelas, pedidos };
}

const novoBanco = (falso) => new BancoSupabase({ url: 'https://projeto.supabase.co/', chave: CHAVE, fetch: falso.fetch });
const pesquisa = (registro, extra = {}) => ({ registro, instituto: 'Instituto Teste', campo: '2026-10-08', divulgacao: '2026-10-10', flavio: 47, lula: 44, flavioValido: 51.6, lulaValido: 48.4, origem: 'painel', aprovadaEm: '2026-10-10T12:00:00.000Z', ...extra });

test('criarBanco só existe com URL e chave, e exige https', () => {
  assert.equal(criarBanco({}), null);
  assert.equal(criarBanco({ supabaseUrl: 'https://x.supabase.co' }), null);
  assert.throws(() => criarBanco({ supabaseUrl: 'http://x.supabase.co', supabaseChave: 'k' }), /https/);
  assert.ok(criarBanco({ supabaseUrl: 'https://x.supabase.co', supabaseChave: 'k' }) instanceof BancoSupabase);
});

test('grava e lê pesquisas, converte nomes de coluna e remove o que saiu', async () => {
  const falso = supabaseFalso();
  const banco = novoBanco(falso);
  await banco.gravarPesquisas({ itens: [pesquisa('BR-01234/2026'), pesquisa('BR-05678/2026', { origem: 'automatica', fontes: [{ url: 'https://a.example/1', nome: 'A' }] })], ignoradas: ['BR-09999/2026'] });
  const linha = falso.tabelas.pesquisas.get('BR-01234/2026');
  assert.equal(linha.flavio_valido, 51.6);
  assert.equal(linha.aprovada_em, '2026-10-10T12:00:00.000Z');
  assert.ok(falso.pedidos.every((p) => p.url.startsWith('https://projeto.supabase.co/rest/v1/')));

  let lido = await banco.lerPesquisas();
  assert.equal(lido.itens.length, 2);
  assert.deepEqual(lido.ignoradas, ['BR-09999/2026']);
  const a = lido.itens.find((p) => p.registro === 'BR-01234/2026');
  assert.equal(a.flavioValido, 51.6);
  assert.equal('fontes' in a, false, 'colunas vazias não viram campos');

  await banco.gravarPesquisas({ itens: [pesquisa('BR-05678/2026')], ignoradas: [] });
  lido = await banco.lerPesquisas();
  assert.deepEqual(lido.itens.map((p) => p.registro), ['BR-05678/2026']);
  assert.deepEqual(lido.ignoradas, []);
  assert.equal(banco.estado().ok, true);
});

test('erro do banco fica no estado (para a saúde do painel)', async () => {
  const banco = new BancoSupabase({ url: 'https://projeto.supabase.co', chave: 'errada', fetch: supabaseFalso().fetch });
  await assert.rejects(banco.lerPesquisas(), /HTTP 401/);
  assert.equal(banco.estado().ok, false);
  assert.match(banco.estado().erro, /401/);
});

test('Pesquisas: banco vazio recebe o que estava no arquivo; depois o banco é a fonte', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'banco-'));
  await writeFile(path.join(dir, 'pesquisas.json'), JSON.stringify({ itens: [pesquisa('BR-01234/2026')], ignoradas: ['BR-09999/2026'] }));
  const falso = supabaseFalso();
  const p1 = new Pesquisas(dir, { banco: novoBanco(falso), log: silencioso });
  await p1.carregar();
  assert.deepEqual([...falso.tabelas.pesquisas.keys()], ['BR-01234/2026']);
  assert.deepEqual([...falso.tabelas.pesquisas_ignoradas.keys()], ['BR-09999/2026']);

  // Outro servidor (disco novo, vazio) lê do banco
  const p2 = new Pesquisas(await mkdtemp(path.join(os.tmpdir(), 'banco-')), { banco: novoBanco(falso), log: silencioso });
  await p2.carregar();
  assert.deepEqual(p2.itens.map((p) => p.registro), ['BR-01234/2026']);
  assert.ok(p2.ignoradas.has('BR-09999/2026'));
});

test('Pesquisas: banco fora do ar na partida não apaga o que está nele', async () => {
  const falso = supabaseFalso();
  falso.tabelas.pesquisas.set('BR-01234/2026', { registro: 'BR-01234/2026', instituto: 'Instituto Teste', flavio: 47, lula: 44, origem: 'painel' });
  let fora = true;
  const banco = new BancoSupabase({ url: 'https://projeto.supabase.co', chave: CHAVE, fetch: (...a) => (fora ? Promise.reject(new Error('fetch failed')) : falso.fetch(...a)) });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'banco-'));
  const p = new Pesquisas(dir, { banco, log: silencioso });
  await p.carregar(); // cai para o arquivo (vazio)
  assert.equal(p.itens.length, 0);

  p.itens.push(pesquisa('BR-05678/2026'));
  await p.salvar(); // banco ainda fora: grava só o arquivo, sem erro
  assert.equal(JSON.parse(await readFile(path.join(dir, 'pesquisas.json'), 'utf8')).itens.length, 1);

  fora = false;
  await p.salvar(); // banco voltou: junta antes de gravar
  assert.deepEqual([...falso.tabelas.pesquisas.keys()].sort(), ['BR-01234/2026', 'BR-05678/2026']);
  assert.equal(p.itens.length, 2);
});

test('Acesso: conta criada vai para o banco e vale em outro servidor; acesso antigo é levado ao banco', async () => {
  const falso = supabaseFalso();
  const codigo = 'codigo-de-instalacao-teste';
  const a1 = new Acesso({ dataDir: await mkdtemp(path.join(os.tmpdir(), 'banco-')), codigoInstalacao: codigo, banco: novoBanco(falso), log: silencioso });
  await a1.carregar();
  assert.equal(a1.configurado, false);
  const r = await a1.definir({ codigo, usuario: 'dono.site', senha: 'Frase longa 4 teste' });
  assert.equal(r.noBanco, true);
  assert.equal(falso.tabelas.painel_acesso.get(1).usuario, 'dono.site');
  assert.match(falso.tabelas.painel_acesso.get(1).hash, /^scrypt\$/);

  const a2 = new Acesso({ dataDir: await mkdtemp(path.join(os.tmpdir(), 'banco-')), banco: novoBanco(falso), log: silencioso });
  await a2.carregar();
  assert.equal(a2.conta.origem, 'banco');
  assert.ok((await a2.entrar({ usuario: 'dono.site', senha: 'Frase longa 4 teste' })).sessao);

  // Quem já usava ADMIN_LOGIN: o banco novo recebe essa conta na partida
  const outro = supabaseFalso();
  const hash = await gerarHash('Outra frase 9 teste');
  const a3 = new Acesso({ loginEnv: `dono.site:${hash}`, banco: novoBanco(outro), log: silencioso });
  await a3.carregar();
  assert.equal(a3.conta.origem, 'banco');
  assert.equal(outro.tabelas.painel_acesso.get(1).hash, hash);
});
