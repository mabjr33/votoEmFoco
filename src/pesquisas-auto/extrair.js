// Lê os números de uma pesquisa presidencial de 2º turno no texto de uma reportagem.
// É conservador de propósito: na dúvida, não devolve número nenhum. Quem decide se a pesquisa
// entra no modelo é a conferência entre fontes (src/pesquisas.js), não esta função.

import { decodificar } from '../noticias/rss.js';

const MAX_HTML = 3 * 1024 * 1024;
// Suba quando as regras mudarem: as reportagens recentes são lidas de novo com as regras novas
export const VERSAO_EXTRATOR = 3;

/** Maiúsculas sem acento, mantendo dígitos, vírgula, ponto e %. */
export const simplificar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[º°]/g, 'O').replace(/[^A-Z0-9%,./\-\s]/g, ' ').replace(/\s+/g, ' ').trim();

const limpar = (s) => decodificar(String(s)
  .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr|\/td|\/blockquote|\/figcaption)\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();

/**
 * Texto da página. `corpo` vem do articleBody (JSON-LD) ou do <article>, sem menus e rodapé;
 * `inteiro` é a página toda (os números de registro às vezes ficam num quadro fora do corpo).
 */
export function textoDaPagina(html) {
  const s = String(html || '').slice(0, MAX_HTML);
  const semCodigo = s.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
  let corpo = '';
  for (const m of s.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const b = m[1].match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!b) continue;
    try { const t = JSON.parse(`"${b[1]}"`); if (t.length > 300) { corpo = limpar(t); break; } } catch { /* JSON quebrado */ }
  }
  if (!corpo) {
    const art = semCodigo.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
    corpo = limpar((art || semCodigo).replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' '));
  }
  return { corpo, inteiro: limpar(semCodigo) };
}

/** BR-12345/2026 em qualquer grafia comum (BR-12345/2026, BR 12345/2026, BR12345/2026). */
export function registrosNoTexto(texto) {
  return [...new Set([...String(texto).matchAll(/\bBR\s?-?\s?(\d{5})\s?\/\s?(20\d{2})\b/g)].map((m) => `BR-${m[1]}/${m[2]}`))];
}

// Frases que citam números de outra coisa: 1º turno, pesquisa anterior, recortes do eleitorado,
// outros cargos, rejeição, transferência de votos.
const OUTRA_COISA = new RegExp([
  'PRIMEIRO TURNO', '1O TURNO', '1 TURNO', 'URNAS?', 'APURAD', 'TOTALIZ', 'OBTEVE', 'RECEBEU', 'TERMINOU', 'TEVE',
  'APARECIA', 'REGISTRAVA', 'TINHA', 'ANTERIOR', 'PASSADA', 'ULTIMA PESQUISA', 'LEVANTAMENTO DE', 'EM SETEMBRO', 'EM AGOSTO',
  'ESPONTANEA', 'REJEI', 'NAO VOTARIA', 'AVALIA', 'APROVA', 'GOVERNADOR', 'SENADO\\b', 'SENADORES', 'DEPUTAD',
  'ELEITORES DE', 'ELEITORAD[OA] DE', 'ENTRE (OS |AS )?(ELEITOR|MULHER|HOMEN|JOVE|EVANGEL|CATOLIC|QUEM)', 'MULHERES', 'HOMENS',
  'EVANGELIC', 'CATOLIC', 'REGIAO', 'NORDESTE', 'SUDESTE', 'CENTRO-OESTE', 'NO SUL', 'NO NORTE', 'RENDA', 'SALARIO', 'ESCOLARIDADE', 'FAIXA',
  'ENTREVISTADOS COM', 'ENTRE (OS |AS )?ENTREVISTAD', 'ENSINO', 'GRUPO', 'SEGMENTO', 'ANOS OU MAIS', '\\d+ (A|E) \\d+ ANOS', 'IDOSOS',
  'CADA',
  // expectativa de vitória ("quem vai ganhar"), que não é intenção de voto
  'CHANCES?', 'ACHAM?', 'ACREDITA', 'EXPECTATIVA', 'APONTARAM', 'VAI GANHAR', 'VAI VENCER', 'QUEM VENCE',
  // o 1º turno contado de outro jeito ("avançou ao 2º turno com 47%")
  'AVANCOU', 'AVANCARAM', 'CHEGOU', 'PASSOU AO', 'FICOU COM', 'LIDERANCA COM',
].map((p) => `\\b${p}`).join('|'));
const PCT = /(\d{1,2}(?:,\d{1,2})?)\s?(?:%|POR CENTO)/g;
const num = (s) => Number(String(s).replace(',', '.'));

