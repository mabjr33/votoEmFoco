// Construção de URLs dos arquivos de divulgação do TSE (EA11/EA20).
// Erros de URL geram 404, e muitos 404 podem bloquear o IP — por isso tudo é validado aqui.

const UF_RE = /^[a-z]{2}$/;

export const CARGOS = Object.freeze({ PRESIDENTE: 1, GOVERNADOR: 3, SENADOR: 5 });

export function pad(n, size) {
  const s = String(n);
  if (!/^\d+$/.test(s)) throw new Error(`Código numérico inválido: ${n}`);
  return s.padStart(size, '0');
}

export function configPath(cfg) {
  return `/${cfg.ambiente}/comum/config/ele-c.json`;
}

/**
 * Preenche o template de diretório vindo de ele-c.json (campo arq[].dir), ex.:
 * "<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>"
 * Retorna apenas o caminho (sem host), para ser combinado com cfg.base.
 */
export function fillDir(template, { ambiente, ciclo, eleicao, uf }) {
  return template
    .replace('<base>', '')
    .replace('<ambiente>', ambiente)
    .replace('<ciclo>', ciclo)
    .replace('<cd_eleicao>', String(Number(eleicao)))
    .replace('<uf>', uf);
}

/**
 * Caminho do arquivo de resultado unificado (EA20, sufixo -u.json).
 * Com `municipio` (código TSE de 5 dígitos), gera o arquivo do município/localidade dentro da UF.
 */
export function resultPath(cfg, { eleicao, cargo, abrangencia, municipio, dirTemplate }) {
  const abr = String(abrangencia).toLowerCase();
  if (abr !== 'br' && !UF_RE.test(abr)) throw new Error(`Abrangência inválida: ${abrangencia}`);
  if (municipio !== undefined && (abr === 'br' || !/^\d{1,5}$/.test(String(municipio)))) throw new Error(`Município inválido: ${municipio}`);
  const dir = dirTemplate
    ? fillDir(dirTemplate, { ambiente: cfg.ambiente, ciclo: cfg.ciclo, eleicao, uf: abr })
    : `/${cfg.ambiente}/${cfg.ciclo}/${Number(eleicao)}/dados/${abr}`;
  const prefixo = municipio !== undefined ? `${abr}${pad(municipio, 5)}` : abr;
  return `${dir}/${prefixo}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;
}

/** Caminho do arquivo de configuração de municípios (EA12, sufixo -cm.json). */
export function municipiosPath(cfg, { eleicao, dirTemplate }) {
  const dir = dirTemplate
    ? fillDir(dirTemplate, { ambiente: cfg.ambiente, ciclo: cfg.ciclo, eleicao, uf: '' }).replace(/\/$/, '')
    : `/${cfg.ambiente}/${cfg.ciclo}/${Number(eleicao)}/config`;
  return `${dir}/mun-e${pad(eleicao, 6)}-cm.json`;
}

/**
 * Extrai as localidades de uma UF do EA12. Procura, em qualquer nível, um objeto com cd igual à UF
 * e uma lista `mu` — tolerante a pequenas variações de leiaute.
 */
export function localidadesDe(cm, uf = 'zz') {
  const alvo = uf.toLowerCase();
  const pilha = [cm];
  while (pilha.length) {
    const o = pilha.pop();
    if (Array.isArray(o)) { pilha.push(...o); continue; }
    if (!o || typeof o !== 'object') continue;
    if (String(o.cd || '').toLowerCase() === alvo && Array.isArray(o.mu)) {
      return o.mu
        .filter((m) => m && /^\d{1,5}$/.test(String(m.cd)))
        .map((m) => ({ cd: String(m.cd).padStart(5, '0'), nome: String(m.nm || m.ds || m.cd).trim() }));
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') pilha.push(v);
  }
  return [];
}
