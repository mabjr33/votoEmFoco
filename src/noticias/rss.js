// Leitor de RSS 2.0 e Atom sem dependências. Tolerante a feeds cortados: só lê itens completos.

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', ordm: 'º', ordf: 'ª', deg: '°',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
  agrave: 'à', Agrave: 'À', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü',
};

export function decodificar(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTIDADES[e] ?? m;
  });
}

/** Conteúdo de um elemento como texto puro (sem CDATA, sem tags, entidades resolvidas). */
export function texto(s) {
  let t = String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/<[^>]*>/g, ' ');
  t = decodificar(t);
  if (/<[a-z/][^>]*>/i.test(t)) t = decodificar(t.replace(/<[^>]*>/g, ' ')); // HTML que veio escapado
  return t.replace(/\s+/g, ' ').trim();
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function campo(bloco, ...nomes) {
  for (const n of nomes) {
    const m = bloco.match(new RegExp(`<${reEsc(n)}(?:\\s[^>]*)?>([\\s\\S]*?)</${reEsc(n)}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}
function todos(bloco, nome) {
  return [...bloco.matchAll(new RegExp(`<${reEsc(nome)}(?:\\s[^>]*)?>([\\s\\S]*?)</${reEsc(nome)}>`, 'gi'))].map((m) => texto(m[1])).filter(Boolean);
}
const attr = (tag, a) => decodificar(tag.match(new RegExp(`\\s${a}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '');

function data(s) {
  const t = Date.parse(texto(s));
  return Number.isFinite(t) ? t : null;
}

/** Itens de um feed: [{ titulo, link, data (ms|null), resumo, categorias }]. */
export function lerFeed(xml) {
  const s = String(xml || '');
  const itens = [];
  for (const [bloco] of s.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    let link = texto(campo(bloco, 'link'));
    if (!/^https?:\/\//i.test(link)) link = texto(campo(bloco, 'guid'));
    itens.push({
      titulo: texto(campo(bloco, 'title')),
      link,
      data: data(campo(bloco, 'pubDate', 'dc:date', 'published', 'updated')),
      resumo: texto(campo(bloco, 'description', 'content:encoded')).slice(0, 600),
      categorias: todos(bloco, 'category'),
    });
  }
  for (const [bloco] of s.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const links = [...bloco.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const alt = links.find((l) => !/\srel=/i.test(l) || /rel=["']alternate["']/i.test(l)) || links[0] || '';
    itens.push({
      titulo: texto(campo(bloco, 'title')),
      link: attr(alt, 'href'),
      data: data(campo(bloco, 'published', 'updated')),
      resumo: texto(campo(bloco, 'summary', 'content')).slice(0, 600),
      categorias: [...bloco.matchAll(/<category\b[^>]*>/gi)].map((m) => attr(m[0], 'term')).filter(Boolean),
    });
  }
  return itens.filter((i) => i.titulo && /^https?:\/\//i.test(i.link));
}

/** Decodifica o corpo conforme o charset do cabeçalho ou da declaração XML (padrão UTF-8). */
export function decodificarCorpo(buf, contentType = '') {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let cs = contentType.match(/charset=([\w-]+)/i)?.[1];
  if (!cs) cs = new TextDecoder('latin1').decode(bytes.slice(0, 200)).match(/encoding=["']([\w-]+)["']/i)?.[1];
  try { return new TextDecoder(cs || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}
