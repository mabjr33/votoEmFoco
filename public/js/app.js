import { defaultParams, simulate, liveProjection, normFlow } from '/shared/engine.js';
import { suggestedFlow } from '/shared/presets.js';
import { REGIOES, pontoDePartida, cenarioFinal, situacaoVirada, mesclarHistorico } from '/shared/aovivo.js';
import { $, $$, fmtInt, fmtPct, fmtChance, fmtPp, esc, clamp, curto, deQtd, parseVotos, redondo, titulo, normalizar, avatar } from './util.js';
import { corPartido, textoSobre } from './partidos.js';
import { desenharBrasil } from './mapa-br.js';
import { NOME_SITE } from './marca.js';
import { renderPrevisoes, fotosFinalistas, definirPesquisasExtras } from './previsoes.js';
import { renderSimuladorFacil, ligarSimuladorFacil } from './simulador.js';
import { renderNoticias, contarNovas } from './noticias.js';
import MAPA from './mapa-brasil.js';

const UF_NOME = Object.fromEntries(MAPA.locations.map((l) => [l.id, l.name]));
UF_NOME.zz = 'Exterior';
const UFS = MAPA.locations.map((l) => l.id).sort((a, b) => UF_NOME[a].localeCompare(UF_NOME[b], 'pt'));
const ufNome = (cd) => UF_NOME[cd] || String(cd).toUpperCase();
const CA = 'var(--a)', CB = 'var(--b)';
// Mapa-múndi (o maior arquivo do site): só é baixado quando alguém abre a aba Exterior
let MUNDO = null;

// ---------- estado ----------
const S = {
  status: null, races: [], pres: null, gov: {}, endorsers: {}, exterior: null, eventos: [],
  rota: { aba: 'presidente', uf: null, sim: 'pres' }, turno: null, turnoEscolhido: false, modo: null,
  base: {}, opts: {}, simDesenhado: null, dicas: {}, dicasPrev: {}, noticias: null, paisAberto: null, tipoMapa: null,
  atrasadas: new Set(), // disputas que mudaram fora da tela: atualizadas quando a pessoa abrir
};
const ler = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// cache 'no-cache': o navegador revalida e recebe 304 quando nada mudou
async function getJSON(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

// ---------- dados ----------
async function carregarRace(id) { const p = await getJSON(`/api/race/${id}`); if (id === 'pres') S.pres = p; else S.gov[p.scope] = p; }

/**
 * Atualização de uma disputa já carregada: só a parte ao vivo e o fim do histórico. O 1º turno
 * não muda (quando muda, o servidor manda recarregar tudo). Corta a maior parte do tráfego da noite.
 */
async function carregarVivo(id) {
  const atual = id === 'pres' ? S.pres : Object.values(S.gov).find((g) => g.id === id);
  if (!atual) return carregarRace(id);
  const v = await getJSON(`/api/race/${id}/vivo`);
  const hist = mesclarHistorico(atual.live?.history || [], v.historicoFim || []);
  if (!hist) return carregarRace(id);
  Object.assign(atual, { version: v.version, finalists: v.finalists, live: { ...v.live, history: hist } });
}
/** Exterior: só o 2º turno de cada cidade; o 1º turno já está aqui. */
async function carregarExteriorVivo() {
  if (!S.exterior?.cidades) { S.exterior = await getJSON('/api/exterior'); return; }
  const v = await getJSON('/api/exterior/vivo');
  const porCd = new Map(S.exterior.cidades.map((c) => [c.cd, c]));
  if (v.cidades.some((c) => !porCd.has(c.cd))) { S.exterior = await getJSON('/api/exterior'); return; }
  for (const c of v.cidades) porCd.get(c.cd).t2 = c.t2;
  Object.assign(S.exterior, { version: v.version, aoVivo: v.aoVivo, atualizadoEm: v.atualizadoEm, total: { ...S.exterior.total, t2: v.total.t2 } });
}
/** Lista de disputas: completa nas recargas; nos avisos comuns, só % apurado e versão de cada uma. */
function mesclarRaces(lista, pend) {
  if (lista.every((x) => 'label' in x)) { S.races = lista; return; }
  for (const x of lista) {
    const r = S.races.find((y) => y.id === x.id);
    if (r) Object.assign(r, x); else pend.add('*');
  }
}
/** Pesquisas aprovadas no painel: entram nos modelos da aba Previsões. */
async function carregarPesquisas() {
  const d = await getJSON('/api/pesquisas').catch(() => null);
  if (d) S.pesqChave = definirPesquisasExtras(d.itens || [], d.registradas || []);
}
async function carregarTudo() {
  const [status, races, endorsers, exterior, eventos] = await Promise.all([
    getJSON('/api/status').catch(() => null), getJSON('/api/races').catch(() => []), getJSON('/api/endorsers').catch(() => ({})),
    getJSON('/api/exterior').catch(() => null), getJSON('/api/eventos').catch(() => []),
  ]);
  Object.assign(S, { status, races, endorsers, exterior, eventos });
  S.atrasadas.clear();
  S.noticias = await getJSON('/api/noticias').catch(() => S.noticias);
  await carregarPesquisas();
  await Promise.all(races.map((r) => carregarRace(r.id).catch(() => {})));
  if (S.turno === null && S.pres) S.turno = temVotos(S.pres) ? 2 : 1;
}
const temVotos = (r) => !!(r?.live?.summary && r.live.summary.secoes.st > 0);
const liveUnits = (r) => (r.cargo === 1 ? r.live.units : r.live.summary ? { [r.scope]: r.live.summary } : {});
const fins = (r) => r?.finalists || [];
const votosDe = (u, n) => u?.cands.find((x) => x.n === n)?.vap || 0;

// ---------- simulação ----------
function premissasIniciais(r) {
  const p = defaultParams();
  const [a, b] = fins(r);
  const f = new Set(fins(r).map((x) => x.n));
  for (const c of (r.baseline.summary?.cands || []).filter((c) => !f.has(c.n) && c.pvap >= 0.5).slice(0, 10)) p.transferencias.global[c.n] = suggestedFlow(c.partido, a?.partido, b?.partido);
  if (r.cargo !== 1) p.incerteza.sdNacional = 3;
  return p;
}
const optsPadrao = () => ({ modo: 'nacional', shareNacional: null, shareRegiao: {}, comparecimento: 1, ajustes: [], semApuracao: false });
/** Apuração terminada: não sobra voto para dividir, então o simulador refaz o 2º turno inteiro. */
const encerrada = (r) => temVotos(r) && r.live.summary.secoes.pst >= 100;
/** Votos apurados entram no simulador durante a contagem, a menos que a pessoa peça para simular o 2º turno inteiro. */
const usaApuracao = (r) => temVotos(r) && !encerrada(r) && !opts(r).semApuracao;
const base = (r) => (S.base[r.id] ||= ler(`base:${r.id}`, null) || premissasIniciais(r));
const opts = (r) => (S.opts[r.id] ||= ler(`opts:${r.id}`, null) || optsPadrao());
const salvarSim = (r) => { gravar(`base:${r.id}`, S.base[r.id]); gravar(`opts:${r.id}`, S.opts[r.id]); };

/** comApuracao: usa os votos já apurados mesmo se a pessoa pediu ao simulador para ignorá-los. */
function calcular(r, { comApuracao = false } = {}) {
  if (!r || fins(r).length < 2 || !Object.keys(r.baseline.units).length) return null;
  const f = fins(r).map((x) => x.n);
  const p = base(r);
  const sim = simulate(r.baseline.units, f, p);
  const vivo = comApuracao ? temVotos(r) && !encerrada(r) : usaApuracao(r);
  const proj = vivo ? liveProjection(liveUnits(r), sim, f, { incerteza: p.incerteza }) : null;
  const pp = pontoDePartida({ live: vivo ? liveUnits(r) : {}, sim, proj }, f);
  const inc = { ...p.incerteza, seed: 11 };
  return { sim, proj, pp, final: cenarioFinal(pp, { ...opts(r), incerteza: inc }), esperado: cenarioFinal(pp, { ...optsPadrao(), incerteza: inc }) };
}

// ---------- rotas ----------
function lerRota() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'presidente';
  const [aba, ...resto] = h.split('-');
  const suf = resto.join('-');
  if (aba === 'simulador' || aba === 'avancado') return { aba, uf: null, sim: suf || S.rota.sim || 'pres' };
  if (aba === 'exterior' || aba === 'previsoes' || aba === 'noticias' || aba === 'telao') return { aba, uf: null, sim: S.rota.sim };
  if (!['presidente', 'governadores', 'senado'].includes(aba)) return { aba: 'presidente', uf: null, sim: S.rota.sim };
  return { aba, uf: /^[a-z]{2}$/.test(suf) ? suf : null, sim: S.rota.sim };
}
const ir = (h) => { if (location.hash !== `#${h}`) location.hash = h; else render(); };

// ---------- pedaços de interface ----------
const quad = (cor) => `<i class="marca" style="background:${cor}"></i>`;
function pessoa(c, cor, tam = 48) {
  return `<div class="pessoa">${avatar(c, { tam, cor })}<div><div class="nm">${esc(c.nmu)}</div><div class="pt">${esc(c.partido || '')}${c.n ? ` · ${esc(c.n)}` : ''}</div></div></div>`;
}
function barra(pA, pB, ca = CA, cb = CB, { pequena = false, total = 100 } = {}) {
  return `<div class="barra ${pequena ? 'pequena' : ''}" aria-hidden="true"><span style="width:${(pA / total) * 100}%;background:${ca}"></span><span style="flex:1"></span><span style="width:${(pB / total) * 100}%;background:${cb}"></span><i class="meio"></i></div>`;
}
function duelo(A, B, pA, pB, vA, vB, { ca = CA, cb = CB, total = 100 } = {}) {
  const lado = (c, cor, p, v, k) => `<div class="lado ${k}">${pessoa(c, cor)}<div class="pct">${fmtPct(p, 1)}<small>%</small></div>${v !== undefined ? `<div class="votos">${fmtInt(v)} votos</div>` : ''}</div>`;
  return `<div class="duelo">${lado(A, ca, pA, vA, 'a')}${lado(B, cb, pB, vB, 'b')}</div>${barra(pA, pB, ca, cb, { total })}`;
}
function linhaCand(c, cor, pct, votos, { menor = false, sub = '' } = {}) {
  return `<div class="linha-cand ${menor ? 'menor' : ''}"><span class="n">${avatar(c, { tam: menor ? 30 : 36, cor })}<span>${esc(c.nmu)}<small>${esc(sub || c.partido || '')}</small></span></span>
    <span class="v">${fmtPct(pct, 1)}%${votos !== undefined ? `<small>${fmtInt(votos)}</small>` : ''}</span></div>`;
}
function alternar(nome, itens, atual) {
  return `<div class="alternar" role="group" aria-label="${esc(nome)}">${itens.map(([k, t, ok = true]) => `<button type="button" data-${nome}="${k}" aria-pressed="${atual === k}" ${ok ? '' : 'disabled'}>${t}</button>`).join('')}</div>`;
}
/** Tom pela vantagem em pontos: mais forte quanto maior a diferença. */
function tom(cor, margem, firme = true) {
  const n = margem < 5 ? 35 : margem < 15 ? 55 : margem < 30 ? 75 : 95;
  return `color-mix(in oklab, ${cor} ${firme ? n : Math.round(n * 0.5)}%, var(--vazio))`;
}
const hora = (s) => { const m = String(s || '').match(/(\d{2}):(\d{2})/); return m ? `${m[1]}h${m[2]}` : ''; };

