// Simulador simples: "para onde vão os eleitores". Uma pergunta por grupo de eleitores do 1º turno;
// o resultado muda na hora. As contas ficam em /shared/simples.js (testadas). O simulador avançado
// (estados, regiões, apuração ao vivo) continua em #avancado.
import { gruposDoPrimeiroTurno, cenarioSimples, controlesDeTransferencia } from '/shared/simples.js';
import { modeloTransferencia } from '/shared/previsao.js';
import { suggestedFlow } from '/shared/presets.js';
import { ELEICOES } from '/shared/historico.js';
import { esc, fmtPct, fmtInt, curto, deQtd, avatar } from './util.js';
import { corPartido } from './partidos.js';

const E = { estado: {}, ctx: null };
const ler = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };
const primeiro = (nome) => String(nome || '').split(' ')[0];
const qtd = (n) => `${curto(n)}${deQtd(n)}`;

/** Leituras de transferência como frações dos votos dos demais (presidente: pesquisas + perfil). */
function leiturasPresidente() {
  const e = ELEICOES.find((x) => x.ano === 2026);
  const t = modeloTransferencia().detalhe;
  const fr = (l) => ({ paraA: (l.flavio - e.lider.t1) / t.outros, paraB: (l.lula - e.segundo.t1) / t.outros });
  const por = Object.fromEntries(t.leituras.map((l) => [l.id, fr(l)]));
  const media = { paraA: t.leituras.reduce((s, l) => s + fr(l).paraA, 0) / t.leituras.length, paraB: t.leituras.reduce((s, l) => s + fr(l).paraB, 0) / t.leituras.length };
  return { media, ...por };
}
/** Governador: sem pesquisa reunida; perfil dos partidos ponderado pelos votos de cada eliminado. */
function leituraPerfil(resumo, A, B) {
  const elim = resumo.cands.filter((c) => c.n !== A.n && c.n !== B.n);
  const tot = elim.reduce((s, c) => s + c.vap, 0);
  if (!tot) return { paraA: 0.35, paraB: 0.35 };
  let a = 0, b = 0;
  for (const c of elim) { const f = suggestedFlow(c.partido, A.partido, B.partido); a += c.vap * f.A; b += c.vap * f.B; }
  return { paraA: a / tot, paraB: b / tot };
}
function predefinicoes(r, A, B) {
  const meio = (base) => ({ paraA: (base.paraA + base.paraB) / 2, paraB: (base.paraA + base.paraB) / 2 });
  if (r.cargo === 1) {
    const L = leiturasPresidente();
    return [['media', 'Média das pesquisas', L.media], ['datafolha', 'Datafolha', L.datafolha], ['ipespe', 'Ipespe', L.ipespe], ['perfil', 'Perfil dos partidos', L.perfil], ['meio', 'Meio a meio', meio(L.media)]].filter(([, , v]) => v);
  }
  const p = leituraPerfil(r.baseline.summary, A, B);
  return [['perfil', 'Perfil dos partidos', p], ['meio', 'Meio a meio', meio(p)]];
}
function padrao(r, A, B) {
  const [, , base] = predefinicoes(r, A, B)[0];
  return { repeteA: 1, repeteB: 1, ...controlesDeTransferencia(base), ninguemVota: 0, ninguemParaA: 0.5, pre: predefinicoes(r, A, B)[0][0] };
}
const opcoes = (r, A, B) => (E.estado[r.id] ||= ler(`facil:${r.id}`) || padrao(r, A, B));

function controle(id, rotulo, valor, { min = 0, max = 100, dividir = null } = {}) {
  const v = Math.round(valor * 100);
  const saida = dividir ? `${esc(primeiro(dividir[0]))} ${v}% · ${esc(primeiro(dividir[1]))} ${100 - v}%` : `${v}%`;
  return `<label class="sf-controle" for="${id}"><span>${esc(rotulo)}</span><output id="${id}-out">${saida}</output></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="1" value="${v}" ${dividir ? 'class="dividir"' : ''} style="--p:${((v - min) / (max - min)) * 100}%">`;
}

