// Dados SINTÉTICOS para o modo de teste. Nomes de candidatos são fictícios;
// apenas as siglas partidárias são reais (para exercitar as premissas ideológicas).
// Os totais nacionais do 1º turno de Presidente reproduzem a escala do resultado oficial,
// mas a distribuição por UF é inventada. Nada aqui deve ser lido como resultado real.

export const ELEITORADO = { // milhões, aproximado
  sp: 34.7, mg: 16.3, rj: 12.8, ba: 11.3, rs: 8.6, pr: 8.5, pe: 7.0, ce: 6.8, pa: 6.1, sc: 5.5, ma: 5.0, go: 4.9,
  pb: 3.1, es: 2.9, am: 2.6, rn: 2.6, pi: 2.6, mt: 2.5, al: 2.4, df: 2.2, ms: 2.0, se: 1.7, ro: 1.2, to: 1.1,
  ac: 0.6, ap: 0.55, rr: 0.37, zz: 0.7,
};

// Fração do candidato "A" (PL) entre A+B por UF — sintético, inspirado em padrões regionais.
export const LEAN_A = {
  sp: 0.55, mg: 0.5, rj: 0.56, ba: 0.3, rs: 0.57, pr: 0.63, pe: 0.36, ce: 0.33, pa: 0.48, sc: 0.68, ma: 0.32, go: 0.62,
  pb: 0.37, es: 0.6, am: 0.52, rn: 0.4, pi: 0.27, mt: 0.65, al: 0.42, df: 0.6, ms: 0.62, se: 0.38, ro: 0.7, to: 0.55,
  ac: 0.7, ap: 0.53, rr: 0.75, zz: 0.5,
};

export const PRES_CANDS = [
  { n: '22', nm: 'Candidato Azul', partido: 'PL', share: null },
  { n: '13', nm: 'Candidata Vermelha', partido: 'PT', share: null },
  { n: '70', nm: 'Candidato Laranja', partido: 'AVANTE', share: 0.0289 },
  { n: '28', nm: 'Candidato Cinza', partido: 'MISSÃO', share: 0.0224 },
  { n: '30', nm: 'Candidato Dourado', partido: 'NOVO', share: 0.0027 },
  { n: '80', nm: 'Candidata Lilás', partido: 'UP', share: 0.001 },
  { n: '16', nm: 'Candidato Bordô', partido: 'PSTU', share: 0.0004 },
  { n: '27', nm: 'Candidata Turquesa', partido: 'DC', share: 0.0003 },
  { n: '21', nm: 'Candidato Carmim', partido: 'PCB', share: 0.0002 },
];
export const PRES_TOTAL_A = 56104503; // escala do 1º turno oficial
export const PRES_TOTAL_B = 53879538;

export const GOV_RUNOFF = {
  ac: [{ n: '11', nm: 'Governadora Alfa', partido: 'PP', p: 0.46 }, { n: '10', nm: 'Senador Beta', partido: 'REPUBLICANOS', p: 0.41 }],
  am: [{ n: '55', nm: 'Senador Gama', partido: 'PSD', p: 0.4966 }, { n: '22', nm: 'Professora Delta', partido: 'PL', p: 0.3406 }],
  df: [{ n: '11', nm: 'Governadora Épsilon', partido: 'PP', p: 0.4993 }, { n: '13', nm: 'Deputado Zeta', partido: 'PT', p: 0.3447 }],
  es: [{ n: '10', nm: 'Prefeito Eta', partido: 'REPUBLICANOS', p: 0.42 }, { n: '15', nm: 'Vice Teta', partido: 'MDB', p: 0.38 }],
  rj: [{ n: '22', nm: 'Deputado Iota', partido: 'PL', p: 0.44 }, { n: '55', nm: 'Prefeito Capa', partido: 'PSD', p: 0.43 }],
  rn: [{ n: '44', nm: 'Prefeito Lambda', partido: 'UNIÃO', p: 0.3677 }, { n: '13', nm: 'Deputado Mi', partido: 'PT', p: 0.3625 }],
  to: [{ n: '44', nm: 'Senadora Ni', partido: 'UNIÃO', p: 0.4976 }, { n: '45', nm: 'Deputado Csi', partido: 'PSDB', p: 0.3227 }],
};

export const EXTRA_PARTIES = ['PSB', 'NOVO', 'PSOL', 'PDT', 'MDB', 'PSD', 'UNIÃO', 'REPUBLICANOS', 'PP', 'PT', 'PL'];
const NUM = { PSB: '40', NOVO: '30', PSOL: '50', PDT: '12', MDB: '15', PSD: '55', 'UNIÃO': '44', REPUBLICANOS: '10', PP: '11', PT: '13', PL: '22', PSDB: '45', AVANTE: '70' };
export const partyNumber = (sg) => NUM[sg] || '99';

const GREEK = ['Ômega', 'Rho', 'Sigma', 'Tau', 'Ípsilon', 'Fi', 'Qui', 'Psi', 'Pi', 'Ômicron'];