// ---------- topo ----------
function renderTopo() {
  document.title = S.status?.modoTeste ? `TESTE · ${NOME_SITE}` : NOME_SITE;
  $('#nome-site').textContent = NOME_SITE;
  const vista = { simulador: 'simulador', avancado: 'simulador', previsoes: 'previsoes', noticias: 'noticias', telao: 'telao' }[S.rota.aba] || 'resultado';
  document.body.classList.toggle('modo-telao', vista === 'telao');
  $('#vista-telao').hidden = vista !== 'telao';
  for (const a of $$('.vistas a')) a.setAttribute('aria-current', a.dataset.vista === vista ? 'page' : 'false');
  for (const a of $$('.disputas a')) a.setAttribute('aria-current', a.dataset.aba === S.rota.aba ? 'page' : 'false');
  $('#vista-resultado').hidden = vista !== 'resultado';
  $('#vista-simulador').hidden = vista !== 'simulador';
  $('#vista-previsoes').hidden = vista !== 'previsoes';
  $('#vista-noticias').hidden = vista !== 'noticias';
  const nn = vista === 'noticias' ? 0 : contarNovas(S.noticias);
  const ln = $('.vistas a[data-vista="noticias"]');
  if (nn) ln.dataset.novas = nn > 99 ? '99+' : nn; else delete ln.dataset.novas;
  $('#teste').hidden = !S.status?.modoTeste;
  const dr = S.status?.dadosReais;
  if (dr) $('#teste').textContent = `Modo de teste. O 1º turno é o real do TSE (baixado em ${new Date(dr.baixadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}). O 2º turno é uma simulação sorteada a cada execução: não é resultado nem previsão.`;
  const parado = renderAlertaTse();
  const el = $('#fonte');
  const sm = S.pres?.live?.summary;
  if (S.status?.pausedUntil && Date.parse(S.status.pausedUntil) > Date.now()) el.innerHTML = '<span class="ponto"></span>Consultas ao TSE em pausa para respeitar o limite de acesso. Mostrando o último dado recebido.';
  else if (parado && temVotos(S.pres)) el.innerHTML = `<span class="ponto"></span>Último dado recebido: totalização das ${esc(hora(sm.totalizadoEm))}, com ${fmtPct(sm.secoes.pst, 1)}% das seções.`;
  else if (temVotos(S.pres)) el.innerHTML = `<span class="ponto ${sm.totalFinal ? '' : 'vivo'}"></span>${sm.totalFinal ? 'Apuração encerrada' : 'Ao vivo'}${S.status?.modoTeste ? ' (simulação de teste)' : ', dados do TSE'} · ${fmtPct(sm.secoes.pst, 1)}% das seções · ${esc(hora(sm.totalizadoEm))}`;
  else if (S.pres) el.innerHTML = '<span class="ponto"></span>A apuração do 2º turno começa em 25 de outubro, às 17h de Brasília.';
  else el.textContent = 'Carregando os dados do TSE…';
}

