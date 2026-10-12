// Mapa do Brasil por estado: preenchimento, rótulos (UF e %), chamadas laterais para estados pequenos,
// botão do exterior, zoom e arraste.
import MAPA from './mapa-brasil.js';
import { esc, iniciais } from './util.js';
import { textoSobre } from './partidos.js';

const VB = [0, 0, 720, 639];
const CHAMADAS = ['rn', 'pb', 'pe', 'al', 'se', 'es', 'rj'];
const AJUSTE = { go: [-14, 14], df: [10, -2], mg: [6, 0], pa: [8, 10], ma: [4, 6], sc: [6, 0], ba: [-4, 0], pi: [-2, 4], to: [0, 6], am: [0, 6], ap: [-2, 6] };
let centros = null;
let zoom = { k: 1, x: 0, y: 0 };

function calcularCentros(svg) {
  centros = {};
  for (const p of svg.querySelectorAll('path[data-uf]')) {
    const b = p.getBBox();
    const [dx, dy] = AJUSTE[p.dataset.uf] || [0, 0];
    centros[p.dataset.uf] = [b.x + b.width / 2 + dx, b.y + b.height / 2 + dy];
  }
}

/** Sem as chamadas laterais, o mapa ocupa só a área do Brasil. */
function viewBoxSemChamadas() {
  const w = 613 / zoom.k, h = VB[3] / zoom.k;
  const cx = 613 / 2 + zoom.x, cy = VB[3] / 2 + zoom.y;
  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
}

function viewBox() {
  const w = VB[2] / zoom.k, h = VB[3] / zoom.k;
  const cx = VB[2] / 2 + zoom.x, cy = VB[3] / 2 + zoom.y;
  return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
}

function rotulo(uf, d, [x, y]) {
  if (!d?.rotulo && !d?.cand) return '';
  const ini = d.cand ? esc(iniciais(d.cand.nmu)) : '';
  const av = d.cand
    ? `<g class="av"><circle r="12.5" fill="${d.cor}" stroke="#0f0e0d" stroke-width="1.5"/><text class="ini" y="3.5">${ini}</text>
       ${d.cand.sq ? `<image href="/api/foto/${esc(d.cand.sq)}" x="-11" y="-11" width="22" height="22" clip-path="url(#clip-av)" preserveAspectRatio="xMidYMin slice"/>` : ''}</g>`
    : '';
  const yUf = d.cand ? 24 : -2;
  return `<g class="rot" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" pointer-events="none">${av}
    <text class="uf" y="${yUf}">${uf.toUpperCase()}</text>
    ${d.rotulo ? `<text class="pct" y="${yUf + 11}">${d.marca ? `<tspan fill="${d.marca}">■</tspan> ` : ''}${esc(d.rotulo)}</text>` : ''}</g>`;
}

function chamadas(dados, sel, extra) {
  const ufs = CHAMADAS.filter((u) => dados[u]);
  const ordem = ufs.map((u) => ({ u, y: centros[u][1] })).sort((a, b) => a.y - b.y);
  // distribui verticalmente sem sobreposição
  let ultimo = -Infinity;
  const pos = ordem.map((o) => { const y = Math.max(o.y, ultimo + 29); ultimo = y; return { ...o, y }; });
  const x0 = 640;
  let html = pos.map(({ u, y }) => {
    const d = dados[u];
    const [cx, cy] = centros[u];
    const cor = d.cor || '#444';
    const txt = textoSobre(cor.startsWith('#') ? cor : '#444444');
    const av = d.cand ? `<circle cx="${x0 + 11}" cy="${y}" r="9" fill="${cor}" stroke="#0f0e0d"/>
      ${d.cand.sq ? `<image href="/api/foto/${esc(d.cand.sq)}" x="${x0 + 3}" y="${y - 8}" width="16" height="16" clip-path="url(#clip-av-p)" preserveAspectRatio="xMidYMin slice" style="transform-box:fill-box"/>` : ''}` : '';
    const tx = d.cand ? x0 + 24 : x0 + 8;
    return `<g class="chamada ${sel === u ? 'sel' : ''}" data-uf="${u}" tabindex="0" role="button" aria-label="${esc(d.titulo || u)}">
      <path d="M${cx.toFixed(1)},${cy.toFixed(1)} L${x0 - 18},${y} L${x0},${y}" class="linha"/>
      <rect x="${x0}" y="${y - 11}" width="${d.cand ? 78 : 66}" height="22" rx="4" fill="${d.fundoChamada || cor}"/>
      ${av}<text x="${tx}" y="${y + 4}" fill="${d.fundoChamada ? '#f2efea' : txt}" class="ct"><tspan font-weight="700">${u.toUpperCase()}</tspan>${d.rotulo ? `  ${esc(d.rotulo)}` : ''}</text></g>`;
  }).join('');
  if (extra) {
    const y = Math.max(ultimo + 40, 560);
    const cor = extra.cor || '#444';
    html += `<g class="chamada ${sel === 'zz' ? 'sel' : ''}" data-uf="zz" tabindex="0" role="button" aria-label="Exterior">
      <rect x="${x0}" y="${y - 11}" width="66" height="22" rx="4" fill="${cor}"/>
      <text x="${x0 + 8}" y="${y + 4}" fill="${textoSobre(cor.startsWith('#') ? cor : '#444444')}" class="ct">🌐 ${esc(extra.rotulo || '')}</text></g>`;
  }
  return html;
}

