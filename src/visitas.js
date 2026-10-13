// Contagem de acessos sem cookie e sem guardar IP (LGPD): cada abertura do site conta uma página
// vista; visitante único do dia = resumo (hash) de IP + navegador com um sal sorteado a cada dia,
// que só existe na memória. Ninguém, nem o dono do site, consegue voltar do resumo para o IP.
// Robôs (buscadores, prévias de link, monitores) não contam. Os totais por dia vão para o banco
// (se ligado) e para data/visitas.json. Depois de um reinício, quem voltar no mesmo dia pode ser
// contado de novo: o número é uma boa aproximação, não uma contagem exata.

import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const ROBO = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|uptime|monitor|pingdom|statuscake|headless|lighthouse|curl|wget|python|node-fetch|undici|go-http|java\/|okhttp|axios|render/i;
const DIAS_GUARDADOS = 90;
const diaSP = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(ms);

export class Visitas {
  constructor({ dataDir = null, banco = null, log = console, agora = () => Date.now() } = {}) {
    this.arquivo = dataDir ? path.join(dataDir, 'visitas.json') : null;
    this.banco = banco;
    this.log = log;
    this.agora = agora;
    this.dias = new Map(); // 'AAAA-MM-DD' -> { visitantes, paginas }
    this.dia = null; this.sal = null; this.vistos = new Set();
    this.sujos = new Set();
  }

  async carregar() {
    try {
      if (this.arquivo) for (const d of JSON.parse(await readFile(this.arquivo, 'utf8')).dias || []) this.dias.set(d.dia, { visitantes: d.visitantes, paginas: d.paginas });
    } catch { /* primeiro uso */ }
    if (this.banco) {
      try {
        // O banco é a fonte (o disco do Render some); vale o maior de cada dia
        for (const d of await this.banco.lerVisitas(DIAS_GUARDADOS)) {
          const a = this.dias.get(d.dia);
          this.dias.set(d.dia, { visitantes: Math.max(d.visitantes, a?.visitantes || 0), paginas: Math.max(d.paginas, a?.paginas || 0) });
        }
      } catch (e) { this.log.warn?.(`[visitas] banco indisponível: ${e.message}`); }
    }
  }

  /** Conta uma abertura do site. ip: o do visitante (ipCliente). Devolve true se contou. */
  registrar(req, ip) {
    const ua = String(req.headers['user-agent'] || '');
    if (req.method !== 'GET' || !ua || ROBO.test(ua)) return false;
    // Pré-carregamento do navegador não é visita
    if (/prefetch|prerender/i.test(`${req.headers['sec-purpose'] || ''} ${req.headers.purpose || ''}`)) return false;
    const hoje = diaSP(this.agora());
    if (hoje !== this.dia) { this.dia = hoje; this.sal = randomBytes(16); this.vistos = new Set(); }
    const d = this.dias.get(hoje) || { visitantes: 0, paginas: 0 };
    d.paginas++;
    const id = createHash('sha256').update(this.sal).update(`${ip}|${ua}`).digest('base64url').slice(0, 16);
    if (!this.vistos.has(id)) { this.vistos.add(id); d.visitantes++; }
    this.dias.set(hoje, d);
    this.sujos.add(hoje);
    return true;
  }

  /** Resumo para o painel: hoje, ontem e os últimos dias (do mais antigo ao mais novo). */
  resumo(nDias = 14) {
    const agora = this.agora();
    const lista = [];
    for (let i = nDias - 1; i >= 0; i--) {
      const dia = diaSP(agora - i * 86_400_000);
      const d = this.dias.get(dia);
      lista.push({ dia, visitantes: d?.visitantes || 0, paginas: d?.paginas || 0 });
    }
    let total = 0;
    for (const d of this.dias.values()) total += d.visitantes;
    return { hoje: lista.at(-1), ontem: lista.at(-2), dias: lista, totalVisitantes: total, erro: this.erro || null };
  }

  async salvar() {
    if (!this.sujos.size) return;
    const sujos = [...this.sujos]; this.sujos.clear();
    const limite = diaSP(this.agora() - DIAS_GUARDADOS * 86_400_000);
    for (const k of this.dias.keys()) if (k < limite) this.dias.delete(k);
    if (this.arquivo) {
      try {
        await mkdir(path.dirname(this.arquivo), { recursive: true });
        const tmp = `${this.arquivo}.tmp`;
        await writeFile(tmp, JSON.stringify({ dias: [...this.dias].map(([dia, d]) => ({ dia, ...d })) }));
        await rename(tmp, this.arquivo);
      } catch (e) { this.log.warn?.(`[visitas] arquivo: ${e.message}`); }
    }
    if (this.banco) {
      try {
        await this.banco.gravarVisitas(sujos.filter((k) => this.dias.has(k)).map((dia) => ({ dia, ...this.dias.get(dia) })));
        this.erro = null;
      } catch (e) {
        for (const k of sujos) this.sujos.add(k);
        this.erro = /visitas_diarias|PGRST205|HTTP 404/.test(e.message) ? 'falta a tabela visitas_diarias no banco: rode de novo o supabase/schema.sql' : e.message;
        this.log.warn?.(`[visitas] banco: ${e.message}`);
      }
    }
  }

  /** Grava a cada minuto (só se mudou). */
  start(intervaloMs = 60_000) {
    this.timer = setInterval(() => this.salvar(), intervaloMs);
    this.timer.unref?.();
  }
  async stop() { clearInterval(this.timer); await this.salvar(); }
}
