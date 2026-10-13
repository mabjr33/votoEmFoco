// Defesas de rede compartilhadas: IP real do visitante atrás do proxy, limite de requisições por IP
// e proteção contra SSRF (o servidor ser usado para abrir endereços internos).

import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * IP do visitante. Atrás de proxy, cada proxy ACRESCENTA um endereço no fim de X-Forwarded-For;
 * o começo do cabeçalho vem do próprio visitante e pode ser inventado. Por isso vale o endereço
 * na posição `saltos` contando do fim (1 = só a hospedagem na frente; 2 = CDN + hospedagem).
 */
export function ipCliente(req, saltos = 0) {
  const direto = req.socket?.remoteAddress || '?';
  if (!saltos) return direto;
  const lista = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = lista.length >= saltos ? lista[lista.length - saltos] : lista[0];
  return ip && net.isIP(ip.replace(/^::ffff:/, '')) ? ip.replace(/^::ffff:/, '') : direto;
}

/**
 * Limite por IP (balde de fichas). Generoso de propósito: na noite da eleição muita gente navega
 * pelo mesmo IP de operadora (CGNAT). Serve para barrar robô martelando, não visitante comum.
 */
export class LimitadorIp {
  constructor({ porSegundo = 40, rajada = 200, maxIps = 50_000 } = {}) {
    this.porSegundo = porSegundo; this.rajada = rajada; this.maxIps = maxIps;
    this.baldes = new Map(); // ip -> { fichas, em }
  }
  permite(ip, agora = Date.now()) {
    let b = this.baldes.get(ip);
    if (!b) {
      if (this.baldes.size >= this.maxIps) this.limpar(agora);
      b = { fichas: this.rajada, em: agora };
      this.baldes.set(ip, b);
    }
    b.fichas = Math.min(this.rajada, b.fichas + ((agora - b.em) / 1000) * this.porSegundo);
    b.em = agora;
    if (b.fichas < 1) return false;
    b.fichas -= 1;
    return true;
  }
  /** Tira quem já encheu o balde de novo (não está usando). */
  limpar(agora = Date.now()) {
    const cheio = (this.rajada / this.porSegundo) * 1000;
    for (const [ip, b] of this.baldes) if (agora - b.em > cheio) this.baldes.delete(ip);
    if (this.baldes.size >= this.maxIps) this.baldes.clear();
  }
}

/** Endereço que não deve ser aberto pelo servidor: rede interna, local, metadados da nuvem etc. */
export function ipPrivado(ip) {
  const v = String(ip).replace(/^::ffff:/i, '');
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(v)) {
    const s = v.toLowerCase();
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8:');
  }
  return true;
}

/** Confere se a URL aponta para um endereço público (http/https, porta padrão, DNS fora da rede interna). */
export async function urlPublica(u, { resolver = lookup } = {}) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !ipPrivado(host);
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp)$/i.test(host) || /^localhost$/i.test(host)) return false;
  try {
    const ends = await resolver(host, { all: true });
    return ends.length > 0 && ends.every((e) => !ipPrivado(e.address));
  } catch { return false; }
}

/**
 * fetch que só abre endereços públicos e confere cada redirecionamento (um link "público" pode
 * redirecionar para um endereço interno). Até 5 redirecionamentos.
 */
export async function fetchPublico(fetchFn, u, opcoes = {}, { resolver } = {}) {
  let atual = u;
  for (let i = 0; i <= 5; i++) {
    if (!(await urlPublica(atual, { resolver }))) throw new Error('endereço não público');
    const r = await fetchFn(atual, { ...opcoes, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      atual = new URL(r.headers.get('location'), atual).href;
      try { await r.body?.cancel?.(); } catch { /* sem corpo */ }
      continue;
    }
    return r;
  }
  throw new Error('redirecionamentos demais');
}
