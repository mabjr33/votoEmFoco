// Cliente HTTP para os arquivos de divulgação do TSE.
// - Limitador de taxa (token bucket) bem abaixo do limite oficial de 100 req/s por IP.
// - Requisições condicionais (ETag / Last-Modified) -> 304 economiza banda.
// - Quarentena de URLs que retornaram 404 e pausa global se houver muitos 404 (o TSE bloqueia IPs por isso).
// - Pausa global de 10+ min ao receber 403/429 (sinal de bloqueio).
// - Cache em disco: o sistema continua servindo o último dado válido se o TSE ficar indisponível.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TseClient {
  constructor(cfg, { log = console } = {}) {
    this.cfg = cfg;
    this.log = log;
    this.cacheDir = path.join(cfg.dataDir, 'cache');
    this.mem = new Map(); // path -> { etag, lastModified, body, fetchedAt }
    this.notFound = new Map(); // path -> timestamp
    this.recent404 = [];
    this.pausedUntil = 0;
    this.tokens = cfg.maxRps;
    this.lastRefill = Date.now();
    this.inFlight = 0;
    this.stats = { requests: 0, ok: 0, notModified: 0, notFound: 0, errors: 0, skipped: 0, lastError: null };
  }

  async init() {
    await mkdir(this.cacheDir, { recursive: true });
  }

  cacheFile(p) {
    const h = createHash('sha1').update(p).digest('hex').slice(0, 12);
    const safe = p.replace(/[^a-z0-9.-]+/gi, '_').slice(-80);
    return path.join(this.cacheDir, `${safe}.${h}.json`);
  }

  async readCache(p) {
    if (this.mem.has(p)) return this.mem.get(p);
    try {
      const entry = JSON.parse(await readFile(this.cacheFile(p), 'utf8'));
      this.mem.set(p, entry);
      return entry;
    } catch {
      return null;
    }
  }

  async writeCache(p, entry) {
    this.mem.set(p, entry);
    const f = this.cacheFile(p);
    const tmp = `${f}.tmp`;
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, f);
  }

  async takeToken() {
    for (;;) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.cfg.maxRps, this.tokens + elapsed * this.cfg.maxRps);
      this.lastRefill = now;
      if (this.tokens >= 1 && this.inFlight < (this.cfg.maxConcurrency || 4)) {
        this.tokens -= 1;
        this.inFlight += 1;
        return;
      }
      await sleep(Math.max(20, 1000 / this.cfg.maxRps));
    }
  }

  isPaused() {
    return Date.now() < this.pausedUntil;
  }

  pause(ms, reason) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.log.warn?.(`[tse] pausando requisições por ${Math.round(ms / 1000)}s: ${reason}`);
  }

  /** Busca um arquivo binário (fotos). Cache em disco; 404 fica em quarentena por 6 h. */
  async getBinary(p) {
    const f = this.cacheFile(p) + '.bin';
    try { const buf = await readFile(f); const meta = JSON.parse(await readFile(f + '.meta', 'utf8')); return { status: 'cached', body: buf, type: meta.type }; } catch {}
    const nf = this.notFound.get(p), falha = this.falhaFoto?.get(p);
    if ((nf && Date.now() - nf < 6 * 3600_000) || (falha && Date.now() - falha < 60_000) || this.isPaused()) return { status: 'not-found' };
    await this.takeToken();
    this.stats.requests++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(this.cfg.base + p, { headers: { 'User-Agent': this.cfg.userAgent || 'eleicoes-ao-vivo' }, signal: ctrl.signal });
      if (res.status === 403 || res.status === 429) { this.pause(11 * 60_000, `HTTP ${res.status} em foto`); return { status: 'error' }; }
      if (!res.ok) { await res.arrayBuffer().catch(() => {}); this.notFound.set(p, Date.now()); this.stats.notFound++; return { status: 'not-found' }; }
      const body = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'image/jpeg';
      if (!/^image\//.test(type) || body.length > 2_000_000) return { status: 'error' };
      await writeFile(f, body); await writeFile(f + '.meta', JSON.stringify({ type }));
      this.stats.ok++;
      return { status: 'ok', body, type };
    } catch { this.stats.errors++; (this.falhaFoto ||= new Map()).set(p, Date.now()); return { status: 'error' }; }
    finally { clearTimeout(timer); this.inFlight -= 1; }
  }

  /**
   * Busca um JSON. Retorna { status, data, fromCache, fetchedAt }.
   * status: 'ok' (novo), 'not-modified', 'cached' (sem rede), 'not-found', 'error'
   * opts.quarantineMs: por quanto tempo não repetir uma URL que deu 404.
   */
  async getJson(p, { quarantineMs = 15 * 60_000, allowNetwork = true } = {}) {
    const cached = await this.readCache(p);
    const nf = this.notFound.get(p);
    if (nf && Date.now() - nf < quarantineMs) {
      this.stats.skipped++;
      return { status: 'not-found', data: cached?.body ?? null, fromCache: !!cached };
    }
    if (!allowNetwork || this.isPaused()) {
      this.stats.skipped++;
      return { status: cached ? 'cached' : 'error', data: cached?.body ?? null, fromCache: true, fetchedAt: cached?.fetchedAt };
    }

    await this.takeToken();
    this.stats.requests++;
    const headers = { 'User-Agent': this.cfg.userAgent || 'eleicoes-ao-vivo', Accept: 'application/json' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(this.cfg.base + p, { headers, signal: ctrl.signal });
      if (res.status === 304 && cached) {
        this.stats.notModified++;
        return { status: 'not-modified', data: cached.body, fromCache: true, fetchedAt: cached.fetchedAt };
      }
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => {});
        this.stats.notFound++;
        this.notFound.set(p, Date.now());
        const now = Date.now();
        this.recent404 = this.recent404.filter((t) => now - t < 60_000).concat(now);
        if (this.recent404.length >= 5) this.pause(120_000, 'muitos 404 em 1 minuto (proteção contra bloqueio de IP)');
        return { status: 'not-found', data: cached?.body ?? null, fromCache: !!cached };
      }
      if (res.status === 403 || res.status === 429) {
        await res.arrayBuffer().catch(() => {});
        this.pause(11 * 60_000, `HTTP ${res.status} — possível bloqueio por taxa`);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      this.notFound.delete(p);
      const entry = {
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        body,
        fetchedAt: new Date().toISOString(),
      };
      await this.writeCache(p, entry);
      this.stats.ok++;
      return { status: 'ok', data: body, fromCache: false, fetchedAt: entry.fetchedAt };
    } catch (err) {
      this.stats.errors++;
      this.stats.lastError = `${p}: ${err.message}`;
      return { status: cached ? 'cached' : 'error', data: cached?.body ?? null, fromCache: true, fetchedAt: cached?.fetchedAt, error: err.message };
    } finally {
      clearTimeout(timer);
      this.inFlight -= 1;
    }
  }
}
