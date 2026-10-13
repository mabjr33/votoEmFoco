// Banco de dados (Supabase / Postgres) para o que precisa sobreviver a reinícios: pesquisas
// aprovadas e automáticas, as removidas no painel e o acesso ao painel. Sem dependências: usa a API
// REST do próprio Supabase (PostgREST). Tabelas em supabase/schema.sql.
// Só existe com SUPABASE_URL e SUPABASE_SERVICE_KEY; sem eles, tudo continua em arquivo (data/).

const CAMPOS = [ // nome no site -> coluna no banco
  ['registro', 'registro'], ['instituto', 'instituto'], ['campo', 'campo'], ['divulgacao', 'divulgacao'], ['amostra', 'amostra'],
  ['margem', 'margem'], ['flavio', 'flavio'], ['lula', 'lula'], ['flavioValido', 'flavio_valido'], ['lulaValido', 'lula_valido'],
  ['depois1T', 'depois_1t'], ['fonteUrl', 'fonte_url'], ['fonteNome', 'fonte_nome'], ['origem', 'origem'], ['fontes', 'fontes'],
  ['cnpj', 'cnpj'], ['fim', 'fim'], ['aprovadaEm', 'aprovada_em'],
];
const NUMEROS = new Set(['margem', 'flavio', 'lula', 'flavioValido', 'lulaValido']);
const paraBanco = (p) => Object.fromEntries(CAMPOS.map(([a, b]) => [b, p[a] ?? (b === 'origem' ? 'painel' : null)]));
const doBanco = (l) => Object.fromEntries(CAMPOS.map(([a, b]) => [a, NUMEROS.has(a) && l[b] != null ? Number(l[b]) : l[b]]).filter(([, v]) => v !== null && v !== undefined));
const lista = (xs) => encodeURIComponent(`(${xs.map((x) => `"${String(x).replace(/["\\]/g, '')}"`).join(',')})`);

export class BancoSupabase {
  constructor({ url, chave, fetch = globalThis.fetch }) {
    this.url = String(url).replace(/\/+$/, '');
    this.chave = chave;
    this.fetch = fetch;
    this.ultimoErro = null;
    this.ultimoOk = null;
  }

  /** opcional: falha não mexe no estado de saúde do banco (ex.: tabela de visitas, que é acessória). */
  async req(metodo, caminho, corpo, prefer, { opcional = false } = {}) {
    const headers = { apikey: this.chave, Accept: 'application/json' };
    // Chave antiga (service_role) é um JWT e vai também no Authorization; a nova (sb_secret_...) só no apikey
    if (!this.chave.startsWith('sb_')) headers.Authorization = `Bearer ${this.chave}`;
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await this.fetch(`${this.url}/rest/v1/${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: ctrl.signal });
      const texto = await r.text();
      if (!r.ok) throw new Error(`banco ${metodo} ${caminho.split('?')[0]}: HTTP ${r.status} ${texto.slice(0, 160)}`);
      if (!opcional) { this.ultimoOk = Date.now(); this.ultimoErro = null; }
      return texto ? JSON.parse(texto) : null;
    } catch (e) {
      if (!opcional) this.ultimoErro = e.name === 'AbortError' ? 'banco: tempo esgotado' : e.message;
      throw e;
    } finally { clearTimeout(t); }
  }

  async lerPesquisas() {
    const [itens, ign] = await Promise.all([
      this.req('GET', 'pesquisas?select=*&order=aprovada_em.desc'),
      this.req('GET', 'pesquisas_ignoradas?select=registro'),
    ]);
    return { itens: itens.map(doBanco), ignoradas: ign.map((x) => x.registro) };
  }

  /** Deixa o banco igual ao estado em memória (são poucas linhas). */
  async gravarPesquisas({ itens, ignoradas }) {
    if (itens.length) await this.req('POST', 'pesquisas?on_conflict=registro', itens.map(paraBanco), 'resolution=merge-duplicates,return=minimal');
    const fora = itens.length ? `?registro=not.in.${lista(itens.map((p) => p.registro))}` : '?registro=not.is.null';
    await this.req('DELETE', `pesquisas${fora}`, undefined, 'return=minimal');
    if (ignoradas.length) await this.req('POST', 'pesquisas_ignoradas?on_conflict=registro', ignoradas.map((registro) => ({ registro })), 'resolution=ignore-duplicates,return=minimal');
    const foraIgn = ignoradas.length ? `?registro=not.in.${lista(ignoradas)}` : '?registro=not.is.null';
    await this.req('DELETE', `pesquisas_ignoradas${foraIgn}`, undefined, 'return=minimal');
  }

  async lerAcesso() {
    const [l] = await this.req('GET', 'painel_acesso?select=usuario,hash&id=eq.1');
    return l ? { usuario: l.usuario, hash: l.hash } : null;
  }

  async gravarAcesso({ usuario, hash }) {
    await this.req('POST', 'painel_acesso?on_conflict=id', [{ id: 1, usuario, hash, atualizado_em: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
  }

  /** Totais por dia dos últimos `dias` dias: [{ dia, visitantes, paginas }]. Acessório: não afeta a saúde do banco. */
  async lerVisitas(dias = 90) {
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
    const linhas = await this.req('GET', `visitas_diarias?select=dia,visitantes,paginas&dia=gte.${desde}&order=dia.asc`, undefined, undefined, { opcional: true });
    return linhas.map((l) => ({ dia: l.dia, visitantes: Number(l.visitantes), paginas: Number(l.paginas) }));
  }

  async gravarVisitas(linhas) {
    if (!linhas.length) return;
    await this.req('POST', 'visitas_diarias?on_conflict=dia', linhas.map(({ dia, visitantes, paginas }) => ({ dia, visitantes, paginas })), 'resolution=merge-duplicates,return=minimal', { opcional: true });
  }

  estado() { return { ok: !this.ultimoErro, ultimoOk: this.ultimoOk, erro: this.ultimoErro }; }
}

const semAspas = (s) => String(s || '').trim().replace(/^["'<]+|[">']+$/g, '').trim();

/**
 * Endereço do projeto a partir do que foi colado na variável. Aceita os enganos comuns: o endereço
 * da API com /rest/v1, aspas ou espaços em volta e o link do painel do Supabase
 * (supabase.com/dashboard/project/<id>). Devolve https://<id>.supabase.co, ou null se não der.
 */
export function urlDoProjeto(valor) {
  const s = semAspas(valor);
  const painel = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})\b/i);
  if (painel) return `https://${painel[1].toLowerCase()}.supabase.co`;
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (u.protocol !== 'https:' || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.')) return null;
  return `https://${u.host}`;
}

/** Banco a partir da configuração, ou null (sem banco: tudo em arquivo). Lança erro se a URL não serve. */
export function criarBanco(cfg, opcoes = {}) {
  if (!cfg.supabaseUrl || !cfg.supabaseChave) return null;
  const url = urlDoProjeto(cfg.supabaseUrl);
  if (!url) throw new Error('SUPABASE_URL deve ser https://<projeto>.supabase.co (Project Settings > Data API, "Project URL")');
  return new BancoSupabase({ url, chave: semAspas(cfg.supabaseChave), ...opcoes });
}
