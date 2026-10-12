// Aba Previsões: histórico das eleições presidenciais, erro das pesquisas e modelos para o 2º turno de 2026.
// Os cálculos ficam em /shared/previsao.js (testados). Aqui só se monta a página.
import { simulate, simulateWithUncertainty, calibrateSwing } from '/shared/engine.js';
import { FONTES, ELEICOES, PESQUISAS_2026_2T, TRANSFERENCIA_2026, ATUALIZADO } from '/shared/historico.js';
import { previsoes, erroPorAno, normCdf } from '/shared/previsao.js';
import { esc, fmtPct, fmtInt, curto, normalizar, avatar } from './util.js';
import { corPartido } from './partidos.js';
import { desenharBrasil } from './mapa-br.js';

const CA = 'var(--a)', CB = 'var(--b)';
const E26 = ELEICOES.find((e) => e.ano === 2026);
const NOME_F = E26.lider.nome, NOME_L = E26.segundo.nome;
const P = previsoes();
const pos = (v, lo, hi) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
const quad = (cor) => `<i class="marca" style="background:${cor}"></i>`;
const pct = (v, d = 1) => `${fmtPct(v, d)}%`;
const fonte = (k) => (FONTES[k] ? `<a href="${esc(FONTES[k].url)}" target="_blank" rel="noopener">${esc(FONTES[k].nome.split(':')[0])}</a>` : '');

/** Eixo horizontal com marcas; usado por todos os gráficos de linha única. */
function eixo(lo, hi, passo, fmt = (v) => `${v}%`) {
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += passo) ticks.push(`<span style="left:${pos(v, lo, hi)}%">${fmt(v)}</span>`);
  return `<div class="fila eixo"><div></div><div class="trilho-p">${ticks.join('')}</div><div></div></div>`;
}
const linhaRef = (v, lo, hi, rot = '') => `<i class="ref" style="left:${pos(v, lo, hi)}%">${rot ? `<b>${rot}</b>` : ''}</i>`;

function cabecaCandidato(nome, cor, foto, lado) {
  const c = { nmu: nome, sq: foto?.sq };
  return `<div class="lado ${lado}"><div class="pessoa">${avatar(c, { tam: 48, cor })}<div><div class="nm">${esc(nome)}</div><div class="pt">${lado === 'a' ? 'PL, 1º no 1º turno' : 'PT, 2º no 1º turno'}</div></div></div>`;
}

// ---------- blocos ----------
function blocoTopo(ctx) {
  const c = P.combinado;
  const f = c.centro, l = 100 - c.centro;
  const fotos = ctx.fotos();
  const s = ctx.pres?.baseline?.summary;
  let votos = '';
  if (s?.eleitores?.te && s.votos?.vv && s.eleitores.c) {
    const comp = s.eleitores.te * (1 - P.abstencao.centro / 100);
    const validos = comp * (s.votos.vv / s.eleitores.c);
    votos = `<p class="nota">Em votos: com ${curto(s.eleitores.te)} de eleitores, abstenção de ${pct(P.abstencao.centro)} e brancos e nulos na proporção do 1º turno, seriam cerca de ${curto(validos)} de votos válidos. A estimativa central daria uma diferença de ${curto(Math.abs(2 * f - 100) / 100 * validos)} de votos.</p>`;
  }
  return `<div class="prev-topo">
    <div class="duelo">${cabecaCandidato(NOME_F, CA, fotos.f, 'a')}<div class="pct">${fmtPct(f, 1)}<small>%</small></div></div>
      ${cabecaCandidato(NOME_L, CB, fotos.l, 'b')}<div class="pct">${fmtPct(l, 1)}<small>%</small></div></div></div>
    <div class="barra" aria-hidden="true"><span style="width:${f}%;background:${CA}"></span><span style="flex:1"></span><span style="width:${l}%;background:${CB}"></span><i class="meio"></i></div>
    <div class="prev-resumo">
      <div><div class="r">Chance de vitória no modelo</div><div class="n"><span style="color:${CA}">${fmtPct(c.probFlavio * 100, 0)}%</span> <small>${esc(NOME_F.split(' ')[0])}</small> · <span style="color:${CB}">${fmtPct(c.probLula * 100, 0)}%</span> <small>${esc(NOME_L)}</small></div>
        <div class="chance"><span style="width:${c.probFlavio * 100}%;background:${CA}"></span><span style="flex:1;background:${CB}"></span></div></div>
      <div><div class="r">Faixa provável (80%)</div><div class="n">${fmtPct(c.int80[0], 1)} a ${fmtPct(c.int80[1], 1)}<small>% para ${esc(NOME_F.split(' ')[0])}</small></div><div class="s">Com 95%: ${fmtPct(c.int95[0], 1)} a ${fmtPct(c.int95[1], 1)}%</div></div>
      <div><div class="r">Abstenção esperada</div><div class="n">${fmtPct(P.abstencao.centro, 1)}<small>%</small></div><div class="s">${fmtPct(P.abstencao.faixa[0], 1)} a ${fmtPct(P.abstencao.faixa[1], 1)}% pelo histórico</div></div>
    </div>
    ${votos}
  </div>`;
}

