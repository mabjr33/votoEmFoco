// Cadastro oficial de pesquisas eleitorais (PesqEle), publicado pelo TSE no Portal de Dados
// Abertos como um .zip de CSVs atualizado uma vez por dia. O cadastro NÃO traz resultados:
// traz instituto, CNPJ, período de campo, data de divulgação e número de entrevistas. Serve para
// saber quais pesquisas existem e para conferir as que aparecem nas reportagens.
//
// Uma consulta a cada 6 horas, condicional (If-None-Match / If-Modified-Since): o arquivo só é
// baixado de novo quando muda. Nada de varredura nem de outras URLs.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { lerLimitado } from '../noticias/coletor.js';

const MAX_ZIP = 40 * 1024 * 1024;
const MAX_CSV = 80 * 1024 * 1024;

/** Lê um arquivo de dentro de um .zip (sem dependências). filtro: (nome) => boolean. */
export function lerZip(buf, filtro) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip sem diretório central');
  const total = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < total; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido');
    const metodo = b.readUInt16LE(p + 10), tam = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const nome = b.toString('latin1', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!filtro(nome)) continue;
    if (tam === 0xffffffff) throw new Error('zip64 não suportado');
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('zip corrompido');
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const dados = b.subarray(ini, ini + tam);
    if (metodo === 0) return { nome, dados };
    if (metodo === 8) return { nome, dados: inflateRawSync(dados, { maxOutputLength: MAX_CSV }) };
    throw new Error(`método de compressão ${metodo} não suportado`);
  }
  return null;
}

/** CSV do TSE: separador ";", campos entre aspas, latin1. Gera um objeto por linha. */
export function* lerCsv(texto) {
  let campo = '', linha = [], aspas = false, cab = null;
  const fim = () => { linha.push(campo); campo = ''; const l = linha; linha = []; return l; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; }
    else if (c === '\n') {
      if (campo.endsWith('\r')) campo = campo.slice(0, -1);
      const l = fim();
      if (!cab) cab = l; else if (l.length > 1) yield Object.fromEntries(cab.map((k, j) => [k, l[j] ?? '']));
    } else campo += c;
  }
  if (campo || linha.length) { const l = fim(); if (cab && l.length > 1) yield Object.fromEntries(cab.map((k, j) => [k, l[j] ?? ''])); }
}

