// Normalização do arquivo EA20 (resultado unificado) para um formato interno enxuto.
// Especificação: TSE-EA20-Arquivo-de-resultado-unificado (versão 2026-07-10).

/** Converte números do TSE: inteiros como "56104503", percentuais como "47,03" ou "47.034567891". */
export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const pick = (obj, k9, k2) => (obj?.[k9] !== undefined && obj?.[k9] !== '' ? num(obj[k9]) : num(obj?.[k2]));

export function normalizeEA20(j) {
  if (!j || typeof j !== 'object') throw new Error('EA20 vazio ou inválido');
  const cands = [];
  const carg = (j.carg || [])[0] || {};
  for (const agr of carg.agr || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        cands.push({
          n: String(c.n),
          sq: c.sqcand ? String(c.sqcand) : null,
          nm: c.nm || '',
          nmu: c.nmu || c.nm || `Candidato ${c.n}`,
          partido: (par.sg || '').replace(/\*+$/, ''),
          composicao: agr.tp && agr.tp !== 'i' ? agr.com || '' : '',
          coligacao: agr.tp && agr.tp !== 'i' ? agr.nm || '' : '',
          seq: num(c.seq),
          eleito: c.e === 's',
          st: c.st || '',
          dvt: c.dvt || '',
          vap: num(c.vap),
          pvap: pick(c, 'pvapn', 'pvap'),
          vice: (c.vs || []).find((v) => v.tp === 'v')?.nmu || null,
        });
      }
    }
  }
  cands.sort((a, b) => b.vap - a.vap || a.seq - b.seq);
  const s = j.s || {};
  const e = j.e || {};
  const v = j.v || {};
  return {
    ele: String(Number(j.ele || 0)),
    turno: Number(j.t || 1),
    tpabr: j.tpabr || '',
    cd: String(j.cdabr || '').toLowerCase(),
    cargo: num(carg.cd),
    cargoNome: carg.nmn || '',
    geradoEm: [j.dg, j.hg].filter(Boolean).join(' '),
    totalizadoEm: [j.dt, j.ht].filter(Boolean).join(' '),
    idg: j.idg ? String(j.idg) : null,
    totalFinal: j.tf === 's',
    andamento: j.and || 'n',
    md: j.md || null,
    divulga: j.dv !== 'n',
    secoes: { ts: num(s.ts), st: num(s.st), pst: pick(s, 'pstn', 'pst'), snt: num(s.snt) },
    eleitores: {
      te: num(e.te), est: num(e.est), esnt: num(e.esnt), esi: num(e.esi),
      c: num(e.c), a: num(e.a), pc: pick(e, 'pcn', 'pc'), pa: pick(e, 'pan', 'pa'),
    },
    votos: {
      tv: num(v.tv), vv: num(v.vv), vb: num(v.vb), tvn: num(v.tvn),
      van: num(v.van), vansj: num(v.vansj), pvb: pick(v, 'pvbn', 'pvb'), ptvn: pick(v, 'ptvnn', 'ptvn'),
    },
    cands,
  };
}

/** Finalistas de um arquivo: quem tem st "2º turno"/e="s"; senão, os dois mais votados. */
export function finalistsFrom(unit) {
  const marked = unit.cands.filter((c) => /2.?\s*turno/i.test(c.st) || (c.eleito && !/^eleito/i.test(c.st)));
  const list = (marked.length >= 2 ? marked : unit.cands).slice(0, 2);
  return list.map((c) => c.n);
}

/** Indica se o arquivo de 1º turno de um cargo majoritário resultou em 2º turno. */
export function wentToRunoff(unit) {
  if (unit.md === 's') return true;
  if (unit.cands.some((c) => /2.?\s*turno/i.test(c.st))) return true;
  if (unit.totalFinal && unit.cands.length >= 2) {
    const top = unit.cands[0];
    return !top.eleito && top.pvap <= 50;
  }
  return false;
}
