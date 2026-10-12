// Dados históricos usados na aba Previsões. Cada bloco cita a fonte consultada em 11/10/2026.
// Percentuais de candidatos: votos válidos. Abstenção: % do eleitorado.
// Quando um número não pôde ser conferido, ele fica como null e não entra nos cálculos.

export const ATUALIZADO = '11/10/2026';

export const FONTES = {
  bpmoney: { nome: 'BP Money: sem virada no 2º turno desde a redemocratização', url: 'https://bpmoney.com.br/politica/eleicoes-2022-brasil-nao-tem-virada-2o-turno-redemocratizacao' },
  tse2018: { nome: 'TSE: totalização do 1º turno de 2018', url: 'https://www.tse.jus.br/comunicacao/noticias/2018/Outubro/concluida-totalizacao-de-votos-do-1o-turno-das-eleicoes-2018' },
  ihu2018: { nome: 'IHU Unisinos: resultado do 2º turno de 2018', url: 'https://ihu.unisinos.br/584188-bolsonaro-presidente-com-vantagem-proxima-a-de-dilma-em-2010-eleito-nao-recebe-cheque-em-branco-dizem-analistas' },
  cf2014: { nome: 'Congresso em Foco: 2º turno de 2014', url: 'https://congressoemfoco.com.br/noticia/53571/dilma-se-reelegeu-com-38-dos-votos-totais' },
  cf2022: { nome: 'Congresso em Foco: pesquisas e resultado do 2º turno de 2022', url: 'https://www.congressoemfoco.com.br/noticia/10860/quatro-pesquisas-acertaram-a-votacao-de-lula-e-bolsonaro-veja-quais' },
  pp2026: { nome: 'Portal de Prefeitura: 1º turno de 2026 com 100% das seções', url: 'https://portaldeprefeitura.com.br/bastidores-da-politica/eleicoes-2026-com-100-das-secoes-totalizadas-flavio-tem-4703-e/633498/' },
  abst2026: { nome: 'Jornal Grande Bahia: abstenção de 21,08% no 1º turno de 2026', url: 'https://jornalgrandebahia.com.br/?p=1391247' },
  abstAB: { nome: 'Agência Brasil: abstenção nas eleições presidenciais', url: 'https://agenciabrasil.ebc.com.br/politica/noticia/2018-10/taxa-de-abstencao-na-eleicao-presidencial-e-maior-desde-1998' },
  abstC24: { nome: 'Correio: abstenção nos 2º turnos', url: 'https://www.correio24horas.com.br/eleicoes/segundo-turno-registra-maior-percentual-de-abstencoes-desde-1989-1110' },
  opovoAbst: { nome: 'O Povo: abstenção no 1º turno de 2026 e em 2022', url: 'https://www.opovo.com.br/noticias/mundo/2026/10/06/primeiro-turno-teve-maior-abstencao-eleitoral-em-28-anos.html' },
  wiki2010: { nome: 'Wikipedia: pesquisas da eleição presidencial de 2010', url: 'https://en.wikipedia.org/wiki/Opinion_polling_for_the_2010_Brazilian_presidential_election' },
  wiki2018: { nome: 'Wikipedia: pesquisas da eleição presidencial de 2018', url: 'https://en.wikipedia.org/wiki/Opinion_polling_for_the_2018_Brazilian_presidential_election' },
  wiki2022: { nome: 'Wikipedia: pesquisas da eleição presidencial de 2022', url: 'https://en.wikipedia.org/wiki/Opinion_polling_for_the_2022_Brazilian_presidential_election' },
  df0310: { nome: 'Money Times: Datafolha de 3/10/2026', url: 'https://www.moneytimes.com.br/pesquisa-datafolha-3-de-outubro-de-2026-gaep/' },
  quaest0310: { nome: 'CNN Brasil: Quaest de 3/10/2026', url: 'https://www.cnnbrasil.com.br/eleicoes/quaest-2-turno/' },
  rtbd0110: { nome: 'Tribuna PR: Real Time Big Data de 1/10/2026', url: 'https://www.tribunapr.com.br/noticias/brasil/tres-dias-eleicao-pesquisa-mostra-virada-2o-turno-entre-lula-flavio-bolsonaro/' },
  df0810: { nome: 'O Povo: Datafolha do 2º turno (6 e 7/10/2026)', url: 'https://opovo.com.br/noticias/brasil/2026/10/11/datafolha-flavio-tem-52-e-lula-aparece-com-48-no-2-turno.html' },
  atlas0910: { nome: 'Gazeta do Povo: AtlasIntel do 2º turno (3 a 8/10/2026)', url: 'https://www.gazetadopovo.com.br/eleicoes/2026/pesquisa-eleitoral-2026/atlasintel-presidente-outubro-2026-segundo-turno/' },
  vox0910: { nome: 'Estado de Minas: Vox Brasil do 2º turno (5 a 7/10/2026)', url: 'https://em.com.br/politica/2026/10/7517782-pesquisa-vox-lula-tem-442-e-flavio-bolsonaro-427-no-2-turno.html' },
  cnt0310: { nome: 'Bem Paraná: CNT/MDA de 3/10/2026', url: 'https://www.bemparana.com.br/eleicoes-2026/pesquisa-cnt/amp/' },
  cc0910: { nome: 'CartaCapital: as primeiras pesquisas do 2º turno (inclui PoderData de 8/10/2026)', url: 'https://www.cartacapital.com.br/politica/o-que-disseram-as-primeiras-pesquisas-sobre-flavio-bolsonaro-x-lula-no-2o-turno/' },
  oeste1210: { nome: 'Revista Oeste: DataTrends do 2º turno (7 a 9/10/2026)', url: 'https://revistaoeste.com/politica/datatrends-flavio-tem-50-contra-44-de-lula-no-2o-turno/' },
  folha1010: { nome: 'Folha de S.Paulo: Ipespe/Abrapel do 2º turno (6 a 8/10/2026)', url: 'https://www1.folha.uol.com.br/poder/2026/10/flavio-bolsonaro-tem-527-dos-votos-validos-no-2o-turno-contra-473-de-lula-diz-ipespe.shtml' },
  tseDados: { nome: 'TSE, Portal de Dados Abertos: resultados de 1989 a 2022 (votação por UF e por município e zona)', url: 'https://dadosabertos.tse.jus.br/dataset/?groups=resultados' },
  tse1t2026: { nome: 'TSE: resultado do 1º turno de 2026 (arquivo oficial de divulgação)', url: 'https://resultados.tse.jus.br/' },
};

