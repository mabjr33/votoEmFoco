// Coletor: descobre as eleições no ele-c.json, carrega o 1º turno (base do simulador)
// e acompanha o 2º turno em tempo real assim que o TSE o publica na configuração.

import { EventEmitter } from 'node:events';
import { CARGOS, configPath, resultPath, municipiosPath, localidadesDe } from './tse/urls.js';
import { normalizeEA20, finalistsFrom, wentToRunoff } from './tse/normalize.js';

const UF_NOMES = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul', mt: 'Mato Grosso',
  pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
  ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul', sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo',
  to: 'Tocantins', zz: 'Exterior', br: 'Brasil',
};
export { UF_NOMES };

export class Collector extends EventEmitter {
  constructor(cfg, client, { log = console } = {}) {
    super();
    this.cfg = cfg;
    this.client = client;
    this.log = log;
    this.races = new Map();
    this.endorsers = {}; // uf -> { gov: [...], sen: [...] }
    this.discovery = { federal2: null, estadual2: null, federal2Disponivel: false, estadual2Ufs: [], dirU: null, dirCm: null, configEm: null };
    // Votos no exterior por localidade (cidade) — Presidente
    this.eventos = []; // últimas atualizações (mais recente primeiro)
    this.fotos = new Map(); // sqcand -> { ele, uf } autorizados para o proxy de fotos
    this.exterior = { cidades1: [], cidades2: null, t1: {}, t2: {}, version: 0, ultimaVarredura: 0, varrendo: false, atualizadoEm: null };
    this.lastPoll = null;
    this.lastConfig = null;
    this.timers = [];
    this.running = false;
    this.ready = false;
  }

  get presUnits() {
    return this.cfg.incluirExterior ? [...this.cfg.ufs, this.cfg.exterior] : [...this.cfg.ufs];
  }

  path(eleicao, cargo, abrangencia) {
    return resultPath(this.cfg, { eleicao, cargo, abrangencia, dirTemplate: this.discovery.dirU });
  }

  async fetchUnit(eleicao, cargo, abr, { skipIfFinal = false } = {}) {
    const p = this.path(eleicao, cargo, abr);
    if (skipIfFinal) {
      const cached = await this.client.readCache(p);
      if (cached?.body?.tf === 's' && cached?.body?.and === 'f') return { unit: normalizeEA20(cached.body), status: 'cached' };
    }
    const r = await this.client.getJson(p);
    if (!r.data) return { unit: null, status: r.status };
    try {
      return { unit: normalizeEA20(r.data), status: r.status };
    } catch (err) {
      this.log.warn?.(`[coletor] JSON inválido em ${p}: ${err.message}`);
      return { unit: null, status: 'error' };
    }
  }

  // ---------- descoberta (EA11) ----------
  async discover() {
    const r = await this.client.getJson(configPath(this.cfg), { quarantineMs: 60_000 });
    if (!r.data) return false;
    const cfgJson = r.data;
    const all = (cfgJson.pl || []).flatMap((pl) => pl.e || []);
    const byCd = new Map(all.map((e) => [String(e.cd), e]));
    const fed1 = byCd.get(String(this.cfg.eleicoes.federal1));
    const est1 = byCd.get(String(this.cfg.eleicoes.estadual1));
    const dirU = (cfgJson.arq || []).find((a) => a.tp === 'u')?.dir || null;
    const dirCm = (cfgJson.arq || []).find((a) => a.tp === 'cm')?.dir || null;
    const dirFt = (cfgJson.arq || []).find((a) => a.tp === 'ft')?.dir || null;
    const federal2 = fed1?.cdt2 || null;
    const estadual2 = est1?.cdt2 || null;
    const fed2 = federal2 ? byCd.get(String(federal2)) : null;
    const est2 = estadual2 ? byCd.get(String(estadual2)) : null;
    const estUfs = est2
      ? (est2.abr || [])
          .filter((a) => (a.cp || []).some((cp) => Number(cp.cd) === CARGOS.GOVERNADOR))
          .map((a) => String(a.cd).toLowerCase())
      : [];
    const prev = JSON.stringify(this.discovery);
    this.discovery = {
      federal2, estadual2,
      federal2Disponivel: !!fed2,
      estadual2Ufs: estUfs,
      dirU,
      dirCm,
      dirFt,
      configEm: [cfgJson.dg, cfgJson.hg].filter(Boolean).join(' '),
    };
    this.lastConfig = new Date().toISOString();
    if (prev !== JSON.stringify(this.discovery)) {
      this.log.info?.(`[coletor] configuração TSE: 2º turno federal ${federal2} ${fed2 ? 'PUBLICADO' : 'ainda não publicado'}; estadual ${estadual2} UFs=[${estUfs.join(',')}]`);
      this.syncLiveAvailability();
      this.emit('update', { raceId: '*' });
    }
    return true;
  }

