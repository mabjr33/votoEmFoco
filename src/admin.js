// Área administrativa: saúde do coletor e aprovação de pesquisas.
// Entrada com usuário e senha criados pelo dono do site (src/acesso.js); não existe conta padrão.
// Criar o acesso ou redefini-lo exige o código de instalação (ADMIN_TOKEN). Depois de entrar, a
// sessão vai no cabeçalho "Authorization: Bearer <sessão>" (sem cookie, então sem risco de CSRF).

import { Acesso } from './acesso.js';

const MAX_CORPO = 16 * 1024;
const JANELA_FALHAS = 10 * 60_000;
const MAX_FALHAS = 10;

export function criarAdmin({ token, acesso = null, loginEnv = null, dataDir = null, banco = null, collector, noticias, pesquisas, cadastro = null, conexoes, aoMudarPesquisas, trustProxy = false, log = console }) {
  if (token && token.length < 16) log.warn?.('[admin] ADMIN_TOKEN com menos de 16 caracteres: não serve como código de instalação');
  const contas = acesso || new Acesso({ dataDir, loginEnv, codigoInstalacao: token, banco, log });
  const carregado = contas.carregar();
  const falhas = new Map(); // ip -> [instantes]
  const inicio = Date.now();

  const ipDe = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  function responder(res, status, obj) {
    const json = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
  }
  const bloqueado = (ip) => (falhas.get(ip) || []).filter((t) => Date.now() - t < JANELA_FALHAS).length >= MAX_FALHAS;
  function falhou(ip) {
    const agora = Date.now();
    const recentes = (falhas.get(ip) || []).filter((t) => agora - t < JANELA_FALHAS);
    recentes.push(agora);
    falhas.set(ip, recentes);
    if (falhas.size > 10_000) falhas.clear(); // não deixa o mapa crescer sem limite
  }
  const sessaoDe = (req) => String(req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1] || null;
  function autorizado(req, res) {
    const ip = ipDe(req);
    if (bloqueado(ip)) { responder(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' }); return false; }
    if (contas.sessao(sessaoDe(req))) return true;
    falhou(ip);
    responder(res, 401, { erro: 'Sessão expirada ou inválida. Entre de novo.' });
    return false;
  }
  function lerCorpo(req) {
    return new Promise((resolve, reject) => {
      const partes = []; let total = 0;
      req.on('data', (d) => { total += d.length; if (total > MAX_CORPO) { reject(new Error('grande')); req.destroy(); } else partes.push(d); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); } catch { reject(new Error('json')); } });
      req.on('error', reject);
    });
  }

  function saude() {
    const st = collector.status();
    const races = [...collector.races.values()].map((r) => ({
      id: r.id, label: r.label, aoVivo: !!r.live?.available, pst: r.live?.summary?.secoes?.pst ?? null,
      totalizadoEm: r.live?.summary?.totalizadoEm || null, atualizadoEm: r.live?.atualizadoEm || null,
    }));
    const n = noticias?.payload();
    return {
      agora: new Date().toISOString(), noArDesde: new Date(inicio).toISOString(), memoriaMb: Math.round(process.memoryUsage().rss / 1e6),
      conexoesAoVivo: conexoes(),
      tse: {
        fonte: `${st.base}/${st.ambiente}`, pronto: st.ready, ultimaRespostaOk: st.tseOkEm, semRespostaMs: st.tseSemRespostaMs,
        pausadoAte: st.pausedUntil, ultimaConsulta: st.lastPoll, configuracaoEm: st.discovery?.configEm,
        segundoTurnoFederal: st.discovery?.federal2Disponivel, ufsGovernador2T: st.discovery?.estadual2Ufs || [],
        requisicoes: st.http,
      },
      disputas: races,
      noticias: n ? { atualizadoEm: n.atualizadoEm, fontes: n.fontes } : null,
      banco: banco ? banco.estado() : null,
      cadastroPesquisas: cadastro ? { atualizadoEm: cadastro.atualizadoEm, erro: cadastro.erro, pesquisas: cadastro.itens.size } : null,
    };
  }

  /** Trata /api/admin/*. Devolve true se a rota é do painel. */
  return async function tratar(req, res, p) {
    if (!p.startsWith('/api/admin/')) return false;
    await carregado;
    // Sem conta e sem código de instalação, o painel não existe
    if (!contas.ativo) { res.writeHead(404); res.end(); return true; }
    const ip = ipDe(req);

    // ---------- sem sessão: estado, criar/redefinir acesso, entrar ----------
    if (p === '/api/admin/estado' && req.method === 'GET') return responder(res, 200, { configurado: contas.configurado, podeCriar: !!contas.codigo }), true;
    if ((p === '/api/admin/criar' || p === '/api/admin/entrar') && req.method === 'POST') {
      if (bloqueado(ip)) return responder(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' }), true;
      let corpo;
      try { corpo = await lerCorpo(req); } catch { return responder(res, 400, { erro: 'Corpo inválido.' }), true; }
      // Criar quando já existe conta é "redefinir": exige o código de instalação do mesmo jeito
      const r = p === '/api/admin/criar' ? await contas.definir(corpo) : await contas.entrar(corpo);
      if (r.erro) {
        if (r.status === 401) falhou(ip);
        return responder(res, r.status, { erro: r.erro }), true;
      }
      falhas.delete(ip);
      log.info?.(`[admin] ${p.endsWith('criar') ? 'acesso criado/redefinido' : 'entrada'}: ${contas.conta.usuario}`);
      return responder(res, p.endsWith('criar') ? 201 : 200, r), true;
    }

    // ---------- com sessão ----------
    if (!autorizado(req, res)) return true;
    try {
      if (p === '/api/admin/sair' && req.method === 'POST') { contas.sair(sessaoDe(req)); return responder(res, 200, { ok: true }), true; }
      if (p === '/api/admin/senha' && req.method === 'POST') {
        let corpo;
        try { corpo = await lerCorpo(req); } catch { return responder(res, 400, { erro: 'Corpo inválido.' }), true; }
        const r = await contas.trocarSenha(sessaoDe(req), corpo);
        if (r.erro) return responder(res, r.status, { erro: r.erro }), true;
        log.info?.(`[admin] senha trocada: ${contas.conta.usuario}`);
        return responder(res, 200, r), true;
      }
      if (p === '/api/admin/conta' && req.method === 'GET') return responder(res, 200, { usuario: contas.conta.usuario, origem: contas.conta.origem, linhaVariavel: contas.linhaVariavel() }), true;
      if (p === '/api/admin/saude' && req.method === 'GET') return responder(res, 200, saude()), true;
      if (p === '/api/admin/pesquisas' && req.method === 'GET') {
        const itens = noticias?.payload().itens || [];
        const conhecidos = pesquisas.conhecidos();
        const semRegistro = itens.filter((i) => i.etiquetas.includes('pesquisa') && !(i.registros || []).some((r) => conhecidos.has(r)) && !(i.registros || []).length).slice(0, 15)
          .map((i) => ({ titulo: i.titulo, link: i.link, fonte: i.fonte, data: i.data }));
        return responder(res, 200, { aprovadas: pesquisas.itens, pendentes: pesquisas.pendentes, detectadas: pesquisas.detectadas(itens), semRegistro, automatica: !!cadastro }), true;
      }
      if (p === '/api/admin/pesquisas' && req.method === 'POST') {
        let corpo;
        try { corpo = await lerCorpo(req); } catch { return responder(res, 400, { erro: 'Corpo inválido.' }), true; }
        const r = await pesquisas.adicionar(corpo);
        if (r.erro) return responder(res, 422, r), true;
        aoMudarPesquisas();
        log.info?.(`[admin] pesquisa aprovada: ${r.pesquisa.instituto} ${r.pesquisa.registro}`);
        return responder(res, 201, r), true;
      }
      const m = p.match(/^\/api\/admin\/pesquisas\/(BR-\d{5}%2F20\d{2}|BR-\d{5}\/20\d{2})$/i);
      if (m && req.method === 'DELETE') {
        const ok = await pesquisas.remover(decodeURIComponent(m[1]).toUpperCase());
        if (ok) { aoMudarPesquisas(); log.info?.(`[admin] pesquisa removida: ${decodeURIComponent(m[1])}`); }
        return responder(res, ok ? 200 : 404, { ok }), true;
      }
      return responder(res, 404, { erro: 'Rota não encontrada.' }), true;
    } catch (e) {
      log.error?.('[admin]', e);
      return responder(res, 500, { erro: 'Erro interno.' }), true;
    }
  };
}