/**
 * Eleições presidenciais. lider = 1º colocado no 1º turno; segundo = 2º colocado.
 * incumbente: 'lider' ou 'segundo' quando o presidente em exercício disputou; null se não.
 */
export const ELEICOES = [
  { ano: 1989, lider: { nome: 'Collor', partido: 'PRN', t1: 30.48, t2: 53.03 }, segundo: { nome: 'Lula', partido: 'PT', t1: 17.19, t2: 46.97 }, abst1: null, abst2: 14.4, incumbente: null, fontes: ['bpmoney', 'abstC24'] },
  { ano: 1994, primeiroTurno: { nome: 'FHC', partido: 'PSDB', pct: 54 }, abst1: 29.3, fontes: ['ihu2018', 'abstAB'] },
  { ano: 1998, primeiroTurno: { nome: 'FHC', partido: 'PSDB', pct: 53.06 }, abst1: 21.5, fontes: ['bpmoney', 'abstAB'] },
  { ano: 2002, lider: { nome: 'Lula', partido: 'PT', t1: 46.44, t2: 61.27 }, segundo: { nome: 'Serra', partido: 'PSDB', t1: 23.2, t2: 38.73 }, abst1: 17.7, abst2: 20.46, incumbente: null, fontes: ['bpmoney', 'abstAB', 'abstC24'] },
  { ano: 2006, lider: { nome: 'Lula', partido: 'PT', t1: 48.61, t2: 60.83 }, segundo: { nome: 'Alckmin', partido: 'PSDB', t1: 41.64, t2: 39.17 }, abst1: 16.8, abst2: 18.99, incumbente: 'lider', fontes: ['bpmoney', 'abstAB', 'abstC24'] },
  { ano: 2010, lider: { nome: 'Dilma', partido: 'PT', t1: 46.91, t2: 56.05 }, segundo: { nome: 'Serra', partido: 'PSDB', t1: 32.61, t2: 43.95 }, abst1: 18.1, abst2: 21.47, incumbente: null, fontes: ['bpmoney', 'abstAB', 'abstC24'] },
  { ano: 2014, lider: { nome: 'Dilma', partido: 'PT', t1: 41.59, t2: 51.64 }, segundo: { nome: 'Aécio', partido: 'PSDB', t1: 33.55, t2: 48.36 }, abst1: 19.4, abst2: 21.1, incumbente: 'lider', fontes: ['bpmoney', 'abstAB', 'cf2014'] },
  { ano: 2018, lider: { nome: 'Bolsonaro', partido: 'PSL', t1: 46.03, t2: 55.13 }, segundo: { nome: 'Haddad', partido: 'PT', t1: 29.28, t2: 44.87 }, abst1: 20.33, abst2: 21.3, incumbente: null, fontes: ['tse2018', 'ihu2018', 'abstAB'] },
  { ano: 2022, lider: { nome: 'Lula', partido: 'PT', t1: 48.43, t2: 50.9 }, segundo: { nome: 'Bolsonaro', partido: 'PL', t1: 43.2, t2: 49.1 }, abst1: 20.9, abst2: 20.5, incumbente: 'segundo', fontes: ['bpmoney', 'cf2022', 'opovoAbst'] },
  { ano: 2026, lider: { nome: 'Flávio Bolsonaro', partido: 'PL', t1: 47.03, t2: null }, segundo: { nome: 'Lula', partido: 'PT', t1: 45.16, t2: null }, abst1: 21.08, abst2: null, incumbente: 'segundo', fontes: ['pp2026', 'abst2026'] },
];