  syncLiveAvailability() {
    for (const race of this.races.values()) {
      const avail = race.cargo === CARGOS.PRESIDENTE
        ? this.discovery.federal2Disponivel
        : this.discovery.estadual2Ufs.includes(race.scope);
      race.ele2 = race.cargo === CARGOS.PRESIDENTE ? this.discovery.federal2 : this.discovery.estadual2;
      race.live.available = avail && !!race.ele2;
    }
  }

  // ---------- 1º turno (base) ----------
  async loadBaselines() {
    const { federal1, estadual1 } = this.cfg.eleicoes;

    // Presidente
    const pres = this.ensureRace('pres', { label: 'Presidente', cargo: CARGOS.PRESIDENTE, scope: 'br', ele1: federal1 });
    const br = await this.fetchUnit(federal1, CARGOS.PRESIDENTE, 'br', { skipIfFinal: true });
    if (br.unit) pres.baseline.summary = br.unit;
    for (const uf of this.presUnits) {
      const r = await this.fetchUnit(federal1, CARGOS.PRESIDENTE, uf, { skipIfFinal: true });
      if (r.unit) pres.baseline.units[uf] = r.unit;
    }
    if (pres.baseline.summary) {
      pres.finalists = finalistsFrom(pres.baseline.summary);
      for (const c of pres.baseline.summary.cands.slice(0, 6)) this.autorizarFoto(c.sq, federal1, 'br');
    }
    if (this.cfg.incluirExterior) await this.carregarExterior1().catch((e) => this.log.warn?.(`[coletor] exterior 1º turno: ${e.message}`));

    // Governador e Senador (todas as UFs: base para apoios e detecção de 2º turno)
    const runoffUfs = [];
    for (const uf of this.cfg.ufs) {
      const gov = await this.fetchUnit(estadual1, CARGOS.GOVERNADOR, uf, { skipIfFinal: true });
      const sen = await this.fetchUnit(estadual1, CARGOS.SENADOR, uf, { skipIfFinal: true });
      this.endorsers[uf] = {
        gov: gov.unit ? compactEndorsers(gov.unit) : [],
        sen: sen.unit ? compactEndorsers(sen.unit) : [],
        govInfo: gov.unit ? { totalizadoEm: gov.unit.totalizadoEm, pst: gov.unit.secoes.pst, segundoTurno: wentToRunoff(gov.unit) } : null,
      };
      for (const c of this.endorsers[uf].gov.slice(0, 3)) this.autorizarFoto(c.sq, estadual1, uf);
      for (const c of this.endorsers[uf].sen.slice(0, 3)) this.autorizarFoto(c.sq, estadual1, uf);
      this.semearEventos(uf, gov.unit, sen.unit);
      if (gov.unit && wentToRunoff(gov.unit)) {
        runoffUfs.push(uf);
        const race = this.ensureRace(`gov-${uf}`, { label: `Governador — ${UF_NOMES[uf]}`, cargo: CARGOS.GOVERNADOR, scope: uf, ele1: estadual1 });
        race.baseline.summary = gov.unit;
        race.baseline.units = { [uf]: gov.unit };
        race.finalists = finalistsFrom(gov.unit);
        for (const c of gov.unit.cands.slice(0, 2)) this.autorizarFoto(c.sq, estadual1, uf);
      }
    }
    // Fallback: se o TSE ainda não marcou o 2º turno nos arquivos, usa a lista configurada
    if (runoffUfs.length === 0) {
      for (const uf of this.cfg.governador2TurnoFallback || []) {
        this.ensureRace(`gov-${uf}`, { label: `Governador — ${UF_NOMES[uf]}`, cargo: CARGOS.GOVERNADOR, scope: uf, ele1: estadual1 });
      }
    }
    // Endorsers do próprio presidente (para apoios em disputas estaduais)
    for (const [uf, u] of Object.entries(pres.baseline.units)) {
      if (this.endorsers[uf]) this.endorsers[uf].pres = compactEndorsers(u);
    }
    this.syncLiveAvailability();
    this.ready = true;
    this.emit('update', { raceId: '*' });
  }

