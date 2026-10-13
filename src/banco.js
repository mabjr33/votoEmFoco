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

  async req(metodo, caminho, corpo, prefer) {
    const headers = { apikey: this.chave, Authorization: `Bearer ${this.chave}`, Accept: 'application/json' };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await this.fetch(`${this.url}/rest/v1/${caminho}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: ctrl.signal });
      const texto = await r.text();
      if (!r.ok) throw new Error(`banco ${metodo} ${caminho.split('?')[0]}: HTTP ${r.status} ${texto.slice(0, 160)}`);
      this.ultimoOk = Date.now(); this.ultimoErro = null;
      return texto ? JSON.parse(texto) : null;
    } catch (e) {
      this.ultimoErro = e.name === 'AbortError' ? 'banco: tempo esgotado' : e.message;
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

  estado() { return { ok: !this.ultimoErro, ultimoOk: this.ultimoOk, erro: this.ultimoErro }; }
}

/** Banco a partir da configuração, ou null (sem banco: tudo em arquivo). */
export function criarBanco(cfg, opcoes = {}) {
  if (!cfg.supabaseUrl || !cfg.supabaseChave) return null;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(String(cfg.supabaseUrl).replace(/\/+$/, ''))) throw new Error('SUPABASE_URL deve ser https://<projeto>.supabase.co');
  return new BancoSupabase({ url: cfg.supabaseUrl, chave: cfg.supabaseChave, ...opcoes });
}
