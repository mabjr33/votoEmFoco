// Pesquisas do 2º turno que entram no modelo além das fixas em src/shared/historico.js:
// - aprovadas no painel, com os números conferidos por quem aprovou;
// - automáticas: registradas no TSE (cadastro oficial) e com os MESMOS números publicados por
//   pelo menos dois veículos diferentes. Na dúvida (uma fonte só, números divergentes), a pesquisa
//   fica no painel esperando aprovação. Nada sai de manchete.

import { EventEmitter } from 'node:events';
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
  // Margem: obrigatória no painel (o formulário exige); nas automáticas, só quando a reportagem informa
  const margem = e.margem === '' || e.margem == null ? null : numero(e.margem, 0.1, 10);
  if (margem === null && (e.margem !== null || !e.automatica)) return { erro: 'Margem de erro entre 0,1 e 10 pontos.' };
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

// Tolerância entre reportagens da mesma pesquisa, em pontos de votos válidos de Flávio. Cobre
// arredondamento (52 × 52,8) e a conta de válidos a partir dos totais; não cobre número errado.
const TOLERANCIA = 0.6;
const partilhaFlavio = (m) => (m.validos ? m.validos.flavio : (100 * m.totais.flavio) / (m.totais.flavio + m.totais.lula));
const mediana = (xs) => { const v = [...xs].sort((a, b) => a - b); const i = v.length >> 1; return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2; };
function maisComum(lista, chave = JSON.stringify) {
  const conta = new Map();
  for (const x of lista) if (x != null) { const k = chave(x); conta.set(k, { x, n: (conta.get(k)?.n || 0) + 1 }); }
  let melhor = null;
  for (const v of conta.values()) if (!melhor || v.n > melhor.n) melhor = v;
  return melhor?.x ?? null;
}
const diaMes = (iso) => { const [, m, d] = iso.split('-').map(Number); return [d, m]; };
/** '2026-10-06', '2026-10-08' -> '6–8/10' (como nas pesquisas fixas). */
export function periodoCampo(inicio, fim) {
  if (!inicio || !fim) return '';
  const [d1, m1] = diaMes(inicio), [d2, m2] = diaMes(fim);
  if (inicio === fim) return `${d2}/${m2}`;
  return m1 === m2 ? `${d1}–${d2}/${m2}` : `${d1}/${m1}–${d2}/${m2}`;
}
const fmtDia = (ms) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'numeric', timeZone: 'America/Sao_Paulo' }).format(ms);

/** Junta o cadastro do TSE com as reportagens (uma por veículo) numa entrada para validarPesquisa. */
function proposta(cad, fontes) {
  const validos = maisComum(fontes.map((f) => f.validos));
  const totais = maisComum(fontes.map((f) => f.totais));
  return {
    automatica: true,
    registro: cad.registro, instituto: cad.instituto, amostra: cad.amostra,
    campo: periodoCampo(cad.inicio, cad.fim), divulgacao: fmtDia(Math.min(...fontes.map((f) => f.data))),
    margem: maisComum(fontes.map((f) => f.margem)),
    flavio: totais?.flavio ?? null, lula: totais?.lula ?? null,
    flavioValido: validos?.flavio ?? null, lulaValido: validos?.lula ?? null,
    fonteUrl: fontes[0].link, fonteNome: fontes[0].fonte,
  };
}

export class Pesquisas extends EventEmitter {
  constructor(dataDir) {
    super();
    this.arquivo = dataDir ? path.join(dataDir, 'pesquisas.json') : null;
    this.itens = [];
    this.ignoradas = new Set(); // automáticas removidas no painel: não voltam sozinhas
    this.pendentes = []; // achadas nas reportagens, mas sem confirmação suficiente
    this.versao = 0;
  }

  async carregar() {
    if (!this.arquivo) return;
    try {
      const j = JSON.parse(await readFile(this.arquivo, 'utf8'));
      this.itens = Array.isArray(j.itens) ? j.itens : [];
      this.ignoradas = new Set(Array.isArray(j.ignoradas) ? j.ignoradas : []);
    } catch { /* primeiro uso */ }
  }

  async salvar() {
    if (!this.arquivo) return;
    await mkdir(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify({ itens: this.itens, ignoradas: [...this.ignoradas] }, null, 1));
    await rename(tmp, this.arquivo);
  }

  /** Registros que já estão no modelo (fixos, aprovados ou automáticos). */
  conhecidos() { return new Set([...PESQUISAS_2026_2T.map((p) => p.registro), ...this.itens.map((p) => p.registro)]); }

