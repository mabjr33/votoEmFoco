export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = new Intl.NumberFormat('pt-BR');
export const fmtInt = (n) => nf.format(Math.round(n || 0));
/**
 * Chance (0 a 1) em texto. Previsão, projeção ou simulação nunca garante nada: acima de 99% vira
 * "mais de 99%" e abaixo de 1%, "menos de 1%". Nunca aparece 100% nem 0%.
 */
export function fmtChance(p) {
  if (!Number.isFinite(p)) return '–';
  if (p > 0.99) return 'mais de 99%';
  if (p < 0.01) return 'menos de 1%';
  return `${Math.round(p * 100).toLocaleString('pt-BR')}%`;
}
/**
 * Dados parados: o TSE não responde há mais de 3 ciclos de consulta (mínimo 90 s). Só vale com a
 * apuração em andamento: antes dela o servidor consulta o TSE a cada 2 min e não há número ao vivo.
 */
export function tseParado(st) {
  if (!st?.ready || st.apuracaoComecaEm) return false;
  const limite = Math.max(90_000, 3 * (st.pollIntervalMs || 15_000));
  return st.tseSemRespostaMs === null || st.tseSemRespostaMs > limite;
}
export const fmtPct =(n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
export const fmtPp = (n, d = 1) => `${n > 0.0005 ? '+' : n < -0.0005 ? '−' : '±'}${fmtPct(Math.abs(n), d)}`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** 2.2 milhões, 135 mil, 912 */
/** " de" depois de milhão/milhões: "1,1 milhão de votos", mas "53 mil votos" e "753 votos". Use logo após curto(n). */
export const deQtd = (n) => (Math.abs(n || 0) >= 1e6 ? ' de' : '');
export function curto(n, casas = 1) {
  const a = Math.abs(n || 0);
  if (a >= 1e6) return `${fmtPct(n / 1e6, casas).replace(/,0$/, '')} ${a >= 2e6 ? 'milhões' : 'milhão'}`;
  if (a >= 1e3) return `${fmtPct(n / 1e3, 0)} mil`;
  return fmtInt(n);
}

/** Aceita "500000", "500.000", "500 mil", "1,5 mi", "2 milhões". */
export function parseVotos(txt) {
  const s = String(txt).toLowerCase().trim().replace(/\s+/g, ' ');
  const m = s.match(/^([\d.,]+)\s*(mil|k|mi|milh(?:ão|ões|ao|oes)?|m)?$/);
  if (!m) return NaN;
  const n = m[2] ? Number(m[1].replace(/\./g, '').replace(',', '.')) : Number(m[1].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Math.round(n * (!m[2] ? 1 : /^(mil|k)$/.test(m[2]) ? 1e3 : 1e6));
}

export function redondo(x) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))));
  const m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

/** "SÃO FRANCISCO" -> "São Francisco" */
export function titulo(s) {
  const menores = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'la', 'los', 'las', 'em']);
  return String(s || '').toLowerCase().split(/(\s+|-)/).map((p, i) => (i && menores.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const iniciais = (nome) => String(nome || '?').replace(/^(escritor|professora?|dr\.?|dra\.?|deputad[oa]|senador[a]?|prefeit[oa]|governador[a]?|capitão|delegad[oa]|pastor[a]?)\s+/i, '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Retrato do candidato: foto do TSE via proxy, com iniciais quando a foto não existir. */
export function avatar(c, { tam = 40, cor = '#666' } = {}) {
  const ini = esc(iniciais(c?.nmu));
  const foto = c?.sq ? `<img src="/api/foto/${esc(c.sq)}" alt="" loading="lazy">` : '';
  return `<span class="avatar" style="--tam:${tam}px;--cor:${cor}" aria-hidden="true"><span>${ini}</span>${foto}</span>`;
}