function blocoMargem() {
  const fs = P.combinado.faixas;
  const max = Math.max(...fs.map((f) => f.prob));
  const linhas = fs.map((f) => {
    const cor = f.de >= 0 ? CA : CB;
    return `<div class="barra-h"><span class="rot">${esc(f.rotulo)}</span><span class="tr"><i style="width:${(f.prob / max) * 100}%;background:${cor}"></i></span><span class="v">${f.prob < 0.005 ? '<1' : fmtPct(f.prob * 100, 0)}%</span></div>`;
  }).join('');
  return `<section><h2>Por quanto</h2><p class="intro">Chance de cada faixa de diferença em votos válidos, segundo a previsão combinada. Diferença de 5 pp equivale a 52,5% contra 47,5%.</p><div class="barras-h">${linhas}</div></section>`;
}

function blocoModelos() {
  const lo = 42, hi = 62;
  const linha = (m, rot, sub, destaque = false) => {
    const a = m.centro - 1.2816 * m.sd, b = m.centro + 1.2816 * m.sd;
    const cor = m.centro >= 50 ? CA : CB;
    return `<div class="fila ${destaque ? 'destaque' : ''}"><div class="fila-rot">${esc(rot)}<small>${sub}</small></div>
      <div class="trilho-p">${linhaRef(50, lo, hi)}<i class="int" style="left:${pos(a, lo, hi)}%;width:${pos(b, lo, hi) - pos(a, lo, hi)}%;background:color-mix(in oklab, ${cor} 28%, transparent)"></i>
      <i class="pto" style="left:${pos(m.centro, lo, hi)}%;background:${cor}" data-dica="${esc(`<b>${rot}</b><br>${NOME_F} ${pct(m.centro)}<br>Faixa de 80%: ${fmtPct(a)} a ${pct(b)}`)}"></i></div>
      <div class="fila-v">${fmtPct(m.centro, 1)}%</div></div>`;
  };
  const [mp, mh, mt] = P.modelos;
  const peso = (id) => fmtPct(P.combinado.pesos.find((p) => p.id === id).peso * 100, 0);
  const dp = mp.detalhe, dh = mh.detalhe, dt = mt.detalhe;
  return `<section><h2>Três jeitos de prever</h2>
    <p class="intro">Percentual de ${esc(NOME_F)} nos votos válidos em cada modelo. O ponto é a estimativa central; a faixa cobre 80% dos casos. À direita da linha central, ${esc(NOME_F.split(' ')[0])} vence; à esquerda, ${esc(NOME_L)}.</p>
    <div class="filas">
      ${linha(mp, 'Pesquisas corrigidas', `peso ${peso('pesquisas')}% na combinação`)}
      ${linha(mt, 'Transferência declarada', `peso ${peso('transferencia')}%`)}
      ${linha(mh, 'Padrão histórico', `peso ${peso('historico')}%`)}
      ${linha({ centro: P.combinado.centro, sd: P.combinado.sd }, 'Previsão combinada', 'média ponderada', true)}
      ${eixo(lo, hi, 4)}
    </div>
    <div class="explica-grade">
      <div><h3>Pesquisas corrigidas</h3><p>Média das ${dp.usadas.length} pesquisas de 2º turno feitas depois do 1º turno (${dp.usadas.map((u) => `${esc(u.instituto)} ${fmtPct(u.flavio, 1)}%`).join(', ')}) = ${pct(dp.bruto, 2)}. Nas últimas pesquisas de 2010, 2018 e 2022 (${dp.nErros} levantamentos), o candidato do PT apareceu em média ${fmtPct(dp.vies, 2)} pp acima do resultado. Somando essa correção, ${pct(mp.centro, 2)}. A incerteza junta a variação desse erro (${fmtPct(dp.sdErro, 1)} pp) com 1,5 pp pelas duas semanas até a eleição.</p></div>
      <div><h3>Transferência declarada</h3><p>No 1º turno, os demais candidatos tiveram ${pct(dt.outros, 2)} dos válidos. Segundo o Datafolha, ${fmtPct(dt.transf.flavio * 100, 0)}% desses eleitores dizem votar em ${esc(NOME_F.split(' ')[0])}, ${fmtPct(dt.transf.lula * 100, 0)}% em ${esc(NOME_L)} e ${fmtPct(dt.transf.brancoNulo * 100, 0)}% em branco ou nulo. Somando aos votos do 1º turno: ${pct(dt.flavio, 2)} contra ${pct(dt.lula, 2)}, ou ${pct(mt.centro, 2)} dos válidos. Supõe que quem votou nos dois finalistas repete o voto. A incerteza de 2 pp é uma premissa.</p></div>
      <div><h3>Padrão histórico</h3><p>De um turno para o outro, a vantagem do líder entre os dois finalistas costuma encolher: na mediana de 1989 a 2022, sobrou ${fmtPct(dh.k * 100, 0)}% dela. Em 2026, ${esc(NOME_F.split(' ')[0])} teve ${pct(dh.s1, 2)} entre os dois, o que leva a ${pct(mh.centro, 2)}. Pesa pouco porque varia muito: em 2006, Lula ampliou a vantagem e passou de ${pct(dh.pontos.find((p) => p.ano === 2006).s1, 1)} para ${pct(dh.pontos.find((p) => p.ano === 2006).s2, 1)}.</p></div>
    </div></section>`;
}

