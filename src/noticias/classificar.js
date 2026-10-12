// Decide se uma manchete é sobre a eleição e põe etiquetas (pesquisa, debate, justiça eleitoral,
// presidente, governadores, estados). É por palavras-chave: rápido, explicável e imperfeito.

export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[º°]/g, 'O').replace(/ª/g, 'A').replace(/[^A-Z0-9%/-]+/g, ' ').replace(/\s+/g, ' ').trim();

const UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to'];

// Estados por nome ou gentílico. Ficaram de fora formas ambíguas: "paulista" (avenida),
// "fluminense" (clube), "carioca" (cidade), "Pará" sozinho (confunde com "para").
const ESTADOS = [
  ['ac', /\b(ACRE|ACREAN[OA]S?)\b/], ['al', /\b(ALAGOAS|ALAGOAN[OA]S?)\b/], ['ap', /\b(AMAPA|AMAPAENSES?)\b/],
  ['am', /\b(AMAZONAS|AMAZONENSES?)\b/], ['ba', /\b(BAHIA|BAIAN[OA]S?)\b/], ['ce', /\b(CEARA|CEARENSES?)\b/],
  ['df', /\b(DISTRITO FEDERAL|BRASILIENSES?|BURITI)\b/], ['es', /\b(ESPIRITO SANTO|CAPIXABAS?)\b/], ['go', /\b(GOIAS|GOIAN[OA]S?)\b/],
  ['ma', /\b(MARANHAO|MARANHENSES?)\b/], ['ms', /\b(MATO GROSSO DO SUL|SUL-MATO-GROSSENSES?)\b/], ['mt', /\b(MATO GROSSO(?! DO SUL)|MATO-GROSSENSES?)\b/],
  ['mg', /\b(MINAS GERAIS|MINEIR[OA]S?)\b/], ['pa', /\b((?:DO|NO|AO) PARA|PARAENSES?)\b/], ['pb', /\b(PARAIBA|PARAIBAN[OA]S?)\b/],
  ['pr', /\b(PARANA|PARANAENSES?)\b(?! PESQUISAS)/], ['pe', /\b(PERNAMBUCO|PERNAMBUCAN[OA]S?)\b/], ['pi', /\b(PIAUI|PIAUIENSES?)\b/],
  ['rj', /\b(RIO DE JANEIRO)\b/], ['rn', /\b(RIO GRANDE DO NORTE|POTIGUAR(ES)?)\b/], ['rs', /\b(RIO GRANDE DO SUL|GAUCH[OA]S?)\b/],
  ['ro', /\b(RONDONIA|RONDONIENSES?)\b/], ['rr', /\b(RORAIMA|RORAIMENSES?)\b/], ['sc', /\b(SANTA CATARINA|CATARINENSES?)\b/],
  ['sp', /\b(SAO PAULO)\b/], ['se', /\b(SERGIPE|SERGIPAN[OA]S?)\b/], ['to', /\b(TOCANTINS|TOCANTINENSES?)\b/],
];

const INSTITUTOS = /\b(DATAFOLHA|QUAEST|ATLASINTEL|ATLAS INTEL|IPEC|PARANA PESQUISAS|REAL TIME BIG DATA|VOX BRASIL|VOX POPULI|CNT\/MDA|PODERDATA|IPESPE|FUTURA|GENIAL\/QUAEST|IDEIA)\b/;
const FORTE = /\b(ELEICAO|ELEICOES|ELEITORA(L|IS)|ELEITOR(ES|ADO)?|REELEI\w*|(1O|2O|PRIMEIRO|SEGUNDO) TURNO|TSE|TRE-[A-Z]{2}|JUSTICA ELEITORAL|URNAS?|APURACAO|CANDIDAT\w*|INTENCAO DE VOTO|VOTOS? VALIDOS|ABSTENCAO|PRESIDENCIAVE(L|IS)|PRESIDENCIAL)\b/;
const MEDIO = /\b(CAMPANHAS?|DEBATES?|PESQUISAS?|APOIOS?|APOIA|APOIAR|ATOS?|COMICIOS?|CARREATAS?|MOTOCIATAS?|CAMINHADAS?|AGENDAS?|VOTOS?|PALANQUES?|ALIANCAS?|ADVERSARI[OA]S?|PROPOSTAS?|PLANO DE GOVERNO|SABATINAS?|LIDERA|VANTAGEM|EMPATE|ENTREVISTAS?|PROPAGANDA|DIZ|DIZEM|AFIRMA|PEDE|ACUSA|CRITICA|ATACA|REBATE|RESPONDE|PROMETE|DEFENDE|IRONIZA|COBRA|EVENTO|DISCURSO|CANAL|REDES|VIDEO)\b/;
// MEDIO só vale junto do nome de um candidato, e vale igual para todos eles.
const OPINIAO_URL = /\/(opiniao|colunas?|colunistas?|blogs?|artigos?|editorial|editoriais|analises?)\//i;
const OPINIAO_CAT = /opini|coluna|artigo|editorial|blog|crônica|cronica/i;
const REGISTRO = /\b([A-Z]{2})-(\d{5})\/(20\d{2})\b/g;
// Nomes que confundem com os candidatos (ex.: Flávio Dino, ministro do STF)
const HOMONIMOS = /\bFLAVIO DINO\b/g;