/** Dados parados: o TSE não responde há mais de 3 ciclos de consulta (mínimo 90 s). */
function renderAlertaTse() {
  const st = S.status, el = $('#alerta-tse');
  const limite = Math.max(90_000, 3 * (st?.pollIntervalMs || 15_000));
  const parado = st?.ready && (st.tseSemRespostaMs === null || st.tseSemRespostaMs > limite);
  el.hidden = !parado;
  if (!parado) return false;
  const min = st.tseSemRespostaMs === null ? null : Math.max(1, Math.round(st.tseSemRespostaMs / 60_000));
  el.textContent = `${min === null ? 'O servidor ainda não conseguiu falar com o TSE' : `Sem resposta do TSE há ${min} min (desde ${new Date(st.tseOkEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h')})`}. Os números podem estar desatualizados; a página se atualiza sozinha quando o TSE voltar.`;
  return true;
}

/**
 * A disputa aparece na tela atual? Presidente sempre; governador só na aba Governadores, no telão,
 * no simulador dele ou no painel do estado. As outras ficam marcadas e são atualizadas ao abrir.
 */
function naTela(id) {
  if (id === 'pres') return true;
  const { aba, uf, sim } = S.rota;
  if (id === 'exterior') return aba === 'exterior';
  return aba === 'governadores' || aba === 'telao' || ((aba === 'simulador' || aba === 'avancado') && sim === id) || (!!uf && id === `gov-${uf}`);
}
const atualizarParte = (id) => (id === 'exterior' ? carregarExteriorVivo() : carregarVivo(id));
function atualizarAtrasadas() {
  const ids = [...S.atrasadas].filter(naTela);
  if (!ids.length) return;
  for (const i of ids) S.atrasadas.delete(i);
  Promise.all(ids.map((i) => atualizarParte(i).catch(() => {}))).then(() => render());
}

function render() {
  S.rota = lerRota();
  atualizarAtrasadas();
  const entrando = S.abaAnterior !== S.rota.aba;
  S.abaAnterior = S.rota.aba;
  renderTopo();
  if (S.rota.aba === 'telao') return renderTelao();
  if (S.rota.aba === 'previsoes') return mostrarPrevisoes();
  if (S.rota.aba === 'noticias') return renderNoticias($('#vista-noticias'), S.noticias, { entrando });
  S.prevDesenhada = null;
  if (!S.pres || !S.pres.baseline.summary) { $('#placar').innerHTML = '<p class="nota">Carregando o 1º turno no TSE…</p>'; return; }
  const a = S.rota.aba;
  if (a === 'simulador') {
    S.simDesenhado = null; // ao voltar para o avançado, ele se redesenha
    return renderSimuladorFacil({ r: raceSim(), races: S.races, ufNome, fins, raiz: $('#controles'), resumoEl: $('#sim-resumo'), cores: coresGov });
  }
  if (a === 'avancado') return renderSimulador();
  S.simDesenhado = null;
  // No modo de teste, o 2º turno é simulado: deixa isso escrito em cima do placar
  $('#placar').classList.toggle('simulado', !!S.status?.modoTeste && ((S.turno === 2 && ['presidente', 'exterior'].includes(a)) || a === 'governadores'));
  if (a === 'governadores') return renderGovernadores();
  if (a === 'senado') return renderSenado();
  if (a === 'exterior') {
    if (MUNDO) return renderExterior();
    $('#placar').innerHTML = '<p class="nota">Carregando o mapa-múndi…</p>';
    return import('./mapa-mundo.js').then((m) => { MUNDO = m; if (S.rota.aba === 'exterior') render(); }, console.error);
  }
  return renderPresidente();
}

// =================== PREVISÕES ===================
/** Os modelos não mudam com a apuração; só redesenha quando chegam dados novos do 1º turno. */
function mostrarPrevisoes() {
  const chave = `${S.pres?.baseline?.summary?.eleitores?.te || 0}:${Object.keys(S.gov).length}:${S.pesqChave || ''}`;
  if (S.prevDesenhada === chave) return;
  S.prevDesenhada = chave;
  S.dicasPrev = renderPrevisoes($('#vista-previsoes'), {
    pres: S.pres, gov: S.gov, fins, ufNome, UFS, premissas: premissasIniciais, fotos: () => fotosFinalistas(S.pres),
  });
}

function prepararMapa(tipo) {
  if (S.tipoMapa === tipo) return;
  S.tipoMapa = tipo;
  $('#mapa').innerHTML = '';
}
/** No celular: com estado escolhido, o painel sobe de baixo; sem estado, fica na página. */
function abrirPainel(aberto, fixo = !aberto) {
  $('#painel').classList.toggle('aberto', aberto);
  $('#painel').classList.toggle('fixo', fixo);
  $('#fundo').hidden = !aberto;
}

// =================== PRESIDENTE ===================
function modosDisponiveis(r) {
  const v = temVotos(r);
  return [['oficial', 'Oficial', v], ['projecao', 'Projeção', v && r.live.summary.secoes.pst < 100], ['simulacao', 'Simulação', true]];
}
function modoAtual(r) {
  const ok = modosDisponiveis(r).filter(([, , d]) => d).map(([k]) => k);
  if (!S.modo || !ok.includes(S.modo)) S.modo = temVotos(r) ? (r.live.summary.secoes.pst < 100 ? 'projecao' : 'oficial') : 'simulacao';
  return S.modo;
}

/** Situação de uma UF para presidente, conforme turno e modo. */
function ufPres(cd, c) {
  const r = S.pres;
  const [A, B] = fins(r);
  if (S.turno === 1) {
    const u = r.baseline.units[cd];
    if (!u) return null;
    const [l, s] = u.cands;
    const cor = l.n === A.n ? CA : l.n === B.n ? CB : corPartido(l.partido);
    return { lider: l, pct: l.pvap, margem: l.pvap - (s?.pvap || 0), cor, pA: u.cands.find((x) => x.n === A.n)?.pvap, pB: u.cands.find((x) => x.n === B.n)?.pvap, firme: true };
  }
  const m = modoAtual(r);
  if (m === 'oficial') {
    const lu = r.live.units[cd];
    if (!lu?.secoes.st) return { vazio: true };
    const a = votosDe(lu, A.n), b = votosDe(lu, B.n), pA = a + b ? (a / (a + b)) * 100 : 50;
    return { lider: pA >= 50 ? A : B, pct: Math.max(pA, 100 - pA), margem: Math.abs(2 * pA - 100), cor: pA >= 50 ? CA : CB, pA, pB: 100 - pA, a, b, apur: lu.secoes.pst, firme: lu.andamento === 'f' };
  }
  const u = m === 'projecao' ? c.proj?.units[cd] : c.sim.units[cd];
  if (!u) return null;
  return { lider: u.pctA >= 50 ? A : B, pct: Math.max(u.pctA, u.pctB), margem: Math.abs(u.pctA - u.pctB), cor: u.pctA >= 50 ? CA : CB, pA: u.pctA, pB: u.pctB, a: u.A, b: u.B, firme: false };
}

function renderPresidente() {
  const r = S.pres, c = calcular(r);
  const [A, B] = fins(r);
  const { uf } = S.rota;
  let corpo, pe;
  if (S.turno === 1) {
    const s = r.baseline.summary;
    const a = s.cands.find((x) => x.n === A.n), b = s.cands.find((x) => x.n === B.n);
    corpo = duelo({ ...A, sq: a.sq }, { ...B, sq: b.sq }, a.pvap, b.pvap, a.vap, b.vap);
    const outros = s.cands.filter((x) => x.n !== A.n && x.n !== B.n).reduce((t, x) => t + x.pvap, 0);
    pe = `<span>Resultado final do 1º turno. Diferença de <strong>${curto(Math.abs(a.vap - b.vap))}</strong>${deQtd(Math.abs(a.vap - b.vap))} votos. Os demais candidatos somaram ${fmtPct(outros)}%.</span>`;
  } else {
    const m = modoAtual(r);
    if (m === 'oficial') {
      const sm = r.live.summary, a = votosDe(sm, A.n), b = votosDe(sm, B.n), V = a + b || 1;
      corpo = duelo(A, B, (a / V) * 100, (b / V) * 100, a, b);
      pe = `<span><strong>${fmtPct(sm.secoes.pst, 1)}%</strong> das seções totalizadas. ${sm.totalFinal ? 'Resultado final do TSE.' : sm.md === 'e' ? 'Resultado matematicamente definido.' : `Ainda faltam cerca de <strong>${curto(c.esperado.faltam)}</strong>${deQtd(c.esperado.faltam)} votos válidos.`}</span>`;
    } else if (m === 'projecao') {
      const t = c.proj.total, i = c.proj.incerteza;
      corpo = duelo(A, B, t.pctA, t.pctB, t.A, t.B);
      pe = `<span>Projeção com <strong>${fmtPct(t.eleitoradoApuradoPct, 0)}%</strong> do eleitorado apurado. ${esc((i.pVitoriaA >= 0.5 ? A : B).nmu)} vence em ${fmtChance(Math.max(i.pVitoriaA, i.pVitoriaB))} das variações.</span>`;
    } else {
      const f = c.final;
      corpo = duelo(A, B, f.pA, f.pB, f.A, f.B);
      pe = `<span>Cenário do simulador. Diferença de <strong>${curto(Math.abs(f.margem))}</strong>${deQtd(Math.abs(f.margem))} votos. <a class="link" href="#avancado-pres">Ajustar</a></span>`;
    }
  }
  $('#placar').innerHTML = `<div class="placar-topo"><h1>Presidente</h1><div class="controles-placar">
      ${S.turno === 2 ? alternar('modo', modosDisponiveis(r), modoAtual(r)) : ''}${alternar('turno', [['1', '1º turno'], ['2', '2º turno']], String(S.turno))}</div></div>
    ${corpo}<div class="placar-pe">${pe}</div>${S.turno === 2 ? blocoVirada(r) : ''}`;
  prepararMapa('br');
  const dados = {};
  S.dicas = {};
  for (const cd of [...UFS, 'zz']) {
    const d = ufPres(cd, c);
    if (!d) continue;
    if (d.vazio) { dados[cd] = { fill: 'var(--vazio)' }; S.dicas[cd] = `<b>${esc(ufNome(cd))}</b><br>Ainda sem votos apurados`; continue; }
    dados[cd] = { fill: tom(d.cor, d.margem, d.firme || S.turno === 1), cor: d.cor };
    S.dicas[cd] = `<b>${esc(ufNome(cd))}</b><br>${esc(A.nmu)} ${fmtPct(d.pA)}%<br>${esc(B.nmu)} ${fmtPct(d.pB)}%${d.apur !== undefined ? `<br>${fmtPct(d.apur, 0)}% das seções` : ''}`;
  }
  desenharBrasil($('#mapa'), dados, { sel: uf, rotulos: false });
  const fonteMapa = S.turno === 1 ? 'Resultado do 1º turno' : { oficial: 'Votos já totalizados', projecao: 'Projeção por estado', simulacao: 'Cenário-base do simulador' }[modoAtual(r)];
  $('#mapa-pe').innerHTML = `<div class="legenda">${quad(CB)}${esc(B.nmu)}<span class="grad" style="background:linear-gradient(90deg,var(--b),var(--vazio),var(--a))"></span>${quad(CA)}${esc(A.nmu)}</div>
    <span>${fonteMapa}. Quanto mais forte a cor, maior a vantagem.</span><a class="chip" href="#exterior">Votos no exterior</a>`;
  $('#painel').innerHTML = uf ? painelPresUf(uf, c) : painelPresBrasil(c);
  abrirPainel(!!uf);
  $('#abaixo').innerHTML = blocoRegioes(c) + blocoEvolucao(r) + blocoCronologia();
  lembrarDobras($('#abaixo'));
}

function seletorEstado(aba) {
  return `<label class="nota" for="sel-uf" style="display:block;margin-bottom:6px">Ver um estado</label>
    <select class="entrada" id="sel-uf" data-aba="${aba}"><option value="">Escolha…</option>${UFS.map((u) => `<option value="${u}">${esc(ufNome(u))}</option>`).join('')}</select>`;
}

function painelPresBrasil(c) {
  const r = S.pres;
  let dl;
  if (S.turno === 1) {
    const s = r.baseline.summary;
    dl = `<dt>Eleitorado</dt><dd>${fmtInt(s.eleitores.te)}</dd><dt>Comparecimento</dt><dd>${fmtPct(s.eleitores.pc)}%</dd>
      <dt>Brancos e nulos</dt><dd>${fmtInt(s.votos.vb + s.votos.tvn)}</dd><dt>Votos válidos</dt><dd>${fmtInt(s.votos.vv)}</dd>`;
  } else if (temVotos(r)) {
    const s = r.live.summary;
    dl = `<dt>Seções totalizadas</dt><dd>${fmtPct(s.secoes.pst, 1)}%</dd><dt>Comparecimento</dt><dd>${fmtPct(s.eleitores.pc)}%</dd>
      <dt>Brancos e nulos</dt><dd>${fmtInt(s.votos.vb + s.votos.tvn)}</dd><dt>Votos válidos faltando</dt><dd>cerca de ${curto(c.esperado.faltam)}</dd>`;
  } else {
    const t = c.sim.total;
    dl = `<dt>Eleitorado</dt><dd>${fmtInt(t.te)}</dd><dt>Comparecimento no cenário</dt><dd>${fmtPct((t.comparecimento / t.te) * 100)}%</dd>
      <dt>Votos válidos no cenário</dt><dd>${fmtInt(t.validos)}</dd>`;
  }
  const outros = r.baseline.summary.cands.filter((x) => !fins(r).some((f) => f.n === x.n)).slice(0, 4);
  return `<div class="painel-cab"><div><h2>Brasil</h2><p class="sub">${S.turno === 1 ? '1º turno' : '2º turno'}, Presidente</p></div></div>
    <div class="bloco"><dl class="dados">${dl}</dl></div>
    <div class="bloco"><h3>Os demais candidatos no 1º turno</h3>${outros.map((x) => linhaCand(x, corPartido(x.partido), x.pvap, undefined, { menor: true })).join('')}</div>
    <div class="bloco">${seletorEstado('presidente')}<p class="nota" style="margin-top:10px">Ou clique no mapa.</p></div>`;
}

function painelPresUf(cd, c) {
  const r = S.pres;
  const [A, B] = fins(r);
  const d = ufPres(cd, c);
  const u1 = r.baseline.units[cd];
  let res;
  if (d && !d.vazio) {
    const t1 = S.turno === 1 ? '1º turno, resultado final' : { oficial: `Apuração, ${fmtPct(d.apur ?? 0, 1)}% das seções`, projecao: 'Projeção para o estado', simulacao: 'Cenário-base do simulador' }[modoAtual(r)];
    res = `<div class="bloco"><h3>${t1}</h3>${linhaCand(A, CA, d.pA, S.turno === 1 ? votosDe(u1, A.n) : d.a)}${linhaCand(B, CB, d.pB, S.turno === 1 ? votosDe(u1, B.n) : d.b)}${barra(d.pA, d.pB, CA, CB, { pequena: true })}</div>`;
  } else res = '<div class="bloco"><p class="nota">Ainda sem votos apurados neste estado.</p></div>';
  const v1 = u1 ? u1.cands.reduce((t, x) => t + x.vap, 0) : 0;
  const prim = S.turno === 2 && u1 ? `<div class="bloco"><h3>No 1º turno</h3><dl class="dados"><dt>${esc(A.nmu)}</dt><dd>${fmtPct((votosDe(u1, A.n) / v1) * 100)}%</dd>
    <dt>${esc(B.nmu)}</dt><dd>${fmtPct((votosDe(u1, B.n) / v1) * 100)}%</dd><dt>Eleitorado</dt><dd>${fmtInt(u1.eleitores.te)}</dd></dl></div>` : '';
  return `<div class="painel-cab"><div><h2>${esc(ufNome(cd))}</h2><p class="sub">Presidente${u1 ? `, eleitorado de ${fmtInt(u1.eleitores.te)}` : ''}</p></div>
      <a class="fechar" href="#presidente" aria-label="Fechar">×</a></div>${res}${prim}${blocoGovUf(cd)}${blocoSenUf(cd)}
    <div class="acoes"><a class="botao-2" href="#simulador-pres">Abrir o simulador</a></div>`;
}

function govSituacao(uf) {
  const e = S.endorsers[uf], g = S.gov[uf];
  if (g && fins(g).length === 2) {
    const [A, B] = fins(g);
    const ca = corPartido(A.partido), cb = corPartido(B.partido) === ca ? 'var(--tinta-3)' : corPartido(B.partido);
    if (temVotos(g)) {
      const sm = g.live.summary, a = votosDe(sm, A.n), b = votosDe(sm, B.n), pA = a + b ? (a / (a + b)) * 100 : 50;
      const fim = sm.totalFinal || sm.md === 'e';
      return { uf, tipo: fim ? 'eleito2' : 'vivo', A, B, ca, cb, pA, pB: 100 - pA, a, b, lider: pA >= 50 ? A : B, cor: pA >= 50 ? ca : cb, apur: sm.secoes.pst, firme: fim, g };
    }
    const s1 = g.baseline.summary;
    const a1 = s1?.cands.find((x) => x.n === A.n), b1 = s1?.cands.find((x) => x.n === B.n);
    return { uf, tipo: 'segundo', A: { ...A, sq: a1?.sq }, B: { ...B, sq: b1?.sq }, ca, cb, pA: a1?.pvap, pB: b1?.pvap, lider: A, cor: ca, firme: false, g };
  }
  const cands = e?.gov || [];
  const el = cands.find((x) => /^Eleit/i.test(x.st)) || cands[0];
  if (!el) return null;
  const seg = cands.find((x) => x !== el);
  return { uf, tipo: /^Eleit/i.test(el.st) ? 'eleito1' : 'indefinido', A: el, B: seg, ca: corPartido(el.partido), cb: corPartido(seg?.partido), pA: el.pvap, pB: seg?.pvap, lider: el, cor: corPartido(el.partido), firme: /^Eleit/i.test(el.st) };
}
const rotuloGov = (s) => ({ eleito1: 'Eleito no 1º turno', segundo: '2º turno em 25 de outubro', vivo: `2º turno, ${fmtPct(s.apur, 0)}% apurado`, eleito2: 'Eleito no 2º turno', indefinido: '' }[s.tipo]);

function blocoGovUf(cd) {
  const s = govSituacao(cd);
  if (!s) return '';
  if (s.tipo === 'eleito1' || s.tipo === 'indefinido') return `<div class="bloco"><h3>Governador, ${esc(rotuloGov(s).toLowerCase())}</h3>${linhaCand(s.A, s.ca, s.pA, undefined, { menor: true })}</div>`;
  let pA = s.pA, pB = s.pB, rot = rotuloGov(s);
  if (s.tipo === 'segundo') { const c = calcular(s.g); pA = c.final.pA; pB = c.final.pB; rot = '2º turno, cenário do simulador'; }
  return `<div class="bloco"><h3>Governador, ${esc(rot)}</h3>${linhaCand(s.A, s.ca, pA, undefined, { menor: true })}${linhaCand(s.B, s.cb, pB, undefined, { menor: true })}
    ${barra(pA, pB, s.ca, s.cb, { pequena: true })}<p style="margin-top:12px"><a class="link" href="#governadores-${cd}">Ver a disputa</a></p></div>`;
}
function blocoSenUf(cd) {
  const el = (S.endorsers[cd]?.sen || []).filter((x) => /^Eleit/i.test(x.st));
  if (!el.length) return '';
  return `<div class="bloco"><h3>Senadores eleitos</h3>${el.map((x) => linhaCand(x, corPartido(x.partido), x.pvap, undefined, { menor: true })).join('')}</div>`;
}

function blocoRegioes(c) {
  const r = S.pres;
  const [A, B] = fins(r);
  const cel = Object.entries(REGIOES).map(([k, reg]) => {
    let a = 0, b = 0, te = 0, est = 0;
    for (const uf of reg.ufs) {
      if (S.turno === 1) { const u = r.baseline.units[uf]; a += votosDe(u, A.n); b += votosDe(u, B.n); continue; }
      const m = modoAtual(r);
      if (m === 'oficial') { const u = r.live.units[uf]; if (u) { a += votosDe(u, A.n); b += votosDe(u, B.n); te += u.eleitores.te; est += u.eleitores.est; } }
      else { const u = m === 'projecao' ? c.proj?.units[uf] : c.sim.units[uf]; if (u) { a += u.A; b += u.B; } }
    }
    if (!(a + b)) return `<div class="regiao"><div class="nome">${esc(reg.nome)}</div><div class="sub">sem votos ainda</div></div>`;
    const pA = (a / (a + b)) * 100, lider = pA >= 50 ? A : B, cor = pA >= 50 ? CA : CB;
    const sub = S.turno === 1 ? 'entre os dois, no 1º turno' : modoAtual(r) === 'oficial' ? `${fmtPct(te ? (est / te) * 100 : 0, 0)}% apurado` : modoAtual(r) === 'projecao' ? 'projeção' : 'cenário-base';
    return `<div class="regiao"><div class="nome">${esc(reg.nome)}</div><div class="pct" style="color:${cor}">${fmtPct(Math.max(pA, 100 - pA), 1)}%</div>
      <div class="quem">${esc(lider.nmu)} à frente</div>${barra(pA, 100 - pA, CA, CB, { pequena: true })}<div class="sub">${sub}</div></div>`;
  }).join('');
  return `<section><h2>Por região</h2><div class="regioes">${cel}</div></section>`;
}

/**
 * "Ainda dá para virar?" durante a contagem. Usa os votos oficiais já apurados, a estimativa do
 * simulador para o que falta e, como teto, os eleitores das seções ainda não totalizadas (TSE).
 * A mesma regra vale para quem estiver atrás, seja quem for.
 */
function dadosVirada(r) {
  if (!temVotos(r) || encerrada(r) || r.live.summary.totalFinal) return null;
  const sm = r.live.summary, [A, B] = fins(r);
  const c = calcular(r, { comApuracao: true });
  if (!c) return null;
  const s = situacaoVirada({ a: votosDe(sm, A.n), b: votosDe(sm, B.n), faltam: c.esperado.faltam, esperadoA: c.esperado.esperado, eleitoresRestantes: sm.eleitores.esnt });
  return { s, sm, atras: s.atras === 'A' ? A : B };
}
const pctFr = (x) => `${fmtPct(x * 100, 1)}%`;
/** Uma linha só, para o telão. */
function linhaVirada(r) {
  const d = dadosVirada(r);
  if (!d) return '';
  const { s, sm, atras } = d;
  if (s.impossivel || sm.md === 'e') return s.impossivel ? `Não dá mais para virar: a diferença é maior que todos os eleitores das seções que faltam.` : 'O TSE indica resultado matematicamente definido.';
  if (s.precisa > 1) return `Pela estimativa, ${esc(atras.nmu)} não alcança nem com todos os votos válidos que faltam.`;
  return `Para virar, ${esc(atras.nmu)} precisa de ${pctFr(s.precisa)} dos votos que faltam${s.recebe == null ? '' : ` (estimativa: ${pctFr(s.recebe)})`}.`;
}

function blocoVirada(r, { titulo: h = 'h2', classe = '', cores = [CA, CB] } = {}) {
  const d = dadosVirada(r);
  if (!d) return '';
  const { s, sm, atras } = d;
  const [A, B] = fins(r);
  const frente = s.atras === 'A' ? B : A;
  const cor = s.atras === 'A' ? cores[0] : cores[1];
  const pct = pctFr;
  const qtd = (n) => `${curto(n)}${deQtd(n)}`;
  // Fala da contagem oficial (votos já totalizados), que pode ser diferente da projeção do placar
  const contagem = `Na contagem oficial (${fmtPct(sm.secoes.pst, 1)}% das seções), ${esc(frente.nmu)} está <b>${qtd(s.diferenca)} votos</b> à frente.`;
  const metodo = 'Votos que faltam: estimativa a partir das seções que faltam em cada estado. Teto: eleitores das seções ainda não totalizadas, segundo o TSE.';
  let resp, texto, medidor = '';
  if (s.impossivel || sm.md === 'e') {
    resp = 'Não';
    texto = s.impossivel ? `${contagem} A diferença já é maior que todos os eleitores das seções que faltam.` : 'O TSE indica resultado matematicamente definido.';
  } else if (s.precisa > 1) {
    resp = 'Pela estimativa, não';
    texto = `${contagem} Pela estimativa, nem todos os ${qtd(s.faltam)} votos válidos que faltam bastariam para ${esc(atras.nmu)}.`;
  } else {
    resp = 'Sim';
    texto = `${contagem} Para virar, ${esc(atras.nmu)} precisa de <b>${pct(s.precisa)}</b> dos votos que faltam${s.recebe == null ? '.' : `; a tendência indica ${pct(s.recebe)}.`}`;
    medidor = `<div class="medidor-virada" role="img" aria-label="Precisa de ${pct(s.precisa)} dos votos que faltam${s.recebe == null ? '' : `; tendência de ${pct(s.recebe)}`}">
      ${s.recebe == null ? '' : `<span class="est" style="width:${clamp(s.recebe, 0, 1) * 100}%;background:${cor}"></span>`}
      <i class="precisa ${s.precisa > 0.8 ? 'dir' : s.precisa < 0.2 ? 'esq' : ''}" style="left:${clamp(s.precisa, 0, 1) * 100}%"><b>precisa ${pct(s.precisa)}</b></i></div>`;
  }
  return `<div class="virada-card ${classe}" title="${esc(metodo)}"><${h}>Ainda dá para virar? <span class="resp">${resp}</span></${h}><p>${texto}</p>${medidor}</div>`;
}

/** Reabre os blocos recolhidos que a pessoa tinha aberto e passa a lembrar dos próximos. */
function lembrarDobras(raiz) {
  S.dobrasAbertas ||= new Set();
  for (const d of raiz.querySelectorAll('details.dobra[data-dobra]')) {
    if (S.dobrasAbertas.has(d.dataset.dobra)) d.open = true;
    d.addEventListener('toggle', () => { if (d.open) S.dobrasAbertas.add(d.dataset.dobra); else S.dobrasAbertas.delete(d.dataset.dobra); });
  }
}

// ---------- como a apuração andou ----------
const horaCurta = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? `${Number(m[1])}h${m[2]}` : ''; };
const pontosEvolucao = (r) => (r.live.history || []).filter((h) => h.pA !== null && h.pst > 0);
const temDiferenca = (pts) => pts.every((p) => p.vA != null && p.vB != null);
function legendaPonto(r, p) {
  const [A, B] = fins(r);
  const d = p.vA != null ? Math.abs(p.vA - p.vB) : null;
  return `${horaCurta(p.t) ? `${horaCurta(p.t)} · ` : ''}${fmtPct(p.pst, 1)}% das seções · ${A.nmu} ${fmtPct(p.pA)}% × ${B.nmu} ${fmtPct(p.pB)}%${d == null ? '' : ` · diferença de ${curto(d)}${deQtd(d)} votos`}`;
}

/**
 * Gráfico da apuração. modo 'pct': percentual de cada um; 'dif': diferença em votos (acima da
 * linha do zero, A à frente; abaixo, B). n: quantos pontos desenhar (o "rever" vai aumentando);
 * os eixos usam todos os pontos, para o gráfico não mudar de escala durante a animação.
 */
function svgEvolucao(r, pts, modo, n = pts.length) {
  const [A, B] = fins(r);
  const W = Math.round(Math.min(720, Math.max(300, document.documentElement.clientWidth - 32))), H = W < 480 ? 190 : 210, pad = { l: modo === 'dif' ? 58 : 40, r: 8, t: 12, b: 26 };
  const x = (v) => pad.l + (W - pad.l - pad.r) * (v / 100);
  const vis = pts.slice(0, Math.max(1, n)), u = vis.at(-1);
  let lo, hi, ticks, series, rotY, extra = '';
  if (modo === 'dif') {
    const ds = pts.map((p) => p.vA - p.vB);
    const M = Math.max(1, ...ds.map(Math.abs)) * 1.15;
    lo = -M; hi = M; ticks = [-M * 0.8, 0, M * 0.8];
    rotY = (v) => (v === 0 ? '0' : curto(Math.abs(v)));
    series = [{ k: (p) => p.vA - p.vB, cor: 'var(--tinta)' }];
  } else {
    const vals = pts.flatMap((p) => [p.pA, p.pB]);
    lo = Math.max(0, Math.floor(Math.min(...vals, 50) / 5) * 5 - 5); hi = Math.min(100, Math.ceil(Math.max(...vals, 50) / 5) * 5 + 5);
    ticks = [lo, 50, hi]; rotY = (v) => `${v}%`;
    series = [{ k: (p) => p.pA, cor: 'var(--a)' }, { k: (p) => p.pB, cor: 'var(--b)' }];
  }
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  if (modo === 'dif') {
    extra = `<text x="${W - pad.r}" y="${y(0) - 7}" text-anchor="end" class="lado" style="fill:var(--a)">↑ ${esc(A.nmu)} à frente</text>
      <text x="${W - pad.r}" y="${y(0) + 16}" text-anchor="end" class="lado" style="fill:var(--b)">↓ ${esc(B.nmu)} à frente</text>`;
  }
  const linha = (k) => vis.map((p, i) => `${i ? 'L' : 'M'}${x(p.pst).toFixed(1)},${y(k(p)).toFixed(1)}`).join(' ');
  // Pontos para a dica (no máximo ~120, para não pesar)
  const passo = Math.max(1, Math.ceil(vis.length / 120));
  const alvos = vis.filter((_, i) => i % passo === 0 || i === vis.length - 1)
    .map((p) => `<circle class="alvo" cx="${x(p.pst).toFixed(1)}" cy="${y(series[0].k(p)).toFixed(1)}" r="7" data-dica="${esc(legendaPonto(r, p))}"/>`).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modo === 'dif' ? 'Diferença em votos' : 'Percentuais'} durante a apuração. Último ponto: ${esc(legendaPonto(r, u))}">
    ${ticks.map((v) => `<line class="${v === 0 || v === 50 ? 'grade zero' : 'grade'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${rotY(v)}</text>`).join('')}
    ${(W < 480 ? [0, 50, 100] : [0, 25, 50, 75, 100]).map((v) => `<text x="${x(v)}" y="${H - 6}" text-anchor="${v === 100 ? 'end' : v === 0 ? 'start' : 'middle'}">${v}%${v === 100 ? ' das seções' : ''}</text>`).join('')}
    ${extra}${series.map((s) => `<path d="${linha(s.k)}" fill="none" stroke="${s.cor}" stroke-width="2.2" stroke-linejoin="round"/>`).join('')}
    ${series.map((s) => `<circle cx="${x(u.pst)}" cy="${y(s.k(u))}" r="4.5" fill="${s.cor}" stroke="var(--bg)" stroke-width="2"/>`).join('')}${alvos}</svg>`;
}

function blocoEvolucao(r) {
  const pts = pontosEvolucao(r);
  if (S.turno !== 2 || pts.length < 2) return '';
  const [A, B] = fins(r);
  const dif = temDiferenca(pts);
  const modo = dif && S.evolModo === 'dif' ? 'dif' : 'pct';
  const n = S.evolRever?.id === r.id ? S.evolRever.i : pts.length;
  const intro = modo === 'dif' ? 'Diferença em votos válidos, conforme as seções foram totalizadas.' : `${quad(CA)}${esc(A.nmu)} &nbsp; ${quad(CB)}${esc(B.nmu)}`;
  return `<section id="evolucao"><div class="evol-cab"><h2>Como a apuração andou</h2>${alternar('evol', [['pct', 'Percentuais'], ['dif', 'Diferença em votos', dif]], modo)}</div>
    <p class="intro">${intro}</p>
    <div id="evol-svg">${svgEvolucao(r, pts, modo, n)}</div>
    <div class="evol-pe"><button type="button" class="botao-2" id="evol-rever">${S.evolRever ? 'Parar' : 'Rever a apuração'}</button><span id="evol-leg" aria-live="polite">${esc(legendaPonto(r, pts[Math.max(0, n - 1)]))}</span></div></section>`;
}

/** Anima o gráfico do começo ao ponto atual, em uns 8 segundos. Clicar de novo para. */
function reverApuracao(r) {
  clearInterval(S.evolTimer);
  if (S.evolRever) { S.evolRever = null; return render(); }
  const pts = pontosEvolucao(r);
  if (pts.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const passo = Math.max(1, Math.ceil(pts.length / 100));
  S.evolRever = { id: r.id, i: 2 };
  const quadro = () => {
    const el = $('#evol-svg');
    const total = pontosEvolucao(r);
    if (!el || !S.evolRever) { clearInterval(S.evolTimer); S.evolRever = null; return; }
    const modo = temDiferenca(total) && S.evolModo === 'dif' ? 'dif' : 'pct';
    el.innerHTML = svgEvolucao(r, total, modo, S.evolRever.i);
    $('#evol-leg').textContent = legendaPonto(r, total[S.evolRever.i - 1]);
    if (S.evolRever.i >= total.length) { clearInterval(S.evolTimer); S.evolRever = null; $('#evol-rever').textContent = 'Rever a apuração'; return; }
    S.evolRever.i = Math.min(total.length, S.evolRever.i + passo);
  };
  $('#evol-rever').textContent = 'Parar';
  quadro();
  S.evolTimer = setInterval(quadro, 80);
}

function blocoCronologia() {
  // No celular, só os lotes mais recentes (a lista inteira ocupava várias telas)
  const itens = S.eventos.filter((e) => e.tipo === 'secoes' && e.a && e.b).slice(0, document.documentElement.clientWidth < 600 ? 6 : 14).map((e) =>
    `<li><span class="h">${esc(e.hora || '')}</span><span>${esc(e.texto)}. ${esc(e.a.nmu)} ${fmtPct(e.a.pvap)}%, ${esc(e.b.nmu)} ${fmtPct(e.b.pvap)}%.</span></li>`).join('');
  const n = S.eventos.filter((e) => e.tipo === 'secoes' && e.a && e.b).length;
  return `<details class="dobra" data-dobra="cronologia"><summary><span class="dobra-t">Registro da apuração</span><span class="dobra-r">${n ? `${fmtInt(n)} lote${n > 1 ? 's' : ''} de seções totalizadas pelo TSE` : 'Ainda sem seções do 2º turno'}</span></summary>
    <div class="dobra-corpo">${itens ? `<ul class="cronologia">${itens}</ul>` : '<p class="nota">Ainda não há seções do 2º turno totalizadas.</p>'}</div></details>`;
}

// =================== EXTERIOR ===================
function renderExterior() {
  const r = S.pres, c = calcular(r);
  const [A, B] = fins(r);
  const t = S.turno === 2 ? 't2' : 't1';
  const tot = S.exterior?.total?.[t];
  let corpo = '<p class="nota">Ainda sem votos apurados no exterior neste turno.</p>';
  if (tot && tot.a + tot.b > 0) {
    const V = tot.a + tot.b + (t === 't1' ? tot.outros : 0);
    const u1 = r.baseline.units.zz;
    corpo = duelo({ ...A, sq: u1?.cands.find((x) => x.n === A.n)?.sq }, { ...B, sq: u1?.cands.find((x) => x.n === B.n)?.sq }, (tot.a / V) * 100, (tot.b / V) * 100, tot.a, tot.b) +
      `<div class="placar-pe"><span><strong>${fmtPct(tot.pst, 1)}%</strong> das seções do exterior. ${curto(tot.te)}${deQtd(tot.te)} eleitores, comparecimento de ${fmtPct(tot.pc)}%.</span></div>`;
  }
  $('#placar').innerHTML = `<div class="placar-topo"><h1>Presidente no exterior</h1><div class="controles-placar">${alternar('turno', [['1', '1º turno'], ['2', '2º turno']], String(S.turno))}</div></div>${corpo}`;
  prepararMapa('mundo');
  const cidades = (S.exterior?.cidades || []).map((x) => {
    const d = x[t], ok = d && d.a + d.b > 0, pA = ok ? (d.a / (d.a + d.b)) * 100 : null;
    return { cd: x.cd, nome: x.nome, eleitores: x.t1?.te || d?.te || 0, cor: !ok ? 'var(--tinta-3)' : pA >= 50 ? 'var(--a)' : 'var(--b)', pA, d, loc: MUNDO.localizar(x.nome),
      dica: `<b>${esc(titulo(x.nome))}</b>${ok ? `<br>${esc(A.nmu)} ${fmtPct(pA)}%<br>${esc(B.nmu)} ${fmtPct(100 - pA)}%` : '<br>Sem votos apurados'}<br>${fmtInt(x.t1?.te || d?.te)} eleitores` };
  });
  const estados = {};
  for (const cd of UFS) { const d = ufPres(cd, c); if (d && !d.vazio) estados[cd] = tom(d.cor, d.margem, true); }
  MUNDO.desenharMundo($('#mapa'), cidades, estados);
  $('#mapa-pe').innerHTML = `<div class="legenda">${quad(CA)}${esc(A.nmu)} à frente ${quad(CB)}${esc(B.nmu)} à frente</div><span>Círculos proporcionais ao eleitorado da cidade.</span><a class="chip" href="#presidente">Voltar ao Brasil</a>`;
  const paises = {};
  for (const x of cidades) {
    const k = x.loc?.iso || '–';
    const p = (paises[k] ||= { iso: k, nome: x.loc?.pais || 'Outros locais', cidades: [], a: 0, b: 0, te: 0 });
    p.cidades.push(x); p.te += x.eleitores; if (x.d) { p.a += x.d.a; p.b += x.d.b; }
  }
  const lista = Object.values(paises).sort((a, b) => b.te - a.te).map((p) => {
    const pA = p.a + p.b ? (p.a / (p.a + p.b)) * 100 : null, aberto = S.paisAberto === p.iso;
    return `<li><button type="button" data-pais="${esc(p.iso)}" aria-expanded="${aberto}"><span class="nm">${esc(p.nome)}</span>
      <span class="v" style="color:${pA === null ? 'var(--tinta-3)' : pA >= 50 ? 'var(--a)' : 'var(--b)'}">${pA === null ? '–' : `${fmtPct(Math.max(pA, 100 - pA), 0)}%`}</span>
      <span class="sub">${p.cidades.length} ${p.cidades.length > 1 ? 'cidades' : 'cidade'}, ${curto(p.te)}${deQtd(p.te)} eleitores${pA === null ? '' : `, ${esc((pA >= 50 ? A : B).nmu)} à frente`}</span>
      ${pA === null ? '' : barra(pA, 100 - pA, CA, CB, { pequena: true })}</button>
      ${aberto ? `<div class="cidades-pais">${p.cidades.sort((a, b) => b.eleitores - a.eleitores).map((x) => `<div><span>${esc(titulo(x.nome))}</span><span>${x.pA === null ? '–' : `${fmtPct(x.pA, 0)}% a ${fmtPct(100 - x.pA, 0)}%`}</span></div>`).join('')}</div>` : ''}</li>`;
  }).join('');
  $('#painel').innerHTML = `<div class="painel-cab"><div><h2>Por país</h2><p class="sub">${Object.keys(paises).length} países, ${cidades.length} cidades. Fora do Brasil, o voto é só para presidente.</p></div></div>
    <div class="bloco"><ul class="paises">${lista}</ul></div>`;
  abrirPainel(false, true);
  $('#abaixo').innerHTML = '';
}

// =================== GOVERNADORES ===================
function renderGovernadores() {
  const { uf } = S.rota;
  const sit = UFS.map(govSituacao).filter(Boolean);
  const e1 = sit.filter((s) => s.tipo === 'eleito1').length, seg = sit.filter((s) => ['segundo', 'vivo', 'eleito2'].includes(s.tipo));
  const def2 = seg.filter((s) => s.tipo === 'eleito2').length;
  $('#placar').innerHTML = `<div class="placar-topo"><h1>Governadores</h1></div>
    <div class="numeros"><div><div class="n">${e1}</div><div class="r">eleitos no 1º turno</div></div>
      <div><div class="n">${seg.length}</div><div class="r">disputas no 2º turno</div></div>
      <div><div class="n">${def2}</div><div class="r">já decididas no 2º turno</div></div></div>`;
  prepararMapa('br');
  const dados = {};
  S.dicas = {};
  for (const s of sit) {
    dados[s.uf] = { fill: s.tipo === 'segundo' ? `color-mix(in oklab, ${s.ca} 28%, var(--vazio))` : tom(s.cor, Math.abs((s.pA || 0) - (s.pB || 0)), s.firme) };
    S.dicas[s.uf] = `<b>${esc(ufNome(s.uf))}</b><br>${esc(s.A.nmu)} (${esc(s.A.partido)}) ${fmtPct(s.pA)}%${s.B ? `<br>${esc(s.B.nmu)} (${esc(s.B.partido)}) ${fmtPct(s.pB)}%` : ''}<br>${esc(rotuloGov(s))}`;
  }
  desenharBrasil($('#mapa'), dados, { sel: uf, rotulos: false });
  const partidos = {};
  for (const s of sit) if (s.firme) partidos[s.lider.partido] = (partidos[s.lider.partido] || 0) + 1;
  $('#mapa-pe').innerHTML = `<div class="legenda">${Object.entries(partidos).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `<span>${quad(corPartido(p))}${esc(p)} ${n}</span>`).join('')}</div>
    <span>Cor pelo partido. Tons claros: 2º turno ainda em aberto.</span>`;
  if (uf) $('#painel').innerHTML = painelGovUf(uf);
  else {
    const item = (s) => `<li><a href="#governadores-${s.uf}"><span class="uf" style="background:${s.cor};color:${s.cor.startsWith('#') ? textoSobre(s.cor) : '#fff'}">${s.uf.toUpperCase()}</span>
      <span class="quem">${esc(s.lider.nmu)}${s.tipo === 'segundo' || s.tipo === 'vivo' ? ` × ${esc((s.lider.n === s.B.n ? s.A : s.B).nmu)}` : ''}<small>${esc(s.lider.partido)}, ${esc(rotuloGov(s).toLowerCase())}</small></span>
      <span class="v">${s.tipo === 'segundo' ? '' : `${fmtPct(Math.max(s.pA, s.pB || 0), 0)}%`}</span></a></li>`;
    $('#painel').innerHTML = `<div class="painel-cab"><div><h2>Estados</h2><p class="sub">Os 2º turnos primeiro, depois os eleitos no 1º turno.</p></div></div>
      <div class="bloco"><h3>2º turno</h3><ul class="lista-estados">${seg.map(item).join('')}</ul></div>
      <div class="bloco"><h3>Eleitos no 1º turno</h3><ul class="lista-estados">${sit.filter((s) => s.tipo === 'eleito1').map(item).join('')}</ul></div>`;
  }
  abrirPainel(!!uf);
  $('#abaixo').innerHTML = blocoCronologia();
  lembrarDobras($('#abaixo'));
}

function painelGovUf(uf) {
  const s = govSituacao(uf);
  const fechar = '<a class="fechar" href="#governadores" aria-label="Fechar">×</a>';
  if (!s) return `<div class="painel-cab"><h2>${esc(ufNome(uf))}</h2>${fechar}</div><p class="nota">Sem dados.</p>`;
  let topo = '';
  if (s.g) {
    const c = calcular(s.g);
    if (s.tipo === 'segundo') topo = `<div class="bloco"><h3>2º turno, cenário do simulador</h3>${linhaCand(s.A, s.ca, c.final.pA, Math.round(c.final.A))}${linhaCand(s.B, s.cb, c.final.pB, Math.round(c.final.B))}${barra(c.final.pA, c.final.pB, s.ca, s.cb, { pequena: true })}</div>`;
    else {
      topo = `<div class="bloco"><h3>${esc(rotuloGov(s))}</h3>${linhaCand(s.A, s.ca, s.pA, s.a)}${linhaCand(s.B, s.cb, s.pB, s.b)}${barra(s.pA, s.pB, s.ca, s.cb, { pequena: true })}
        ${c.proj && s.apur < 100 ? `<p class="nota" style="margin-top:12px">Projeção: ${esc(s.A.nmu)} ${fmtPct(c.proj.total.pctA)}%</p>` : ''}</div>${blocoVirada(s.g, { titulo: 'h3', classe: 'bloco compacto', cores: [s.ca, s.cb] })}`;
    }
    topo += `<div class="acoes"><a class="botao" href="#simulador-gov-${uf}">Simular este 2º turno</a></div>`;
  }
  const cands = (S.endorsers[uf]?.gov || []).slice(0, 6);
  return `<div class="painel-cab"><div><h2>${esc(ufNome(uf))}</h2><p class="sub">Governador. ${esc(rotuloGov(s))}.</p></div>${fechar}</div>${topo}
    <div class="bloco"><h3>1º turno, resultado final</h3>${cands.map((x) => linhaCand(x, corPartido(x.partido), x.pvap, x.vap, { menor: true })).join('')}</div>${blocoSenUf(uf)}`;
}

// =================== TELÃO ===================
// Para TV ou projetor: números grandes, só votos oficiais apurados, passa sozinho pelas disputas.
const TELAO_MS = 12_000;
const comFoto = (r, c) => ({ ...c, sq: c.sq || r.baseline.summary?.cands.find((x) => x.n === c.n)?.sq });
function slidesTelao() {
  return [{ id: 'pres', r: S.pres }, ...S.races.filter((x) => x.cargo === 3).map((x) => ({ id: x.id, uf: x.scope, r: S.gov[x.scope] }))]
    .filter((s) => s.r && fins(s.r).length === 2 && s.r.baseline.summary);
}
/** Placar de uma disputa: apurado oficial no 2º turno ou, antes da contagem, o 1º turno. */
function placarTelao(r) {
  const [A, B] = fins(r);
  if (temVotos(r)) {
    const sm = r.live.summary, vA = votosDe(sm, A.n), vB = votosDe(sm, B.n), V = vA + vB || 1;
    const fim = sm.totalFinal || sm.md === 'e';
    return { A, B, vA, vB, pA: (vA / V) * 100, pB: (vB / V) * 100,
      sub: `${fmtPct(sm.secoes.pst, 1)}% das seções totalizadas · diferença de ${curto(Math.abs(vA - vB))}${deQtd(Math.abs(vA - vB))} votos${sm.totalFinal ? ' · resultado final do TSE' : fim ? ' · matematicamente definido' : ''}` };
  }
  const s1 = r.baseline.summary, a = s1.cands.find((x) => x.n === A.n), b = s1.cands.find((x) => x.n === B.n);
  return { A, B, vA: a?.vap, vB: b?.vap, pA: a?.pvap, pB: b?.pvap, primeiro: true, sub: 'Resultado do 1º turno. A apuração do 2º turno começa em 25 de outubro, às 17h de Brasília.' };
}
/** Mapa do presidente só com o que o TSE já totalizou (sem projeção nem simulação). */
function mapaTelao(r) {
  const [A, B] = fins(r), dados = {};
  for (const cd of UFS) {
    const lu = temVotos(r) ? r.live.units[cd] : r.baseline.units[cd];
    if (!lu || (temVotos(r) && !lu.secoes?.st)) { dados[cd] = { fill: 'var(--vazio)' }; continue; }
    const a = votosDe(lu, A.n), b = votosDe(lu, B.n), pA = a + b ? (a / (a + b)) * 100 : 50;
    dados[cd] = { fill: tom(pA >= 50 ? CA : CB, Math.abs(2 * pA - 100), !temVotos(r) || lu.andamento === 'f'), cor: pA >= 50 ? CA : CB };
  }
  return dados;
}
function renderTelao() {
  const slides = slidesTelao();
  const el = $('#vista-telao');
  if (!slides.length) { el.innerHTML = '<p class="telao-sub">Carregando os dados do TSE…</p>'; return; }
  S.telaoI = ((S.telaoI || 0) % slides.length + slides.length) % slides.length;
  const sl = slides[S.telaoI], r = sl.r;
  const p = placarTelao(r);
  let ca = CA, cb = CB;
  if (sl.id !== 'pres') { ca = corPartido(p.A.partido); cb = corPartido(p.B.partido) === ca ? 'var(--tinta-3)' : corPartido(p.B.partido); }
  const lado = (c, pct, votos, cor, l) => `<div class="telao-lado ${l}">${avatar(comFoto(r, c), { tam: 120, cor })}<div class="telao-nome">${esc(c.nmu)}<small>${esc(c.partido || '')}</small></div>
    <div class="telao-pct" style="color:${cor}">${pct == null ? '–' : fmtPct(pct, 1)}<small>%</small></div><div class="telao-votos">${votos == null ? '' : `${fmtInt(votos)} votos`}</div></div>`;
  const titulo = sl.id === 'pres' ? 'Presidente' : `Governador · ${ufNome(sl.uf)}`;
  const simulado = S.status?.modoTeste && !p.primeiro;
  const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  el.innerHTML = `<div class="telao-topo"><span class="telao-titulo">${esc(titulo)}${p.primeiro ? ' <small>1º turno</small>' : ' <small>2º turno</small>'}</span><span class="telao-relogio">${hora} <small>Brasília</small></span></div>
    ${simulado ? '<p class="telao-selo">2º turno simulado para teste · não é resultado</p>' : ''}
    <div class="telao-grade ${sl.id === 'pres' ? 'com-mapa' : ''}">
      <div class="telao-corpo"><div class="telao-duelo">${lado(p.A, p.pA, p.vA, ca, 'a')}${lado(p.B, p.pB, p.vB, cb, 'b')}</div>
        ${p.pA == null ? '' : barra(p.pA, p.pB, ca, cb)}<p class="telao-sub">${esc(p.sub)}</p>${p.primeiro ? '' : `<p class="telao-virada">${linhaVirada(r)}</p>`}</div>
      ${sl.id === 'pres' ? '<div id="telao-mapa" class="telao-mapa mapa"></div>' : ''}
    </div>
    <div class="telao-pe"><span>Fonte: TSE · ${esc(location.host)}</span>
      <span class="telao-pontos" aria-label="Disputa ${S.telaoI + 1} de ${slides.length}">${slides.map((_, i) => `<i class="${i === S.telaoI ? 'atual' : ''}"></i>`).join('')}</span>
      <span class="telao-acoes"><button type="button" class="botao-2" id="telao-cheia">Tela cheia</button><a class="botao-2" href="#presidente">Sair</a></span></div>`;
  if (sl.id === 'pres') desenharBrasil($('#telao-mapa'), mapaTelao(r), { rotulos: false });
  if (!S.telaoTimer) {
    S.telaoTimer = setInterval(() => {
      if (S.rota.aba !== 'telao') { clearInterval(S.telaoTimer); S.telaoTimer = null; return; }
      S.telaoI++; render();
    }, TELAO_MS);
  }
}
/** Troca de disputa pelo teclado; recomeça a contagem dos 12 s. */
function passarTelao(d) {
  clearInterval(S.telaoTimer); S.telaoTimer = null;
  S.telaoI = (S.telaoI || 0) + d;
  render();
}

// =================== SENADO ===================
function renderSenado() {
  const { uf } = S.rota;
  const bancada = {};
  const dados = {};
  S.dicas = {};
  for (const u of UFS) {
    const sen = S.endorsers[u]?.sen || [];
    const el = sen.filter((x) => /^Eleit/i.test(x.st));
    for (const x of el) bancada[x.partido] = (bancada[x.partido] || 0) + 1;
    if (!sen[0]) continue;
    dados[u] = { fill: el.length ? tom(corPartido((el[0] || sen[0]).partido), 40, true) : 'var(--vazio)' };
    S.dicas[u] = `<b>${esc(ufNome(u))}</b>${sen.slice(0, 3).map((x) => `<br>${/^Eleit/i.test(x.st) ? '✓ ' : ''}${esc(x.nmu)} (${esc(x.partido)}) ${fmtPct(x.pvap)}%`).join('')}`;
  }
  const ordem = Object.entries(bancada).sort((a, b) => b[1] - a[1]);
  const total = ordem.reduce((t, [, n]) => t + n, 0);
  $('#placar').innerHTML = `<div class="placar-topo"><h1>Senado</h1></div>
    <div class="numeros"><div><div class="n">${total}</div><div class="r">senadores eleitos em 2026</div></div><div><div class="n">${ordem.length}</div><div class="r">partidos com cadeiras novas</div></div></div>
    <div class="composicao">${ordem.map(([p, n]) => `<span style="flex:${n};background:${corPartido(p)}" title="${esc(p)}: ${n}"></span>`).join('')}</div>
    <div class="legenda nota">${ordem.map(([p, n]) => `<span>${quad(corPartido(p))}${esc(p)} ${n}</span>`).join('')}</div>`;
  prepararMapa('br');
  desenharBrasil($('#mapa'), dados, { sel: uf, rotulos: false });
  $('#mapa-pe').innerHTML = '<span>Cor pelo partido do senador mais votado em cada estado. Cada estado elegeu dois senadores, sem 2º turno.</span>';
  if (uf) {
    const sen = S.endorsers[uf]?.sen || [];
    $('#painel').innerHTML = `<div class="painel-cab"><div><h2>${esc(ufNome(uf))}</h2><p class="sub">Senado, resultado final</p></div><a class="fechar" href="#senado" aria-label="Fechar">×</a></div>
      <div class="bloco">${sen.slice(0, 8).map((x) => linhaCand(x, corPartido(x.partido), x.pvap, x.vap, { menor: true, sub: `${x.partido}${/^Eleit/i.test(x.st) ? ', eleito' : ''}` })).join('')}</div>`;
  } else {
    $('#painel').innerHTML = `<div class="painel-cab"><div><h2>Eleitos por estado</h2></div></div><div class="bloco"><ul class="lista-estados">${UFS.map((u) => {
      const el = (S.endorsers[u]?.sen || []).filter((x) => /^Eleit/i.test(x.st));
      if (!el.length) return '';
      const cor = corPartido(el[0].partido);
      return `<li><a href="#senado-${u}"><span class="uf" style="background:${cor};color:${textoSobre(cor)}">${u.toUpperCase()}</span><span class="quem">${el.map((x) => esc(x.nmu)).join(' e ')}<small>${el.map((x) => esc(x.partido)).join(' e ')}</small></span><span></span></a></li>`;
    }).join('')}</ul></div>`;
  }
  abrirPainel(!!uf);
  $('#abaixo').innerHTML = '';
}

// =================== SIMULADOR ===================
const coresGov = (A, B) => { const ca = corPartido(A.partido); const cb = corPartido(B.partido) === ca ? 'var(--tinta-3)' : corPartido(B.partido); return [ca, cb]; };
function raceSim() {
  const m = S.rota.sim.match(/^gov-([a-z]{2})$/);
  return (m && S.gov[m[1]]) || S.pres;
}
function campo(id, rotulo, min, max, step, valor, un = '%', ajuda = '') {
  return `<div class="campo"><div class="campo-topo"><label for="${id}">${rotulo}</label><output id="${id}-out" data-u="${un}">${fmtPct(valor, step < 1 ? 1 : 0)}${un}</output></div>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${valor}">${ajuda ? `<p class="ajuda">${ajuda}</p>` : ''}</div>`;
}