function blocoPesquisas() {
  const linhas = PESQUISAS_2026_2T.map((p) => {
    const fv = p.flavioValido, lv = p.lulaValido;
    const cor = fv == null ? 'inherit' : fv >= 50 ? CA : CB;
    return `<tr class="${p.depois1T ? '' : 'antes'}"><td>${esc(p.instituto)}<small>${esc(p.registro)}</small></td><td>${esc(p.campo)}</td><td class="n">${fmtInt(p.amostra)}</td>
      <td class="n">${p.flavio == null ? '–' : fmtPct(p.flavio, 1)}</td><td class="n">${p.lula == null ? '–' : fmtPct(p.lula, 1)}</td>
      <td class="n forte" style="color:${cor}">${fv == null ? '–' : `${fmtPct(fv, 1)} a ${fmtPct(lv, 1)}`}</td><td>${fonte(p.fonte)}</td></tr>`;
  }).join('');
  return `<section><h2>As pesquisas do 2º turno</h2><p class="intro">Levantamentos registrados no TSE, com o número de registro. Em cinza, os feitos antes do 1º turno, que não entram no modelo. "Válidos" é como o instituto divulgou, sem brancos, nulos e indecisos.</p>
    <div class="tabela-rolar"><table class="tabela"><thead><tr><th>Instituto</th><th>Campo</th><th class="n">Entrevistas</th><th class="n">${esc(NOME_F.split(' ')[0])}</th><th class="n">${esc(NOME_L)}</th><th class="n">Válidos</th><th>Fonte</th></tr></thead><tbody>${linhas}</tbody></table></div></section>`;
}

