// Pesquisas do 2º turno aprovadas pelo painel (além das fixas em src/shared/historico.js).
// Os números são digitados por quem confere a fonte: nada é tirado automaticamente de manchete.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { PESQUISAS_2026_2T } from './shared/historico.js';

const REGISTRO = /^BR-\d{5}\/20\d{2}$/;
const texto = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '').slice(0, max);
const numero = (v, lo, hi) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

/** Valida e normaliza uma pesquisa enviada pelo painel. Devolve { pesquisa } ou { erro }. */
export function validarPesquisa(e) {
  if (!e || typeof e !== 'object') return { erro: 'Envie os dados da pesquisa.' };
  const registro = texto(e.registro, 20).toUpperCase();
  if (!REGISTRO.test(registro)) return { erro: 'Registro no formato BR-12345/2026 (pesquisa nacional registrada no TSE).' };
  const instituto = texto(e.instituto, 60);
  if (instituto.length < 2) return { erro: 'Informe o instituto.' };
  const amostra = numero(e.amostra, 100, 200_000);
  if (amostra === null || !Number.isInteger(amostra)) return { erro: 'Entrevistas: número inteiro entre 100 e 200.000.' };
  const margem = numero(e.margem, 0.1, 10);
  if (margem === null) return { erro: 'Margem de erro entre 0,1 e 10 pontos.' };
  const flavio = e.flavio === '' || e.flavio == null ? null : numero(e.flavio, 0, 100);
  const lula = e.lula === '' || e.lula == null ? null : numero(e.lula, 0, 100);
  if ((flavio === null) !== (lula === null) || (flavio !== null && flavio + lula > 100)) return { erro: 'Votos totais: preencha os dois, somando até 100.' };
  let flavioValido = e.flavioValido === '' || e.flavioValido == null ? null : numero(e.flavioValido, 0, 100);
  let lulaValido = e.lulaValido === '' || e.lulaValido == null ? null : numero(e.lulaValido, 0, 100);
  if ((flavioValido === null) !== (lulaValido === null)) return { erro: 'Votos válidos: preencha os dois.' };
  if (flavioValido !== null && Math.abs(flavioValido + lulaValido - 100) > 0.6) return { erro: 'Votos válidos precisam somar 100 (tolerância de arredondamento: 0,6).' };
  if (flavioValido === null && flavio === null) return { erro: 'Preencha os votos totais ou os válidos.' };
  let fonteUrl = texto(e.fonteUrl, 400);
  try { const u = new URL(fonteUrl); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(); fonteUrl = u.href; } catch { return { erro: 'Fonte: link http(s) da matéria ou do instituto.' }; }
  const fonteNome = texto(e.fonteNome, 60) || new URL(fonteUrl).hostname.replace(/^www\./, '');
  return {
    pesquisa: {
      instituto, registro, campo: texto(e.campo, 20), divulgacao: texto(e.divulgacao, 10), amostra, margem,
      flavio, lula, flavioValido, lulaValido, depois1T: true, fonteUrl, fonteNome, aprovadaEm: new Date().toISOString(),
    },
  };
}

export class Pesquisas {
  constructor(dataDir) {
    this.arquivo = dataDir ? path.join(dataDir, 'pesquisas.json') : null;
    this.itens = [];
    this.versao = 0;
  }

  async carregar() {
    if (!this.arquivo) return;
    try { const j = JSON.parse(await readFile(this.arquivo, 'utf8')); this.itens = Array.isArray(j.itens) ? j.itens : []; } catch { /* primeiro uso */ }
  }

  async salvar() {
    if (!this.arquivo) return;
    await mkdir(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify({ itens: this.itens }, null, 1));
    await rename(tmp, this.arquivo);
  }

  /** Registros que já estão no modelo (fixos ou aprovados). */
  conhecidos() { return new Set([...PESQUISAS_2026_2T.map((p) => p.registro), ...this.itens.map((p) => p.registro)]); }

  async adicionar(entrada) {
    const { pesquisa, erro } = validarPesquisa(entrada);
    if (erro) return { erro };
    if (this.conhecidos().has(pesquisa.registro)) return { erro: `A pesquisa ${pesquisa.registro} já está no modelo.` };
    this.itens.unshift(pesquisa);
    this.versao++;
    await this.salvar();
    return { pesquisa };
  }

  async remover(registro) {
    const antes = this.itens.length;
    this.itens = this.itens.filter((p) => p.registro !== registro);
    if (this.itens.length === antes) return false;
    this.versao++;
    await this.salvar();
    return true;
  }

  /**
   * Pesquisas que aparecem nas manchetes com registro nacional e ainda não estão no modelo.
   * São só sugestões: os números precisam ser conferidos na fonte antes de aprovar.
   */
  detectadas(itensNoticias = []) {
    const conhecidos = this.conhecidos();
    const porRegistro = new Map();
    for (const i of itensNoticias) {
      for (const r of i.registros || []) {
        if (!REGISTRO.test(r) || conhecidos.has(r)) continue;
        const l = porRegistro.get(r) || { registro: r, manchetes: [] };
        if (l.manchetes.length < 5) l.manchetes.push({ titulo: i.titulo, link: i.link, fonte: i.fonte, data: i.data });
        porRegistro.set(r, l);
      }
    }
    return [...porRegistro.values()].sort((a, b) => b.manchetes[0].data - a.manchetes[0].data);
  }
}
