// Abre as reportagens de pesquisa presidencial que chegaram pelos feeds e guarda os números
// que src/pesquisas-auto/extrair.js conseguiu ler. Cada link é lido uma vez só, um de cada vez,
// com pausa entre eles. Não toca no TSE.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { lerLimitado } from '../noticias/coletor.js';
import { decodificarCorpo } from '../noticias/rss.js';
import { extrairPesquisa, VERSAO_EXTRATOR } from './extrair.js';

const AGENTE = 'Mozilla/5.0 (compatible; ApuracaoEleicoes/1.0; leitor de pesquisas)';
const MAX_PAGINA = 3 * 1024 * 1024;
const DIA = 86_400_000;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export const hostDe = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m|amp)\./, ''); } catch { return ''; } };

export class LeitorMaterias {
  /** opcoes: { dataDir, candidatos, maxPorCiclo, diasMax, pausaMs, fetch, log } */
  constructor(opcoes = {}) {
    this.arquivo = opcoes.dataDir ? path.join(opcoes.dataDir, 'materias-pesquisa.json') : null;
    this.candidatos = opcoes.candidatos;
    this.maxPorCiclo = opcoes.maxPorCiclo ?? 12;
    this.diasMax = opcoes.diasMax ?? 5;
    this.pausaMs = opcoes.pausaMs ?? 1500;
    this.fetch = opcoes.fetch || globalThis.fetch;
    this.log = opcoes.log || console;
    this.lidas = new Map(); // link -> { link, host, fonte, data, lidoEm, registros, validos, totais, margem, erro }
    this.rodando = false;
  }

  async carregar() {
    if (!this.arquivo) return;
    try { const j = JSON.parse(await readFile(this.arquivo, 'utf8')); this.lidas = new Map((j.itens || []).map((m) => [m.link, m])); } catch { /* primeiro uso */ }
  }

  async salvar() {
    if (!this.arquivo) return;
    await mkdir(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify({ itens: [...this.lidas.values()] }));
    await rename(tmp, this.arquivo);
  }

  async ler(link) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await this.fetch(link, { headers: { 'User-Agent': AGENTE, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }, signal: ctrl.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (!/html/i.test(r.headers.get('content-type') || 'text/html')) throw new Error('não é HTML');
      const html = decodificarCorpo(await lerLimitado(r, MAX_PAGINA), r.headers.get('content-type') || '');
      return extrairPesquisa(html, this.candidatos);
    } finally { clearTimeout(t); }
  }

  /**
   * Lê as reportagens novas. itens: os da aba Notícias ({ link, fonte, data, etiquetas }).
   * Só entram as etiquetadas como pesquisa sobre presidente, dos últimos `diasMax` dias.
   */
  async processar(itens, agora = Date.now()) {
    if (this.rodando) return 0;
    this.rodando = true;
    let lidas = 0;
    try {
      const fila = itens.filter((i) => i.etiquetas?.includes('pesquisa') && i.etiquetas?.includes('presidente')
        && agora - i.data < this.diasMax * DIA && /^https?:\/\//.test(i.link) && this.lidas.get(i.link)?.versao !== VERSAO_EXTRATOR).slice(0, this.maxPorCiclo);
      for (const i of fila) {
        if (lidas) await espera(this.pausaMs);
        const base = { link: i.link, host: hostDe(i.link), fonte: i.fonte, data: i.data, lidoEm: agora, versao: VERSAO_EXTRATOR };
        try { this.lidas.set(i.link, { ...base, ...(await this.ler(i.link)) }); } catch (e) { this.lidas.set(i.link, { ...base, erro: String(e.message || e).slice(0, 120) }); }
        lidas++;
      }
      for (const [k, m] of this.lidas) if (agora - m.lidoEm > 15 * DIA) this.lidas.delete(k);
      if (lidas) await this.salvar().catch(() => {});
    } finally { this.rodando = false; }
    return lidas;
  }

  /** Reportagens com algum número lido. */
  extracoes() { return [...this.lidas.values()].filter((m) => !m.erro && (m.validos || m.totais)); }
}