function blocoErros() {
  const lo = -3, hi = 7;
  const grupos = [
    ...[2010, 2018, 2022].map((a) => ({ rot: `${a}, 2º turno`, itens: P.erros2T.filter((e) => e.ano === a) })),
    ...[2010, 2018, 2022, 2026].map((a) => ({ rot: `${a}, 1º turno`, itens: P.erros1T.filter((e) => e.ano === a) })),
  ];
  const filas = grupos.map((g) => {
    const m = erroPorAno(g.itens)[0];
    const pts = g.itens.map((e) => `<i class="pto pq" style="left:${pos(e.erro, lo, hi)}%" data-dica="${esc(`<b>${e.instituto}, ${e.ano}</b><br>Pesquisa: ${fmtPct(e.prev)}% para o PT entre os dois<br>Resultado: ${fmtPct(e.real)}%<br>Erro: ${e.erro > 0 ? '+' : ''}${fmtPct(e.erro, 2)} pp`)}"></i>`).join('');
    return `<div class="fila ${g.rot.startsWith('2026') ? 'destaque' : ''}"><div class="fila-rot">${g.rot}<small>${g.itens.length} pesquisas</small></div>
      <div class="trilho-p">${linhaRef(0, lo, hi)}<i class="media" style="left:${pos(m.media, lo, hi)}%"></i>${pts}</div><div class="fila-v">${m.media > 0 ? '+' : ''}${fmtPct(m.media, 1)}</div></div>`;
  }).join('');
  const cen = P.cenarios.map((c) => `<li><span>${esc(c.rotulo)}<small>${c.erro > 0 ? '+' : ''}${fmtPct(c.erro, 2)} pp</small></span><span class="v" style="color:${c.flavio >= 50 ? CA : CB}">${fmtPct(c.flavio, 1)}% a ${fmtPct(c.lula, 1)}%</span></li>`).join('');
  return `<section><h2>Quanto as pesquisas erraram</h2>
    <p class="intro">Diferença entre a última pesquisa de cada instituto e o resultado, medida no percentual do candidato do PT entre os dois primeiros. À direita do zero, a pesquisa deu mais ao PT do que as urnas. O traço vertical é a média do ano.</p>
    <div class="filas">${filas}${eixo(lo, hi, 2, (v) => `${v > 0 ? '+' : ''}${v}`)}</div>
    <p class="nota" style="margin-top:12px">No 1º turno de 2026, as três pesquisas finais aqui reunidas davam ${esc(NOME_L)} à frente; ${esc(NOME_F.split(' ')[0])} terminou com ${pct(E26.lider.t1, 2)} contra ${pct(E26.segundo.t1, 2)}. Pesquisas de 1º turno erram mais que as de 2º, porque o eleitor ainda escolhe entre muitos nomes.</p>
    <h3 class="sub-h">E se as pesquisas de agora errarem como antes?</h3>
    <p class="intro">Média das três pesquisas pós-1º turno (${pct(P.modelos[0].detalhe.bruto, 2)} para ${esc(NOME_F.split(' ')[0])}) ajustada por erros já observados. São hipóteses, não previsões.</p>
    <ul class="cenarios">${cen}</ul></section>`;
}

