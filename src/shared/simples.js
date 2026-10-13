// Simulador simples: "para onde vão os eleitores". Parte dos votos oficiais do 1º turno e pergunta,
// para cada grupo de eleitores, quantos votam em cada finalista no 2º turno.
// Grupos: quem votou em A; quem votou em B; quem votou nos demais candidatos; quem não escolheu
// ninguém (absteve-se, votou branco ou nulo).

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

/**
 * Os grupos a partir do resumo do 1º turno (formato do TSE normalizado: cands[].vap, eleitores.te,
 * votos.vv). nA, nB: números dos finalistas. separados: os eliminados com pelo menos minPct% dos
 * votos válidos (até max), para simular um por um; os menores ficam juntos em "os demais".
 */
export function gruposDoPrimeiroTurno(resumo, nA, nB, { minPct = 0.2, max = 6 } = {}) {
  const votos = (n) => resumo.cands.find((c) => c.n === n)?.vap || 0;
  const a = votos(nA), b = votos(nB);
  const validos = resumo.votos?.vv || resumo.cands.reduce((s, c) => s + c.vap, 0);
  const demais = Math.max(0, validos - a - b);
  // Quem não escolheu ninguém: eleitorado menos os votos válidos (abstenção + brancos + nulos)
  const ninguem = Math.max(0, (resumo.eleitores?.te || validos) - validos);
  const separados = resumo.cands.filter((c) => c.n !== nA && c.n !== nB && c.vap > 0 && validos && (100 * c.vap) / validos >= minPct)
    .sort((x, y) => y.vap - x.vap).slice(0, max)
    .map((c) => ({ n: c.n, nome: c.nmu, partido: c.partido, votos: c.vap, pct: (100 * c.vap) / validos }));
  return { a, b, demais, ninguem, eleitorado: resumo.eleitores?.te || null, separados };
}

/**
 * opcoes (frações de 0 a 1):
 *   repeteA, repeteB: eleitores de cada finalista que votam nele de novo (o resto não vota em ninguém)
 *   demaisEscolhem: dos eleitores dos demais, quantos escolhem um dos dois
 *   demaisParaA:    desses, quantos vão para A
 *   ninguemVota:    de quem não escolheu ninguém no 1º turno, quantos votam agora num dos dois
 *   ninguemParaA:   desses, quantos vão para A
 *   separado:       true = cada eliminado de g.separados com seus próprios controles
 *   porCandidato:   { [número]: { escolhem, paraA } } (sem entrada, vale o controle geral)
 * No modo separado, demaisEscolhem/demaisParaA valem para "os demais" (os eliminados menores).
 */
export function cenarioSimples(g, o) {
  const repA = clamp01(o.repeteA), repB = clamp01(o.repeteB);
  const dE = clamp01(o.demaisEscolhem), dA = clamp01(o.demaisParaA);
  const nV = clamp01(o.ninguemVota), nA = clamp01(o.ninguemParaA);
  let demaisA, demaisB, porCandidato = null, resto = null;
  if (o.separado && g.separados?.length) {
    porCandidato = g.separados.map((c) => {
      const p = o.porCandidato?.[c.n];
      const e = clamp01(p ? p.escolhem : dE), a = clamp01(p ? p.paraA : dA);
      return { n: c.n, nome: c.nome, votos: c.votos, paraA: c.votos * e * a, paraB: c.votos * e * (1 - a) };
    });
    const votosResto = Math.max(0, g.demais - g.separados.reduce((s, c) => s + c.votos, 0));
    resto = { votos: votosResto, paraA: votosResto * dE * dA, paraB: votosResto * dE * (1 - dA) };
    demaisA = porCandidato.reduce((s, c) => s + c.paraA, 0) + resto.paraA;
    demaisB = porCandidato.reduce((s, c) => s + c.paraB, 0) + resto.paraB;
  } else {
    demaisA = g.demais * dE * dA;
    demaisB = g.demais * dE * (1 - dA);
  }
  const deA = { primeiro: g.a * repA, demais: demaisA, ninguem: g.ninguem * nV * nA };
  const deB = { primeiro: g.b * repB, demais: demaisB, ninguem: g.ninguem * nV * (1 - nA) };
  const A = deA.primeiro + deA.demais + deA.ninguem;
  const B = deB.primeiro + deB.demais + deB.ninguem;
  const V = A + B;
  const pA = V ? (100 * A) / V : 50;
  const empate = Math.abs(A - B) < 1;
  return { A, B, validos: V, pA, pB: V ? 100 - pA : 50, margem: A - B, vencedor: empate ? null : A > B ? 'A' : 'B', deA, deB, porCandidato, resto };
}

/**
 * Converte uma leitura de transferência (frações para A e para B, o resto é branco/nulo/abstenção)
 * nos dois controles do simulador: quantos escolhem um dos dois e, desses, quantos vão para A.
 */
export function controlesDeTransferencia({ paraA, paraB }) {
  const escolhem = clamp01(paraA + paraB);
  return { demaisEscolhem: escolhem, demaisParaA: escolhem ? clamp01(paraA / escolhem) : 0.5 };
}
