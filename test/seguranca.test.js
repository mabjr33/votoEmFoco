// Defesas de rede e contagem de acessos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipCliente, LimitadorIp, ipPrivado, urlPublica, fetchPublico } from '../src/rede.js';
import { Visitas } from '../src/visitas.js';

const req = (xff, remoto = '10.0.0.5', extra = {}) => ({ headers: { ...(xff ? { 'x-forwarded-for': xff } : {}), ...extra }, socket: { remoteAddress: remoto }, method: 'GET' });

test('IP do visitante: o começo do X-Forwarded-For pode ser inventado; vale o que o proxy acrescentou', () => {
  assert.equal(ipCliente(req('1.2.3.4'), 0), '10.0.0.5', 'sem proxy confiável, ignora o cabeçalho');
  assert.equal(ipCliente(req('9.9.9.9, 200.1.2.3'), 1), '200.1.2.3', 'visitante inventou 9.9.9.9; o proxy acrescentou o real');
  assert.equal(ipCliente(req('9.9.9.9, 200.1.2.3, 104.16.0.1'), 2), '200.1.2.3', 'CDN + hospedagem');
  assert.equal(ipCliente(req(''), 1), '10.0.0.5');
  assert.equal(ipCliente(req('lixo'), 1), '10.0.0.5', 'valor que não é IP');
});

test('limite por IP: rajada e recarga', () => {
  const l = new LimitadorIp({ porSegundo: 10, rajada: 5 });
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.ok(l.permite('a', t));
  assert.equal(l.permite('a', t), false, 'passou da rajada');
  assert.ok(l.permite('b', t), 'outro IP não é afetado');
  assert.ok(l.permite('a', t + 200), 'recarrega com o tempo (10/s)');
  l.limpar(t + 60_000);
  assert.equal(l.baldes.size, 0);
});

test('endereços internos são recusados (SSRF)', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(ipPrivado(ip), ip);
  for (const ip of ['200.147.3.157', '8.8.8.8', '2804:14c::1']) assert.equal(ipPrivado(ip), false, ip);
  const publico = async () => [{ address: '200.147.3.157', family: 4 }];
  const interno = async () => [{ address: '10.0.0.7', family: 4 }];
  assert.ok(await urlPublica('https://g1.globo.com/x', { resolver: publico }));
  assert.equal(await urlPublica('https://site-que-aponta-para-dentro.com/', { resolver: interno }), false, 'DNS para rede interna');
  for (const u of ['http://169.254.169.254/latest/meta-data', 'http://localhost:3000/', 'file:///etc/passwd', 'https://a.com:8443/', 'https://user:senha@a.com/', 'http://intranet/', 'http://servico.internal/']) {
    assert.equal(await urlPublica(u, { resolver: publico }), false, u);
  }
});

test('redirecionamento para endereço interno é barrado', async () => {
  const resolver = async (host) => [{ address: host === 'interno.exemplo.com' ? '10.0.0.9' : '200.1.1.1', family: 4 }];
  const respostas = {
    'https://a.com.br/materia': new Response(null, { status: 302, headers: { location: 'https://interno.exemplo.com/admin' } }),
    'https://b.com.br/materia': new Response(null, { status: 301, headers: { location: '/nova' } }),
    'https://b.com.br/nova': new Response('ok', { status: 200 }),
  };
  const fetchFalso = async (u, op) => { assert.equal(op.redirect, 'manual'); return respostas[u]; };
  await assert.rejects(fetchPublico(fetchFalso, 'https://a.com.br/materia', {}, { resolver }), /não público/);
  assert.equal(await (await fetchPublico(fetchFalso, 'https://b.com.br/materia', {}, { resolver })).text(), 'ok');
});