/**
 * Últimas pesquisas antes de cada 2º turno (votos totais como publicados).
 * pt = candidato do PT; outro = adversário. O erro é calculado sobre a divisão entre os dois.
 */
export const PESQUISAS_2T_FINAIS = [
  { ano: 2010, instituto: 'Datafolha', campo: '29–30/10', pt: 51, outro: 41, fonte: 'wiki2010' },
  { ano: 2010, instituto: 'Ibope', campo: '27–30/10', pt: 52, outro: 40, fonte: 'wiki2010' },
  { ano: 2010, instituto: 'Vox Populi', campo: '30/10', pt: 51, outro: 39, fonte: 'wiki2010' },
  { ano: 2010, instituto: 'CNT/Sensus', campo: '28–29/10', pt: 50.3, outro: 37.6, fonte: 'wiki2010' },
  { ano: 2018, instituto: 'Datafolha', campo: '26–27/10', pt: 39, outro: 47, fonte: 'wiki2018' },
  { ano: 2018, instituto: 'Ibope', campo: '26–27/10', pt: 41, outro: 47, fonte: 'wiki2018' },
  { ano: 2018, instituto: 'CNT/MDA', campo: '26–27/10', pt: 37, outro: 49, fonte: 'wiki2018' },
  { ano: 2022, instituto: 'Datafolha', campo: '28–29/10', pt: 49, outro: 45, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'Ipec', campo: '27–29/10', pt: 50, outro: 43, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'Quaest', campo: '27–29/10', pt: 45, outro: 42, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'AtlasIntel', campo: '26–29/10', pt: 52.4, outro: 45.7, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'Paraná Pesquisas', campo: '26–28/10', pt: 47.1, outro: 46.3, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'PoderData', campo: '23–25/10', pt: 49, outro: 44, fonte: 'wiki2022' },
];

/** Últimas pesquisas antes do 1º turno, só os dois primeiros colocados (votos totais como publicados). */
export const PESQUISAS_1T_FINAIS = [
  { ano: 2010, instituto: 'Datafolha', campo: '1–2/10', pt: 47, outro: 29, fonte: 'wiki2010' },
  { ano: 2010, instituto: 'Ibope', campo: '1–2/10', pt: 47, outro: 29, fonte: 'wiki2010' },
  { ano: 2018, instituto: 'Datafolha', campo: '3–4/10', pt: 22, outro: 36, fonte: 'wiki2018' },
  { ano: 2018, instituto: 'Ibope', campo: '1–2/10', pt: 22, outro: 36, fonte: 'wiki2018' },
  { ano: 2022, instituto: 'Datafolha', campo: '30/9–1/10', pt: 48, outro: 34, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'Ipec', campo: '29/9–1/10', pt: 47, outro: 34, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'Quaest', campo: '24–27/9', pt: 46, outro: 33, fonte: 'wiki2022' },
  { ano: 2022, instituto: 'AtlasIntel', campo: '28–30/9', pt: 49.8, outro: 40.7, fonte: 'wiki2022' },
  { ano: 2026, instituto: 'Datafolha', campo: '3/10', pt: 42, outro: 40, fonte: 'df0310' },
  { ano: 2026, instituto: 'AtlasIntel', campo: '27/9–2/10', pt: 47, outro: 44.1, fonte: 'atlas0910' },
  { ano: 2026, instituto: 'CNT/MDA', campo: '30/9–2/10', pt: 43.1, outro: 38, fonte: 'cnt0310' },
];

