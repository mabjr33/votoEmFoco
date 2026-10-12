// Gera public/js/mundo.js: contorno dos países (Natural Earth 110m via world-atlas, ISC),
// projeção Natural Earth e posição projetada das cidades do exterior.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import cidades from './cidades-exterior.mjs';

const out = process.argv[2];
const topo = JSON.parse(readFileSync(new URL('./node_modules/world-atlas/countries-110m.json', import.meta.url)));
const paises = feature(topo, topo.objects.countries);
// Sem a Antártida
paises.features = paises.features.filter((f) => f.properties.name !== 'Antarctica');
const W = 1000, H = 520;
const proj = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], paises);
const path = geoPath(proj).digits(1);
const terra = path(paises);
const fronteiras = path(mesh(topo, topo.objects.countries, (a, b) => a !== b));
const brasil = paises.features.find((f) => f.properties.name === 'Brazil');
const bb = geoPath(proj).bounds(brasil);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lista = cidades.map(([nome, iso, pais, lat, lon, ...aliases]) => {
  const [x, y] = proj([lon, lat]);
  return { nome, iso, pais, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, chaves: [...new Set([nome, ...aliases].map(norm))] };
});
const js = `// Gerado por scripts/gerar-mundo.mjs — não editar à mão.
// Contorno dos países: Natural Earth 110m (domínio público) via world-atlas (licença ISC), projeção Natural Earth.
export const W = ${W};
export const H = ${H};
export const TERRA = ${JSON.stringify(terra)};
export const FRONTEIRAS = ${JSON.stringify(fronteiras)};
/** Caixa projetada do Brasil (para sobrepor o mapa de estados). */
export const BRASIL = ${JSON.stringify(bb.flat().map((v) => Math.round(v * 10) / 10))};
/** Cidades com eleitores brasileiros no exterior: nome, país (ISO2), posição projetada e nomes aceitos (normalizados). */
export const CIDADES = ${JSON.stringify(lista)};
`;
writeFileSync(out, js);
console.log('ok', (js.length / 1024).toFixed(0) + ' KB', lista.length, 'cidades', 'Brasil bbox', bb);
