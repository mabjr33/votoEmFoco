// Entrada automática de pesquisas: leitura das reportagens, cadastro do TSE, conferência entre
// veículos e o efeito no modelo. Textos curtos no formato das reportagens reais; números fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extrairPesquisa, parNaFrase, registrosNoTexto } from '../src/pesquisas-auto/extrair.js';
import { lerZip, RegistroPesquisas, nomeInstituto, abrangenciaDe } from '../src/pesquisas-auto/registro-tse.js';
import { LeitorMaterias } from '../src/pesquisas-auto/materias.js';
import { candidatosDe } from '../src/pesquisas-auto/automacao.js';
import { Pesquisas, periodoCampo } from '../src/pesquisas.js';
import { modeloPesquisas, maisRecentePorInstituto, serieDiaria, previsoes } from '../src/shared/previsao.js';
import { ELEICOES, PESQUISAS_2026_2T } from '../src/shared/historico.js';

const C = candidatosDe(ELEICOES.find((e) => e.ano === 2026));
const pagina = (paragrafos, extra = '') => `<html><body><nav>Menu Lula Flávio 10% 20%</nav><article>${paragrafos.map((p) => `<p>${p}</p>`).join('')}</article>${extra}</body></html>`;

test('candidatos: nome completo e primeiro nome', () => {
  assert.deepEqual(C, [{ chave: 'flavio', nomes: ['FLAVIO BOLSONARO', 'FLAVIO'] }, { chave: 'lula', nomes: ['LULA'] }]);
});

test('frase: ordem dos nomes decide quem leva cada número', () => {
  assert.deepEqual(parNaFrase('Flávio tem 52% e Lula aparece com 48%.', C), { tipo: 'validos', flavio: 52, lula: 48 });
  assert.deepEqual(parNaFrase('O senador Flávio Bolsonaro (PL) tem 52,8% das intenções de voto válidas, contra 47,2% do presidente Lula (PT).', C), { tipo: 'validos', flavio: 52.8, lula: 47.2 });
  assert.deepEqual(parNaFrase('Lula, candidato à reeleição, tem 44,2% das intenções de voto, e Flávio, 42,7%.', C), { tipo: 'totais', lula: 44.2, flavio: 42.7 });
  assert.deepEqual(parNaFrase('Em votos válidos, Lula tem 50,86%, contra 49,14% de Flávio Bolsonaro.', C), { tipo: 'validos', lula: 50.86, flavio: 49.14 });
});

test('frase: recusa o que não é o resultado da pesquisa', () => {
  assert.equal(parNaFrase('No 1º turno, Flávio teve 47,03% e Lula, 45,16% dos votos válidos.', C), null, '1º turno');
  assert.equal(parNaFrase('Na pesquisa anterior, Lula aparecia com 47% e Flávio registrava 44,1%.', C), null, 'pesquisa anterior');
  assert.equal(parNaFrase('Entre as mulheres, Lula tem 51% e Flávio, 41%.', C), null, 'recorte');
  assert.equal(parNaFrase('No Nordeste, Lula tem 60% e Flávio, 33%.', C), null, 'região');
  assert.equal(parNaFrase('Flávio tem 46% dos eleitores de Caiado e Lula, 32%.', C), null, 'transferência');
  assert.equal(parNaFrase('Lula e Flávio têm 46% cada.', C), null, 'um número só');
  assert.equal(parNaFrase('Flávio tem 49%, Lula 45% e 6% não sabem.', C), null, 'três números');
  assert.equal(parNaFrase('Em votos totais, Flávio tem 52% e Lula, 48%.', C), null, 'diz totais mas soma 100');
  assert.equal(parNaFrase('Flávio Dino tem 52% e Lula, 48%.', C), null, 'homônimo');
  assert.equal(parNaFrase('Perguntados sobre quem tem mais chances de vencer, 54% apontaram Flávio e 37% colocaram Lula.', C), null, 'expectativa de vitória');
  assert.equal(parNaFrase('Flávio Bolsonaro (PL) avançou ao segundo turno na liderança com 47,03% dos votos, ante 45,16% de Lula (PT).', C), null, '1º turno sem dizer "1º turno"');
});