function blocoHistoria() {
  const c = P.comparativo;
  const lo = 45, hi = 70;
  const filas = c.linhas.map((l) => {
    const e = ELEICOES.find((x) => x.ano === l.ano);
    const s2 = l.t2 == null ? P.combinado.centro : (100 * e.lider.t2) / (e.lider.t2 + e.segundo.t2);
    const a = Math.min(l.partilha1, s2), b = Math.max(l.partilha1, s2);
    const prev = l.t2 == null;
    const dica = prev
      ? `<b>2026</b><br>1º turno: ${NOME_F} ${fmtPct(l.partilha1)}% entre os dois<br>Previsão combinada: ${fmtPct(s2)}%`
      : `<b>${l.ano}</b><br>${l.lider} (líder) × ${l.segundo}<br>1º turno: ${fmtPct(l.partilha1)}% entre os dois<br>2º turno: ${fmtPct(s2)}%`;
    return `<div class="fila ${prev ? 'destaque' : ''}"><div class="fila-rot">${l.ano}<small>${esc(l.lider)} × ${esc(l.segundo)}${l.incumbente === 'lider' ? ', líder era o presidente' : l.incumbente === 'segundo' ? ', 2º era o presidente' : ''}</small></div>
      <div class="trilho-p">${linhaRef(50, lo, hi)}<i class="seg ${prev ? 'prev' : ''}" style="left:${pos(a, lo, hi)}%;width:${pos(b, lo, hi) - pos(a, lo, hi)}%"></i>
      <i class="pto vazado" style="left:${pos(l.partilha1, lo, hi)}%" data-dica="${esc(dica)}"></i><i class="pto ${prev ? 'prev' : ''}" style="left:${pos(s2, lo, hi)}%" data-dica="${esc(dica)}"></i></div>
      <div class="fila-v">${prev ? `${fmtPct(s2, 1)}%*` : `${fmtPct(s2, 1)}%`}</div></div>`;
  }).join('');
  const fatos = [
    ['Viradas no 2º turno', `${c.disputas - c.lideresVenceram} em ${c.disputas}`, 'O líder do 1º turno venceu todas as disputas de 2º turno desde 1989.'],
    ['Diferença no 1º turno de 2026', `${fmtPct(c.margem2026, 2)} pp`, `A menor da série. A anterior menor foi de ${fmtPct(c.menorMargemAnterior, 2)} pp, em 2022.`],
    ['Os dois finalistas somaram', pct(c.soma2026, 2), `A maior soma da série, acima dos ${pct(c.maiorSomaAnterior, 2)} de 2022. Sobram poucos votos para disputar.`],
  ].map(([r, n, s]) => `<div><div class="r">${r}</div><div class="n">${n}</div><div class="s">${s}</div></div>`).join('');
  return `<section><h2>2026 na história</h2>
    <p class="intro">Percentual do líder do 1º turno entre os dois finalistas: o círculo vazado é o 1º turno e o cheio, o resultado do 2º. Em 2026, o ponto cheio é a previsão combinada (*). Quanto mais perto da linha de 50%, mais apertado.</p>
    <div class="fatos">${fatos}</div>
    <div class="filas">${filas}${eixo(lo, hi, 5)}</div>
    <p class="nota" style="margin-top:12px">Em 2022 e em 2026, o presidente em exercício chegou ao 2º turno em segundo lugar. Em 2022, Bolsonaro reduziu a diferença de ${fmtPct(48.43 - 43.2, 1)} pp no 1º turno para ${fmtPct(50.9 - 49.1, 1)} pp no 2º, mas não virou.</p></section>`;
}

function blocoTransferencia() {
  const t = TRANSFERENCIA_2026;
  const partes = [[NOME_F, t.flavio, CA], [NOME_L, t.lula, CB], ['Branco ou nulo', t.brancoNulo, 'var(--tinta-3)'], ['Outras respostas', t.outros, 'var(--vazio)']];
  return `<section><h2>Para onde vão os votos dos eliminados</h2>
    <p class="intro">Eleitores de Cury, Renan Santos, Caiado e Zema no 1º turno, segundo o Datafolha de 6 e 7 de outubro. Juntos, esses candidatos e os demais tiveram ${pct(P.modelos[2].detalhe.outros, 2)} dos votos válidos.</p>
    <div class="composicao alta">${partes.map(([, v, c]) => `<span style="flex:${v};background:${c}"></span>`).join('')}</div>
    <div class="legenda">${partes.map(([n, v, c]) => `<span>${quad(c)}${esc(n)} <b>${fmtPct(v * 100, 0)}%</b></span>`).join('')}</div>
    <p class="nota" style="margin-top:8px">Fonte: ${fonte(t.fonte)}.</p></section>`;
}