// Gerador determinístico
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lista de candidatos ao governo (1º turno) de uma UF. */
export function govCands(uf, r) {
  const runoff = GOV_RUNOFF[uf];
  if (runoff) {
    const used = new Set(runoff.map((c) => c.partido));
    const rest = 1 - runoff[0].p - runoff[1].p;
    const extra = EXTRA_PARTIES.filter((p) => !used.has(p)).slice(0, 3);
    const w = [0.55, 0.3, 0.15];
    return [
      ...runoff.map((c) => ({ ...c, st: '2º turno', e: 's' })),
      ...extra.map((p, i) => ({ n: partyNumber(p), nm: `Candidato ${GREEK[i]} ${uf.toUpperCase()}`, partido: p, p: rest * w[i], st: 'Não eleito', e: 'n' })),
    ];
  }
  const parties = [...EXTRA_PARTIES].sort(() => r() - 0.5).slice(0, 4);
  const win = 0.52 + r() * 0.2;
  const second = (1 - win) * (0.6 + r() * 0.2);
  const rest = 1 - win - second;
  return [
    { n: partyNumber(parties[0]), nm: `Governador ${GREEK[0]} ${uf.toUpperCase()}`, partido: parties[0], p: win, st: 'Eleito', e: 's' },
    { n: partyNumber(parties[1]), nm: `Candidato ${GREEK[1]} ${uf.toUpperCase()}`, partido: parties[1], p: second, st: 'Não eleito', e: 'n' },
    { n: partyNumber(parties[2]), nm: `Candidato ${GREEK[2]} ${uf.toUpperCase()}`, partido: parties[2], p: rest * 0.7, st: 'Não eleito', e: 'n' },
    { n: partyNumber(parties[3]), nm: `Candidato ${GREEK[3]} ${uf.toUpperCase()}`, partido: parties[3], p: rest * 0.3, st: 'Não eleito', e: 'n' },
  ];
}

export function senCands(uf, r) {
  const parties = [...EXTRA_PARTIES].sort(() => r() - 0.5).slice(0, 5);
  const ps = [0.3, 0.26, 0.2, 0.14, 0.1];
  return parties.map((p, i) => ({
    n: `${partyNumber(p)}${i}`, nm: `Senador(a) ${GREEK[i + 4] || 'Nu'} ${uf.toUpperCase()}`, partido: p, p: ps[i],
    st: i < 2 ? 'Eleito' : 'Não eleito', e: i < 2 ? 's' : 'n',
  }));
}

// Localidades do exterior (nomes reais de cidades; pesos e votos SINTÉTICOS).
// d: inclinação sintética a favor do candidato A (positivo) ou B (negativo).
export const EXTERIOR_CIDADES = [
  ['29017', 'LISBOA', 0.075, -0.12], ['29025', 'PORTO', 0.035, -0.06], ['29033', 'MIAMI', 0.07, 0.2], ['29041', 'BOSTON', 0.065, 0.12],
  ['29050', 'NOVA YORK', 0.06, 0.02], ['29068', 'ORLANDO', 0.045, 0.22], ['29076', 'LONDRES', 0.055, -0.08], ['29084', 'TÓQUIO', 0.05, 0.18],
  ['29092', 'NAGOIA', 0.03, 0.2], ['29106', 'HAMAMATSU', 0.025, 0.21], ['29114', 'PARIS', 0.035, -0.2], ['29122', 'MADRI', 0.03, -0.1],
  ['29130', 'BARCELONA', 0.025, -0.14], ['29149', 'ROMA', 0.03, 0.03], ['29157', 'MILÃO', 0.025, 0.06], ['29165', 'GENEBRA', 0.025, -0.05],
  ['29173', 'ZURIQUE', 0.02, 0.0], ['29181', 'BERLIM', 0.02, -0.22], ['29190', 'MUNIQUE', 0.02, -0.04], ['29203', 'TORONTO', 0.03, 0.04],
  ['29211', 'MONTREAL', 0.015, -0.1], ['29220', 'BUENOS AIRES', 0.025, -0.15], ['29238', 'ASSUNÇÃO', 0.02, 0.15], ['29246', 'SANTIAGO', 0.015, -0.12],
  ['29254', 'MONTEVIDÉU', 0.01, -0.18], ['29262', 'SYDNEY', 0.02, 0.05], ['29270', 'DUBLIN', 0.025, -0.02], ['29289', 'BRUXELAS', 0.015, -0.1],
  ['29297', 'AMSTERDÃ', 0.015, -0.12], ['29300', 'FRANKFURT', 0.015, -0.06], ['29319', 'ATLANTA', 0.02, 0.18], ['29327', 'HOUSTON', 0.02, 0.2],
  ['29335', 'LOS ANGELES', 0.025, 0.0], ['29343', 'SÃO FRANCISCO', 0.015, -0.1], ['29351', 'WASHINGTON', 0.015, -0.04], ['29360', 'CHICAGO', 0.015, 0.08],
].map(([cd, nm, w, d]) => ({ cd, nm, w, d }));