test('registros: grafias comuns', () => {
  assert.deepEqual(registrosNoTexto('registro BR-02949/2026, BR 01234/2026 e BR09999/2026; SP-12345/2026 não'), ['BR-02949/2026', 'BR-01234/2026', 'BR-09999/2026']);
});

test('reportagem: válidos, totais e margem; manchete de "leia mais" fica de fora', () => {
  const html = pagina([
    'Flávio Bolsonaro (PL) tem 52% em votos válidos, contra 48% de Lula (PT), segundo pesquisa Datafolha.',
    'Em votos totais, Flávio apareceu com 49% e Lula, com 45%.',
    'A margem de erro é de dois pontos percentuais. O registro no TSE é BR-02949/2026.',
    'No 1º turno, Flávio obteve 47% dos votos válidos e Lula, 45,2%.',
    'Leia mais',
    'Datafolha: Lula tem 47%, e Flávio, 46%, no segundo turno',
  ]);
  assert.deepEqual(extrairPesquisa(html, C), { registros: ['BR-02949/2026'], validos: { flavio: 52, lula: 48 }, totais: { flavio: 49, lula: 45 }, margem: 2 });
});

test('reportagem com recortes (escolaridade, idade) e "divulgada neste domingo": fica o resultado geral', () => {
  const html = pagina([
    'Flávio Bolsonaro (PL) aparece com 50% das intenções de voto contra 44% de Lula para o segundo turno, segundo pesquisa divulgada neste domingo, 11.',
    'O levantamento mostra o senador com 53,1% dos votos válidos, contra 46,9% do petista.',
    'Entre os entrevistados com ensino superior ou mais, Flávio registra 60% das intenções de voto, enquanto Lula tem 30,4%.',
    'Já no grupo com 60 anos ou mais, Lula aparece à frente, com 51%, contra 43,2% de Flávio.',
    'Entre os eleitores de 16 a 24 anos, Flávio tem 60,2%, contra 30,9% de Lula.',
    'O levantamento está registrado sob o número BR-03576/2026. A margem de erro estimada é de 2,19 pontos porcentuais.',
  ]);
  // "o senador"/"o petista" sem nome: o extrator não adivinha quem é quem
  assert.deepEqual(extrairPesquisa(html, C), { registros: ['BR-03576/2026'], validos: null, totais: { flavio: 50, lula: 44 }, margem: 2.19 });
});