function blocoMapa(ctx) {
  const r = ctx.pres;
  const fs = ctx.fins(r);
  if (!r?.baseline?.units || fs.length < 2) return { html: '', desenhar: () => {} };
  const [A, B] = fs;
  const f = fs.map((x) => x.n);
  const p = ctx.premissas(r);
  const swing = calibrateSwing(r.baseline.units, f, p, P.combinado.centro);
  if (swing === null) return { html: '', desenhar: () => {} };
  const sim = simulate(r.baseline.units, f, { ...p, swingPp: swing });
  const sdUf = Math.sqrt(P.combinado.sd ** 2 + 1.5 ** 2);
  const cats = { a: 0, ia: 0, ind: 0, ib: 0, b: 0 };
  const dados = {}, dicas = {};
  for (const [cd, u] of Object.entries(sim.units)) {
    if (cd === 'zz') continue;
    const pa = normCdf((u.pctA - 50) / sdUf);
    const k = pa >= 0.8 ? 'a' : pa >= 0.6 ? 'ia' : pa > 0.4 ? 'ind' : pa > 0.2 ? 'ib' : 'b';
    cats[k]++;
    const cor = pa >= 0.5 ? CA : CB;
    const forca = { a: 90, ia: 50, ind: 0, ib: 50, b: 90 }[k];
    dados[cd] = { fill: k === 'ind' ? 'var(--vazio)' : `color-mix(in oklab, ${cor} ${forca}%, var(--vazio))` };
    dicas[cd] = `<b>${esc(ctx.ufNome(cd))}</b><br>${esc(A.nmu)} ${fmtPct(u.pctA)}%<br>${esc(B.nmu)} ${fmtPct(u.pctB)}%<br>Chance de ${esc(A.nmu)}: ${fmtPct(pa * 100, 0)}%`;
  }
  const leg = [
    ['a', `Provável ${A.nmu}`, `color-mix(in oklab, ${CA} 90%, var(--vazio))`], ['ia', `Inclina para ${A.nmu}`, `color-mix(in oklab, ${CA} 50%, var(--vazio))`],
    ['ind', 'Indefinido', 'var(--vazio)'], ['ib', `Inclina para ${B.nmu}`, `color-mix(in oklab, ${CB} 50%, var(--vazio))`], ['b', `Provável ${B.nmu}`, `color-mix(in oklab, ${CB} 90%, var(--vazio))`],
  ];
  const html = `<section><h2>Mapa provável</h2>
    <p class="intro">O cenário-base do simulador (votos de cada estado no 1º turno, com transferência pelo perfil dos partidos) foi deslocado por igual em todos os estados até o total nacional bater com a previsão combinada (${fmtPct(swing > 0 ? swing : -swing, 1)} pp ${swing >= 0 ? `para ${esc(A.nmu)}` : `para ${esc(B.nmu)}`}). "Provável" é chance acima de 80%; "inclina", de 60% a 80%.</p>
    <div class="prev-mapa"><div id="mapa-prev" class="mapa"></div>
      <div class="contagem">${leg.map(([k, rot, cor]) => `<div><span class="caixa" style="background:${cor}"></span><span>${esc(rot)}</span><b>${cats[k]}</b></div>`).join('')}
      <p class="nota">Estados não elegem presidente: vale o total de votos do país. O mapa mostra só onde cada um tende a ir melhor.</p></div></div></section>`;
  return { html, desenhar: () => { const el = document.getElementById('mapa-prev'); if (el) desenharBrasil(el, dados, { rotulos: false }); }, dicas };
}

