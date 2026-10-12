// Servidor HTTP sem dependências: API JSON + Server-Sent Events + arquivos estáticos.
// Todos os visitantes leem do cache do coletor; só o coletor fala com o TSE.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, ROOT } from './config.js';
import { TseClient } from './tse/client.js';
import { Collector } from './collector.js';
import { Noticias } from './noticias/coletor.js';
import { ELEICOES } from './shared/historico.js';
import { Pesquisas } from './pesquisas.js';
import { criarAdmin } from './admin.js';
import { criarAutomacao } from './pesquisas-auto/automacao.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const STATIC_ROOTS = { '/shared/': path.join(ROOT, 'src', 'shared'), '/': path.join(ROOT, 'public') };
const COMPRIMIVEL = /^(text\/|application\/json|image\/svg)/;
const FOTO_TIPOS = /^image\/(jpeg|png|webp|gif)$/;

// Cabeçalhos de segurança em todas as respostas. A CSP só permite scripts do próprio site
// (nada inline): um texto malicioso vindo de um feed ou de um arquivo não consegue rodar código.
const SEGURANCA = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "img-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * Corpo pronto para envio: ETag pelo conteúdo e versões comprimidas feitas uma vez só, sob demanda.
 * Com muitos visitantes, o mesmo JSON deixa de ser comprimido a cada requisição.
 */
