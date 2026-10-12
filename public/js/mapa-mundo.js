// Mapa-múndi do exterior: contorno dos países, Brasil por estado sobreposto e cidades como círculos
// (tamanho pelo eleitorado, cor pelo candidato que lidera).
import { W, H, TERRA, FRONTEIRAS, BRASIL, CIDADES } from './mundo.js';
import MAPA from './mapa-brasil.js';
import { esc, normalizar, titulo } from './util.js';

const PORCHAVE = new Map();
for (const c of CIDADES) for (const k of c.chaves) PORCHAVE.set(k, c);

/** Localiza a cidade do TSE no cadastro (país e posição). */
export function localizar(nomeTse) {
  const k = normalizar(nomeTse);
  return PORCHAVE.get(k) || PORCHAVE.get(k.replace(/^CIDADE DE /, '')) || null;
}

// Enquadramento inicial: sem as altas latitudes (mais espaço para as Américas e a Europa)
let zoom = { k: 1.18, x: 10, y: -18 };
const vb = () => {
  const w = W / zoom.k, h = H / zoom.k;
  return `${W / 2 + zoom.x - w / 2} ${H / 2 + zoom.y - h / 2} ${w} ${h}`;
};

/**
 * cidades: [{ cd, nome, eleitores, cor, destaque, dica }]
 * estados: { uf: fill }
 */
export function desenharMundo(el, cidades, estados = {}) {
  const [x0, y0, x1, y1] = BRASIL;
  const sx = (x1 - x0) / 613, sy = (y1 - y0) / 639;
  if (!el.querySelector('svg.mundo')) {
    el.innerHTML = `<svg class="mundo" viewBox="${vb()}" role="img" aria-label="Mapa-múndi com as cidades onde brasileiros votam">
      <path class="terra" d="${TERRA}"/><path class="fronteiras" d="${FRONTEIRAS}"/>
      <g class="br-estados" transform="translate(${x0},${y0}) scale(${sx},${sy})">${MAPA.locations.map((l) => `<path d="${l.path}" data-uf="${l.id}"/>`).join('')}</g>
      <g class="cidades"></g><g class="nomes"></g></svg>
      <div class="zoom"><button type="button" data-zoom="1" aria-label="Aproximar">+</button><button type="button" data-zoom="-1" aria-label="Afastar">−</button></div>`;
    const svg = el.querySelector('svg');
    el.querySelector('.zoom').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-zoom]');
      if (!b) return;
      zoom.k = Math.min(8, Math.max(1.18, zoom.k * (b.dataset.zoom === '1' ? 1.6 : 1 / 1.6)));
      if (zoom.k <= 1.18) { zoom.k = 1.18; zoom.x = 10; zoom.y = -18; }
      svg.setAttribute('viewBox', vb());
      svg.style.setProperty('--k', zoom.k);
    });
    let ar = null;
    svg.addEventListener('pointerdown', (e) => { if (zoom.k > 1) ar = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y }; });
    window.addEventListener('pointermove', (e) => {
      if (!ar) return;
      const r = svg.getBoundingClientRect(), f = (W / zoom.k) / r.width;
      zoom.x = ar.zx - (e.clientX - ar.x) * f; zoom.y = ar.zy - (e.clientY - ar.y) * f;
      svg.setAttribute('viewBox', vb());
    });
    window.addEventListener('pointerup', () => { ar = null; });
  }
  const svg = el.querySelector('svg');
  for (const p of svg.querySelectorAll('.br-estados path')) p.style.fill = estados[p.dataset.uf] || 'var(--vazio)';
  const maxEl = Math.max(1, ...cidades.map((c) => c.eleitores || 0));
  const comPos = cidades.map((c) => ({ ...c, loc: localizar(c.nome) })).filter((c) => c.loc)
    .sort((a, b) => (b.eleitores || 0) - (a.eleitores || 0));
  svg.querySelector('.cidades').innerHTML = comPos.map((c) => {
    const r = 2.2 + 7 * Math.sqrt((c.eleitores || 0) / maxEl);
    return `<circle cx="${c.loc.x}" cy="${c.loc.y}" r="${r.toFixed(2)}" fill="${c.cor}" data-cidade="${esc(c.cd)}" data-dica="${esc(c.dica || '')}"/>`;
  }).join('');
  svg.querySelector('.nomes').innerHTML = comPos.slice(0, 7).map((c) =>
    `<text x="${c.loc.x + 6}" y="${c.loc.y + 3}">${esc(titulo(c.loc.nome || c.nome))}</text>`).join('');
}
