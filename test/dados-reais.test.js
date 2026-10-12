// Ponta a ponta do modo "1º turno real": baixa os arquivos de um TSE (aqui, o sintético), guarda numa pasta,
// sobe o mock a partir dessa pasta e confere que o coletor vê os mesmos nomes, votos e fotos, com o 2º turno simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockTse } from '../src/mock/tse-mock.js';
import { baixarPrimeiroTurno } from '../src/tse/baixar.js';
import { fmtResumo, temDadosReais } from '../src/mock/fonte-real.js';
import { TseClient } from '../src/tse/client.js';
import { Collector } from '../src/collector.js';
import { loadConfig } from '../src/config.js';

const quiet = { info() {}, warn() {}, error() {} };
const ouvir = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

test('baixar o 1º turno e testar com ele', async () => {
  const origem = createMockTse({ durationSec: 600, startDelaySec: 600, publish2nd: false });
  const base = await ouvir(origem.server);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'reais-'));
  const destino = path.join(tmp, 'tse-1turno');
  let espelho;
  try {
    // 1) baixar
    const m = await baixarPrimeiroTurno({ destino, overrides: { base, maxRps: 50 }, log: quiet });
    assert.ok(temDadosReais(destino));
    assert.deepEqual(m.resumo.finalistas, ['Candidato Azul (PL)', 'Candidata Vermelha (PT)']);
    assert.equal(m.resumo.estadosPresidente, 28);
    assert.equal(m.resumo.cidadesExterior, 36);
    assert.equal(m.resumo.governadores2T.length, 7);
    assert.ok(m.fotos >= 2);
    assert.equal(m.avisos.length, 0, m.avisos.join('; '));
    assert.equal(origem.stats.notFound, 0, 'o download não gera 404 no TSE');
    assert.match(fmtResumo(m), /Finalistas: Candidato Azul \(PL\) × Candidata Vermelha \(PT\)/);
    const manifesto = JSON.parse(await readFile(path.join(destino, 'manifesto.json'), 'utf8'));
    assert.equal(manifesto.eleicoes.federal2, '6258');

    // 2) mock a partir da pasta, com 2º turno simulado
    espelho = createMockTse({ dadosReais: destino, durationSec: 3, startDelaySec: 0, semente: 7 });
    const base2 = await ouvir(espelho.server);
    const dataDir = path.join(tmp, 'app');
    const cfg = loadConfig({ base: base2, dataDir, maxRps: 50, pollIntervalMs: 3000 });
    const client = new TseClient(cfg, { log: quiet });
    await client.init();
    const col = new Collector(cfg, client, { log: quiet });
    assert.ok(await col.discover());
    assert.ok(col.discovery.federal2Disponivel);
    assert.equal(col.discovery.estadual2Ufs.length, 7);
    await col.loadBaselines();
    const pres = col.racePayload('pres');
    assert.deepEqual(pres.finalists.map((f) => f.nmu), ['Candidato Azul', 'Candidata Vermelha']);
    // 1º turno idêntico ao da origem
    const origemBr = JSON.parse(await readFile(path.join(destino, 'oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json'), 'utf8'));
    assert.equal(pres.baseline.summary.votos.vv, Number(origemBr.v.vv));

    await new Promise((r) => setTimeout(r, 3500));
    await col.pollLive();
    const live = col.racePayload('pres').live;
    assert.equal(live.summary.secoes.pst, 100);
    assert.equal(live.summary.cands.length, 2);
    assert.deepEqual(live.summary.cands.map((c) => c.sq).sort(), pres.finalists.map((f) => f.sq).sort(), 'mesmo número de candidato do 1º turno');
    assert.ok(live.summary.cands.some((c) => c.eleito));
    // fotos saem da pasta
    const f = await col.foto(pres.finalists[0].sq);
    assert.ok(f?.body?.length > 0);
    assert.equal(espelho.stats.notFound, 0, 'nenhum 404 no espelho');
    col.stop();
  } finally {
    origem.server.close();
    espelho?.server.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