  ensureRace(id, { label, cargo, scope, ele1 }) {
    if (!this.races.has(id)) {
      this.races.set(id, {
        id, label, cargo, scope, ele1, ele2: null,
        finalists: [],
        baseline: { summary: null, units: {} },
        live: { available: false, summary: null, units: {}, atualizadoEm: null, history: [] },
        version: 0,
      });
    }
    return this.races.get(id);
  }

  // ---------- fotos e eventos ----------
  autorizarFoto(sq, ele, uf) {
    if (sq && /^\d{6,16}$/.test(String(sq))) this.fotos.set(String(sq), { ele: String(ele), uf });
  }

  /** Foto de candidato via proxy: só para candidatos já carregados (evita 404 em massa no TSE). */
  async foto(sq) {
    const info = this.fotos.get(String(sq));
    if (!info) return null;
    const tpl = this.discovery.dirFt || '<base>/<ambiente>/<ciclo>/<cd_eleicao>/fotos/<uf>';
    const dir = tpl.replace('<base>', '').replace('<ambiente>', this.cfg.ambiente).replace('<ciclo>', this.cfg.ciclo)
      .replace('<cd_eleicao>', String(Number(info.ele))).replace('<uf>', info.uf);
    const r = await this.client.getBinary(`${dir}/${sq}.jpeg`);
    return r.body ? r : null;
  }

  /** Nomes da disputa para o classificador de notícias. */
  contextoNoticias() {
    const nomes = (r) => (r?.finalists || []).map((n) => (r.baseline?.summary?.cands || r.live?.summary?.cands || []).find((c) => c.n === n)?.nmu).filter(Boolean);
    const governadores = [];
    for (const r of this.races.values()) if (r.cargo === CARGOS.GOVERNADOR) { const ns = nomes(r); if (ns.length) governadores.push({ uf: r.scope, nomes: ns }); }
    return { presidente: nomes(this.races.get('pres')), governadores };
  }

  addEvento(ev) {
    const chave = ev.chave || `${ev.tipo}:${ev.texto}`;
    if (this.eventos.some((e) => e.chave === chave)) return;
    this.eventos.unshift({ ...ev, chave });
    this.eventos.sort((x, y) => (y.ts || 0) - (x.ts || 0));
    if (this.eventos.length > 120) this.eventos.length = 120;
  }

  semearEventos(uf, gov, sen) {
    const nome = UF_NOMES[uf];
    if (gov?.totalFinal) {
      const eleito = gov.cands.find((c) => /^Eleit/i.test(c.st));
      const seg = gov.cands.filter((c) => /2.?\s*turno/i.test(c.st));
      if (eleito) this.addEvento({ tipo: 'eleito', uf, ts: tsDe(gov.totalizadoEm), hora: horaDe(gov.totalizadoEm), texto: `${nome}: ${eleito.nmu} é eleito governador.`, destaque: eleito.nmu, sq: eleito.sq, partido: eleito.partido });
      else if (seg.length === 2) this.addEvento({ tipo: 'segundo', uf, ts: tsDe(gov.totalizadoEm), hora: horaDe(gov.totalizadoEm), texto: `${nome}: ${seg[0].nmu} e ${seg[1].nmu} vão ao 2º turno para governador.`, partido: seg[0].partido });
    }
    if (sen?.totalFinal) {
      const eleitos = sen.cands.filter((c) => /^Eleit/i.test(c.st));
      if (eleitos.length) this.addEvento({ tipo: 'senado', uf, ts: tsDe(sen.totalizadoEm), hora: horaDe(sen.totalizadoEm),
        texto: `${nome}: ${eleitos.map((c) => c.nmu).join(' e ')} ${eleitos.length > 1 ? 'são eleitos' : 'é eleito'} para o Senado.`, sq: eleitos[0].sq, partido: eleitos[0].partido });
    }
  }