function renderSimulador() {
  const r = raceSim(), c = calcular(r);
  if (!c) { $('#controles').innerHTML = '<p class="nota">O 1º turno ainda está sendo carregado.</p>'; return; }
  const chave = `${r.id}:${encerrada(r)}`;
  if (S.simDesenhado !== chave) { desenharControles(r, c); S.simDesenhado = chave; }
  atualizarSim(r, c);
}

function desenharControles(r, c) {
  const [A, B] = fins(r);
  const o = opts(r), p = base(r);
  const te = Object.values(r.baseline.units).reduce((s, u) => s + (u.eleitores?.te || 0), 0);
  const opcoes = [['pres', 'Presidente'], ...S.races.filter((x) => x.cargo === 3).map((x) => [x.id, `Governador, ${ufNome(x.scope)}`])];
  const elim = (r.baseline.summary?.cands || []).filter((x) => x.n !== A.n && x.n !== B.n && x.pvap >= 0.5).slice(0, 8);
  $('#controles').innerHTML = `
    <div class="sim-fixo" id="sim-fixo"></div>
    <p class="voltar-simples"><a class="link" href="#simulador-${r.id}">← Simulador simples</a></p>
    <div class="cab-sim"><h1>Simulador avançado</h1><select class="entrada" id="sim-race" aria-label="Disputa">${opcoes.map(([v, t]) => `<option value="${v}" ${v === r.id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <p class="intro">Em votos válidos ${r.cargo === 1 ? 'do país inteiro' : `de ${esc(ufNome(r.scope))}`}. O que já foi apurado vem do TSE. O que falta, você decide como se divide, e o resultado é refeito a cada nova totalização.</p>
    <div class="agora" id="sim-agora"></div>
    ${encerrada(r) ? '<p class="aviso-sim">A apuração terminou: o resultado oficial está na aba <a href="#presidente">Resultado</a>. Aqui você simula o 2º turno inteiro a partir do 1º turno.</p>'
      : temVotos(r) ? `<label class="interruptor"><input type="checkbox" id="sim-zero" ${o.semApuracao ? 'checked' : ''}> Simular o 2º turno inteiro, sem os votos já apurados</label>` : ''}

    <details class="secao" name="sim" open>
      <summary><h2>Os votos que faltam</h2></summary>
      <div class="secao-corpo">
        <div class="divisao-topo"><div>${pessoa(A, CA, 36)}<div class="p" id="sim-pa"></div><div class="q" id="sim-qa"></div></div>
          <div style="text-align:right"><div class="pessoa" style="flex-direction:row-reverse">${avatar(B, { tam: 36, cor: CB })}<div><div class="nm">${esc(B.nmu)}</div><div class="pt">${esc(B.partido)}</div></div></div><div class="p" id="sim-pb"></div><div class="q" id="sim-qb"></div></div></div>
        <div class="trilho" id="sim-trilho"><input type="range" id="sim-share" min="0" max="100" step="0.1" aria-label="Parte dos votos que faltam para ${esc(A.nmu)}">
          <div class="marcador esp" id="mk-esp"><span>estimativa</span></div><div class="marcador vir" id="mk-vir"><span>empate</span></div></div>
        <div class="virada" id="sim-virada"></div>
        <div class="atalhos">
          <button type="button" data-atalho="esperado">Estimativa</button>
          ${usaApuracao(r) ? '<button type="button" data-atalho="apurado">Como o já apurado</button>' : ''}
          <button type="button" data-atalho="primeiro">Como no 1º turno</button>
          <button type="button" data-atalho="meio">Meio a meio</button>
          <button type="button" data-atalho="virada">No ponto de empate</button>
        </div>
        <div class="linha-campo"><label for="sim-votosA">Ou diga quantos dos votos que faltam vão para ${esc(A.nmu)}:</label><input class="entrada num" id="sim-votosA" inputmode="numeric" placeholder="ex.: 12 milhões"></div>
        ${r.cargo === 1 ? `<label class="interruptor"><input type="checkbox" id="sim-regional" ${o.modo === 'regional' ? 'checked' : ''}> Dividir por região</label><div id="sim-regioes" ${o.modo === 'regional' ? '' : 'hidden'}></div>` : ''}
      </div>
    </details>

    <details class="secao" name="sim">
      <summary><h2>Comparecimento</h2><span class="resumo" id="res-comp"></span></summary>
      <div class="secao-corpo">${campo('sim-comp', 'Votos válidos que ainda entram, em relação à estimativa', 70, 130, 1, Math.round(o.comparecimento * 100), '%', 'Abaixo de 100%: menos gente votando nas seções que faltam. Acima: mais.')}</div>
    </details>

    <details class="secao" name="sim">
      <summary><h2>Somar ou tirar votos</h2><span class="resumo" id="res-aj"></span></summary>
      <div class="secao-corpo">
        <p class="explica">Entra direto no total ${r.cargo === 1 ? 'do país' : 'do estado'}.</p>
        <div class="linha-campo"><input class="entrada num" id="aj-votos" inputmode="numeric" value="${fmtInt(redondo(te * 0.003))}" aria-label="Quantidade de votos">
          <span>para</span><select class="entrada" id="aj-para"><option value="A">${esc(A.nmu)}</option><option value="B">${esc(B.nmu)}</option></select>
          <select class="entrada" id="aj-origem"><option value="adversario">tirados do outro</option><option value="novos">de novos eleitores</option></select>
          <button type="button" class="botao" id="aj-aplicar">Aplicar</button></div>
        <div class="atalhos">${[0.0006, 0.003, 0.006, 0.012].map((x) => redondo(te * x)).map((v) => `<button type="button" data-votos="${v}">${curto(v)}</button>`).join('')}</div>
        <ul class="lista-aj" id="aj-lista"></ul>
      </div>
    </details>

    <details class="secao" name="sim">
      <summary><h2>Premissas antes da apuração</h2></summary>
      <div class="secao-corpo">
        <p class="explica">Valem para os estados que ainda não têm votos apurados. Partem do 1º turno oficial.</p>
        ${campo('b-retA', `Eleitores de ${esc(A.nmu)} que repetem o voto`, 80, 100, 0.5, p.retencao.A.stay * 100)}
        ${campo('b-retB', `Eleitores de ${esc(B.nmu)} que repetem o voto`, 80, 100, 0.5, p.retencao.B.stay * 100)}
        ${elim.map((x) => { const f = normFlow(p.transferencias.global[x.n] || p.padraoEliminados); const s = f.A + f.B ? (f.A / (f.A + f.B)) * 100 : 50;
          return `<div class="cand-elim"><h3>${esc(x.nmu)}</h3><p class="meta">${esc(x.partido)}, ${fmtPct(x.pvap)}% no 1º turno</p>${campo(`b-el-${x.n}`, `Dos eleitores que votam, quantos vão para ${esc(A.nmu)}`, 0, 100, 1, Math.round(s))}</div>`; }).join('')}
        ${campo('b-swing', `Deslocamento geral a favor de ${esc(A.nmu)}`, -10, 10, 0.1, p.swingPp || 0, ' pp')}
      </div>
    </details>`;
  renderAjustes(r);
}

function renderAjustes(r) {
  const [A, B] = fins(r);
  const o = opts(r);
  $('#aj-lista').innerHTML = o.ajustes.map((a, i) => `<li><span>${fmtInt(a.votos)} para ${esc((a.para === 'A' ? A : B).nmu)}, ${a.origem === 'adversario' ? 'tirados do outro' : 'de novos eleitores'}</span><button type="button" class="link" data-rm="${i}">Remover</button></li>`).join('');
  $('#res-aj').textContent = o.ajustes.length ? `${o.ajustes.length} ajuste(s)` : '';
}

function atualizarSim(r, c) {
  const [A, B] = fins(r);
  const f = c.final, o = opts(r), ap = f.apurado, vivo = usaApuracao(r);
  $('#sim-agora').innerHTML = `
    <div><div class="r">${vivo ? 'Já apurado' : 'Apurado'}</div><div class="n">${vivo ? curto(ap.validos) : '0'}</div><div class="s">${vivo ? `votos válidos, ${fmtPct(r.live.summary.secoes.pst, 1)}% das seções` : encerrada(r) ? 'apuração encerrada, fora da simulação' : o.semApuracao ? 'apuração deixada de fora' : 'a contagem começa às 17h'}</div></div>
    <div><div class="r">${esc(A.nmu)}</div><div class="n" style="color:var(--a)">${vivo ? curto(ap.A) : '–'}</div><div class="s">${vivo ? `${fmtPct((ap.A / (ap.validos || 1)) * 100)}% do apurado` : 'sem votos ainda'}</div></div>
    <div><div class="r">Faltam, estimados</div><div class="n">${curto(f.faltam)}</div><div class="s">votos válidos</div></div>`;
  const s = f.faltam ? f.shareUsado : f.esperado;
  const inp = $('#sim-share');
  if (document.activeElement !== inp) inp.value = (s * 100).toFixed(1);
  inp.disabled = o.modo === 'regional' || !f.faltam;
  for (const b of $$('[data-atalho]')) b.disabled = !f.faltam;
  const vA = $('#sim-votosA'); if (vA) vA.disabled = !f.faltam;
  $('#sim-trilho').style.setProperty('--pos', `${(s * 100).toFixed(1)}%`);
  $('#sim-pa').textContent = `${fmtPct(s * 100)}%`;
  $('#sim-pb').textContent = `${fmtPct((1 - s) * 100)}%`;
  $('#sim-qa').textContent = `+${curto(f.faltam * s)}${deQtd(f.faltam * s)} votos`;
  $('#sim-qb').textContent = `+${curto(f.faltam * (1 - s))}${deQtd(f.faltam * (1 - s))} votos`;
  const marcar = (el, v) => { el.hidden = v === null || v < 0 || v > 1; if (!el.hidden) el.style.left = `calc(${(v * 100).toFixed(2)}% + ${(12 - v * 24).toFixed(1)}px)`; };
  marcar($('#mk-esp'), f.esperado);
  marcar($('#mk-vir'), f.viradaA);
  let txt;
  if (!f.faltam) txt = 'Não há votos a dividir neste cenário.';
  else if (!vivo) txt = `${encerrada(r) || o.semApuracao ? 'No 2º turno inteiro simulado' : 'Antes da apuração'}, vence quem tiver mais da metade dos votos válidos. O empate fica em <b>${fmtPct(f.viradaA * 100)}%</b> para ${esc(A.nmu)}.`;
  else {
    const atras = ap.A >= ap.B ? B : A, precisa = ap.A >= ap.B ? f.viradaB : f.viradaA, recebe = ap.A >= ap.B ? 1 - f.esperado : f.esperado;
    txt = precisa > 1 ? `Nem com todos os votos que faltam <b>${esc(atras.nmu)}</b> alcança. O resultado está matematicamente definido.`
      : `Para virar, <b>${esc(atras.nmu)}</b> precisa de <b>${fmtPct(precisa * 100)}%</b> dos votos que faltam. Pela estimativa, fica com ${fmtPct(recebe * 100)}%.`;
  }
  $('#sim-virada').innerHTML = txt;
  $('#res-comp').textContent = o.comparecimento !== 1 ? `${Math.round(o.comparecimento * 100)}%` : '';
  const reg = $('#sim-regioes');
  if (reg && !reg.hidden && !reg.contains(document.activeElement)) {
    reg.innerHTML = `<p class="explica" style="margin-top:12px">Parte dos votos que faltam em cada região que vai para ${esc(A.nmu)}.</p>` + Object.entries(f.regioes).map(([k, g]) => {
      const v = clamp(o.shareRegiao[k] ?? g.share);
      return `<div class="reg-linha"><span>${esc(REGIOES[k]?.nome || k)}</span><input type="range" min="0" max="100" step="0.5" value="${(v * 100).toFixed(1)}" data-reg="${k}" aria-label="${esc(REGIOES[k]?.nome || k)}">
        <span class="v"><b>${fmtPct(v * 100, 0)}%</b> de ${curto(g.rem)}</span></div>`;
    }).join('');
  } else if (reg && !reg.hidden) {
    for (const [k, g] of Object.entries(f.regioes)) { const v = reg.querySelector(`input[data-reg="${k}"]`)?.nextElementSibling; if (v) v.innerHTML = `<b>${fmtPct(clamp(o.shareRegiao[k] ?? g.share) * 100, 0)}%</b> de ${curto(g.rem)}`; }
  }
  // Empate: diferença de menos de 1 voto (evita declarar vencedor por arredondamento)
  const empate = Math.abs(f.margem) < 1, venc = f.A >= f.B ? A : B, i = f.incerteza;
  const dEsp = f.pA - c.esperado.pA;
  $('#sim-fixo').innerHTML = `<span style="color:var(--a)">${esc(A.nmu)} ${fmtPct(f.pA)}%</span><span style="color:var(--b)">${esc(B.nmu)} ${fmtPct(f.pB)}%</span><b>${empate ? 'Empate' : `${esc(venc.nmu)} é eleito`}</b>`;
  $('#sim-resumo').innerHTML = `<p class="rot">${r.cargo === 1 ? 'Presidente' : `Governador, ${esc(ufNome(r.scope))}`}, no seu cenário</p>
    <p class="veredito">${empate ? 'Empate: cada um fica com 50% dos votos válidos' : `${esc(venc.nmu)} é eleito com ${fmtPct(Math.max(f.pA, f.pB))}% dos votos válidos`}</p>
    ${linhaCand(A, CA, f.pA, Math.round(f.A))}${linhaCand(B, CB, f.pB, Math.round(f.B))}${barra(f.pA, f.pB, CA, CB, { pequena: true })}
    <div class="bloco"><dl class="dados"><dt>Diferença</dt><dd>${curto(Math.abs(f.margem))}${deQtd(Math.abs(f.margem))} votos</dd><dt>Votos válidos no total</dt><dd>${fmtInt(f.validos)}</dd>
      <dt>Em relação à estimativa</dt><dd>${Math.abs(dEsp) < 0.005 ? 'igual' : `${esc(A.nmu)} ${fmtPp(dEsp, 2)} pp`}</dd></dl></div>
    <div class="bloco"><h3>Chance em ${fmtInt(i.n)} variações do que falta</h3><div class="chance"><span style="flex:${i.pVitoriaA};background:var(--a)"></span><span style="flex:${i.pVitoriaB};background:var(--b)"></span></div>
      <dl class="dados"><dt>${esc(A.nmu)}</dt><dd>${fmtChance(i.pVitoriaA)}</dd><dt>${esc(B.nmu)}</dt><dd>${fmtChance(i.pVitoriaB)}</dd></dl></div>
    <div class="acoes"><button type="button" class="botao-2" id="sim-reset">Recomeçar</button><button type="button" class="link" id="sim-link">Copiar link</button></div>`;
}

// ---------- eventos ----------
let simAg = false;
function mudouSim(r) {
  salvarSim(r);
  if (simAg) return;
  simAg = true;
  requestAnimationFrame(() => { simAg = false; const c = calcular(r); if (c) atualizarSim(r, c); });
}

function ligar() {
  ligarSimuladorFacil($('#vista-simulador'), { ativo: () => S.rota.aba === 'simulador', ir });
  // Telão: setas trocam a disputa; cursor e controles somem com o mouse parado
  let ocioso;
  document.addEventListener('keydown', (e) => {
    if (S.rota.aba !== 'telao' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') passarTelao(1);
    else if (e.key === 'ArrowLeft') passarTelao(-1);
  });
  document.addEventListener('pointermove', () => {
    document.body.classList.remove('ocioso');
    clearTimeout(ocioso);
    if (S.rota.aba === 'telao') ocioso = setTimeout(() => document.body.classList.add('ocioso'), 3000);
  });
  window.addEventListener('hashchange', () => { S.paisAberto = null; render(); });
  document.addEventListener('click', (e) => {
    if (e.target.id === 'fundo') return ir(S.rota.aba);
    const t = e.target.closest('[data-turno],[data-modo],[data-pais],button,a,path[data-uf]');
    if (!t) return;
    if (t.dataset.turno && !t.disabled) { S.turno = Number(t.dataset.turno); S.turnoEscolhido = true; return render(); }
    if (t.dataset.modo && !t.disabled) { S.modo = t.dataset.modo; return render(); }
    if (t.dataset.pais) { S.paisAberto = S.paisAberto === t.dataset.pais ? null : t.dataset.pais; return render(); }
    if (t.matches('path[data-uf]') && t.closest('#mapa svg.br')) { const a = S.rota.aba; return ir(S.rota.uf === t.dataset.uf ? a : `${a}-${t.dataset.uf}`); }
    if (t.id === 'busca-abrir') return abrirBusca();
    if (t.dataset.evol && !t.disabled) { S.evolModo = t.dataset.evol; return render(); }
    if (t.id === 'evol-rever') return reverApuracao(S.pres);
    if (t.id === 'telao-cheia') return document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {});
    if (S.rota.aba !== 'avancado') return;
    const r = raceSim(), o = opts(r);
    if (t.dataset.atalho) {
      const c = calcular(r), f = c.esperado;
      o.modo = 'nacional';
      const cb = $('#sim-regional'); if (cb) { cb.checked = false; $('#sim-regioes').hidden = true; }
      const [A, B] = fins(r), s1 = r.baseline.summary;
      o.shareNacional = { esperado: null, meio: 0.5, virada: clamp(f.viradaA ?? 0.5), apurado: f.apurado.validos ? f.apurado.A / f.apurado.validos : 0.5,
        primeiro: votosDe(s1, A.n) / (votosDe(s1, A.n) + votosDe(s1, B.n)) }[t.dataset.atalho];
      $('#sim-share').value = ((o.shareNacional ?? f.esperado) * 100).toFixed(1);
      return mudouSim(r);
    }
    if (t.dataset.votos) { $('#aj-votos').value = fmtInt(Number(t.dataset.votos)); return; }
    if (t.id === 'aj-aplicar') { const v = parseVotos($('#aj-votos').value); if (v > 0) { o.ajustes.push({ votos: v, para: $('#aj-para').value, origem: $('#aj-origem').value }); renderAjustes(r); mudouSim(r); } return; }
    if (t.dataset.rm !== undefined) { o.ajustes.splice(Number(t.dataset.rm), 1); renderAjustes(r); return mudouSim(r); }
    if (t.id === 'sim-reset') { S.opts[r.id] = optsPadrao(); S.base[r.id] = premissasIniciais(r); salvarSim(r); S.simDesenhado = null; return render(); }
    if (t.id === 'sim-link') { navigator.clipboard?.writeText(location.href).then(() => { t.textContent = 'Link copiado'; }); }
  });
  document.addEventListener('input', (e) => {
    if (S.rota.aba !== 'avancado') return;
    const t = e.target, r = raceSim(), o = opts(r), p = base(r);
    const out = document.getElementById(`${t.id}-out`);
    if (out) out.textContent = `${fmtPct(Number(t.value), Number(t.step) < 1 ? 1 : 0)}${out.dataset.u}`;
    if (t.id === 'sim-share') o.shareNacional = Number(t.value) / 100;
    else if (t.id === 'sim-comp') o.comparecimento = Number(t.value) / 100;
    else if (t.dataset.reg) o.shareRegiao[t.dataset.reg] = Number(t.value) / 100;
    else if (t.id === 'sim-votosA') {
      const v = parseVotos(t.value), c = calcular(r);
      if (!(v >= 0) || !c.final.faltam) return;
      o.modo = 'nacional'; o.shareNacional = clamp(v / c.final.faltam); $('#sim-share').value = (o.shareNacional * 100).toFixed(1);
    } else if (t.id === 'b-retA' || t.id === 'b-retB') { const s = Number(t.value) / 100, x = 1 - s; p.retencao[t.id.slice(-1)] = { stay: s, toOther: x * 0.2, bn: x * 0.3, abst: x * 0.5 }; }
    else if (t.id.startsWith('b-el-')) { const n = t.id.slice(5), f = normFlow(p.transferencias.global[n] || p.padraoEliminados), eng = f.A + f.B, s = Number(t.value) / 100; p.transferencias.global[n] = { A: eng * s, B: eng * (1 - s), bn: f.bn, abst: f.abst }; }
    else if (t.id === 'b-swing') { p.swingPp = Number(t.value); if (out) out.textContent = `${fmtPp(p.swingPp)} pp`; }
    else return;
    mudouSim(r);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sel-uf' && t.value) return ir(`${t.dataset.aba}-${t.value}`);
    if (t.id === 'sim-race') return ir(`avancado-${t.value}`);
    if (t.id === 'sim-zero') {
      const r = raceSim(), o = opts(r);
      Object.assign(o, { semApuracao: t.checked, modo: 'nacional', shareNacional: null, shareRegiao: {} });
      salvarSim(r); S.simDesenhado = null; return render();
    }
    if (t.id === 'sim-regional') {
      const r = raceSim(), o = opts(r);
      o.modo = t.checked ? 'regional' : 'nacional';
      if (t.checked) { const c = calcular(r); for (const [k, g] of Object.entries(c.final.regioes)) o.shareRegiao[k] ??= g.share; }
      $('#sim-regioes').hidden = !t.checked;
      mudouSim(r);
    }
  });
  const dica = $('#dica');
  const mostrar = (h, x, y) => { dica.innerHTML = h; dica.hidden = false; const b = dica.getBoundingClientRect(); dica.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, x + 14))}px`; dica.style.top = `${Math.max(8, y - b.height - 12)}px`; };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const c = e.target.closest?.('[data-dica]');
    if (c) return mostrar(c.dataset.dica, e.clientX, e.clientY);
    const up = e.target.closest?.('#mapa-prev svg.br [data-uf]');
    if (up && S.dicasPrev[up.dataset.uf]) return mostrar(S.dicasPrev[up.dataset.uf], e.clientX, e.clientY);
    const u = e.target.closest?.('#mapa svg.br [data-uf]');
    if (u && S.dicas[u.dataset.uf]) return mostrar(S.dicas[u.dataset.uf], e.clientX, e.clientY);
    dica.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
    if (e.key === 'Escape') { if (!$('#busca').hidden) $('#busca').hidden = true; else if (S.rota.uf) ir(S.rota.aba); }
    const p = e.target.closest?.('#mapa path[data-uf]');
    if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  $('#busca').addEventListener('click', (e) => { if (e.target.id === 'busca' || e.target.closest('a')) $('#busca').hidden = true; });
  $('#busca-campo').addEventListener('input', buscar);
}