test('visitas: sem cookie, sem IP guardado; robôs não contam; único por dia', async () => {
  let agora = Date.parse('2026-10-13T15:00:00Z');
  const v = new Visitas({ agora: () => agora });
  const nav = { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' };
  assert.ok(v.registrar(req(null, '1.1.1.1', nav), '1.1.1.1'));
  v.registrar(req(null, '1.1.1.1', nav), '1.1.1.1');
  v.registrar(req(null, '2.2.2.2', nav), '2.2.2.2');
  for (const ua of ['WhatsApp/2.23', 'Googlebot/2.1', 'facebookexternalhit/1.1', 'UptimeRobot/2.0', 'curl/8.0', '']) assert.equal(v.registrar(req(null, '3.3.3.3', { 'user-agent': ua }), '3.3.3.3'), false, ua);
  assert.equal(v.registrar(req(null, '4.4.4.4', { ...nav, 'sec-purpose': 'prefetch' }), '4.4.4.4'), false, 'pré-carregamento');
  let r = v.resumo(14);
  assert.deepEqual(r.hoje, { dia: '2026-10-13', visitantes: 2, paginas: 3 });
  assert.equal(r.dias.length, 14);
  assert.ok(!JSON.stringify([...v.dias]).includes('1.1.1.1'), 'IP não fica guardado');

  agora += 86_400_000; // dia seguinte: mesmo visitante conta de novo, sal novo
  v.registrar(req(null, '1.1.1.1', nav), '1.1.1.1');
  r = v.resumo(14);
  assert.equal(r.hoje.visitantes, 1);
  assert.equal(r.ontem.visitantes, 2);
});

test('visitas: banco recebe os totais do dia e é lido na partida', async () => {
  const gravado = [];
  const banco = { lerVisitas: async () => [{ dia: '2026-10-12', visitantes: 40, paginas: 90 }], gravarVisitas: async (l) => gravado.push(...l) };
  const v = new Visitas({ banco, agora: () => Date.parse('2026-10-13T15:00:00Z'), log: { warn() {} } });
  await v.carregar();
  v.registrar(req(null, '1.1.1.1', { 'user-agent': 'Mozilla/5.0' }), '1.1.1.1');
  await v.salvar();
  assert.deepEqual(gravado, [{ dia: '2026-10-13', visitantes: 1, paginas: 1 }]);
  assert.equal(v.resumo().ontem.visitantes, 40);

  // Tabela ainda não criada: avisa no painel o que fazer
  const semTabela = new Visitas({ banco: { lerVisitas: async () => [], gravarVisitas: async () => { throw new Error('banco POST visitas_diarias: HTTP 404'); } }, log: { warn() {} } });
  semTabela.registrar(req(null, '1.1.1.1', { 'user-agent': 'Mozilla/5.0' }), '1.1.1.1');
  await semTabela.salvar();
  assert.match(semTabela.resumo().erro, /schema\.sql/);
});

test('login: muitas conferências de senha ao mesmo tempo recebem "ocupado" em vez de esgotar a memória', async () => {
  const { conferirHash, gerarHash } = await import('../src/acesso.js');
  const hash = await gerarHash('uma frase de teste 42');
  const r = await Promise.allSettled(Array.from({ length: 30 }, () => conferirHash('errada', hash)));
  const ocupado = r.filter((x) => x.status === 'rejected' && x.reason.ocupado).length;
  assert.ok(ocupado >= 10, `${ocupado} recusadas`);
  assert.ok(r.filter((x) => x.status === 'fulfilled').length >= 2);
  assert.equal(await conferirHash('uma frase de teste 42', hash), true, 'depois da enxurrada, volta ao normal');
});

test('acesso: corpo não-objeto (null, lista, número) não derruba — devolve erro limpo', async () => {
  const { Acesso } = await import('../src/acesso.js');
  const a = new Acesso({ codigoInstalacao: 'codigo-de-instalacao-de-teste-1' });
  for (const corpo of [null, undefined, 42, 'texto', []]) {
    assert.equal((await a.entrar(corpo)).status, 401, `entrar(${JSON.stringify(corpo)})`);
    assert.equal((await a.definir(corpo)).status, 401, `definir(${JSON.stringify(corpo)})`);
    assert.equal((await a.trocarSenha('sessao-inexistente', corpo)).status, 401, `trocarSenha(${JSON.stringify(corpo)})`);
  }
})