function blocoAbstencao() {
  const a = P.abstencao;
  const lo = 10, hi = 30;
  const h = (v) => `${pos(v, lo, hi)}%`;
  const cols = a.serie.map((s) => {
    const prev = s.ano === 2026;
    const b1 = s.abst1 == null ? '<span class="col vazio"></span>' : `<span class="col t1" style="height:${h(s.abst1)}" data-dica="${esc(`<b>${s.ano}, 1º turno</b><br>Abstenção de ${fmtPct(s.abst1)}%`)}"><b>${fmtPct(s.abst1, 1)}</b></span>`;
    const b2 = prev
      ? `<span class="col t2 prev" style="height:${h(a.centro)}" data-dica="${esc(`<b>2026, 2º turno (previsão)</b><br>${fmtPct(a.centro)}%, faixa de ${fmtPct(a.faixa[0])} a ${fmtPct(a.faixa[1])}%`)}"><b>${fmtPct(a.centro, 1)}*</b></span>`
      : s.abst2 == null ? '<span class="col vazio"></span>' : `<span class="col t2" style="height:${h(s.abst2)}" data-dica="${esc(`<b>${s.ano}, 2º turno</b><br>Abstenção de ${fmtPct(s.abst2)}%`)}"><b>${fmtPct(s.abst2, 1)}</b></span>`;
    return `<div class="ano ${prev ? 'destaque' : ''}"><div class="cols">${b1}${b2}</div><div class="rot">${s.ano}</div></div>`;
  }).join('');
  return `<section><h2>Abstenção</h2>
    <p class="intro">Percentual do eleitorado que não votou em cada turno. De 2002 a 2022, a abstenção subiu em média ${fmtPct(a.deltaMedio, 1)} pp do 1º para o 2º turno (só caiu em 2022). Aplicado aos ${pct(a.base, 2)} do 1º turno de 2026, dá ${pct(a.centro, 1)} (*), entre ${pct(a.faixa[0], 1)} e ${pct(a.faixa[1], 1)}.</p>
    <div class="legenda" style="margin-bottom:12px">${quad('var(--tinta-3)')}1º turno ${quad('var(--tinta)')}2º turno</div>
    <div class="colunas">${cols}</div>
    <p class="nota" style="margin-top:8px">Barras começam em 10%. Sem barra: 1º turno de 1989 (número não conferido) e 2º turno de 1994 e 1998 (não houve). Fontes: ${fonte('abstAB')}, ${fonte('abstC24')}, ${fonte('abst2026')}.</p></section>`;
}

function blocoGovernadores(ctx) {
  const linhas = [];
  for (const uf of ctx.UFS) {
    const g = ctx.gov[uf];
    const fs = ctx.fins(g);
    if (!g?.baseline?.units || fs.length < 2 || !Object.keys(g.baseline.units).length) continue;
    const [A, B] = fs;
    const s1 = g.baseline.summary;
    const a1 = s1?.cands.find((x) => x.n === A.n)?.pvap, b1 = s1?.cands.find((x) => x.n === B.n)?.pvap;
    const res = simulateWithUncertainty(g.baseline.units, fs.map((x) => x.n), ctx.premissas(g));
    const pA = res.total.pctA, ch = res.incerteza.pVitoriaA;
    const ca = corPartido(A.partido), cb = corPartido(B.partido);
    linhas.push(`<tr><td><b>${esc(ctx.ufNome(uf))}</b></td>
      <td>${quad(ca)}${esc(A.nmu)} <small class="em-linha">${esc(A.partido)}</small></td><td class="n">${fmtPct(a1, 1)}</td>
      <td>${quad(cb)}${esc(B.nmu)} <small class="em-linha">${esc(B.partido)}</small></td><td class="n">${fmtPct(b1, 1)}</td>
      <td class="n forte">${fmtPct(pA, 1)} a ${fmtPct(100 - pA, 1)}</td><td class="n">${fmtPct(Math.max(ch, 1 - ch) * 100, 0)}% ${esc((ch >= 0.5 ? A : B).nmu.split(' ')[0])}</td></tr>`);
  }
  if (!linhas.length) return '';
  return `<section><h2>Governadores no 2º turno</h2>
    <p class="intro">Não reunimos pesquisas estaduais de 2º turno, então aqui vale só o cenário-base: votos do 1º turno de cada estado, com os eleitores dos eliminados divididos pela proximidade dos partidos e incerteza de 3 pp. É a previsão mais frágil desta página.</p>
    <div class="tabela-rolar"><table class="tabela"><thead><tr><th>Estado</th><th>1º colocado</th><th class="n">1º turno</th><th>2º colocado</th><th class="n">1º turno</th><th class="n">Cenário-base</th><th class="n">Chance</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div>
    <p class="nota" style="margin-top:8px">Percentuais em votos válidos. A lista de disputas vem da configuração oficial do TSE quando ela publica o 2º turno. No Rio de Janeiro, o Brasil de Fato informou em 6/10 que a candidatura de Garotinho ainda dependia de decisão do TSE, o que pode mudar a disputa (${fonte('bdf0610')}).</p></section>`;
}