function abrirBusca() { $('#busca').hidden = false; $('#busca-campo').value = ''; buscar(); $('#busca-campo').focus(); }
function buscar() {
  const q = normalizar($('#busca-campo').value);
  const aba = ['governadores', 'senado'].includes(S.rota.aba) ? S.rota.aba : 'presidente';
  const itens = UFS.map((u) => ({ t: ufNome(u), s: 'Estado', h: `${aba}-${u}` }));
  itens.push({ t: 'Exterior', s: 'Votos fora do Brasil', h: 'exterior' });
  for (const x of S.exterior?.cidades || []) itens.push({ t: titulo(x.nome), s: 'Cidade no exterior', h: 'exterior' });
  for (const [u, e] of Object.entries(S.endorsers)) {
    for (const c of (e.gov || []).slice(0, 2)) itens.push({ t: c.nmu, s: `Governador, ${ufNome(u)}`, h: `governadores-${u}` });
    for (const c of (e.sen || []).filter((x) => /^Eleit/i.test(x.st))) itens.push({ t: c.nmu, s: `Senado, ${ufNome(u)}`, h: `senado-${u}` });
  }
  const res = (q ? itens.filter((i) => normalizar(i.t).includes(q)) : itens.slice(0, 27)).slice(0, 30);
  $('#busca-res').innerHTML = res.map((i) => `<li><a href="#${i.h}">${esc(i.t)}<span>${esc(i.s)}</span></a></li>`).join('') || '<li class="nota" style="padding:12px">Nada encontrado.</li>';
}