test('reportagem: lista em linhas e articleBody do JSON-LD', () => {
  const lista = pagina(['Veja os números da pesquisa registrada sob o protocolo BR-01111/2026:', 'Flávio Bolsonaro (PL): 41%', 'Lula (PT): 44%', 'Margem de erro: 2,5 pontos percentuais.']);
  assert.deepEqual(extrairPesquisa(lista, C).totais, { flavio: 41, lula: 44 });
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: `${'Texto da matéria. '.repeat(20)}Lula tem 50,5% dos votos válidos e Flávio, 49,5%. Registro BR-02222/2026.` })}</script><p>Rodapé: Lula 10% Flávio 20%.</p>`;
  const r = extrairPesquisa(ld, C);
  assert.deepEqual(r.validos, { lula: 50.5, flavio: 49.5 });
});

test('reportagem: pares diferentes do mesmo tipo ou totais incoerentes com válidos anulam', () => {
  const dois = pagina(['Flávio tem 52% e Lula, 48% nos válidos.', 'Já na pesquisa Quaest, Lula tem 51% e Flávio, 49% nos válidos.']);
  assert.equal(extrairPesquisa(dois, C).validos, null);
  const incoerente = pagina(['Flávio tem 52% e Lula, 48% nos válidos.', 'Em votos totais, Lula tem 47% e Flávio, 43%.']);
  const r = extrairPesquisa(incoerente, C);
  assert.equal(r.validos, null);
  assert.equal(r.totais, null);
});

// ---------- cadastro do TSE ----------
function zip(arquivos) {
  const locais = [], centrais = [];
  let off = 0;
  for (const [nome, conteudo] of arquivos) {
    const n = Buffer.from(nome, 'latin1'), dados = deflateRawSync(conteudo);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(dados.length, 18); l.writeUInt32LE(conteudo.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(dados.length, 20); c.writeUInt32LE(conteudo.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locais.push(l, n, dados); centrais.push(c, n);
    off += 30 + n.length + dados.length;
  }
  const cd = Buffer.concat(centrais);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(arquivos.length, 8); e.writeUInt16LE(arquivos.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cd, e]);
}
const CAB = '"DT_GERACAO";"SG_UF";"NR_PROTOCOLO_REGISTRO";"NR_CNPJ_EMPRESA";"NM_EMPRESA";"NM_EMPRESA_FANTASIA";"DS_CARGO";"DT_INICIO_PESQUISA";"DT_FIM_PESQUISA";"DT_DIVULGACAO";"QT_ENTREVISTADO";"ST_PESQUISA_PROPRIA";"DS_DADO_MUNICIPIO";"DS_PLANO_AMOSTRAL"';
const NAC = 'A área de abrangência da coleta é Brasil.';
const linha = (uf, reg, cnpj, emp, fant, cargo, ini, fim, div, n, area = NAC) => `"11/10/2026";"${uf}";"${reg}";"${cnpj}";"${emp}";"${fant}";"${cargo}";"${ini} 00:00:00";"${fim} 00:00:00";"${div} 00:00:00";${n};"N";"${area}";"texto com ""aspas"";
e quebra de linha"`;
const CSV = [CAB,
  linha('BR', 'BR011112026', '11111111000111', 'DATAFOLHA INSTITUTO DE PESQUISAS LTDA.', '#NULO#', 'Presidente', '2026-10-13', '2026-10-15', '2026-10-16', 2500),
  linha('BR', 'BR022222026', '22222222000122', 'INSTITUTO EXEMPLO DE OPINIAO LTDA', 'EXEMPLO PESQUISAS', 'Presidente', '2026-10-12', '2026-10-14', '2026-10-15', 1800),
  linha('BR', 'BR033332026', '33333333000133', 'ANTIGA LTDA', 'ANTIGA', 'Presidente', '2026-09-28', '2026-10-02', '2026-10-03', 2000),
  linha('SP', 'SP044442026', '44444444000144', 'ESTADUAL LTDA', 'ESTADUAL', 'Governador', '2026-10-12', '2026-10-14', '2026-10-15', 1200),
  // Presidente, mas só no Distrito Federal: também vem como "BR" no cadastro
  linha('BR', 'BR055552026', '11111111000111', 'DATAFOLHA INSTITUTO DE PESQUISAS LTDA.', '#NULO#', 'Presidente', '2026-10-13', '2026-10-15', '2026-10-16', 910, 'Área física: A área de abrangência da coleta dos dados é o Distrito Federal.'),
  linha('BR', 'BR066662026', '66666666000166', 'SEM AREA LTDA', 'SEM AREA', 'Presidente', '2026-10-13', '2026-10-15', '2026-10-16', 1500, 'Os bairros serão informados no prazo legal.'),
].join('\r\n');
const ZIP = zip([['leiame.pdf', Buffer.from('pdf')], ['pesquisa_eleitoral_2026_BRASIL.csv', Buffer.from(CSV, 'latin1')]]);

test('cadastro: lê o zip do TSE e guarda só presidenciais nacionais com campo depois do 1º turno', () => {
  assert.equal(lerZip(ZIP, (n) => n.endsWith('.pdf')).dados.toString(), 'pdf');
  const r = new RegistroPesquisas({ desde: '2026-10-06' });
  assert.equal(r.importarZip(ZIP), 4);
  assert.deepEqual(r.get('BR-01111/2026'), { registro: 'BR-01111/2026', instituto: 'Datafolha', cnpj: '11111111000111', inicio: '2026-10-13', fim: '2026-10-15', divulgacao: '2026-10-16', amostra: 2500, propria: false, abrangencia: 'nacional' });
  assert.equal(r.get('BR-02222/2026').instituto, 'Exemplo Pesquisas');
  assert.equal(r.get('BR-03333/2026'), null, 'campo antes do 1º turno');
  assert.equal(r.get('BR-05555/2026').abrangencia, 'estadual');
  assert.equal(r.get('BR-06666/2026').abrangencia, 'indefinida');
  // A lista pública de próximas pesquisas só tem as nacionais
  assert.deepEqual(r.proximas('2026-10-16').map((p) => p.registro), ['BR-01111/2026']);
  assert.equal(nomeInstituto('#NULO#', 'INSTITUTO VOX BRASIL OPINIAO E PESQUISAS LTDA'), 'Vox Brasil');
});

