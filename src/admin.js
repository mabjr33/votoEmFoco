// Área administrativa: saúde do coletor e aprovação de pesquisas.
// Só existe com ADMIN_TOKEN definido (16+ caracteres). Autenticação por cabeçalho
// "Authorization: Bearer <token>" (sem cookie, então sem risco de CSRF).

import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_CORPO = 16 * 1024;
const JANELA_FALHAS = 10 * 60_000;
const MAX_FALHAS = 10;

const hash = (s) => createHash('sha256').update(String(s)).digest();

export function criarAdmin({ token, collector, noticias, pesquisas, conexoes, aoMudarPesquisas, trustProxy = false, log = console }) {
  const ativo = typeof token === 'string' && token.length >= 16;
  if (token && !ativo) log.warn?.('[admin] ADMIN_TOKEN com menos de 16 caracteres: painel desligado');
  const esperado = ativo ? hash(token) : null;
  const falhas = new Map(); // ip -> [instantes]
  const inicio = Date.now();

  const ipDe = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  function responder(res, status, obj) {
    const json = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
  }
  function autorizado(req, res) {
    const ip = ipDe(req), agora = Date.now();
    const recentes = (falhas.get(ip) || []).filter((t) => agora - t < JANELA_FALHAS);
    if (recentes.length >= MAX_FALHAS) { responder(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' }); return false; }
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (m && timingSafeEqual(hash(m[1]), esperado)) { falhas.delete(ip); return true; }
    recentes.push(agora);
    falhas.set(ip, recentes);
    if (falhas.size > 10_000) falhas.clear(); // não deixa o mapa crescer sem limite
    responder(res, 401, { erro: 'Senha inválida.' });
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
    };
  }

  /** Trata /api/admin/*. Devolve true se a rota é do painel. */
  return async function tratar(req, res, p) {
    if (!p.startsWith('/api/admin/')) return false;
    if (!ativo) { res.writeHead(404); res.end(); return true; }
    if (!autorizado(req, res)) return true;
    try {
      if (p === '/api/admin/saude' && req.method === 'GET') return responder(res, 200, saude()), true;
      if (p === '/api/admin/pesquisas' && req.method === 'GET') {
        const itens = noticias?.payload().itens || [];
        const conhecidos = pesquisas.conhecidos();
        const semRegistro = itens.filter((i) => i.etiquetas.includes('pesquisa') && !(i.registros || []).some((r) => conhecidos.has(r)) && !(i.registros || []).length).slice(0, 15)
          .map((i) => ({ titulo: i.titulo, link: i.link, fonte: i.fonte, data: i.data }));
        return responder(res, 200, { aprovadas: pesquisas.itens, detectadas: pesquisas.detectadas(itens), semRegistro }), true;
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