/**
 * Sem conexão ao vivo (servidor lotado): consulta a lista de disputas e busca só as que mudaram,
 * pelo mesmo caminho enxuto da conexão ao vivo. Disputa nova ou sumida: recarrega tudo.
 */
async function consultarMudancas() {
  const races = await getJSON('/api/races');
  const tenho = (id) => (id === 'pres' ? S.pres : Object.values(S.gov).find((g) => g.id === id));
  if (races.length !== S.races.length || races.some((r) => !tenho(r.id))) return carregarTudo();
  S.races = races;
  const mudaram = races.filter((r) => tenho(r.id).version !== r.version).map((r) => r.id);
  for (const i of mudaram) if (!naTela(i)) S.atrasadas.add(i);
  if (naTela('exterior')) S.atrasadas.add('exterior');
  await Promise.all([
    ...mudaram.filter(naTela).map((i) => carregarVivo(i).catch(() => {})),
    getJSON('/api/eventos').then((x) => { S.eventos = x; }, () => {}),
    getJSON('/api/status').then((x) => { S.status = x; }, () => {}),
  ]);
}

function conectar() {
  const es = new EventSource('/api/stream');
  let t = null;
  const pend = new Set();
  es.addEventListener('update', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.races) mesclarRaces(d.races, pend);
    for (const i of d.ids || (d.raceId ? [d.raceId] : [])) pend.add(i);
    clearTimeout(t);
    t = setTimeout(async () => {
      const ids = [...pend]; pend.clear();
      try {
        if (ids.includes('*')) await carregarTudo();
        else {
          if (ids.includes('noticias')) S.noticias = await getJSON('/api/noticias').catch(() => S.noticias);
          if (ids.includes('pesquisas')) await carregarPesquisas();
          const disputas = ids.filter((i) => !['exterior', 'noticias', 'pesquisas'].includes(i));
          // Só o que está na tela é buscado agora; o resto fica marcado e vem quando a pessoa abrir.
          // Eventos e status só quando a apuração andou. Tudo em paralelo.
          const mudaram = [...disputas, ...(ids.includes('exterior') ? ['exterior'] : [])];
          for (const i of mudaram) if (!naTela(i)) S.atrasadas.add(i);
          await Promise.all([
            ...mudaram.filter(naTela).map((i) => atualizarParte(i).catch(() => {})),
            disputas.length || ids.includes('exterior') ? getJSON('/api/eventos').then((x) => { S.eventos = x; }, () => {}) : null,
            disputas.length || ids.includes('exterior') ? getJSON('/api/status').then((x) => { S.status = x; }, () => {}) : null,
          ]);
        }
        if (S.turno === 1 && temVotos(S.pres) && !S.turnoEscolhido) S.turno = 2;
        render();
      } catch (err) { console.error(err); }
      // Espera curta e um pouco diferente em cada navegador: os pedidos de milhares de pessoas
      // não chegam todos no mesmo instante depois de cada aviso
    }, 500 + Math.random() * 700);
  });
  es.onerror = () => {
    $('#fonte').textContent = 'Conexão com o servidor perdida. Tentando de novo…';
    // Servidor recusou a conexão ao vivo (ex.: lotado): consulta de tempos em tempos e tenta voltar ao vivo depois
    if (es.readyState === EventSource.CLOSED) {
      const plano = setInterval(async () => { await consultarMudancas().catch(() => {}); render(); }, 30_000);
      setTimeout(() => { clearInterval(plano); conectar(); }, 5 * 60_000);
    }
  };
}

async function iniciar() {
  ligar();
  // Foto que não carrega some e deixa as iniciais à mostra (sem onerror inline, por causa da CSP)
  document.addEventListener('error', (e) => { if (e.target?.matches?.('img[src^="/api/foto/"], image')) e.target.remove(); }, true);
  await carregarTudo().catch(console.error);
  render();
  conectar();
  setInterval(async () => { S.status = await getJSON('/api/status').catch(() => S.status); renderTopo(); }, 20000);
}
iniciar();