test('cadastro: consulta condicional (só baixa quando muda) e guarda em disco', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cadastro-'));
  const pedidos = [];
  const fetch = async (url, op) => {
    pedidos.push(op.headers);
    if (op.headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response(ZIP, { status: 200, headers: { etag: '"v1"', 'last-modified': 'Sun, 11 Oct 2026 08:48:57 GMT' } });
  };
  try {
    const r = new RegistroPesquisas({ url: 'https://exemplo.invalid/p.zip', dataDir: dir, fetch, log: { info() {}, warn() {} } });
    assert.equal(await r.atualizar(), true);
    assert.equal(await r.atualizar(), false);
    assert.equal(pedidos[1]['If-None-Match'], '"v1"');
    const outro = new RegistroPesquisas({ url: 'x', dataDir: dir });
    await outro.carregar();
    assert.equal(outro.itens.size, 4);
    assert.equal(outro.etag, '"v1"');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------- conferência entre veículos ----------
const cadastro = (() => { const r = new RegistroPesquisas({ desde: '2026-10-06' }); r.importarZip(ZIP); return r; })();
const ext = (host, reg, validos, totais = null, extra = {}) => ({ link: `https://${host}/materia-${reg}`, host, fonte: host.split('.')[0], data: Date.parse('2026-10-16T13:00:00Z'), registros: [reg], validos, totais, margem: 2, ...extra });

test('automática: entra com dois veículos diferentes e os mesmos números', async () => {
  const p = new Pesquisas(null);
  let avisos = 0; p.on('mudou', () => avisos++);
  const n = await p.sincronizarAutomaticas(cadastro, [
    ext('a.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 }),
    ext('b.com.br', 'BR-01111/2026', null, { flavio: 47, lula: 45 }), // 51,1% dos válidos: arredondamento
  ]);
  assert.equal(n, 1);
  assert.equal(avisos, 1);
  const [q] = p.itens;
  assert.equal(q.origem, 'automatica');
  assert.equal(q.instituto, 'Datafolha');
  assert.equal(q.amostra, 2500, 'entrevistas do cadastro do TSE');
  assert.equal(q.campo, '13–15/10');
  assert.equal(q.divulgacao, '16/10');
  assert.deepEqual([q.flavioValido, q.lulaValido, q.flavio, q.lula], [51, 49, 47, 45]);
  assert.deepEqual(q.fontes.map((f) => f.nome), ['a', 'b']);
  // de novo: nada muda
  assert.equal(await p.sincronizarAutomaticas(cadastro, [ext('a.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 }), ext('b.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 })]), 0);
});

test('automática: uma fonte só, mesmo veículo duas vezes ou números divergentes ficam esperando aprovação', async () => {
  const p = new Pesquisas(null);
  await p.sincronizarAutomaticas(cadastro, [
    ext('a.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 }),
    ext('a.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 }, null, { link: 'https://a.com.br/outra' }),
    ext('a.com.br', 'BR-02222/2026', { flavio: 50, lula: 50 }),
    ext('b.com.br', 'BR-02222/2026', { flavio: 52, lula: 48 }),
  ]);
  assert.equal(p.itens.length, 0);
  assert.deepEqual(p.pendentes.map((x) => [x.registro, x.motivo]), [
    ['BR-01111/2026', 'só um veículo publicou os números até agora'],
    ['BR-02222/2026', 'as reportagens trazem números diferentes'],
  ]);
  assert.equal(p.pendentes[0].flavioValido, 51, 'pendência vem preenchida para o painel');
});

test('automática: fora do cadastro, antes do 1º turno ou reportagem com várias pesquisas não entram', async () => {
  const p = new Pesquisas(null);
  const n = await p.sincronizarAutomaticas(cadastro, [
    ext('a.com.br', 'BR-09999/2026', { flavio: 51, lula: 49 }), ext('b.com.br', 'BR-09999/2026', { flavio: 51, lula: 49 }),
    ext('a.com.br', 'BR-03333/2026', { flavio: 51, lula: 49 }), ext('b.com.br', 'BR-03333/2026', { flavio: 51, lula: 49 }),
    ext('c.com.br', 'x', { flavio: 51, lula: 49 }, null, { registros: ['BR-01111/2026', 'BR-02222/2026'] }),
    ext('d.com.br', 'x', { flavio: 51, lula: 49 }, null, { registros: ['BR-01111/2026', 'BR-02222/2026'] }),
  ]);
  assert.equal(n, 0);
  assert.equal(p.pendentes.length, 0);
});

test('automática: removida no painel não volta sozinha; aprovada no painel sai das pendências', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pesq-'));
  try {
    const p = new Pesquisas(dir);
    const duas = [ext('a.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 }), ext('b.com.br', 'BR-01111/2026', { flavio: 51, lula: 49 })];
    await p.sincronizarAutomaticas(cadastro, duas);
    assert.equal(await p.remover('BR-01111/2026'), true);
    const recarregada = new Pesquisas(dir);
    await recarregada.carregar();
    assert.equal(await recarregada.sincronizarAutomaticas(cadastro, duas), 0);
    assert.match(recarregada.pendentes[0].motivo, /removida no painel/);
    const { pesquisa } = await recarregada.adicionar({ ...recarregada.pendentes[0], margem: 2 });
    assert.equal(pesquisa.registro, 'BR-01111/2026');
    assert.equal(recarregada.pendentes.length, 0);
    assert.equal(recarregada.itens[0].origem, 'painel');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('período de campo no formato das pesquisas fixas', () => {
  assert.equal(periodoCampo('2026-10-06', '2026-10-08'), '6–8/10');
  assert.equal(periodoCampo('2026-09-28', '2026-10-02'), '28/9–2/10');
  assert.equal(periodoCampo('2026-10-03', '2026-10-03'), '3/10');
});

// ---------- leitura das reportagens ----------
test('reportagens: só pesquisa de presidente, uma leitura por link', async () => {
  const lidos = [];
  const fetch = async (url) => {
    lidos.push(url);
    return new Response(pagina(['Flávio tem 51% e Lula, 49% dos votos válidos. Registro BR-01111/2026.']), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const m = new LeitorMaterias({ candidatos: C, fetch, pausaMs: 0 });
  const agora = Date.parse('2026-10-16T15:00:00Z');
  const itens = [
    { link: 'https://a.com.br/1', fonte: 'A', data: agora - 3600e3, etiquetas: ['pesquisa', 'presidente'] },
    { link: 'https://a.com.br/2', fonte: 'A', data: agora - 3600e3, etiquetas: ['pesquisa', 'governadores'] },
    { link: 'https://a.com.br/3', fonte: 'A', data: agora - 10 * 86400e3, etiquetas: ['pesquisa', 'presidente'] },
  ];
  assert.equal(await m.processar(itens, agora), 1);
  assert.equal(await m.processar(itens, agora), 0, 'não lê de novo');
  assert.deepEqual(lidos, ['https://a.com.br/1']);
  assert.deepEqual(m.extracoes()[0].validos, { flavio: 51, lula: 49 });
  assert.equal(m.extracoes()[0].host, 'a.com.br');
});

// ---------- modelo ----------
test('modelo: só a pesquisa mais recente de cada instituto', () => {
  const base = { depois1T: true, amostra: 2000, margem: 2 };
  const lista = [
    { ...base, instituto: 'Datafolha', registro: 'BR-00001/2026', campo: '13–15/10', flavioValido: 50, lulaValido: 50 },
    { ...base, instituto: 'Datafolha', registro: 'BR-02949/2026', campo: '6–7/10', flavioValido: 52, lulaValido: 48 },
    { ...base, instituto: 'Quaest', registro: 'BR-00002/2026', campo: '27/9–2/10', flavioValido: 49, lulaValido: 51 },
  ];
  assert.deepEqual(maisRecentePorInstituto(lista).map((p) => p.registro), ['BR-00001/2026', 'BR-00002/2026']);
  assert.deepEqual(modeloPesquisas({ pesquisas: lista }).detalhe.usadas.map((u) => u.flavio), [50, 49]);
  // As fixas de hoje: um instituto cada, então nada muda
  assert.equal(previsoes().modelos[0].detalhe.usadas.length, PESQUISAS_2026_2T.filter((p) => p.depois1T).length);
});

test('série diária: cada dia só com as pesquisas já divulgadas', () => {
  const s = serieDiaria({ ate: '2026-10-12' });
  assert.deepEqual(s.map((d) => d.dia), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(s.map((d) => d.pesquisas), [1, 3, 3, 3, 3]);
  const so8 = PESQUISAS_2026_2T.filter((p) => !p.depois1T || p.divulgacao === '8/10');
  assert.equal(s[0].centro, previsoes({ pesquisas: so8 }).combinado.centro);
  assert.equal(s.at(-1).centro, previsoes().combinado.centro);
});

test('abrangência pelo texto do registro (frases dos registros reais de outubro de 2026)', () => {
  const a = (area, plano = '') => abrangenciaDe({ DS_DADO_MUNICIPIO: area, DS_PLANO_AMOSTRAL: plano });
  assert.equal(a('A área de abrangência da coleta dos dados é Brasil, contemplando municípios das cinco grandes regiões.'), 'nacional');
  assert.equal(a('A área de abrangência da coleta é Nacional (Brasil).'), 'nacional');
  assert.equal(a('#NULO#', 'Amostra representando as características do eleitorado de Brasil.'), 'nacional');
  assert.equal(a('', 'A amostra será distribuída pelas 27 Unidades da Federação.'), 'nacional');
  // estaduais, mesmo com "população brasileira" ou "país" em outro trecho
  assert.equal(a('A área de abrangência da coleta é estadual, restrita ao Estado do Amazonas.', 'Ponderação pela PNAD da população brasileira.'), 'estadual');
  assert.equal(a('A área de abrangência da coleta é o território do estado do Tocantins.', 'Eleitores residentes no país.'), 'estadual');
  assert.equal(a('', 'A amostra contemplou as onze regiões geográficas imediatas do RN.'), 'estadual');
  assert.equal(a('', 'para 1344 eleitores do Acre (AC)'), 'estadual');
  assert.equal(a('Área física: A área de abrangência da coleta dos dados é o Distrito Federal.'), 'estadual');
  // sem frase clara, ou nacional e estado ao mesmo tempo: na dúvida
  assert.equal(a('Os bairros serão informados no prazo legal.'), 'indefinida');
  assert.equal(a('A área de abrangência da coleta é Brasil.', 'No estado de São Paulo, 22% das entrevistas.'), 'indefinida');
});

test('automática: pesquisa de um estado só não entra no modelo nacional; abrangência incerta espera aprovação', async () => {
  const p = new Pesquisas(null);
  const n = await p.sincronizarAutomaticas(cadastro, [
    ext('a.com.br', 'BR-05555/2026', null, { flavio: 49, lula: 43 }), ext('b.com.br', 'BR-05555/2026', null, { flavio: 49, lula: 43 }),
    ext('a.com.br', 'BR-06666/2026', { flavio: 51, lula: 49 }), ext('b.com.br', 'BR-06666/2026', { flavio: 51, lula: 49 }),
  ]);
  assert.equal(n, 0);
  assert.deepEqual(p.pendentes.map((x) => x.registro), ['BR-06666/2026'], 'a estadual nem aparece; a incerta vai para o painel');
  assert.match(p.pendentes[0].motivo, /nacional/);
});
