import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const file = JSON.parse(readFileSync(path.join(ROOT, 'config', 'elections.json'), 'utf8'));
  const env = process.env;
  let noticias = { fontes: [] };
  try { noticias = JSON.parse(readFileSync(path.join(ROOT, 'config', 'noticias.json'), 'utf8')); } catch { /* sem feeds */ }
  if (env.NEWS_POLL_MS) noticias.intervaloMs = Number(env.NEWS_POLL_MS);
  if (env.NOTICIAS === '0') noticias.fontes = [];
  const cfg = {
    noticias,
    ...file,
    base: env.TSE_BASE || file.base,
    ambiente: env.TSE_AMBIENTE || file.ambiente,
    pollIntervalMs: Number(env.POLL_MS || file.pollIntervalMs),
    maxRps: Number(env.MAX_RPS || file.maxRps),
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    adminToken: env.ADMIN_TOKEN || null, // código de instalação do painel (criar ou redefinir o acesso)
    adminLogin: env.ADMIN_LOGIN || null, // usuário e hash da senha do painel, gerados pelo próprio painel
    publicUrl: env.PUBLIC_URL || null,
    trustProxy: env.TRUST_PROXY === '1',
    ...overrides,
  };
  // Proteção: o TSE bloqueia IPs acima de 100 req/s. Nunca passamos de 50.
  cfg.maxRps = Math.min(Math.max(1, cfg.maxRps), 50);
  cfg.pollIntervalMs = Math.max(3000, cfg.pollIntervalMs);
  return cfg;
}