/**
 * dados: { uf: { fill, cor, rotulo, marca, cand, titulo, fundoChamada } }
 * opcoes: { sel, extra (exterior), inativos: Set }
 */
export function desenharBrasil(el, dados, { sel = null, extra = null, inativos = null, rotulos = true } = {}) {
  if (!el.querySelector('svg.br')) {
    el.innerHTML = `<svg class="br" viewBox="${viewBox()}" role="group" aria-label="Mapa do Brasil por estado">
      <defs><clipPath id="clip-av" clipPathUnits="userSpaceOnUse"><circle r="11"/></clipPath>
      <clipPath id="clip-av-p" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>
      <g class="estados">${MAPA.locations.map((l) => `<path d="${l.path}" data-uf="${l.id}" tabindex="0" role="button" aria-label="${esc(l.name)}"></path>`).join('')}</g>
      <g class="chamadas"></g><g class="rotulos"></g></svg>
      <div class="zoom"><button type="button" data-zoom="1" aria-label="Aproximar">+</button><button type="button" data-zoom="-1" aria-label="Afastar">−</button></div>`;
    const svg = el.querySelector('svg');
    calcularCentros(svg);
    ligarZoom(el, svg);
  }
  const svg = el.querySelector('svg');
  for (const p of svg.querySelectorAll('path[data-uf]')) {
    const d = dados[p.dataset.uf];
    p.style.fill = d?.fill || 'var(--vazio)';
    p.classList.toggle('sel', sel === p.dataset.uf);
    p.classList.toggle('inativo', !!inativos?.has(p.dataset.uf));
  }
  const s = svg.querySelector('path.sel');
  if (s) svg.querySelector('.estados').appendChild(s);
  svg.querySelector('.rotulos').innerHTML = rotulos ? Object.keys(centros).filter((u) => !CHAMADAS.includes(u)).map((u) => rotulo(u, dados[u], centros[u])).join('') : '';
  svg.querySelector('.chamadas').innerHTML = rotulos ? chamadas(dados, sel, extra) : '';
  svg.setAttribute('viewBox', rotulos ? viewBox() : viewBoxSemChamadas());
}

function ligarZoom(el, svg) {
  const aplicar = () => svg.setAttribute('viewBox', svg.querySelector('.chamadas').childElementCount ? viewBox() : viewBoxSemChamadas());
  el.querySelector('.zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-zoom]');
    if (!b) return;
    zoom.k = Math.min(4, Math.max(1, zoom.k * (b.dataset.zoom === '1' ? 1.4 : 1 / 1.4)));
    if (zoom.k === 1) zoom.x = zoom.y = 0;
    aplicar();
  });
  let arrasto = null;
  svg.addEventListener('pointerdown', (e) => { if (zoom.k > 1) arrasto = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moveu: false }; });
  window.addEventListener('pointermove', (e) => {
    if (!arrasto) return;
    const r = svg.getBoundingClientRect();
    const esc = (VB[2] / zoom.k) / r.width;
    const dx = (e.clientX - arrasto.x) * esc, dy = (e.clientY - arrasto.y) * esc;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrasto.moveu = true;
    zoom.x = arrasto.zx - dx; zoom.y = arrasto.zy - dy;
    aplicar();
  });
  window.addEventListener('pointerup', () => {
    if (arrasto?.moveu) svg.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
    arrasto = null;
  });
}