const TITULOS = /^(CANDIDAT[OA]|GOVERNADORA?|SENADORA?|DEPUTAD[OA]|PREFEIT[OA]|PROFESSORA?|DOUTORA?|PASTORA?|DELEGAD[OA]|CORONEL|CAPITAO|GENERAL|VICE|JUIZA?|MAJOR|SARGENTO|IRMAO|IRMA|PADRE|BISPO|MESTRE)$/;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function padroesDe(nomes) {
  const ps = new Set();
  for (const nome of nomes) {
    const n = normalizar(nome);
    if (!n) continue;
    ps.add(n);
    const partes = n.split(' ');
    const ult = partes.at(-1);
    if (partes.length > 1 && ult.length >= 4) ps.add(ult);
    if (partes.length > 1 && partes[0].length >= 4 && !TITULOS.test(partes[0])) ps.add(partes[0]);
  }
  return [...ps].map((p) => new RegExp(`\\b${reEsc(p)}\\b`));
}

/**
 * Contexto com os nomes da disputa: { presidente: ['FLÁVIO BOLSONARO', 'LULA'], governadores: [{ uf, nomes }] }.
 * Compila uma vez e reaproveita.
 */
export function prepararContexto({ presidente = [], governadores = [], apelidos = [] } = {}) {
  return {
    presidente: padroesDe([...presidente, ...apelidos]),
    governadores: governadores.map((g) => ({ uf: g.uf, padroes: padroesDe(g.nomes) })),
  };
}

export function ehOpiniao(item) {
  return OPINIAO_URL.test(item.link || '') || (item.categorias || []).some((c) => OPINIAO_CAT.test(c));
}

/** Classifica um item. Devolve null se não for sobre a eleição. */
export function classificar(item, ctx = prepararContexto()) {
  if (ehOpiniao(item)) return null;
  const titulo = normalizar(item.titulo).replace(HOMONIMOS, ' ');
  const tudo = `${titulo} ${normalizar(item.resumo).replace(HOMONIMOS, ' ')}`;
  const temPres = ctx.presidente.some((r) => r.test(titulo));
  const govs = ctx.governadores.filter((g) => g.padroes.some((r) => r.test(titulo)));
  const temCand = temPres || govs.length > 0;
  // A decisão usa só o título: o resumo de matérias longas cita "eleição" à toa.
  const relevante = FORTE.test(titulo) || INSTITUTOS.test(titulo) || (temCand && MEDIO.test(titulo)) || (govs.length > 0 && /\bGOVERN/.test(titulo));
  if (!relevante) return null;

  const registros = [...new Set([...`${item.titulo} ${item.resumo || ''}`.matchAll(REGISTRO)]
    .filter((m) => m[1] === 'BR' || UFS.includes(m[1].toLowerCase())).map((m) => m[0]))];
  const etiquetas = [];
  const pesquisa = INSTITUTOS.test(titulo) || /\bINTENCAO DE VOTO\b/.test(titulo) || registros.length > 0
    || (/\bPESQUISAS?\b/.test(titulo) && (temCand || /\b(TURNO|ELEITORA\w*|LIDERA|EMPATE|VANTAGEM|\d+%)\b|\d+(,\d+)?%/.test(titulo)));
  if (pesquisa) etiquetas.push('pesquisa');
  if (/\bDEBATES?\b/.test(titulo) && (temCand || /\b(TURNO|RECORD|BAND|GLOBO|SBT|CNN|PRESIDENCI\w*|GOVERNADOR\w*|CANDIDAT\w*)\b/.test(titulo))) etiquetas.push('debate');
  if (/\b(TSE|TRE-[A-Z]{2}|TRE|JUSTICA ELEITORAL|CORREGEDOR\w*|CASSACAO|INELEGIV\w*|DIREITO DE RESPOSTA|IMPUGNA\w*|MINISTERIO PUBLICO ELEITORAL)\b/.test(titulo)) etiquetas.push('justica');
  if (temPres || /\b(PRESIDEN\w*|PLANALTO|REELEI\w*)\b/.test(titulo)) etiquetas.push('presidente');

  const ufs = new Set(govs.map((g) => g.uf));
  for (const m of tudo.matchAll(/\bTRE-([A-Z]{2})\b/g)) if (UFS.includes(m[1].toLowerCase())) ufs.add(m[1].toLowerCase());
  for (const m of `${item.titulo} ${item.resumo || ''}`.matchAll(/\(([A-Z]{2})\)/g)) if (UFS.includes(m[1].toLowerCase())) ufs.add(m[1].toLowerCase());
  for (const [uf, re] of ESTADOS) if (re.test(titulo)) ufs.add(uf);
  if (govs.length || /\bGOVERNADOR(A|AS|ES)?\b|\bGOVERNO D[OE] ESTADO\b/.test(titulo)) etiquetas.push('governadores');

  return { etiquetas, ufs: [...ufs].sort(), registros };
}
