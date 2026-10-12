// Servidor HTTP sem dependências: API JSON + Server-Sent Events + arquivos estáticos.
// Todos os visitantes leem do cache do coletor; só o coletor fala com o TSE.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadConfig, ROOT } from './config.js';
import { TseClient } from './tse/client.js';
import { Collector } from './collector.js';
import { Noticias } from './noticias/coletor.js';
import { ELEICOES } from './shared/historico.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
};
const STATIC_ROOTS = { '/shared/': path.join(ROOT, 'src', 'shared'), '/': path.join(ROOT, 'public') };

export function createApp(cfg, collector, noticias = null) {
  const sseClients = new Set();
  const payloadCache = new Map(); // raceId -> { version, gz, json }

  collector.on('update', (ev) => {
    const msg = `event: update\ndata: ${JSON.stringify({ ...ev, races: collector.raceList() })}\n\n`;
    for (const res of sseClients) res.write(msg);
  });
  noticias?.on('update', (ev) => {
    const msg = `event: update\ndata: ${JSON.stringify({ raceId: 'noticias', novos: ev.novos })}\n\n`;
    for (const res of sseClients) res.write(msg);
  });
  let cacheNoticias = null;
  const ping = setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25_000);
  ping.unref();

  function sendJson(req, res, obj, { maxAge = 5 } = {}) {
    const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': `public, max-age=${maxAge}` };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && json.length > 1024) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      res.end(gzipSync(json));
    } else {
      res.writeHead(200, headers);
      res.end(json);
    }
  }

  async function serveStatic(req, res, urlPath) {
    for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
      if (!urlPath.startsWith(prefix)) continue;
      let rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
      const file = path.normalize(path.join(dir, rel));
      if (!file.startsWith(dir)) break;
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return res.end(body);
      } catch { /* tenta próximo */ }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

      if (p === '/api/status') return sendJson(req, res, collector.status(), { maxAge: 2 });
      if (p === '/api/races') return sendJson(req, res, collector.raceList(), { maxAge: 2 });
      if (p === '/api/endorsers') return sendJson(req, res, collector.endorsers, { maxAge: 60 });
      if (p === '/api/exterior') return sendJson(req, res, collector.exteriorPayload(), { maxAge: 5 });
      if (p === '/api/eventos') return sendJson(req, res, collector.eventos.slice(0, 60), { maxAge: 3 });
      if (p === '/api/noticias') {
        if (!noticias) return sendJson(req, res, { atualizadoEm: null, fontes: [], itens: [] }, { maxAge: 30 });
        // Reclassificar é barato, mas não precisa ser a cada visita
        if (!cacheNoticias || cacheNoticias.v !== noticias.versao || Date.now() - cacheNoticias.t > 30_000) cacheNoticias = { v: noticias.versao, t: Date.now(), json: JSON.stringify(noticias.payload()) };
        return sendJson(req, res, cacheNoticias.json, { maxAge: 30 });
      }
      const fm = p.match(/^\/api\/foto\/(\d{6,16})$/);
      if (fm) {
        const r = await collector.foto(fm[1]);
        if (!r) { res.writeHead(404, { 'Cache-Control': 'public, max-age=600' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=86400' });
        return res.end(r.body);
      }
      const m = p.match(/^\/api\/race\/([a-z0-9-]+)$/);
      if (m) {
        const race = collector.races.get(m[1]);
        if (!race) { res.writeHead(404); return res.end('{}'); }
        let c = payloadCache.get(race.id);
        if (!c || c.version !== race.version || c.ready !== collector.ready) {
          c = { version: race.version, ready: collector.ready, json: JSON.stringify(collector.racePayload(race.id)) };
          payloadCache.set(race.id, c);
        }
        return sendJson(req, res, c.json, { maxAge: 2 });
      }
      if (p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ races: collector.raceList() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      return serveStatic(req, res, p === '/' ? '/index.html' : p);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Erro interno');
      console.error(err);
    }
  });
}

export async function main(overrides = {}) {
  const cfg = loadConfig(overrides);
  const client = new TseClient(cfg);
  const collector = new Collector(cfg, client);
  const e26 = ELEICOES.find((e) => e.ano === 2026);
  const noticias = cfg.noticias?.fontes?.length ? new Noticias({
    ...cfg.noticias, dataDir: cfg.dataDir,
    contexto: () => ({ ...collector.contextoNoticias(), apelidos: [e26.lider.nome, e26.segundo.nome] }),
  }) : null;
  const server = createApp(cfg, collector, noticias);
  await new Promise((r) => server.listen(cfg.port, cfg.host, r));
  console.log(`[servidor] http://localhost:${cfg.port}  (fonte: ${cfg.base}/${cfg.ambiente}, polling ${cfg.pollIntervalMs / 1000}s, máx ${cfg.maxRps} req/s)`);
  collector.start();
  // Espera o 1º turno carregar (até 30 s) para o filtro já conhecer os nomes dos candidatos
  if (noticias) (async () => { for (let i = 0; i < 60 && !collector.ready; i++) await new Promise((r) => setTimeout(r, 500)); noticias.start(); })();
  if (noticias) console.log(`[notícias] ${noticias.fontes.length} veículos, leitura a cada ${noticias.intervaloMs / 1000} s`);
  const shutdown = () => { collector.stop(); noticias?.stop(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, collector, noticias, cfg };
}

if (import.meta.url === `file://${process.argv[1]}`) main();
