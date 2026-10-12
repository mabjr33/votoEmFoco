// Previsões para o 2º turno presidencial de 2026, a partir do histórico em historico.js.
// Tudo aqui é ESTIMATIVA DE MODELO: combina resultados oficiais e pesquisas registradas já
// divulgadas, mas não é pesquisa eleitoral. Cada função devolve também os números que usou,
// para a interface mostrar de onde veio cada valor.
//
// Convenção: "partilha" = % de um candidato só entre os dois finalistas (equivale aos votos
// válidos no 2º turno). Nos modelos, o número principal é a partilha do LÍDER do 1º turno
// de 2026 (Flávio Bolsonaro).

import {
  ELEICOES, PESQUISAS_2T_FINAIS, PESQUISAS_1T_FINAIS, PESQUISAS_2026_2T, TRANSFERENCIA_2026,
} from './historico.js';

export const partilha = (a, b) => (a + b > 0 ? (100 * a) / (a + b) : 50);
export const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export function desvio(xs) {
  if (xs.length < 2) return 0;
  const m = media(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
export function mediana(xs) {
  const v = [...xs].sort((a, b) => a - b);
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
}

// Função de distribuição da normal padrão (Abramowitz e Stegun 7.1.26, erro < 1,5e-7).
export function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const Z80 = 1.2816;
const Z95 = 1.96;

const r2 = (x) => Math.round(x * 100) / 100;
const eleicao = (ano) => ELEICOES.find((e) => e.ano === ano);
const comSegundoTurno = () => ELEICOES.filter((e) => e.lider && e.lider.t2 != null);

/** Partilha real do candidato do PT entre os dois primeiros, no turno pedido. */
function partilhaPT(ano, turno) {
  const e = eleicao(ano);
  const k = turno === 2 ? 't2' : 't1';
  const [pt, outro] = e.lider.partido === 'PT' ? [e.lider, e.segundo] : [e.segundo, e.lider];
  return partilha(pt[k], outro[k]);
}

/**
 * Erro das últimas pesquisas: partilha do PT na pesquisa menos a partilha real.
 * Positivo = a pesquisa superestimou o PT.
 */
export function errosPesquisas(turno = 2) {
  const lista = turno === 2 ? PESQUISAS_2T_FINAIS : PESQUISAS_1T_FINAIS;
  return lista
    .filter((p) => eleicao(p.ano)?.lider?.[turno === 2 ? 't2' : 't1'] != null)
    .map((p) => {
      const prev = partilha(p.pt, p.outro);
      const real = partilhaPT(p.ano, turno);
      return { ...p, turno, prev: r2(prev), real: r2(real), erro: r2(prev - real) };
    });
}

/** Resumo do erro por ano (média das pesquisas). */
export function erroPorAno(erros) {
  const anos = [...new Set(erros.map((e) => e.ano))];
  return anos.map((ano) => {
    const xs = erros.filter((e) => e.ano === ano).map((e) => e.erro);
    return { ano, n: xs.length, media: r2(media(xs)), min: Math.min(...xs), max: Math.max(...xs) };
  });
}

/** Fatos do 1º turno de 2026 em comparação com as eleições anteriores. */
export function comparativo1T() {
  const linhas = comSegundoTurno().concat(eleicao(2026)).map((e) => ({
    ano: e.ano,
    lider: e.lider.nome,
    segundo: e.segundo.nome,
    margem1: r2(e.lider.t1 - e.segundo.t1),
    somaDois: r2(e.lider.t1 + e.segundo.t1),
    partilha1: r2(partilha(e.lider.t1, e.segundo.t1)),
    t2: e.lider.t2,
    venceuLider: e.lider.t2 == null ? null : e.lider.t2 > 50,
    incumbente: e.incumbente,
  }));
  const passadas = linhas.filter((l) => l.t2 != null);
  const atual = linhas.find((l) => l.ano === 2026);
  return {
    linhas,
    lideresVenceram: passadas.filter((l) => l.venceuLider).length,
    disputas: passadas.length,
    menorMargemAnterior: Math.min(...passadas.map((l) => l.margem1)),
    margem2026: atual.margem1,
    maiorSomaAnterior: Math.max(...passadas.map((l) => l.somaDois)),
    soma2026: atual.somaDois,
  };
}

// Datas das pesquisas de 2026: 'AAAA-MM-DD' quando vêm do cadastro do TSE; senão, o último
// 'd/m' do período de campo ('3–8/10' -> 8/10) ou da divulgação.
const iso = (d, m) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function ultimoDiaMes(s) {
  const ms = [...String(s || '').matchAll(/(\d{1,2})(?:\/(\d{1,2}))?/g)];
  const mes = [...ms].reverse().find((m) => m[2])?.[2];
  const ult = ms.at(-1);
  return ult && mes ? iso(ult[1], ult[2] || mes) : null;
}
/** Último dia de campo. */
export const fimCampo = (p) => p.fim || ultimoDiaMes(p.campo);
/** Dia em que a pesquisa ficou pública. */
export const dataDivulgacao = (p) => ultimoDiaMes(p.divulgacao) || fimCampo(p);
const chaveInstituto = (p) => String(p.instituto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Só a pesquisa mais recente de cada instituto (pelo fim do campo). Assim quem divulga toda
 * semana não pesa mais na média do que quem divulga uma vez. Vale igual para todos os institutos.
 */
export function maisRecentePorInstituto(pesquisas) {
  const por = new Map();
  for (const p of pesquisas) {
    const k = chaveInstituto(p), atual = por.get(k);
    if (!atual || (fimCampo(p) || '') > (fimCampo(atual) || '')) por.set(k, p);
  }
  return pesquisas.filter((p) => por.get(chaveInstituto(p)) === p);
}

/**
 * Modelo P — média das pesquisas do 2º turno feitas após o 1º turno, corrigida pelo erro médio
 * histórico das últimas pesquisas de 2º turno (2010, 2018, 2022).
 * Incerteza: dispersão desse erro + 1,5 pp pela distância até a eleição (premissa).
 */
export function modeloPesquisas({ pesquisas = PESQUISAS_2026_2T, distanciaPp = 1.5 } = {}) {
  const usadas = maisRecentePorInstituto(pesquisas.filter((p) => p.depois1T)).map((p) => ({
    instituto: p.instituto,
    campo: p.campo,
    registro: p.registro,
    flavio: r2(p.flavioValido ?? partilha(p.flavio, p.lula)),
  }));
  const bruto = media(usadas.map((p) => p.flavio));
  const erros = errosPesquisas(2).map((e) => e.erro);
  const vies = media(erros); // + = PT superestimado; Flávio é o adversário do PT
  const centro = bruto + vies;
  const sd = Math.sqrt(desvio(erros) ** 2 + distanciaPp ** 2);
  return {
    id: 'pesquisas',
    nome: 'Pesquisas corrigidas pelo histórico',
    centro: r2(centro), sd: r2(sd),
    detalhe: { usadas, bruto: r2(bruto), vies: r2(vies), nErros: erros.length, sdErro: r2(desvio(erros)), distanciaPp },
  };
}

/**
 * Modelo H — padrão histórico 1º → 2º turno. Para cada eleição com 2º turno:
 * k = (partilha do líder no 2º turno − 50) / (partilha do líder entre os dois no 1º turno − 50).
 * Aplica a mediana de k a 2026. Incerteza: desvio dos resíduos dessa regra nas eleições passadas.
 */
export function modeloHistorico() {
  const pontos = comSegundoTurno().map((e) => {
    const s1 = partilha(e.lider.t1, e.segundo.t1);
    const s2 = partilha(e.lider.t2, e.segundo.t2);
    return { ano: e.ano, lider: e.lider.nome, s1: r2(s1), s2: r2(s2), k: (s2 - 50) / (s1 - 50) };
  });
  const k = mediana(pontos.map((p) => p.k));
  const res = pontos.map((p) => p.s2 - (50 + k * (p.s1 - 50)));
  const sd = Math.sqrt(res.reduce((s, x) => s + x * x, 0) / (res.length - 1));
  const e26 = eleicao(2026);
  const s1 = partilha(e26.lider.t1, e26.segundo.t1);
  return {
    id: 'historico',
    nome: 'Padrão histórico do 1º para o 2º turno',
    centro: r2(50 + k * (s1 - 50)), sd: r2(sd),
    detalhe: { pontos: pontos.map((p) => ({ ...p, k: r2(p.k) })), k: r2(k), s1: r2(s1), residuos: res.map(r2) },
  };
}

/**
 * Modelo T — transferência declarada: soma aos votos do 1º turno a parte dos eleitores dos
 * eliminados que diz votar em cada finalista (Datafolha). Supõe que os eleitores de Flávio e Lula
 * repetem o voto. Incerteza de 2 pp é premissa (não há histórico de acerto dessa pergunta).
 */
export function modeloTransferencia({ transf = TRANSFERENCIA_2026, sd = 2 } = {}) {
  const e = eleicao(2026);
  const outros = 100 - e.lider.t1 - e.segundo.t1;
  const f = e.lider.t1 + transf.flavio * outros;
  const l = e.segundo.t1 + transf.lula * outros;
  return {
    id: 'transferencia',
    nome: 'Transferência declarada dos eliminados',
    centro: r2(partilha(f, l)), sd,
    detalhe: { outros: r2(outros), flavio: r2(f), lula: r2(l), transf },
  };
}

/** Faixas de margem (líder − segundo, em pp de votos válidos) para uma normal na partilha. */
export function faixasMargem(centro, sd) {
  // margem = 2 × partilha − 100
  const p = (m) => normCdf(((50 + m / 2) - centro) / sd);
  const cortes = [
    { rotulo: 'Flávio por mais de 10 pp', de: 10, ate: Infinity },
    { rotulo: 'Flávio por 5 a 10 pp', de: 5, ate: 10 },
    { rotulo: 'Flávio por até 5 pp', de: 0, ate: 5 },
    { rotulo: 'Lula por até 5 pp', de: -5, ate: 0 },
    { rotulo: 'Lula por 5 a 10 pp', de: -10, ate: -5 },
    { rotulo: 'Lula por mais de 10 pp', de: -Infinity, ate: -10 },
  ];
  return cortes.map((c) => ({
    ...c,
    prob: (c.ate === Infinity ? 1 : p(c.ate)) - (c.de === -Infinity ? 0 : p(c.de)),
  }));
}

/**
 * Combinação dos modelos: média ponderada pelo inverso da variância. Como os modelos usam
 * dados parecidos (não são independentes), a incerteza combinada é a média ponderada dos
 * desvios, e não a fórmula que os trata como independentes. É uma escolha conservadora.
 */
export function combinar(modelos) {
  const pesos = modelos.map((m) => 1 / (m.sd * m.sd));
  const soma = pesos.reduce((s, w) => s + w, 0);
  const centro = modelos.reduce((s, m, i) => s + m.centro * pesos[i], 0) / soma;
  const sd = modelos.reduce((s, m, i) => s + m.sd * pesos[i], 0) / soma;
  const prob = normCdf((centro - 50) / sd);
  return {
    centro: r2(centro),
    sd: r2(sd),
    probFlavio: prob,
    probLula: 1 - prob,
    int80: [r2(centro - Z80 * sd), r2(centro + Z80 * sd)],
    int95: [r2(centro - Z95 * sd), r2(centro + Z95 * sd)],
    pesos: modelos.map((m, i) => ({ id: m.id, peso: pesos[i] / soma })),
    faixas: faixasMargem(centro, sd),
  };
}

/**
 * Cenários de erro: o que a média das pesquisas pós-1º turno vira se elas errarem
 * como em eleições passadas. Não são previsões, são "e se".
 */
export function cenariosErro({ pesquisas = PESQUISAS_2026_2T } = {}) {
  const bruto = modeloPesquisas({ pesquisas }).detalhe.bruto;
  const e2 = errosPesquisas(2);
  const e1 = errosPesquisas(1);
  const porAno2 = erroPorAno(e2);
  const pior = e2.reduce((m, e) => (e.erro < m.erro ? e : m));
  const erro1T2026 = media(e1.filter((e) => e.ano === 2026).map((e) => e.erro));
  const lista = [
    { id: 'sem', rotulo: 'Pesquisas exatas', erro: 0 },
    ...porAno2.map((a) => ({ id: `2t${a.ano}`, rotulo: `Erro médio do 2º turno de ${a.ano}`, erro: a.media })),
    { id: 'max2t', rotulo: `Maior subestimação do PT numa pesquisa de 2º turno (${pior.instituto}, ${pior.ano})`, erro: pior.erro },
    { id: '1t2026', rotulo: 'Erro médio do 1º turno de 2026', erro: r2(erro1T2026) },
  ];
  return lista.map((c) => ({ ...c, flavio: r2(bruto + c.erro), lula: r2(100 - bruto - c.erro) }));
}

/**
 * Abstenção no 2º turno: variação média entre os turnos (2002–2022) aplicada aos 21,08% do 1º turno
 * de 2026, com a menor e a maior variação como faixa.
 */
export function previsaoAbstencao() {
  const pares = ELEICOES.filter((e) => e.abst1 != null && e.abst2 != null)
    .map((e) => ({ ano: e.ano, abst1: e.abst1, abst2: e.abst2, delta: r2(e.abst2 - e.abst1) }));
  const deltas = pares.map((p) => p.delta);
  const base = eleicao(2026).abst1;
  return {
    pares,
    base,
    deltaMedio: r2(media(deltas)),
    centro: r2(base + media(deltas)),
    faixa: [r2(base + Math.min(...deltas)), r2(base + Math.max(...deltas))],
    serie: ELEICOES.filter((e) => e.abst1 != null || e.abst2 != null)
      .map((e) => ({ ano: e.ano, abst1: e.abst1 ?? null, abst2: e.abst2 ?? null })),
  };
}

/**
 * A previsão combinada dia a dia, recalculada só com as pesquisas que já eram públicas em cada dia.
 * Começa no dia da primeira pesquisa pós-1º turno e vai até `ate` ('AAAA-MM-DD').
 */
export function serieDiaria({ pesquisas = PESQUISAS_2026_2T, ate } = {}) {
  const pos = pesquisas.filter((p) => p.depois1T && dataDivulgacao(p));
  if (!pos.length) return [];
  const datas = pos.map(dataDivulgacao).sort();
  const fim = ate && ate > datas.at(-1) ? ate : datas.at(-1);
  const fixos = [modeloHistorico(), modeloTransferencia()];
  const serie = [];
  for (let d = new Date(`${datas[0]}T12:00:00Z`); d.toISOString().slice(0, 10) <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    const dia = d.toISOString().slice(0, 10);
    const ate1 = pesquisas.filter((p) => !p.depois1T || (dataDivulgacao(p) && dataDivulgacao(p) <= dia));
    const mp = modeloPesquisas({ pesquisas: ate1 });
    const c = combinar([mp, ...fixos]);
    serie.push({ dia, centro: c.centro, int80: c.int80, probFlavio: c.probFlavio, pesquisas: mp.detalhe.usadas.length });
  }
  return serie;
}

/** Todas as previsões nacionais de uma vez. pesquisas: as fixas do histórico mais as aprovadas no painel. */
export function previsoes({ pesquisas = PESQUISAS_2026_2T } = {}) {
  const modelos = [modeloPesquisas({ pesquisas }), modeloHistorico(), modeloTransferencia()];
  return {
    modelos,
    combinado: combinar(modelos),
    cenarios: cenariosErro({ pesquisas }),
    abstencao: previsaoAbstencao(),
    comparativo: comparativo1T(),
    erros2T: errosPesquisas(2),
    erros1T: errosPesquisas(1),
  };
}