  async adicionar(entrada) {
    const { pesquisa, erro } = validarPesquisa({ ...entrada, automatica: false });
    if (erro) return { erro };
    if (this.conhecidos().has(pesquisa.registro)) return { erro: `A pesquisa ${pesquisa.registro} já está no modelo.` };
    this.itens.unshift({ ...pesquisa, origem: 'painel' });
    this.ignoradas.delete(pesquisa.registro);
    this.pendentes = this.pendentes.filter((p) => p.registro !== pesquisa.registro);
    this.versao++;
    await this.salvar();
    return { pesquisa };
  }

  async remover(registro) {
    const item = this.itens.find((p) => p.registro === registro);
    if (!item) return false;
    this.itens = this.itens.filter((p) => p !== item);
    if (item.origem === 'automatica') this.ignoradas.add(registro);
    this.versao++;
    await this.salvar();
    return true;
  }

  /**
   * Confere as reportagens lidas com o cadastro do TSE. Uma pesquisa entra sozinha quando:
   * está no cadastro oficial (presidencial, nacional, campo depois do 1º turno); a reportagem cita
   * exatamente um registro desse tipo; pelo menos dois veículos diferentes publicaram números; e
   * nenhum veículo diverge dos outros. O resto vira pendência no painel, já preenchida.
   * cadastro: { get(registro) }. extracoes: [{ link, host, fonte, data, registros, validos, totais, margem }].
   * Devolve quantas entraram.
   */
  async sincronizarAutomaticas(cadastro, extracoes) {
    const conhecidos = this.conhecidos();
    const porRegistro = new Map();
    for (const m of extracoes) {
      const regs = (m.registros || []).filter((r) => cadastro.get(r));
      if (regs.length !== 1 || !(m.validos || m.totais)) continue;
      if (!porRegistro.has(regs[0])) porRegistro.set(regs[0], []);
      porRegistro.get(regs[0]).push(m);
    }
    const pendentes = [];
    let novas = 0;
    for (const [registro, ms] of porRegistro) {
      if (conhecidos.has(registro)) continue;
      const porHost = new Map();
      for (const m of [...ms].sort((a, b) => a.data - b.data)) if (m.host && !porHost.has(m.host)) porHost.set(m.host, m);
      const fontes = [...porHost.values()];
      const partilhas = fontes.map(partilhaFlavio);
      const ref = mediana(partilhas);
      const lista = fontes.map((f) => ({ nome: f.fonte, url: f.link, validos: f.validos, totais: f.totais }));
      const entrada = proposta(cadastro.get(registro), fontes);
      let motivo = this.ignoradas.has(registro) ? 'removida no painel; só volta se você aprovar'
        : partilhas.some((x) => Math.abs(x - ref) > TOLERANCIA) ? 'as reportagens trazem números diferentes'
          : fontes.length < 2 ? 'só um veículo publicou os números até agora' : null;
      const { pesquisa, erro } = validarPesquisa(entrada);
      if (!motivo && erro) motivo = erro;
      if (motivo) { pendentes.push({ ...entrada, motivo, fontes: lista }); continue; }
      const cad = cadastro.get(registro);
      this.itens.unshift({ ...pesquisa, origem: 'automatica', fontes: lista.map(({ nome, url }) => ({ nome, url })), cnpj: cad.cnpj, fim: cad.fim });
      novas++;
    }
    this.pendentes = pendentes.sort((a, b) => a.registro.localeCompare(b.registro));
    if (novas) {
      this.versao++;
      await this.salvar();
      this.emit('mudou');
    }
    return novas;
  }

  /**
   * Pesquisas que aparecem nas manchetes com registro nacional e ainda não estão no modelo.
   * São só sugestões: os números precisam ser conferidos na fonte antes de aprovar.
   */
  detectadas(itensNoticias = []) {
    const conhecidos = this.conhecidos();
    const pendentes = new Set(this.pendentes.map((p) => p.registro));
    const porRegistro = new Map();
    for (const i of itensNoticias) {
      for (const r of i.registros || []) {
        if (!REGISTRO.test(r) || conhecidos.has(r) || pendentes.has(r)) continue;
        const l = porRegistro.get(r) || { registro: r, manchetes: [] };
        if (l.manchetes.length < 5) l.manchetes.push({ titulo: i.titulo, link: i.link, fonte: i.fonte, data: i.data });
        porRegistro.set(r, l);
      }
    }
    return [...porRegistro.values()].sort((a, b) => b.manchetes[0].data - a.manchetes[0].data);
  }
}