  eventosAoVivo(race, sm, a, b, last) {
    const hora = horaDe(sm.totalizadoEm), ts = tsDe(sm.totalizadoEm) || Date.now();
    // Para o feed não virar uma enxurrada: um evento a cada 2 pontos de apuração ou 5 minutos
    const ref = this.ultimoEventoSecoes || { st: 0, pst: 0, ts: 0 };
    const delta = sm.secoes.st - ref.st;
    const relevante = sm.secoes.pst - ref.pst >= 2 || ts - ref.ts >= 5 * 60_000 || sm.secoes.pst >= 100;
    if (race.cargo === CARGOS.PRESIDENTE && sm.secoes.st > 0 && delta > 0 && relevante) {
      this.ultimoEventoSecoes = { st: sm.secoes.st, pst: sm.secoes.pst, ts };
      this.addEvento({ tipo: 'secoes', ts, hora, chave: `secoes:${sm.secoes.st}`,
        texto: `+${delta.toLocaleString('pt-BR')} seções (${sm.secoes.pst.toFixed(1).replace('.', ',')}% apurado)`,
        a: a ? { nmu: a.nmu, pvap: a.pvap, partido: a.partido } : null, b: b ? { nmu: b.nmu, pvap: b.pvap, partido: b.partido } : null });
    }
    const nome = race.cargo === CARGOS.PRESIDENTE ? 'Brasil' : UF_NOMES[race.scope];
    const cargo = race.cargo === CARGOS.PRESIDENTE ? 'presidente' : 'governador';
    const venc = sm.cands.find((c) => c.eleito && /^Eleit/i.test(c.st));
    if (sm.totalFinal && venc) this.addEvento({ tipo: 'eleito', uf: race.scope, ts, hora, texto: `${nome}: ${venc.nmu} é eleito ${cargo}.`, sq: venc.sq, partido: venc.partido });
    else if (sm.md === 'e' && a && b) {
      const lider = a.vap >= b.vap ? a : b;
      this.addEvento({ tipo: 'definido', uf: race.scope, ts, hora, chave: `md:${race.id}`, texto: `${nome}: eleição para ${cargo} matematicamente definida a favor de ${lider.nmu}.`, sq: lider.sq, partido: lider.partido });
    }
  }

  // ---------- exterior (localidades de ZZ) ----------
  async localidades(eleicao) {
    const p = municipiosPath(this.cfg, { eleicao, dirTemplate: this.discovery.dirCm });
    const r = await this.client.getJson(p, { quarantineMs: 10 * 60_000 });
    return r.data ? localidadesDe(r.data, this.cfg.exterior) : [];
  }

  async carregarExterior1() {
    const ele = this.cfg.eleicoes.federal1;
    const cidades = await this.localidades(ele);
    if (!cidades.length) { this.log.warn?.('[coletor] nenhuma localidade do exterior encontrada no arquivo de municípios'); return; }
    this.exterior.cidades1 = cidades;
    for (const c of cidades) {
      const r = await this.fetchMunicipio(ele, c.cd, { skipIfFinal: true });
      if (r.unit) this.exterior.t1[c.cd] = r.unit;
    }
    this.exterior.version++;
    this.log.info?.(`[coletor] exterior: ${Object.keys(this.exterior.t1).length} de ${cidades.length} localidades carregadas (1º turno)`);
  }

  async fetchMunicipio(eleicao, cd, opts = {}) {
    const p = resultPath(this.cfg, { eleicao, cargo: CARGOS.PRESIDENTE, abrangencia: this.cfg.exterior, municipio: cd, dirTemplate: this.discovery.dirU });
    if (opts.skipIfFinal) {
      const cached = await this.client.readCache(p);
      if (cached?.body?.and === 'f') return { unit: normalizeEA20(cached.body), status: 'cached' };
    }
    const r = await this.client.getJson(p, { quarantineMs: 30 * 60_000 });
    if (!r.data) return { unit: null, status: r.status };
    try { return { unit: normalizeEA20(r.data), status: r.status }; } catch { return { unit: null, status: 'error' }; }
  }

