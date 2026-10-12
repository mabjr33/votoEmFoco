import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { num, normalizeEA20, wentToRunoff } from '../src/tse/normalize.js';
import { resultPath, fillDir } from '../src/tse/urls.js';
import { createMockTse, buildEA20 } from '../src/mock/tse-mock.js';
import { TseClient } from '../src/tse/client.js';
import { Collector } from '../src/collector.js';
import { loadConfig } from '../src/config.js';

test('num() lê formatos do TSE', () => {
  assert.equal(num('56104503'), 56104503);
  assert.equal(num('47,03'), 47.03);
  assert.equal(num('47,034567891'), 47.034567891);
  assert.equal(num('100'), 100);
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
});

test('URLs seguem o padrão oficial (EA20) com zeros à esquerda', () => {
  const cfg = { ambiente: 'oficial', ciclo: 'ele2026' };
  assert.equal(resultPath(cfg, { eleicao: 6257, cargo: 1, abrangencia: 'br' }), '/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json');
  assert.equal(resultPath(cfg, { eleicao: '6260', cargo: 3, abrangencia: 'RJ' }), '/oficial/ele2026/6260/dados/rj/rj-c0003-e006260-u.json');
  assert.equal(
    fillDir('<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>', { ambiente: 'oficial', ciclo: 'ele2026', eleicao: '6258', uf: 'sp' }),
    '/oficial/ele2026/6258/dados/sp',
  );
  assert.throws(() => resultPath(cfg, { eleicao: 6257, cargo: 1, abrangencia: 'sao paulo' }));
});

test('normalizeEA20 extrai candidatos, seções e votos', () => {
  const j = buildEA20({
    ele: 6259, t: 1, tpabr: 'uf', cdabr: 'df', cargo: 3, cargoNome: 'Governador', te: 1000, comp: 800, vb: 20, tvn: 30,
    cands: [{ n: '11', nm: 'X', partido: 'PP', vap: 499, st: '2º turno', e: 's' }, { n: '13', nm: 'Y', partido: 'PT', vap: 251, st: '2º turno', e: 's' }],
    tf: 's', and: 'f', when: new Date(),
  });
  const u = normalizeEA20(j);
  assert.equal(u.cd, 'df');
  assert.equal(u.cands.length, 2);
  assert.equal(u.cands[0].vap, 499);
  assert.ok(Math.abs(u.cands[0].pvap - 66.533333333) < 1e-6);
  assert.equal(u.eleitores.te, 1000);
  assert.ok(wentToRunoff(u));
});

test('integração: coletor descobre o 2º turno no ele-c.json e acompanha a apuração', async () => {
  const mock = createMockTse({ durationSec: 4, startDelaySec: 0 });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'eleicoes-'));
  const cfg = loadConfig({ base: `http://127.0.0.1:${mock.server.address().port}`, dataDir, maxRps: 50, pollIntervalMs: 3000 });
  const quiet = { info() {}, warn() {}, error() {} };
  const client = new TseClient(cfg, { log: quiet });
  await client.init();
  const col = new Collector(cfg, client, { log: quiet });
  try {
    assert.ok(await col.discover());
    assert.equal(col.discovery.federal2, '6258');
    assert.deepEqual(col.discovery.estadual2Ufs.sort(), ['ac', 'am', 'df', 'es', 'rj', 'rn', 'to']);
    await col.loadBaselines();
    const ids = col.raceList().map((r) => r.id).sort();
    assert.deepEqual(ids, ['gov-ac', 'gov-am', 'gov-df', 'gov-es', 'gov-rj', 'gov-rn', 'gov-to', 'pres']);
    const pres = col.racePayload('pres');
    assert.equal(Object.keys(pres.baseline.units).length, 28); // 27 UFs + exterior
    assert.deepEqual(pres.finalists.map((f) => f.n), ['22', '13']);

    await new Promise((r) => setTimeout(r, 4500));
    await col.pollLive();
    const live = col.racePayload('pres').live;
    assert.ok(live.available);
    assert.equal(live.summary.secoes.pst, 100);
    assert.ok(live.summary.totalFinal);
    assert.equal(Object.keys(live.units).length, 28);

    // Exterior: localidades do arquivo de municípios, 1º turno e 2º turno por cidade
    const ex = col.exteriorPayload();
    assert.equal(ex.cidades.length, 36);
    assert.ok(ex.cidades.every((c) => c.t1 && c.t2), 'todas as cidades com 1º e 2º turno');
    assert.equal(ex.cidades.reduce((s, c) => s + c.t1.a, 0), ex.total.t1.a, 'cidades somam o total de ZZ');
    assert.equal(ex.total.t2.pst, 100);

    // Últimas atualizações: governadores eleitos no 1º turno e o resultado final do 2º turno
    assert.ok(col.eventos.some((e) => e.tipo === 'eleito' && /governador/.test(e.texto)));
    assert.ok(col.eventos.some((e) => e.tipo === 'senado'));
    assert.ok(col.eventos.some((e) => e.tipo === 'eleito' && /presidente/.test(e.texto)));

    // Nomes da disputa para o filtro de notícias
    const ctx = col.contextoNoticias();
    assert.deepEqual(ctx.presidente, ['Candidato Azul', 'Candidata Vermelha']);
    assert.ok(ctx.governadores.find((g) => g.uf === 'rj').nomes.includes('Deputado Iota'));

    // Fotos: só candidatos já carregados passam pelo proxy
    const sq = col.racePayload('pres').finalists[0].sq;
    assert.ok((await col.foto(sq))?.body?.length > 0);
    assert.equal(await col.foto('999999999'), null);

    // Segunda rodada sem mudanças: deve usar 304 (requisição condicional)
    const before = client.stats.notModified;
    await col.pollLive();
    assert.ok(client.stats.notModified > before, 'esperava respostas 304');
    assert.equal(client.stats.notFound, 0, 'nenhum 404 deve ser gerado');
  } finally {
    col.stop();
    mock.server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('cliente pausa após 403 (proteção contra bloqueio) e serve cache', async () => {
  const http = await import('node:http');
  let calls = 0;
  const srv = http.createServer((req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"1"' }); return res.end('{"ok":1}'); }
    res.writeHead(403); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'eleicoes-'));
  const client = new TseClient({ base: `http://127.0.0.1:${srv.address().port}`, dataDir, maxRps: 10 }, { log: { warn() {} } });
  await client.init();
  try {
    assert.equal((await client.getJson('/x.json')).status, 'ok');
    const r2 = await client.getJson('/x.json');
    assert.equal(r2.status, 'cached');
    assert.deepEqual(r2.data, { ok: 1 });
    assert.ok(client.isPaused());
    await client.getJson('/x.json');
    assert.equal(calls, 2, 'não deve chamar o servidor durante a pausa');
  } finally {
    srv.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