function corpo(buf, tipo) {
  const etag = `"${createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`;
  return { buf, tipo, etag, comprimivel: buf.length > 1024 && COMPRIMIVEL.test(tipo), br: null, gz: null };
}
function enviar(req, res, c, cacheControl) {
  const headers = { 'Content-Type': c.tipo, 'Cache-Control': cacheControl, ETag: c.etag };
  if (c.comprimivel) headers.Vary = 'Accept-Encoding';
  if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers); return res.end(); }
  const ae = req.headers['accept-encoding'] || '';
  let body = c.buf;
  if (c.comprimivel && /\bbr\b/.test(ae)) {
    body = c.br ||= brotliCompressSync(c.buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 6, [zc.BROTLI_PARAM_SIZE_HINT]: c.buf.length } });
    headers['Content-Encoding'] = 'br';
  } else if (c.comprimivel && /\bgzip\b/.test(ae)) {
    body = c.gz ||= gzipSync(c.buf);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** Pesquisas registradas no TSE com divulgação de hoje em diante (só o que o cadastro informa). */
function proximasRegistradas(cadastro) {
  if (!cadastro) return [];
  return cadastro.proximas(hojeSP()).slice(0, 30)
    .map(({ registro, instituto, inicio, fim, divulgacao, amostra }) => ({ registro, instituto, inicio, fim, divulgacao, amostra }));
}

export function createApp(cfg, collector, noticias = null, { pesquisas = new Pesquisas(null), cadastro = null, log = console } = {}) {
  const sseClients = new Set();
  const avisarTodos = (ev) => { const msg = `event: update
data: ${JSON.stringify(ev)}

`; for (const res of sseClients) res.write(msg); };
  const admin = criarAdmin({
    // conta do painel fora de data/mock (apagada a cada execução do modo de teste)
    token: cfg.adminToken, loginEnv: cfg.adminLogin, dataDir: cfg.cacheDir || cfg.dataDir, acesso: cfg.acesso, collector, noticias, pesquisas, cadastro, conexoes: () => sseClients.size, trustProxy: !!cfg.trustProxy, log,
    aoMudarPesquisas: () => avisarTodos({ raceId: 'pesquisas' }),
  });
  // Cada conexão ao vivo segura um socket aberto: com teto, uma enxurrada de conexões não derruba o servidor
  const maxSse = Number(cfg.maxSse || process.env.MAX_SSE || 5000);
  const urlPublica = /^https?:\/\/[^\s"<>]+$/.test(cfg.publicUrl || '') ? cfg.publicUrl.replace(/\/+$/, '') : '';
  const payloadCache = new Map(); // raceId -> { version, ready, json }
  const jsonCache = new Map(); // rota -> corpo do último JSON enviado (reaproveitado enquanto não muda)
  const staticCache = new Map(); // arquivo -> { mtimeMs, size, corpo }

  // Pesquisa que entrou sozinha (cadastro do TSE + duas reportagens): todos recalculam a previsão
  pesquisas.on?.('mudou', () => avisarTodos({ raceId: 'pesquisas' }));
  // Um ciclo do coletor atualiza várias disputas em sequência: junta os avisos de ~300 ms num só
  // (menos escritas em milhares de conexões) e manda só o que muda de cada disputa.
  // Recarga completa ('*') sai na hora, com a lista inteira.
  const fila = new Set();
  let timerFila = null;
  const despachar = () => {
    timerFila = null;
    const ids = [...fila]; fila.clear();
    if (!ids.length) return;
    const races = collector.raceList().map(({ id, pst, version, aoVivo }) => ({ id, pst, version, aoVivo }));
    const msg = `event: update\ndata: ${JSON.stringify({ ids, races })}\n\n`;
    for (const res of sseClients) res.write(msg);
  };
  collector.on('update', (ev) => {
    if (ev.raceId === '*') {
      clearTimeout(timerFila); timerFila = null; fila.clear();
      const msg = `event: update\ndata: ${JSON.stringify({ raceId: '*', ids: ['*'], races: collector.raceList() })}\n\n`;
      for (const res of sseClients) res.write(msg);
      return;
    }
    fila.add(ev.raceId);
    timerFila ||= setTimeout(despachar, 300);
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
    const rota = req.url.split('?')[0];
    let c = jsonCache.get(rota);
    if (!c || c.json !== json) { c = { ...corpo(Buffer.from(json), MIME['.json']), json }; jsonCache.set(rota, c); }
    enviar(req, res, c, `public, max-age=${maxAge}`);
  }

  /**
   * Página inicial: endereço público nas tags de compartilhamento. No modo de teste, a prévia do
   * link (WhatsApp, redes) diz que o 2º turno é simulado, sem a imagem de "apuração em tempo real",
   * e a página pede para não ser indexada: um print do teste não pode passar por resultado.
   */
  function paginaInicial(html) {
    let h = html.replaceAll('{{URL}}', urlPublica);
    if (!cfg.modoTeste) return h;
    const aviso = 'Site em teste: o 1º turno é o real do TSE; o 2º turno é uma simulação sorteada, não é resultado nem previsão.';
    h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="robots" content="noindex, nofollow">')
      .replace(/<title>[^<]*<\/title>/, '<title>TESTE · Voto em Foco (2º turno simulado)</title>')
      .replace(/(<meta name="description" content=")[^"]*/, `$1${aviso}`)
      .replace(/(<meta property="og:title" content=")[^"]*/, '$1TESTE · 2º turno simulado, não é resultado')
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${aviso}`)
      .replace(/\s*<meta property="og:image[^>]*>/g, '')
      .replace('content="summary_large_image"', 'content="summary"');
    return h;
  }

  async function serveStatic(req, res, urlPath) {
    for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
      if (!urlPath.startsWith(prefix)) continue;
      let rel;
      try { rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html'; } catch { break; }
      const file = path.normalize(path.join(dir, rel));
      // dir + separador: impede escapar para uma pasta vizinha com o mesmo começo de nome (ex.: public-x)
      if (!file.startsWith(dir + path.sep) || file.includes('\0')) break;
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        let e = staticCache.get(file);
        if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
          let buf = await readFile(file);
          // Página inicial: endereço público nas tags de compartilhamento (precisam de URL absoluta)
          if (path.basename(file) === 'index.html') buf = Buffer.from(paginaInicial(buf.toString('utf8')));
          e = { mtimeMs: st.mtimeMs, size: st.size, corpo: corpo(buf, MIME[path.extname(file)] || 'application/octet-stream') };
          staticCache.set(file, e);
        }
        // no-cache: o navegador sempre confere, mas recebe 304 (sem corpo) se o arquivo não mudou
        // Fontes e a imagem de prévia quase nunca mudam: cache longo. O resto revalida sempre.
        return enviar(req, res, e.corpo, /^\/(fonts\/|og\.png$)/.test(urlPath) ? 'public, max-age=2592000' : 'no-cache');
      } catch { /* tenta próximo */ }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }

  return http.createServer(async (req, res) => {
    try {
      for (const [k, v] of Object.entries(SEGURANCA)) res.setHeader(k, v);
      if (cfg.modoTeste) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      // HSTS só faz sentido atrás de HTTPS (o proxy da hospedagem informa em X-Forwarded-Proto)
      if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p.startsWith('/api/admin/') && await admin(req, res, p)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
      if (p === '/api/pesquisas') return sendJson(req, res, { versao: pesquisas.versao, itens: pesquisas.itens, registradas: proximasRegistradas(cadastro) }, { maxAge: 30 });

      if (p === '/api/status') return sendJson(req, res, collector.status(), { maxAge: 2 });
      if (p === '/api/races') return sendJson(req, res, collector.raceList(), { maxAge: 2 });
      if (p === '/api/endorsers') return sendJson(req, res, collector.endorsers, { maxAge: 60 });
      if (p === '/api/exterior') return sendJson(req, res, collector.exteriorPayload(), { maxAge: 5 });
      if (p === '/api/exterior/vivo') return sendJson(req, res, collector.exteriorPayloadVivo(), { maxAge: 2 });
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
        // Só tipos de imagem comuns: um SVG servido daqui poderia carregar script
        if (!r || !FOTO_TIPOS.test(r.type)) { res.writeHead(404, { 'Cache-Control': 'public, max-age=600' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=86400', 'Content-Length': r.body.length });
        return res.end(req.method === 'HEAD' ? undefined : r.body);
      }
      // /api/race/:id (completo) e /api/race/:id/vivo (só o que muda na apuração)
      const m = p.match(/^\/api\/race\/([a-z0-9-]+)(\/vivo)?$/);
      if (m) {
        const race = collector.races.get(m[1]);
        if (!race) { res.writeHead(404); return res.end('{}'); }
        const chave = m[2] ? `${race.id}/vivo` : race.id;
        let c = payloadCache.get(chave);
        if (!c || c.version !== race.version || c.ready !== collector.ready) {
          c = { version: race.version, ready: collector.ready, json: JSON.stringify(m[2] ? collector.racePayloadVivo(race.id) : collector.racePayload(race.id)) };
          payloadCache.set(chave, c);
        }
        return sendJson(req, res, c.json, { maxAge: 2 });
      }
      if (p === '/api/stream') {
        if (sseClients.size >= maxSse) { res.writeHead(503, { 'Retry-After': '30', 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Muitas conexões'); }
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
  const pesquisas = new Pesquisas(cfg.dataDir);
  await pesquisas.carregar();
  const auto = noticias && cfg.pesquisasTse?.url && process.env.PESQUISAS_AUTO !== '0' ? criarAutomacao({ cfg, noticias, pesquisas, e26 }) : null;
  const server = createApp(cfg, collector, noticias, { pesquisas, cadastro: auto?.cadastro });
  if (cfg.adminToken || cfg.adminLogin) console.log(`[admin] painel em /admin.html (${cfg.adminLogin ? 'entrar com usuário e senha' : 'primeiro acesso: crie usuário e senha com o código de instalação ADMIN_TOKEN'})`);
  await new Promise((r) => server.listen(cfg.port, cfg.host, r));
  console.log(`[servidor] http://localhost:${cfg.port}  (fonte: ${cfg.base}/${cfg.ambiente}, polling ${cfg.pollIntervalMs / 1000}s, máx ${cfg.maxRps} req/s)`);
  collector.start();
  // Espera o 1º turno carregar (até 30 s) para o filtro já conhecer os nomes dos candidatos
  if (noticias) (async () => { for (let i = 0; i < 60 && !collector.ready; i++) await new Promise((r) => setTimeout(r, 500)); noticias.start(); })();
  if (noticias) console.log(`[notícias] ${noticias.fontes.length} veículos, leitura a cada ${noticias.intervaloMs / 1000} s`);
  if (auto) { auto.start(); console.log('[pesquisas] entrada automática: cadastro do TSE a cada 6 h + reportagens de pesquisa (2 veículos com os mesmos números)'); }
  const shutdown = () => { collector.stop(); noticias?.stop(); auto?.stop(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, collector, noticias, cfg };
}

// pathToFileURL: funciona no Windows e em pastas com espaço ou parênteses
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