  /**
   * Atualiza as localidades do exterior no 2º turno. Para poupar o limite do TSE, só varre quando o
   * arquivo agregado de ZZ mudou, no máximo uma vez a cada 60 s, e pula localidades já finalizadas.
   */
  async varrerExterior(ele2, zzMudou) {
    const ex = this.exterior;
    if (ex.varrendo) return;
    if (!ex.cidades2) {
      const lista = await this.localidades(ele2);
      ex.cidades2 = lista.length ? lista : ex.cidades1;
    }
    const agora = Date.now();
    const pendentes = ex.cidades2.filter((c) => ex.t2[c.cd]?.andamento !== 'f');
    if (!pendentes.length) return;
    if (!zzMudou && agora - ex.ultimaVarredura < 60_000 && Object.keys(ex.t2).length) return;
    if (zzMudou && agora - ex.ultimaVarredura < 20_000) return;
    ex.varrendo = true;
    ex.ultimaVarredura = agora;
    let mudou = false;
    try {
      for (const c of pendentes) {
        const r = await this.fetchMunicipio(ele2, c.cd);
        if (r.unit && (r.status === 'ok' || !ex.t2[c.cd])) { ex.t2[c.cd] = r.unit; mudou = true; }
      }
    } finally { ex.varrendo = false; }
    if (mudou) {
      ex.version++;
      ex.atualizadoEm = new Date().toISOString();
      this.emit('update', { raceId: 'exterior' });
    }
  }

  exteriorPayload() {
    const pres = this.races.get('pres');
    const fins = pres?.finalists || [];
    const ex = this.exterior;
    const resumo = (u) => {
      if (!u) return null;
      const a = u.cands.find((c) => c.n === fins[0])?.vap || 0;
      const b = u.cands.find((c) => c.n === fins[1])?.vap || 0;
      return {
        a, b, outros: u.cands.reduce((s, c) => s + c.vap, 0) - a - b,
        te: u.eleitores.te, comparecimento: u.eleitores.c, pc: u.eleitores.pc,
        pst: u.secoes.pst, ts: u.secoes.ts, brancosNulos: u.votos.vb + u.votos.tvn,
        andamento: u.andamento, totalizadoEm: u.totalizadoEm,
      };
    };
    const lista = ex.cidades2 || ex.cidades1;
    const nomes = new Map([...ex.cidades1, ...(ex.cidades2 || [])].map((c) => [c.cd, c.nome]));
    const cds = [...new Set([...lista.map((c) => c.cd), ...Object.keys(ex.t1)])];
    return {
      version: ex.version + (pres?.version || 0),
      finalistas: this.racePayload('pres')?.finalists || [],
      aoVivo: !!pres?.live.available,
      atualizadoEm: ex.atualizadoEm,
      total: { t1: resumo(pres?.baseline.units[this.cfg.exterior]), t2: resumo(pres?.live.units[this.cfg.exterior]) },
      cidades: cds.map((cd) => ({ cd, nome: nomes.get(cd) || cd, t1: resumo(ex.t1[cd]), t2: resumo(ex.t2[cd]) })),
    };
  }

  // ---------- 2º turno (tempo real) ----------
  async pollLive() {
    for (const race of this.races.values()) {
      if (!race.live.available || !race.ele2) continue;
      let changed = false;
      const scopeAbr = race.cargo === CARGOS.PRESIDENTE ? 'br' : race.scope;
      const s = await this.fetchUnit(race.ele2, race.cargo, scopeAbr);
      if (s.unit && s.status === 'ok') { race.live.summary = s.unit; changed = true; }
      else if (s.unit && !race.live.summary) race.live.summary = s.unit;
      if (race.cargo === CARGOS.PRESIDENTE) {
        let zzMudou = false;
        for (const uf of this.presUnits) {
          const r = await this.fetchUnit(race.ele2, race.cargo, uf);
          if (r.unit && (r.status === 'ok' || !race.live.units[uf])) { race.live.units[uf] = r.unit; changed = changed || r.status === 'ok'; }
          if (uf === this.cfg.exterior && r.status === 'ok') zzMudou = true;
        }
        if (this.cfg.incluirExterior) await this.varrerExterior(race.ele2, zzMudou).catch((e) => this.log.warn?.(`[coletor] exterior: ${e.message}`));
      } else if (race.live.summary) {
        race.live.units = { [race.scope]: race.live.summary };
      }
      // A ordem dos finalistas (A = 1º colocado no 1º turno) é fixa para o simulador não "trocar" de lado.
      if (race.live.summary && race.finalists.length < 2) {
        const f = finalistsFrom(race.live.summary);
        if (f.length === 2) race.finalists = f;
      }
      if (changed) {
        race.version++;
        race.live.atualizadoEm = new Date().toISOString();
        const sm = race.live.summary;
        if (sm) {
          const [fa, fb] = race.finalists;
          const a = sm.cands.find((c) => c.n === fa), b = sm.cands.find((c) => c.n === fb);
          const last = race.live.history.at(-1);
          this.eventosAoVivo(race, sm, a, b, last);
          if (!last || last.pst !== sm.secoes.pst) {
            race.live.history.push({ t: sm.totalizadoEm || race.live.atualizadoEm, pst: sm.secoes.pst, st: sm.secoes.st, pA: a?.pvap ?? null, pB: b?.pvap ?? null });
            if (race.live.history.length > 500) race.live.history.shift();
          }
        }
        this.emit('update', { raceId: race.id, pst: race.live.summary?.secoes.pst ?? null });
      }
    }
    this.lastPoll = new Date().toISOString();
  }

