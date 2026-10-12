import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partilha, normCdf, mediana, errosPesquisas, erroPorAno, modeloPesquisas, modeloHistorico,
  modeloTransferencia, combinar, faixasMargem, previsaoAbstencao, comparativo1T, cenariosErro,
} from '../src/shared/previsao.js';

const perto = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('auxiliares: partilha, mediana e normal', () => {
  perto(partilha(47.03, 45.16), 51.01);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
  perto(normCdf(0), 0.5, 1e-6);
  perto(normCdf(1.96), 0.975, 1e-3);
  perto(normCdf(-1.2816), 0.1, 1e-3);
});

test('erro das pesquisas finais de 2º turno: conta feita à mão', () => {
  const e = errosPesquisas(2);
  assert.equal(e.length, 13);
  // Datafolha 2022: 49/45 → 52,13% para Lula; resultado 50,9% → erro +1,23
  perto(e.find((x) => x.ano === 2022 && x.instituto === 'Datafolha').erro, 1.23);
  // CNT/MDA 2018: 37/49 → 43,02% para Haddad; resultado 44,87% → erro −1,85
  perto(e.find((x) => x.ano === 2018 && x.instituto === 'CNT/MDA').erro, -1.85);
  const anos = erroPorAno(e);
  assert.deepEqual(anos.map((a) => a.ano), [2010, 2018, 2022]);
});

test('erro do 1º turno de 2026: pesquisas superestimaram Lula', () => {
  const e = errosPesquisas(1).filter((x) => x.ano === 2026);
  assert.equal(e.length, 3);
  for (const x of e) assert.ok(x.erro > 0);
  perto(e[0].real, 48.99);
});

test('modelo de pesquisas: média pós-1º turno + viés histórico', () => {
  const m = modeloPesquisas();
  // (53,1 + 52,7 + 53 + 52 + 52,8 + 49,14) / 6, a mais recente de cada instituto
  perto(m.detalhe.bruto, 52.12);
  perto(m.detalhe.vies, 0.83);
  perto(m.centro, 52.95);
  assert.equal(m.detalhe.usadas.length, 6);
  assert.ok(m.sd > 1.5 && m.sd < 2.5);
});

test('modelo histórico: mediana de k e o líder vence', () => {
  const m = modeloHistorico();
  perto(m.detalhe.k, 0.46);
  assert.ok(m.centro > 50 && m.centro < 51);
  assert.ok(m.sd > 3);
});

test('modelo de transferência: três leituras sobre os 7,81% dos eliminados', () => {
  const m = modeloTransferencia();
  perto(m.detalhe.outros, 7.81);
  const [df, ip, perfil] = m.detalhe.leituras;
  // Datafolha: 47,03 + 0,46 × 7,81 contra 45,16 + 0,32 × 7,81
  assert.equal(df.id, 'datafolha');
  perto(df.flavio, 50.62); perto(df.lula, 47.66); perto(df.centro, 51.51);
  // Ipespe por candidato: Cury 50/29, Renan 36/20, Caiado 56/15; Zema e os nanicos seguem o Datafolha
  assert.equal(ip.id, 'ipespe');
  perto(ip.flavio, 50.73); perto(ip.lula, 46.93); perto(ip.centro, 51.95);
  assert.ok(ip.cobertura > 93 && ip.cobertura < 94);
  // Perfil dos partidos: regra do simulador (sem pesquisa); todo mundo coberto
  assert.equal(perfil.id, 'perfil');
  assert.equal(perfil.cobertura, 100);
  perto(m.centro, (df.centro + ip.centro + perfil.centro) / 3);
  // Leituras parecidas: a incerteza fica perto dos 2 pp de premissa
  assert.ok(m.sd >= 2 && m.sd < 2.2);
});

test('modelo de transferência: leituras que discordam aumentam a incerteza', () => {
  const opostas = [
    { id: 'a', instituto: 'A', geral: { flavio: 0.8, lula: 0.1 } },
    { id: 'b', instituto: 'B', geral: { flavio: 0.1, lula: 0.8 } },
  ];
  assert.ok(modeloTransferencia({ leituras: opostas }).sd > 3);
});

test('combinação: pesos somam 1, probabilidades fecham, faixas somam 100%', () => {
  const c = combinar([modeloPesquisas(), modeloHistorico(), modeloTransferencia()]);
  perto(c.pesos.reduce((s, p) => s + p.peso, 0), 1, 1e-9);
  perto(c.probFlavio + c.probLula, 1, 1e-9);
  assert.ok(c.int80[0] < c.centro && c.centro < c.int80[1]);
  assert.ok(c.int95[0] < c.int80[0]);
  perto(c.faixas.reduce((s, f) => s + f.prob, 0), 1, 1e-6);
  // Com modelos iguais, o centro é o deles
  const igual = combinar([{ id: 'a', centro: 55, sd: 2 }, { id: 'b', centro: 55, sd: 4 }]);
  perto(igual.centro, 55);
  // Em 50% exatos, chance de 50%
  perto(combinar([{ id: 'a', centro: 50, sd: 2 }]).probFlavio, 0.5, 1e-6);
  perto(faixasMargem(50, 2).find((f) => f.de === 0).prob, faixasMargem(50, 2).find((f) => f.ate === 0).prob, 1e-6);
});

test('abstenção: variação média entre turnos aplicada a 2026', () => {
  const a = previsaoAbstencao();
  assert.equal(a.pares.length, 6);
  perto(a.deltaMedio, 1.77);
  perto(a.centro, 22.85);
  assert.ok(a.faixa[0] < a.centro && a.centro < a.faixa[1]);
});

test('comparativo: líder do 1º turno venceu todas as disputas desde 1989', () => {
  const c = comparativo1T();
  assert.equal(c.disputas, 7);
  assert.equal(c.lideresVenceram, 7);
  assert.ok(c.margem2026 < c.menorMargemAnterior);
  assert.ok(c.soma2026 > c.maiorSomaAnterior);
});

test('cenários de erro somam 100% e partem da média das pesquisas', () => {
  const cs = cenariosErro();
  for (const c of cs) perto(c.flavio + c.lula, 100);
  perto(cs.find((c) => c.id === 'sem').flavio, 52.12);
});