// Grafia dos institutos mais conhecidos; os demais ficam com o nome do cadastro.
const MARCAS = [
  [/DATAFOLHA/, 'Datafolha'], [/ATLAS ?INTEL/, 'AtlasIntel'], [/PODER ?DATA/, 'PoderData'], [/QUAEST/, 'Quaest'],
  [/\bIPEC\b/, 'Ipec'], [/VOX BRASIL/, 'Vox Brasil'], [/VOX POPULI/, 'Vox Populi'], [/PARANA PESQUISAS/, 'Paraná Pesquisas'],
  [/REAL TIME BIG DATA/, 'Real Time Big Data'], [/\bMDA\b/, 'MDA'], [/PALVER/, 'Palver'], [/NEXUS/, 'Nexus'], [/IPESPE/, 'Ipespe'],
  [/FUTURA/, 'Futura'], [/\bIDEIA\b/, 'Ideia'],
];
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const titulo = (s) => s.toLowerCase().split(' ').map((w, i) => (i && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
export function nomeInstituto(fantasia, empresa) {
  const f = /^#?NULO#?$/i.test(fantasia || '') ? '' : String(fantasia || '').trim();
  const base = semAcento(`${f} ${empresa || ''}`);
  for (const [re, nome] of MARCAS) if (re.test(base)) return nome;
  const n = (f || String(empresa || '')).replace(/\b(LTDA|EIRELI|EPP|ME|S\/?A)\b\.?/gi, '').replace(/[\s,.-]+$/, '').replace(/\s+/g, ' ').trim();
  return titulo(n).slice(0, 60);
}

const dia = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null);

/** Linha do CSV -> pesquisa presidencial nacional, ou null. */
export function pesquisaDoCadastro(o) {
  if (o.SG_UF !== 'BR' || !/presidente/i.test(o.DS_CARGO || '')) return null;
  const m = String(o.NR_PROTOCOLO_REGISTRO || '').match(/^BR(\d{5})(20\d{2})$/);
  if (!m) return null;
  return {
    registro: `BR-${m[1]}/${m[2]}`,
    instituto: nomeInstituto(o.NM_EMPRESA_FANTASIA, o.NM_EMPRESA),
    cnpj: String(o.NR_CNPJ_EMPRESA || '').replace(/\D/g, '') || null,
    inicio: dia(o.DT_INICIO_PESQUISA), fim: dia(o.DT_FIM_PESQUISA), divulgacao: dia(o.DT_DIVULGACAO),
    amostra: Number(o.QT_ENTREVISTADO) || null,
    propria: o.ST_PESQUISA_PROPRIA === 'S',
  };
}

export class RegistroPesquisas {
  /** opcoes: { url, dataDir, intervaloMs, desde ('AAAA-MM-DD': só pesquisas com campo terminado a partir daí), fetch, log } */
  constructor(opcoes = {}) {
    this.url = opcoes.url || null;
    this.arquivo = opcoes.dataDir ? path.join(opcoes.dataDir, 'registro-pesquisas.json') : null;
    this.intervaloMs = Math.max(3_600_000, Number(opcoes.intervaloMs) || 6 * 3_600_000);
    this.desde = opcoes.desde || '2026-10-06';
    this.fetch = opcoes.fetch || globalThis.fetch;
    this.log = opcoes.log || console;
    this.itens = new Map();
    this.etag = null; this.modificado = null; this.atualizadoEm = null; this.erro = null;
    this.timer = null;
  }

  async carregar() {
    if (!this.arquivo) return;
    try {
      const j = JSON.parse(await readFile(this.arquivo, 'utf8'));
      this.itens = new Map((j.itens || []).map((p) => [p.registro, p]));
      Object.assign(this, { etag: j.etag || null, modificado: j.modificado || null, atualizadoEm: j.atualizadoEm || null });
    } catch { /* primeiro uso */ }
  }

  async salvar() {
    if (!this.arquivo) return;
    await mkdir(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify({ etag: this.etag, modificado: this.modificado, atualizadoEm: this.atualizadoEm, itens: [...this.itens.values()] }));
    await rename(tmp, this.arquivo);
  }

  /** Lê o .zip já baixado e guarda só as pesquisas presidenciais com campo a partir de `desde`. */
  importarZip(buf) {
    const csv = lerZip(buf, (n) => /_BRASIL\.csv$/i.test(n));
    if (!csv) throw new Error('arquivo nacional não encontrado no zip');
    const itens = new Map();
    for (const o of lerCsv(new TextDecoder('latin1').decode(csv.dados))) {
      const p = pesquisaDoCadastro(o);
      if (p && p.fim && p.fim >= this.desde) itens.set(p.registro, p);
    }
    this.itens = itens;
    return itens.size;
  }

  /** Uma consulta condicional. Devolve true se o cadastro mudou. */
  async atualizar() {
    if (!this.url) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const headers = { 'User-Agent': 'eleicoes-ao-vivo/1.0 (cadastro de pesquisas; 1 consulta a cada 6 h)' };
      if (this.etag) headers['If-None-Match'] = this.etag;
      if (this.modificado) headers['If-Modified-Since'] = this.modificado;
      const r = await this.fetch(this.url, { headers, signal: ctrl.signal, redirect: 'follow' });
      if (r.status === 304) { this.erro = null; return false; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const n = this.importarZip(await lerLimitado(r, MAX_ZIP));
      this.etag = r.headers.get('etag'); this.modificado = r.headers.get('last-modified');
      this.atualizadoEm = Date.now(); this.erro = null;
      await this.salvar().catch(() => {});
      this.log.info?.(`[pesquisas] cadastro do TSE: ${n} pesquisas presidenciais com campo desde ${this.desde}`);
      return true;
    } catch (e) {
      this.erro = e.name === 'AbortError' ? 'tempo esgotado' : String(e.message || e).slice(0, 120);
      this.log.warn?.(`[pesquisas] cadastro do TSE indisponível: ${this.erro}`);
      return false;
    } finally { clearTimeout(t); }
  }

  get(registro) { return this.itens.get(registro) || null; }

  /** Pesquisas com divulgação a partir de hoje (AAAA-MM-DD), em ordem de data. */
  proximas(hoje) {
    return [...this.itens.values()].filter((p) => p.divulgacao && p.divulgacao >= hoje)
      .sort((a, b) => a.divulgacao.localeCompare(b.divulgacao) || a.instituto.localeCompare(b.instituto));
  }

  start(aoMudar = () => {}) {
    const ciclo = async () => {
      if (await this.atualizar()) aoMudar();
      this.timer = setTimeout(ciclo, this.intervaloMs);
      this.timer.unref?.();
    };
    return this.carregar().then(ciclo);
  }

  stop() { clearTimeout(this.timer); }
}