/** candidatos: [{ chave: 'flavio', nomes: ['FLAVIO BOLSONARO', 'FLAVIO'] }, { chave: 'lula', nomes: ['LULA'] }] */
function posicao(frase, nomes) {
  let p = -1;
  for (const n of nomes) {
    const m = frase.match(new RegExp(`\\b${n}\\b`));
    if (m && (p < 0 || m.index < p)) p = m.index;
  }
  return p;
}

/**
 * Par de percentuais numa frase que cita os dois candidatos e tem exatamente dois números.
 * O 1º número vai para o candidato citado primeiro ("Flávio tem 52% e Lula, 48%";
 * "Flávio tem 52%, contra 48% de Lula"; "Contra 48% de Lula, Flávio tem 52%").
 */
export function parNaFrase(fraseOriginal, candidatos) {
  const f = simplificar(fraseOriginal).replace(/\bFLAVIO DINO\b/g, ' ');
  if (OUTRA_COISA.test(f)) return null;
  const pcts = [...f.matchAll(PCT)].map((m) => num(m[1]));
  if (pcts.length !== 2) return null;
  const pos = candidatos.map((c) => posicao(f, c.nomes));
  if (pos.some((p) => p < 0)) return null;
  const ordem = pos[0] <= pos[1] ? [0, 1] : [1, 0];
  const par = { [candidatos[ordem[0]].chave]: pcts[0], [candidatos[ordem[1]].chave]: pcts[1] };
  const soma = pcts[0] + pcts[1];
  const disseValidos = /\bVALID/.test(f), disseTotais = /\bTOTA/.test(f);
  let tipo = null;
  if (Math.abs(soma - 100) <= 0.6) tipo = 'validos';
  else if (soma >= 50 && soma <= 98) tipo = 'totais';
  if (!tipo || (tipo === 'validos' && disseTotais) || (tipo === 'totais' && disseValidos)) return null;
  return { tipo, ...par };
}

/**
 * Frases do texto. Linha curta sem pontuação final é manchete (de "leia mais", por exemplo, que
 * pode ser de outra pesquisa) e fica de fora. Lista "Flávio Bolsonaro (PL): 52%" / "Lula (PT): 48%"
 * em linhas seguidas vira uma frase só.
 */
function frases(texto) {
  const linhas = String(texto).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    if (!(linhas[i].length < 160 && !/[.!?:;]["”]?$/.test(linhas[i]))) for (const s of linhas[i].split(/(?<=[.!?])\s+(?=["“A-ZÀ-Ú])/)) out.push(s);
    const a = linhas[i], b = linhas[i + 1];
    if (b && a.length < 90 && b.length < 90 && /%/.test(a) && /%/.test(b)) out.push(`${a} ${b}`);
  }
  return out;
}

const margemPalavra = { UM: 1, DOIS: 2, TRES: 3, QUATRO: 4 };
function margemDe(texto) {
  const conta = new Map();
  for (const m of simplificar(texto).matchAll(/MARGEM DE ERRO[^.%]{0,40}?\b(\d{1,2}(?:,\d{1,2})?|UM|DOIS|TRES|QUATRO)\s+PONTOS?\b/g)) {
    const v = margemPalavra[m[1]] ?? num(m[1]);
    if (v > 0 && v <= 10) conta.set(v, (conta.get(v) || 0) + 1);
  }
  let melhor = null;
  for (const [v, n] of conta) if (!melhor || n > melhor[1]) melhor = [v, n];
  return melhor ? melhor[0] : null;
}

const iguais = (x, y, cs) => cs.every((c) => x[c.chave] === y[c.chave]);
const partilha = (a, b) => (100 * a) / (a + b);

/**
 * Números de uma reportagem: { registros, validos, totais, margem }.
 * validos/totais: { flavio, lula } ou null. Se a mesma reportagem traz dois pares diferentes
 * do mesmo tipo (ex.: um link "leia mais" com outra pesquisa), aquele tipo fica null.
 */
export function extrairPesquisa(html, candidatos) {
  const { corpo, inteiro } = textoDaPagina(html);
  const registros = registrosNoTexto(inteiro);
  const achados = { validos: [], totais: [] };
  for (const f of frases(corpo)) {
    const p = parNaFrase(f, candidatos);
    if (!p) continue;
    const { tipo, ...par } = p;
    if (!achados[tipo].some((x) => iguais(x, par, candidatos))) achados[tipo].push(par);
  }
  let validos = achados.validos.length === 1 ? achados.validos[0] : null;
  let totais = achados.totais.length === 1 ? achados.totais[0] : null;
  const [a, b] = candidatos.map((c) => c.chave);
  // Totais e válidos da mesma pesquisa precisam bater (válidos = divisão só entre os dois)
  if (validos && totais && Math.abs(partilha(totais[a], totais[b]) - validos[a]) > 1) { validos = null; totais = null; }
  return { registros, validos, totais, margem: margemDe(corpo) };
}
