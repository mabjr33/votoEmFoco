// Lê os feeds RSS dos veículos de tempos em tempos, guarda só as manchetes sobre a eleição e
// avisa quando chega algo novo. Não toca no TSE nem no limite de requisições dele.

import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { lerFeed, decodificarCorpo } from './rss.js';
import { classificar, prepararContexto, normalizar } from './classificar.js';

const AGENTE = 'Mozilla/5.0 (compatible; ApuracaoEleicoes/1.0; leitor de RSS)';

/** Link sem parâmetros de rastreio, para reconhecer a mesma matéria. */
export function linkCanonico(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|amp$|cmpid)/i.test(k)) x.searchParams.delete(k);
    return `${x.host.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch { return String(u); }
}
const chaveTitulo = (t) => normalizar(t).slice(0, 90);

export class Noticias extends EventEmitter {
  /**
   * opcoes: { fontes, intervaloMs, diasGuardados, maxItens, dataDir, contexto: () => ({ presidente, governadores }), fetch }
   */
  constructor(opcoes = {}) {
    super();
    this.fontes = (opcoes.fontes || []).map((f) => ({ ...f, ok: null, erro: null, lidoEm: null, novosNaUltima: 0, etag: null, modificado: null }));
    this.intervaloMs = Math.max(15_000, Number(opcoes.intervaloMs) || 600_000);
    this.diasGuardados = opcoes.diasGuardados || 7;
    this.maxItens = opcoes.maxItens || 400;
    this.arquivo = opcoes.dataDir ? path.join(opcoes.dataDir, 'noticias.json') : null;
    this.contexto = opcoes.contexto || (() => ({}));
    this.fetch = opcoes.fetch || globalThis.fetch;
    this.itens = []; // { id, titulo, link, fonte, data, vistoEm, resumo, categorias }
    this.atualizadoEm = null;
    this.versao = 0;
    this.timer = null;
  }

  async carregar() {
    if (!this.arquivo) return;
    try {
      const j = JSON.parse(await readFile(this.arquivo, 'utf8'));
      this.itens = Array.isArray(j.itens) ? j.itens : [];
      this.atualizadoEm = j.atualizadoEm || null;
    } catch { /* primeiro uso */ }
  }

  async salvar() {
    if (!this.arquivo) return;
    await mkdir(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify({ atualizadoEm: this.atualizadoEm, itens: this.itens }));
    await rename(tmp, this.arquivo);
  }

  async lerFonte(f) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const headers = { 'User-Agent': AGENTE, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' };
      if (f.etag) headers['If-None-Match'] = f.etag;
      if (f.modificado) headers['If-Modified-Since'] = f.modificado;
      const r = await this.fetch(f.url, { headers, signal: ctrl.signal, redirect: 'follow' });
      if (r.status === 304) { f.ok = true; f.erro = null; f.lidoEm = Date.now(); return []; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = decodificarCorpo(await r.arrayBuffer(), r.headers.get('content-type') || '');
      const itens = lerFeed(xml);
      if (!itens.length && !/<(rss|feed|rdf)\b/i.test(xml)) throw new Error('resposta não é um feed');
      f.etag = r.headers.get('etag');
      f.modificado = r.headers.get('last-modified');
      f.ok = true; f.erro = null; f.lidoEm = Date.now();
      return itens;
    } catch (e) {
      f.ok = false;
      f.erro = e.name === 'AbortError' ? 'tempo esgotado' : String(e.message || e).slice(0, 120);
      f.lidoEm = Date.now();
      return [];
    } finally { clearTimeout(t); }
  }

  /** Lê todas as fontes uma vez. Devolve quantos itens novos entraram. */
  async atualizar() {
    const ctx = prepararContexto(this.contexto());
    const agora = Date.now();
    const limite = agora - this.diasGuardados * 86_400_000;
    const porLink = new Set(this.itens.map((i) => linkCanonico(i.link)));
    const porTitulo = new Set(this.itens.map((i) => `${i.fonte}|${chaveTitulo(i.titulo)}`));
    const lidos = await Promise.all(this.fontes.map(async (f) => [f, await this.lerFonte(f)]));
    let novos = 0;
    for (const [f, itens] of lidos) {
      f.novosNaUltima = 0;
      for (const it of itens) {
        const data = it.data && it.data <= agora + 3_600_000 ? it.data : agora;
        if (data < limite) continue;
        const lc = linkCanonico(it.link), kt = `${f.id}|${chaveTitulo(it.titulo)}`;
        if (porLink.has(lc) || porTitulo.has(kt)) continue;
        if (!classificar(it, ctx)) continue;
        porLink.add(lc); porTitulo.add(kt);
        this.itens.push({ id: `${f.id}-${(agora + novos).toString(36)}`, titulo: it.titulo, link: it.link, fonte: f.id, data, vistoEm: agora, resumo: it.resumo.slice(0, 400), categorias: it.categorias.slice(0, 6) });
        f.novosNaUltima++;
        novos++;
      }
    }
    this.itens = this.itens.filter((i) => i.data >= limite).sort((a, b) => b.data - a.data).slice(0, this.maxItens);
    this.atualizadoEm = agora;
    if (novos) { this.versao++; this.emit('update', { novos }); }
    await this.salvar().catch(() => {});
    return novos;
  }

  /** O que a interface recebe. Reclassifica na hora: assim etiquetas melhoram quando chegam os nomes do TSE. */
  payload() {
    const ctx = prepararContexto(this.contexto());
    const nomes = Object.fromEntries(this.fontes.map((f) => [f.id, f.nome]));
    const itens = [];
    for (const i of this.itens) {
      const c = classificar(i, ctx);
      if (!c) continue;
      itens.push({ id: i.id, titulo: i.titulo, link: i.link, fonte: nomes[i.fonte] || i.fonte, fonteId: i.fonte, data: i.data, ...c });
    }
    return {
      atualizadoEm: this.atualizadoEm,
      intervaloMs: this.intervaloMs,
      fontes: this.fontes.map((f) => ({ id: f.id, nome: f.nome, site: f.site, ok: f.ok, erro: f.erro, lidoEm: f.lidoEm, itens: itens.filter((i) => i.fonteId === f.id).length })),
      itens,
    };
  }

  async start() {
    await this.carregar();
    const ciclo = async () => {
      try { await this.atualizar(); } catch (e) { console.error('[notícias]', e); }
      this.timer = setTimeout(ciclo, this.intervaloMs);
      this.timer.unref?.();
    };
    ciclo();
  }

  stop() { clearTimeout(this.timer); }
}
