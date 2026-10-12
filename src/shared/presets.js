// Premissas iniciais do simulador. TODAS são editáveis na interface.
// O posicionamento ideológico dos partidos é uma aproximação (escala −1 esquerda … +1 direita)
// usada apenas para sugerir para onde vão os votos de candidatos eliminados.
// Ajuste conforme pesquisas de 2º turno, apoios declarados e conhecimento local.

export const PARTY_LEAN = {
  PSTU: -1, PCB: -1, PCO: -1, UP: -1, PSOL: -0.9, PT: -0.8, PCdoB: -0.8, REDE: -0.6, PV: -0.5,
  PSB: -0.45, PDT: -0.45, CIDADANIA: -0.1, SOLIDARIEDADE: 0, MDB: 0.1, PSDB: 0.2, PSD: 0.2,
  AVANTE: 0.25, PMB: 0.3, AGIR: 0.3, MOBILIZA: 0.3, DEMOCRATA: 0.3, PODE: 0.3, PODEMOS: 0.3,
  PRD: 0.45, UNIÃO: 0.5, UNIAO: 0.5, DC: 0.6, PP: 0.6, REPUBLICANOS: 0.6, NOVO: 0.7, MISSÃO: 0.7,
  MISSAO: 0.7, PRTB: 0.8, PL: 0.9,
};

export function leanOf(sigla) {
  if (!sigla) return null;
  const k = String(sigla).toUpperCase().replace(/\s+/g, '');
  return PARTY_LEAN[k] ?? PARTY_LEAN[sigla] ?? null;
}

/**
 * Fluxo sugerido para eleitores de um candidato eliminado, por proximidade ideológica.
 * engaj: fração que vota num finalista; o resto se divide entre branco/nulo e abstenção.
 */
export function suggestedFlow(elimParty, partyA, partyB, { engaj = 0.7, k = 1.2 } = {}) {
  const L = leanOf(elimParty), LA = leanOf(partyA), LB = leanOf(partyB);
  let sA = 0.5;
  if (L !== null && LA !== null && LB !== null) {
    const wA = Math.exp(-k * Math.abs(L - LA));
    const wB = Math.exp(-k * Math.abs(L - LB));
    sA = wA / (wA + wB);
  }
  const r = (x) => Math.round(x * 1000) / 1000;
  const rest = 1 - engaj;
  return { A: r(engaj * sA), B: r(engaj * (1 - sA)), bn: r(rest / 2), abst: r(rest / 2) };
}

/** Rótulos amigáveis para a origem de votos nos ajustes manuais. */
export const ORIGENS = {
  adversario: 'Do adversário (troca direta)',
  brancoNulo: 'De quem votaria branco/nulo',
  abstencao: 'De quem se absteria (novos votantes)',
};