/** Desenha a tela inteira (ao abrir ou trocar de disputa). */
export function renderSimuladorFacil(ctx) {
  E.ctx = ctx;
  const { r, races, ufNome, raiz, resumoEl } = ctx;
  if (!r?.baseline?.summary || ctx.fins(r).length < 2) { raiz.innerHTML = '<p class="nota">O 1º turno ainda está sendo carregado.</p>'; resumoEl.innerHTML = ''; return; }
  const [A, B] = ctx.fins(r);
  const s1 = r.baseline.summary;
  const g = gruposDoPrimeiroTurno(s1, A.n, B.n);
  const o = opcoes(r, A, B);
  const elim = s1.cands.filter((c) => c.n !== A.n && c.n !== B.n && c.pvap >= 0.5).slice(0, 4).map((c) => c.nmu.replace(/^(ESCRITORA?|PROFESSORA?|DOUTORA?|PASTORA?)\s+/i, ''));
  const lista = [['pres', 'Presidente'], ...races.filter((x) => x.cargo === 3).map((x) => [x.id, `Governador, ${ufNome(x.scope)}`])];
  const pres = predefinicoes(r, A, B);
  const grupo = (titulo, sub, corpo) => `<section class="sf-grupo"><h2>${titulo}</h2><p class="sf-sub">${sub}</p>${corpo}</section>`;
  raiz.innerHTML = `
    <div class="sf-fixo" id="sf-fixo" aria-hidden="true"></div>
    <div class="cab-sim"><h1>Quem será eleito?</h1><select class="entrada" id="sf-race" aria-label="Disputa">${lista.map(([v, t]) => `<option value="${v}" ${v === r.id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <p class="intro">Começa pelos votos oficiais do 1º turno${r.cargo === 1 ? '' : ` em ${esc(ufNome(r.scope))}`}. Diga para onde vai cada grupo de eleitores e veja o resultado mudar.</p>
    ${grupo(`Quem votou em ${esc(A.nmu)}`, `${qtd(g.a)} votos no 1º turno`, controle('sf-repeteA', 'Votam nele de novo', o.repeteA, { min: 70 }) + '<p class="nota">Os outros não votam em ninguém.</p>')}
    ${grupo(`Quem votou em ${esc(B.nmu)}`, `${qtd(g.b)} votos no 1º turno`, controle('sf-repeteB', 'Votam nele de novo', o.repeteB, { min: 70 }) + '<p class="nota">Os outros não votam em ninguém.</p>')}
    ${grupo('Quem votou nos outros candidatos', `${qtd(g.demais)} votos${elim.length ? ` (${esc(elim.join(', '))}${s1.cands.length > elim.length + 2 ? ' e outros' : ''})` : ''}`,
      `<div class="sf-pre" role="group" aria-label="Começar de">${pres.map(([k, t]) => `<button type="button" class="chip" data-sf-pre="${k}" aria-pressed="${o.pre === k}">${esc(t)}</button>`).join('')}</div>
      ${controle('sf-demaisEscolhem', 'Escolhem um dos dois', o.demaisEscolhem)}
      ${controle('sf-demaisParaA', 'Desses, vão para', o.demaisParaA, { dividir: [A.nmu, B.nmu] })}`)}
    ${grupo('Quem não votou ou anulou no 1º turno', `${qtd(g.ninguem)} eleitores (abstenção, brancos e nulos)`,
      controle('sf-ninguemVota', 'Votam agora num dos dois', o.ninguemVota, { max: 30 }) + controle('sf-ninguemParaA', 'Desses, vão para', o.ninguemParaA, { dividir: [A.nmu, B.nmu] }))}
    <div class="acoes"><button type="button" class="botao-2" id="sf-reset">Recomeçar</button>
      <a class="link" href="#avancado-${r.id}">Simulador avançado: por estado, por região e durante a apuração</a></div>`;
  atualizar();
}

/** Só refaz a conta e o quadro do resultado (a cada movimento de controle). */
function atualizar() {
  const { r, resumoEl, cores } = E.ctx;
  const [A, B] = E.ctx.fins(r);
  const s1 = r.baseline.summary;
  const g = gruposDoPrimeiroTurno(s1, A.n, B.n);
  const o = opcoes(r, A, B);
  const c = cenarioSimples(g, o);
  const [ca, cb] = r.cargo === 1 ? ['var(--a)', 'var(--b)'] : cores(A, B);
  const fotoA = { ...A, sq: A.sq || s1.cands.find((x) => x.n === A.n)?.sq }, fotoB = { ...B, sq: B.sq || s1.cands.find((x) => x.n === B.n)?.sq };
  const venc = c.vencedor === 'A' ? A : c.vencedor === 'B' ? B : null;
  const origem = (de, cor) => `<div class="sf-origem"><span class="sf-o-rot">do 1º turno</span><b>${qtd(de.primeiro)}</b></div>
    <div class="sf-origem"><span class="sf-o-rot">dos outros candidatos</span><b>${qtd(de.demais)}</b></div>
    <div class="sf-origem"><span class="sf-o-rot">de quem não votou</span><b>${qtd(de.ninguem)}</b></div>`;
  const aberto = resumoEl.querySelector('.sf-de-onde')?.open;
  resumoEl.innerHTML = `<p class="rot">No seu cenário</p>
    <div class="sf-duelo">
      <div class="sf-lado">${avatar(fotoA, { tam: 52, cor: ca })}<div class="sf-nome">${esc(A.nmu)}</div><div class="sf-pct" style="color:${ca}">${fmtPct(c.pA, 1)}<small>%</small></div></div>
      <div class="sf-lado b">${avatar(fotoB, { tam: 52, cor: cb })}<div class="sf-nome">${esc(B.nmu)}</div><div class="sf-pct" style="color:${cb}">${fmtPct(c.pB, 1)}<small>%</small></div></div>
    </div>
    <div class="barra pequena" aria-hidden="true"><span style="width:${c.pA}%;background:${ca}"></span><span style="flex:1"></span><span style="width:${c.pB}%;background:${cb}"></span><i class="meio"></i></div>
    <p class="veredito">${venc ? `${esc(venc.nmu)} é eleito` : 'Empate'}</p>
    <p class="nota">${venc ? `Diferença de ${qtd(Math.abs(c.margem))} votos, em ${qtd(c.validos)} votos válidos.` : 'Os dois com o mesmo número de votos.'}</p>
    <details class="dobra sf-de-onde"><summary><span class="dobra-t">De onde vêm os votos</span><span class="dobra-r">em cada grupo de eleitores</span></summary><div class="dobra-corpo">
      <h3 style="color:${ca}">${esc(A.nmu)}</h3>${origem(c.deA)}<h3 style="color:${cb}">${esc(B.nmu)}</h3>${origem(c.deB)}</div></details>
    <p class="nota sf-aviso">Simulação com os seus números: não é previsão nem pesquisa.</p>`;
  if (aberto) resumoEl.querySelector('.sf-de-onde').open = true;
  // Celular: o resultado fica lá embaixo; esta barra fixa no topo mostra o número mudando
  const fixo = document.getElementById('sf-fixo');
  if (fixo) fixo.innerHTML = `<span style="color:${ca}">${esc(primeiro(A.nmu))} ${fmtPct(c.pA, 1)}%</span><b>${venc ? `${esc(primeiro(venc.nmu))} é eleito` : 'Empate'}</b><span style="color:${cb}">${esc(primeiro(B.nmu))} ${fmtPct(c.pB, 1)}%</span>`;
}

function guardar() { const { r } = E.ctx; gravar(`facil:${r.id}`, E.estado[r.id]); }

/** Liga os eventos uma vez. ativo(): a aba do simulador simples está aberta. ir(hash): navega. */
export function ligarSimuladorFacil(raiz, { ativo, ir }) {
  raiz.addEventListener('input', (e) => {
    if (!ativo() || !e.target.id?.startsWith('sf-') || e.target.type !== 'range') return;
    const { r } = E.ctx, [A, B] = E.ctx.fins(r), o = opcoes(r, A, B);
    const t = e.target, chave = t.id.slice(3), v = Number(t.value) / 100;
    o[chave] = v;
    if (chave.startsWith('demais')) { o.pre = null; for (const b of raiz.querySelectorAll('[data-sf-pre]')) b.setAttribute('aria-pressed', 'false'); }
    t.style.setProperty('--p', `${((Number(t.value) - Number(t.min)) / (Number(t.max) - Number(t.min))) * 100}%`);
    const out = document.getElementById(`${t.id}-out`);
    if (out) out.textContent = t.classList.contains('dividir') ? `${primeiro(A.nmu)} ${t.value}% · ${primeiro(B.nmu)} ${100 - Number(t.value)}%` : `${t.value}%`;
    guardar();
    atualizar();
  });
  raiz.addEventListener('click', (e) => {
    if (!ativo()) return;
    const { r } = E.ctx, [A, B] = E.ctx.fins(r);
    const pre = e.target.closest('[data-sf-pre]');
    if (pre) {
      const v = predefinicoes(r, A, B).find(([k]) => k === pre.dataset.sfPre);
      Object.assign(opcoes(r, A, B), controlesDeTransferencia(v[2]), { pre: v[0] });
      guardar(); return renderSimuladorFacil(E.ctx);
    }
    if (e.target.id === 'sf-reset') { E.estado[r.id] = padrao(r, A, B); guardar(); renderSimuladorFacil(E.ctx); }
  });
  raiz.addEventListener('change', (e) => { if (ativo() && e.target.id === 'sf-race') ir(`simulador-${e.target.value}`); });
}
