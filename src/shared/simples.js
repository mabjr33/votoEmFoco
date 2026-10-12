// Simulador simples: "para onde vão os eleitores". Parte dos votos oficiais do 1º turno e pergunta,
// para cada grupo de eleitores, quantos votam em cada finalista no 2º turno.
// Grupos: quem votou em A; quem votou em B; quem votou nos demais candidatos; quem não escolheu
// ninguém (absteve-se, votou branco ou nulo).

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

/**
 * Os grupos a partir do resumo do 1º turno (formato do TSE normalizado: cands[].vap, eleitores.te,
 * votos.vv). nA, nB: números dos finalistas.
 */
export function gruposDoPrimeiroTurno(resumo, nA, nB) {
  const votos = (n) => resumo.cands.find((c) => c.n === n)?.vap || 0;
  const a = votos(nA), b = votos(nB);
  const validos = resumo.votos?.vv || resumo.cands.reduce((s, c) => s + c.vap, 0);
  const demais = Math.max(0, validos - a - b);
  // Quem não escolheu ninguém: eleitorado menos os votos válidos (abstenção + brancos + nulos)
  const ninguem = Math.max(0, (resumo.eleitores?.te || validos) - validos);
  return { a, b, demais, ninguem, eleitorado: resumo.eleitores?.te || null };
}

/**
 * opcoes (frações de 0 a 1):
 *   repeteA, repeteB: eleitores de cada finalista que votam nele de novo (o resto não vota em ninguém)
 *   demaisEscolhem: dos eleitores dos demais, quantos escolhem um dos dois
 *   demaisParaA:    desses, quantos vão para A
 *   ninguemVota:    de quem não escolheu ninguém no 1º turno, quantos votam agora num dos dois
 *   ninguemParaA:   desses, quantos vão para A
 */
export function cenarioSimples(g, o) {
  const repA = clamp01(o.repeteA), repB = clamp01(o.repeteB);
  const dE = clamp01(o.demaisEscolhem), dA = clamp01(o.demaisParaA);
  const nV = clamp01(o.ninguemVota), nA = clamp01(o.ninguemParaA);
  const deA = { primeiro: g.a * repA, demais: g.demais * dE * dA, ninguem: g.ninguem * nV * nA };
  const deB = { primeiro: g.b * repB, demais: g.demais * dE * (1 - dA), ninguem: g.ninguem * nV * (1 - nA) };
  const A = deA.primeiro + deA.demais + deA.ninguem;
  const B = deB.primeiro + deB.demais + deB.ninguem;
  const V = A + B;
  const pA = V ? (100 * A) / V : 50;
  const empate = Math.abs(A - B) < 1;
  return { A, B, validos: V, pA, pB: V ? 100 - pA : 50, margem: A - B, vencedor: empate ? null : A > B ? 'A' : 'B', deA, deB };
}

/**
 * Converte uma leitura de transferência (frações para A e para B, o resto é branco/nulo/abstenção)
 * nos dois controles do simulador: quantos escolhem um dos dois e, desses, quantos vão para A.
 */
export function controlesDeTransferencia({ paraA, paraB }) {
  const escolhem = clamp01(paraA + paraB);
  return { demaisEscolhem: escolhem, demaisParaA: escolhem ? clamp01(paraA / escolhem) : 0.5 };
}