function blocoMetodo() {
  const usadas = new Set(['bpmoney', 'tse2018', 'ihu2018', 'cf2014', 'cf2022', 'pp2026', 'abst2026', 'abstAB', 'abstC24', 'opovoAbst', 'wiki2010', 'wiki2018', 'wiki2022', 'df0310', 'quaest0310', 'rtbd0110', 'df0810', 'atlas0910', 'vox0910', 'cnt0310', 'bdf0610']);
  const lista = [...usadas].filter((k) => FONTES[k]).map((k) => `<li><a href="${esc(FONTES[k].url)}" target="_blank" rel="noopener">${esc(FONTES[k].nome)}</a></li>`).join('');
  return `<section class="metodo"><h2>Como foi feito e o que fica de fora</h2>
    <ul class="pontos">
      <li><b>Fatos:</b> resultados oficiais das eleições de 1989 a 2026 e pesquisas registradas no TSE, com o número de registro quando disponível.</li>
      <li><b>Estimativas:</b> os três modelos, a combinação, a abstenção e o mapa. A combinação pondera cada modelo pelo inverso da variância. Como os modelos usam dados parecidos, a incerteza combinada é a média das incertezas, e não a menor delas.</li>
      <li><b>Hipóteses:</b> os cenários de erro e o mapa por estado.</li>
      <li><b>Fora da conta:</b> pesquisas finais de 2002, 2006 e 2014 (não conseguimos conferir os números em fonte confiável), debates, fatos novos e o efeito do horário eleitoral. Com 3 eleições de pesquisas de 2º turno, o histórico de erro é curto.</li>
      <li>Nada aqui é pesquisa eleitoral. São contas feitas com números públicos, e podem errar por bem mais do que a faixa indicada.</li>
    </ul>
    <h3 class="sub-h">Fontes (consultadas em ${ATUALIZADO})</h3><ul class="fontes">${lista}</ul></section>`;
}

/** Monta a aba. ctx: { pres, gov, fins, premissas, ufNome, UFS, fotos } */
export function renderPrevisoes(raiz, ctx) {
  const mapa = blocoMapa(ctx);
  raiz.innerHTML = `<div class="prev-cab"><h1>Previsões para o 2º turno</h1>
      <p class="intro">Estimativas de modelo, feitas com os resultados oficiais desde 1989 e com as pesquisas registradas já divulgadas. Não são pesquisa eleitoral. Dados reunidos em ${ATUALIZADO}; a eleição é em 25 de outubro.</p></div>
    ${blocoTopo(ctx)}
    <div class="prev-corpo">
      ${blocoModelos()}${blocoMargem()}${blocoPesquisas()}${blocoErros()}${blocoHistoria()}${blocoTransferencia()}${mapa.html}${blocoAbstencao()}${blocoGovernadores(ctx)}${blocoMetodo()}
    </div>`;
  mapa.desenhar();
  return mapa.dicas || {};
}

/** Procura os finalistas reais entre os candidatos carregados do TSE, para usar as fotos. */
export function fotosFinalistas(pres) {
  const cands = pres?.baseline?.summary?.cands || [];
  const achar = (nome) => {
    const chave = normalizar(nome).split(' ')[0];
    return cands.find((c) => normalizar(c.nmu).split(' ').includes(chave));
  };
  return { f: achar(NOME_F), l: achar(NOME_L) };
}
