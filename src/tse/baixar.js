// Baixa uma vez, do TSE, todos os arquivos do 1º turno que o site usa (configuração, Presidente por
// estado e exterior, cidades do exterior, Governador, Senador e fotos dos principais candidatos) e guarda
// numa pasta. O modo de teste usa essa pasta para mostrar o 1º turno real.
//
// Usa o mesmo cliente do servidor: limite de requisições, quarentena de 404 e pausa se o TSE recusar.

import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { TseClient } from './client.js';
import { Collector } from '../collector.js';
import { CARGOS } from './urls.js';

export async function baixarPrimeiroTurno({ destino, overrides = {}, log = console } = {}) {
  const cacheTmp = await mkdtemp(path.join(os.tmpdir(), 'tse-baixar-'));
  const temp = `${destino}.baixando`;
  await rm(temp, { recursive: true, force: true });
  const cfg = loadConfig({ ...overrides, dataDir: cacheTmp });
  cfg.maxRps = Math.min(cfg.maxRps, 8);
  const client = new TseClient(cfg, { log: { info() {}, warn: (m) => log.warn?.(m), error: (m) => log.error?.(m) } });
  await client.init();
  const salvos = new Set();
  const falhas = [];

  const salvar = async (p, conteudo) => {
    const alvo = path.normalize(path.join(temp, p));
    if (!alvo.startsWith(path.normalize(temp) + path.sep)) throw new Error(`caminho inesperado: ${p}`);
    await mkdir(path.dirname(alvo), { recursive: true });
    await writeFile(alvo, conteudo);
    salvos.add(p);
  };
  const getJson = client.getJson.bind(client);
  client.getJson = async (p, o) => {
    const r = await getJson(p, o);
    if (r.data) await salvar(p, JSON.stringify(r.data));
    else falhas.push({ arquivo: p, status: r.status, erro: r.error || null });
    return r;
  };
  const getBinary = client.getBinary.bind(client);
  let fotos = 0;
  client.getBinary = async (p) => {
    const r = await getBinary(p);
    if (r.body) { await salvar(p, r.body); fotos++; }
    return r;
  };

  const silencioso = { info: () => {}, warn: (m) => log.warn?.(m), error: (m) => log.error?.(m) };
  const col = new Collector(cfg, client, { log: silencioso });
  try {
    log.info?.(`[baixar] lendo a configuração em ${cfg.base}/${cfg.ambiente}…`);
    if (!(await col.discover())) {
      throw new Error(`não consegui ler a configuração do TSE (${falhas.at(-1)?.status || 'sem resposta'}). Confira a internet e tente de novo em alguns minutos.`);
    }
    log.info?.('[baixar] Presidente, Governador, Senador e exterior do 1º turno (leva cerca de 1 minuto)…');
    await col.loadBaselines();
    if (client.isPaused()) throw new Error('o TSE recusou as requisições e o download foi pausado para evitar bloqueio. Tente de novo em 15 minutos.');
    log.info?.('[baixar] fotos dos candidatos…');
    for (const sq of col.fotos.keys()) await col.foto(sq);

    // Resumo e conferências
    const pres = col.races.get('pres');
    const s = pres?.baseline?.summary;
    if (!s || !s.cands.length) throw new Error('o arquivo nacional de Presidente do 1º turno não veio.');
    const nome = (r, n) => (r.baseline.summary?.cands || []).find((c) => c.n === n);
    const presidente = s.cands.slice(0, 12).map((c) => ({ n: c.n, nome: c.nmu, partido: c.partido, votos: c.vap, pct: c.pvap, situacao: c.st }));
    const finalistas = pres.finalists.map((n) => nome(pres, n)).filter(Boolean).map((c) => `${c.nmu} (${c.partido})`);
    const ufsPres = Object.keys(pres.baseline.units);
    const governadores2T = [...col.races.values()].filter((r) => r.cargo === CARGOS.GOVERNADOR && r.baseline.summary)
      .map((r) => ({ uf: r.scope, candidatos: r.finalists.map((n) => nome(r, n)).filter(Boolean).map((c) => ({ nome: c.nmu, partido: c.partido, pct: c.pvap })) }));
    const govEleitos = Object.entries(col.endorsers).filter(([, e]) => e.gov?.some((c) => /^Eleit/i.test(c.st))).length;
    const senEleitos = Object.values(col.endorsers).reduce((t, e) => t + (e.sen || []).filter((c) => /^Eleit/i.test(c.st)).length, 0);
    const avisos = [];
    const somaVotos = s.cands.reduce((t, c) => t + c.vap, 0);
    if (Math.abs(somaVotos - s.votos.vv) > 1) avisos.push(`a soma dos candidatos (${somaVotos}) difere dos votos válidos (${s.votos.vv})`);
    if (!s.totalFinal) avisos.push('o TSE ainda não marca o 1º turno de Presidente como totalização final');
    if (ufsPres.length < cfg.ufs.length) avisos.push(`Presidente veio de ${ufsPres.length} de ${cfg.ufs.length} estados`);
    if (finalistas.length !== 2) avisos.push('não deu para identificar os dois finalistas de Presidente');
    if (!governadores2T.length) avisos.push('nenhum 2º turno de governador identificado nos arquivos');
    const manifesto = {
      baixadoEm: new Date().toISOString(),
      origem: `${cfg.base}/${cfg.ambiente}`,
      ambiente: cfg.ambiente,
      ciclo: cfg.ciclo,
      eleicoes: { ...cfg.eleicoes, federal2: col.discovery.federal2, estadual2: col.discovery.estadual2 },
      configTse: col.discovery.configEm,
      arquivos: salvos.size - fotos,
      fotos,
      resumo: {
        presidente, finalistas, totalizadoEm: s.totalizadoEm, secoesPct: s.secoes.pst,
        eleitorado: s.eleitores.te, comparecimento: s.eleitores.c, abstencaoPct: s.eleitores.pa,
        estadosPresidente: ufsPres.length, cidadesExterior: col.exterior.cidades1.length,
        governadores2T, governadoresEleitos1T: govEleitos, senadoresEleitos: senEleitos,
      },
      avisos,
      falhas: falhas.slice(0, 50),
    };
    await writeFile(path.join(temp, 'manifesto.json'), JSON.stringify(manifesto, null, 2));
    await rm(destino, { recursive: true, force: true });
    await rename(temp, destino);
    return manifesto;
  } catch (e) {
    await rm(temp, { recursive: true, force: true });
    throw e;
  } finally {
    col.stop?.();
    await rm(cacheTmp, { recursive: true, force: true });
  }
}