/** Pesquisas do 2º turno de 2026 (Flávio Bolsonaro × Lula). valido = já em votos válidos quando o instituto divulgou. */
export const PESQUISAS_2026_2T = [
  { instituto: 'DataTrends', campo: '7–9/10', divulgacao: '11/10', amostra: 2000, margem: 2.19, registro: 'BR-03576/2026', flavio: 50, lula: 44, flavioValido: 53.1, lulaValido: 46.9, depois1T: true, fonte: 'oeste1210' },
  { instituto: 'Ipespe', campo: '6–8/10', divulgacao: '10/10', amostra: 1500, margem: 2.6, registro: 'BR-00933/2026', flavio: 49, lula: 44, flavioValido: 52.7, lulaValido: 47.3, depois1T: true, fonte: 'folha1010' },
  { instituto: 'PoderData', campo: '5–7/10', divulgacao: '8/10', amostra: 3000, margem: 1.8, registro: 'BR-08134/2026', flavio: null, lula: null, flavioValido: 53, lulaValido: 47, depois1T: true, fonte: 'cc0910' },
  { instituto: 'Datafolha', campo: '6–7/10', divulgacao: '8/10', amostra: 2520, margem: 2, registro: 'BR-02949/2026', flavio: 49, lula: 45, flavioValido: 52, lulaValido: 48, depois1T: true, fonte: 'df0810' },
  { instituto: 'AtlasIntel', campo: '3–8/10', divulgacao: '9/10', amostra: 5026, margem: 1, registro: 'BR-03663/2026', flavio: 51.1, lula: 45.7, flavioValido: 52.8, lulaValido: 47.2, depois1T: true, fonte: 'atlas0910' },
  { instituto: 'Vox Brasil', campo: '5–7/10', divulgacao: '9/10', amostra: 2100, margem: 2.15, registro: 'BR-09623/2026', flavio: 42.7, lula: 44.2, flavioValido: 49.14, lulaValido: 50.86, depois1T: true, fonte: 'vox0910' },
  { instituto: 'Datafolha', campo: '3/10', divulgacao: '3/10', amostra: 4006, margem: 2, registro: 'BR-01708/2026', flavio: 46, lula: 47, depois1T: false, fonte: 'df0310' },
  { instituto: 'Quaest', campo: '2–3/10', divulgacao: '3/10', amostra: 3702, margem: 2, registro: 'BR-02197/2026', flavio: 44, lula: 42, depois1T: false, fonte: 'quaest0310' },
  { instituto: 'Real Time Big Data', campo: '26–30/9', divulgacao: '1/10', amostra: 2000, margem: 2, registro: 'BR-09503/2026', flavio: null, lula: null, flavioValido: 51, lulaValido: 49, depois1T: false, fonte: 'rtbd0110' },
];

/** Para onde dizem ir os eleitores de Cury, Renan Santos, Caiado e Zema (Datafolha, 6 e 7/10/2026). */
export const TRANSFERENCIA_2026 = { flavio: 0.46, lula: 0.32, brancoNulo: 0.15, outros: 0.07, fonte: 'df0810' };

/** Os demais candidatos no 1º turno de 2026: % dos votos válidos no arquivo oficial do TSE (data/tse-1turno). */
export const ELIMINADOS_2026 = [
  { n: '70', nome: 'Augusto Cury', partido: 'AVANTE', pct: 2.8907 },
  { n: '14', nome: 'Renan Santos', partido: 'MISSÃO', pct: 2.2430 },
  { n: '55', nome: 'Ronaldo Caiado', partido: 'PSD', pct: 2.1837 },
  { n: '30', nome: 'Zema', partido: 'NOVO', pct: 0.2737 },
  { n: '80', nome: 'Samara', partido: 'UP', pct: 0.1030 },
  { n: '16', nome: 'Hertz Dias', partido: 'PSTU', pct: 0.0361 },
  { n: '27', nome: 'Clariana Barão', partido: 'DC', pct: 0.0336 },
  { n: '21', nome: 'Edmilson Costa', partido: 'PCB', pct: 0.0190 },
  { n: '35', nome: 'Wilson Grassi', partido: 'DEMOCRATA', pct: 0.0141 },
  { n: '29', nome: 'Rui Costa Pimenta', partido: 'PCO', pct: 0.0126 },
];

/**
 * Pesquisas feitas depois do 1º turno sobre o voto de quem escolheu os eliminados. Fração que diz
 * votar em cada finalista; o resto é branco, nulo, indeciso ou abstenção.
 * geral: vale para todos os eliminados. porCandidato: pelo número do candidato no TSE.
 */
export const TRANSFERENCIAS_2026 = [
  { id: 'datafolha', instituto: 'Datafolha', campo: '6–8/10', fonte: 'df0810', descricao: 'eleitores de Cury, Renan Santos, Caiado e Zema, juntos', geral: { flavio: 0.46, lula: 0.32 } },
  { id: 'ipespe', instituto: 'Ipespe', campo: '6–8/10', fonte: 'folha1010', descricao: 'eleitores de Cury, Caiado e Renan Santos, separados',
    porCandidato: { 70: { flavio: 0.50, lula: 0.29 }, 55: { flavio: 0.56, lula: 0.15 }, 14: { flavio: 0.36, lula: 0.20 } } },
];
