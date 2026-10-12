// Modo de teste: sobe uma "CDN do TSE" local e o sistema apontando para ela.
//   npm run mock              -> 1º turno real (se você rodou `npm run baixar`) ou sintético, e 2º turno simulado em 3 minutos
//   npm run mock:ficticio     -> força os dados sintéticos com nomes fictícios
//   MOCK_DURATION=600 npm run mock
import { createMockTse } from './tse-mock.js';
import { createNoticiasMock } from './noticias-mock.js';
import { temDadosReais } from './fonte-real.js';
import { main } from '../server.js';
import path from 'node:path';
import { ROOT } from '../config.js';
import { rm } from 'node:fs/promises';

const MOCK_PORT = Number(process.env.MOCK_PORT || 8081);
const durationSec = Number(process.env.MOCK_DURATION || 180);
const dataDir = path.join(ROOT, 'data', 'mock');
await rm(dataDir, { recursive: true, force: true });

const pastaReais = process.env.DADOS_REAIS || path.join(ROOT, 'data', 'tse-1turno');
const ficticio = process.argv.includes('--ficticio') || process.env.MOCK_DADOS === 'ficticio';
const usarReais = !ficticio && temDadosReais(pastaReais);
const semente = process.env.MOCK_SEED ? Number(process.env.MOCK_SEED) : undefined;

const mock = createMockTse({ durationSec, startDelaySec: Number(process.env.MOCK_DELAY || 10), dadosReais: usarReais ? pastaReais : null, semente });
await new Promise((r) => mock.server.listen(MOCK_PORT, '127.0.0.1', r));

let noticias;
if (usarReais) {
  const m = mock.fonte.manifesto;
  const desl = mock.fonte.deslocNacional * 100;
  console.log(`[mock] 1º turno REAL do TSE, baixado em ${new Date(m.baixadoEm).toLocaleString('pt-BR')} (${m.resumo.finalistas.join(' × ')})`);
  console.log(`[mock] 2º turno SIMULADO em ${durationSec}s: cenário-base com deslocamento sorteado de ${desl >= 0 ? '+' : ''}${desl.toFixed(1)} pp para ${mock.fonte.presFin[0].nmu} (sorteio ${mock.fonte.semente}; MOCK_SEED repete). Não é previsão.`);
  console.log('[mock] Notícias: feeds reais dos veículos (config/noticias.json)');
} else {
  console.log(`[mock] TSE sintético com nomes fictícios em http://127.0.0.1:${MOCK_PORT}, 2º turno apurado em ${durationSec}s`);
  if (!ficticio) console.log('[mock] Para testar com o 1º turno real, rode antes: npm run baixar');
  const feeds = createNoticiasMock({ cadaSeg: Number(process.env.MOCK_NEWS_SEC || 40) });
  await feeds.listen(Number(process.env.MOCK_NEWS_PORT || MOCK_PORT + 1));
  console.log(`[mock] feeds de notícias fictícios em ${feeds.fontes()[0].url.replace(/\/rss.*/, '')}`);
  noticias = { fontes: feeds.fontes(), intervaloMs: Number(process.env.NEWS_POLL_MS || 15000), diasGuardados: 7, maxItens: 400 };
}

await main({
  ...(noticias ? { noticias } : {}),
  base: `http://127.0.0.1:${MOCK_PORT}`,
  ambiente: mock.fonte.amb,
  ciclo: mock.fonte.ciclo,
  pollIntervalMs: Number(process.env.POLL_MS || 4000),
  maxRps: 40,
  dataDir,
  modoTeste: true,
  dadosReais: usarReais ? { baixadoEm: mock.fonte.manifesto.baixadoEm, origem: mock.fonte.manifesto.origem } : null,
});