  async start() {
    this.running = true;
    await this.client.init();
    await this.discover().catch((e) => this.log.warn?.(`[coletor] descoberta falhou: ${e.message}`));
    await this.loadBaselines().catch((e) => this.log.error?.(`[coletor] base 1º turno falhou: ${e.stack}`));
    const loop = async (fn, ms) => {
      if (!this.running) return;
      try { await fn(); } catch (e) { this.log.error?.(`[coletor] ${e.stack}`); }
      if (this.running) this.timers.push(setTimeout(() => loop(fn, ms), ms));
    };
    loop(() => this.pollLive(), this.cfg.pollIntervalMs);
    this.timers.push(setTimeout(() => loop(() => this.discover(), this.cfg.configIntervalMs), this.cfg.configIntervalMs));
  }

  stop() {
    this.running = false;
    this.timers.forEach(clearTimeout);
  }

  // ---------- visões para a API ----------
  raceList() {
    return [...this.races.values()]
      .sort((a, b) => a.cargo - b.cargo || a.label.localeCompare(b.label, 'pt'))
      .map((r) => ({
        id: r.id, label: r.label, cargo: r.cargo, scope: r.scope,
        temBase: Object.keys(r.baseline.units).length > 0,
        aoVivo: r.live.available,
        pst: r.live.summary?.secoes.pst ?? null,
        version: r.version,
      }));
  }

  racePayload(id) {
    const r = this.races.get(id);
    if (!r) return null;
    const lookup = r.live.summary || r.baseline.summary;
    const finalists = r.finalists.map((n) => {
      const c = lookup?.cands.find((x) => x.n === n) || r.baseline.summary?.cands.find((x) => x.n === n);
      return c ? { n: c.n, sq: c.sq, nmu: c.nmu, partido: c.partido, composicao: c.composicao, vice: c.vice } : { n, nmu: `Nº ${n}` };
    });
    return {
      id: r.id, label: r.label, cargo: r.cargo, scope: r.scope, version: r.version,
      finalists,
      baseline: r.baseline,
      live: r.live,
      ufNomes: UF_NOMES,
      fotoEle: String(r.ele1), fotoUf: r.cargo === CARGOS.PRESIDENTE ? 'br' : r.scope,
    };
  }

  status() {
    return {
      ready: this.ready,
      modoTeste: !!this.cfg.modoTeste,
      dadosReais: this.cfg.dadosReais || null,
      base: this.cfg.base,
      ambiente: this.cfg.ambiente,
      discovery: this.discovery,
      lastPoll: this.lastPoll,
      lastConfig: this.lastConfig,
      pausedUntil: this.client.pausedUntil ? new Date(this.client.pausedUntil).toISOString() : null,
      http: this.client.stats,
      pollIntervalMs: this.cfg.pollIntervalMs,
      maxRps: this.cfg.maxRps,
    };
  }
}

function compactEndorsers(unit) {
  const c = unit.eleitores.c || unit.votos.tv || 1;
  return unit.cands.slice(0, 8).map((x) => ({
    n: x.n, sq: x.sq, nmu: x.nmu, partido: x.partido, vap: x.vap, pvap: x.pvap,
    shareEleitores: x.vap / c, st: x.st, eleito: x.eleito,
  }));
}

/** "04/10/2026 18:30:00" -> timestamp (horário de Brasília) */
function tsDe(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`) : 0;
}
function horaDe(s) {
  const m = String(s || '').match(/(\d{2}):(\d{2}):\d{2}/);
  return m ? `${m[1]}h${m[2]}` : '';
}
