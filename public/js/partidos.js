// Cores por partido (convenção visual da cobertura eleitoral, ajustadas para fundo escuro).
const CORES = {
  PT: '#e5322d', PL: '#3b63e8', PSD: '#3fae57', PP: '#6dd3f5', REPUBLICANOS: '#4a7fc0', UNIAO: '#1e9bd7',
  MDB: '#a06cd5', PSB: '#f4b23e', PSDB: '#5aa9e6', PDT: '#e8794a', PSOL: '#f2d04b', NOVO: '#f28c28',
  AVANTE: '#19b5a5', PODE: '#24b3c9', PODEMOS: '#24b3c9', SOLIDARIEDADE: '#ff7f6e', CIDADANIA: '#e05aa0',
  PCDOB: '#b5302b', PV: '#6cc070', REDE: '#2bb3a0', MISSAO: '#f6c343', PRTB: '#8d9a43', DC: '#8e7cc3',
  UP: '#d94848', PSTU: '#c23b3b', PCB: '#a33030', PCO: '#9b2c2c', PRD: '#6d7fd8', MOBILIZA: '#9aa0a6',
  AGIR: '#a58b6f', PMB: '#c77dba', DEMOCRATA: '#7c9cbf',
};
const PADRAO = '#8b8f96';
const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

export const corPartido = (sigla) => CORES[chave(sigla)] || PADRAO;

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Cor de texto legível sobre a cor do partido. */
export const textoSobre = (hex) => (lum(hex) > 0.36 ? '#111' : '#fff');

/** Cores para dois finalistas; se forem do mesmo partido, o segundo recebe um tom alternativo. */
export function coresFinalistas(a, b) {
  const ca = corPartido(a?.partido);
  let cb = corPartido(b?.partido);
  if (cb === ca) cb = '#c9ccd1';
  return [ca, cb];
}
