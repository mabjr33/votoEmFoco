// Servidor: compressão feita uma vez, ETag/304 nos estáticos e no JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.js';

function coletorFalso() {
  const c = new EventEmitter();
  Object.assign(c, {
    ready: true, races: new Map(), eventos: [],
    endorsers: { sp: { sen: Array.from({ length: 200 }, (_, i) => ({ n: String(i), nmu: `Candidato ${i}` })) } },
    status: () => ({ ready: true }), raceList: () => [], exteriorPayload: () => ({ cidades: [] }), foto: async () => null,
  });
  return c;
}
const ouvir = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

test('servidor: estáticos e JSON comprimidos, com ETag e 304', async () => {
  const col = coletorFalso();
  const srv = createApp({}, col);
  const base = await ouvir(srv);
  try {
    // Estático com Brotli; o conteúdo descomprimido é o arquivo
    const r1 = await fetch(`${base}/js/util.js`, { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(r1.status, 200);
    assert.ok(r1.headers.get('etag'));
    const original = readFileSync(new URL('../public/js/util.js', import.meta.url), 'utf8');
    // fetch descomprime sozinho; o tamanho enviado vem em Content-Length
    assert.equal(await r1.text(), original);
    assert.ok(Number(r1.headers.get('content-length')) < Buffer.byteLength(original));
    const r2 = await fetch(`${base}/js/util.js`, { headers: { 'If-None-Match': r1.headers.get('etag') } });
    assert.equal(r2.status, 304);

    // JSON grande com gzip; mesmo conteúdo, mesma ETag; conteúdo novo, ETag nova
    const j1 = await fetch(`${base}/api/endorsers`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(j1.headers.get('content-encoding'), 'gzip');
    assert.equal((await j1.json()).sp.sen.length, 200);
    const etag = j1.headers.get('etag');
    assert.equal((await fetch(`${base}/api/endorsers`, { headers: { 'If-None-Match': etag } })).status, 304);
    col.endorsers.sp.sen.pop();
    const j3 = await fetch(`${base}/api/endorsers`, { headers: { 'If-None-Match': etag } });
    assert.equal(j3.status, 200);
    assert.notEqual(j3.headers.get('etag'), etag);
    assert.equal((await j3.json()).sp.sen.length, 199);

    // HEAD não manda corpo
    const h = await fetch(`${base}/js/util.js`, { method: 'HEAD' });
    assert.equal(h.status, 200);
    assert.equal((await h.arrayBuffer()).byteLength, 0);
  } finally {
    srv.close();
  }
});

test('servidor: corpo comprimido decodifica igual nos dois formatos', async () => {
  const srv = createApp({}, coletorFalso());
  const base = await ouvir(srv);
  const http = await import('node:http');
  const cru = (enc) => new Promise((resolve, reject) => {
    http.get(`${base}/api/endorsers`, { headers: { 'Accept-Encoding': enc } }, (res) => {
      const partes = []; res.on('data', (d) => partes.push(d)); res.on('end', () => resolve({ enc: res.headers['content-encoding'], buf: Buffer.concat(partes) }));
    }).on('error', reject);
  });
  try {
    const br = await cru('br'), gz = await cru('gzip');
    assert.equal(br.enc, 'br');
    assert.equal(gz.enc, 'gzip');
    assert.equal(brotliDecompressSync(br.buf).toString(), gunzipSync(gz.buf).toString());
  } finally {
    srv.close();
  }
});

test('segurança: cabeçalhos, CSP sem script inline e caminhos fora da pasta pública', async () => {
  const srv = createApp({}, coletorFalso());
  const base = await ouvir(srv);
  const http = await import('node:http');
  // fetch normaliza "/../"; aqui o caminho vai cru, como um atacante mandaria
  const cru = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  try {
    const r = await fetch(`${base}/`);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/, 'só scripts do próprio site');
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('x-frame-options'));
    assert.ok(!(await r.text()).includes(' onerror='), 'sem manipuladores inline no HTML');
    for (const p of ['/../package.json', '/..%2fpackage.json', '/shared/..%2f..%2fconfig%2felections.json', '/%2e%2e/src/server.js']) assert.equal(await cru(p), 404, p);
    assert.equal(await cru('/%E0%A4%A'), 404, 'URL malformada não vira erro 500');
    assert.equal((await fetch(`${base}/api/status`, { method: 'POST' })).status, 405);
  } finally {
    srv.close();
  }
});

test('segurança: teto de conexões ao vivo', async () => {
  const srv = createApp({ maxSse: 1 }, coletorFalso());
  const base = await ouvir(srv);
  const ctrl = new AbortController();
  try {
    const a = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
    assert.equal(a.status, 200);
    const b = await fetch(`${base}/api/stream`);
    assert.equal(b.status, 503);
  } finally {
    ctrl.abort();
    srv.closeAllConnections?.();
    srv.close();
  }
});
