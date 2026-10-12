// Feeds RSS sintéticos para o modo de teste: veículos e manchetes fictícios, com os nomes
// fictícios do TSE sintético. Inclui manchetes fora do tema e de opinião, que o filtro deve descartar.
import http from 'node:http';

const VEICULOS = [
  { id: 'jornal-teste', nome: 'Jornal Teste' },
  { id: 'agencia-exemplo', nome: 'Agência Exemplo' },
  { id: 'portal-ficticio', nome: 'Portal Fictício' },
];

// [veículo, minutos atrás, título, resumo, caminho]
const BASE = [
  [0, 20, 'Pesquisa Instituto Fictício: Candidato Azul tem 51% e Candidata Vermelha, 49% no 2º turno', 'Levantamento registrado no TSE sob o número BR-00001/2026, com 2.000 entrevistas.', 'politica'],
  [1, 45, 'Candidato Azul e Candidata Vermelha confirmam presença em debate na TV no domingo', '', 'politica'],
  [2, 70, 'TSE nega direito de resposta pedido pela campanha de Candidata Vermelha', '', 'politica'],
  [0, 110, 'Governadora Alfa recebe apoio de prefeitos do interior do Acre', '', 'politica'],
  [1, 160, 'Deputado Iota e Prefeito Capa trocam críticas na disputa pelo governo do Rio de Janeiro', '', 'politica'],
  [2, 200, 'Horário eleitoral: campanhas mudam o tom na segunda semana do 2º turno', '', 'politica'],
  [0, 260, 'Time vence clássico e deixa a zona de rebaixamento', '', 'esportes'],
  [1, 300, 'Estudo identifica nova espécie de sapo na Amazônia', '', 'ciencia'],
  [2, 330, 'Artigo: o que está em jogo no 2º turno', '', 'opiniao'],
  [0, 400, 'Abstenção preocupa campanhas na reta final do 2º turno', '', 'politica'],
  [1, 520, 'Senado adia votação de proposta sobre jornada de trabalho', '', 'politica'],
  [2, 610, 'TRE-RN multa coligação por propaganda irregular em Natal (RN)', '', 'politica'],
  [0, 900, 'Pesquisa Instituto Exemplo: Senadora Ni lidera no Tocantins', 'Registro TO-00012/2026.', 'politica'],
  [1, 1300, 'Candidata Vermelha faz caminhada em Recife e pede votos no Nordeste', '', 'politica'],
  [2, 1500, 'Candidato Azul promete reforma tributária em entrevista', '', 'politica'],
  [0, 2000, 'Debate entre Prefeito Lambda e Deputado Mi é marcado para quinta no Rio Grande do Norte', '', 'politica'],
  [1, 2600, 'Preço do café sobe pelo terceiro mês seguido', '', 'economia'],
  [2, 3100, 'Eleitores que não votaram no 1º turno podem votar no 2º, lembra a Justiça Eleitoral', '', 'politica'],
];

// Manchetes que "saem" durante o teste, uma a cada `cadaSeg` segundos
const NOVAS = [
  [1, 'Pesquisa Instituto Fictício: Candidata Vermelha encosta em Candidato Azul', 'Registro BR-00002/2026.'],
  [0, 'Candidato Azul recebe apoio de governadores eleitos no 1º turno', ''],
  [2, 'TSE manda remover vídeo com conteúdo manipulado sobre Candidato Azul', ''],
  [1, 'Debate na TV: Candidato Azul e Candidata Vermelha discutem economia e segurança', ''],
  [0, 'Governadora Épsilon e Deputado Zeta fazem último debate no Distrito Federal', ''],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function createNoticiasMock({ cadaSeg = 40 } = {}) {
  const inicio = Date.now();
  let porta = 0;
  const itensDe = (v) => {
    const agora = Date.now();
    const lista = BASE.filter((b) => b[0] === v).map(([, min, titulo, resumo, secao]) => ({ titulo, resumo, secao, data: inicio - min * 60_000 }));
    const quantas = Math.min(NOVAS.length, Math.floor((agora - inicio) / (cadaSeg * 1000)));
    NOVAS.slice(0, quantas).forEach(([vv, titulo, resumo], i) => { if (vv === v) lista.push({ titulo, resumo, secao: 'politica', data: inicio + (i + 1) * cadaSeg * 1000 }); });
    return lista.sort((a, b) => b.data - a.data);
  };
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const m = p.match(/^\/rss\/([a-z-]+)\.xml$/);
    const vi = m ? VEICULOS.findIndex((v) => v.id === m[1]) : -1;
    if (vi >= 0) {
      const v = VEICULOS[vi];
      const itens = itensDe(vi).map((i) => `<item><title><![CDATA[${i.titulo}]]></title><link>http://127.0.0.1:${porta}/${i.secao}/${slug(i.titulo)}?utm_source=rss</link>
<pubDate>${new Date(i.data).toUTCString()}</pubDate><category>${i.secao === 'opiniao' ? 'Opinião' : 'Notícias'}</category><description>${esc(i.resumo)}</description></item>`).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${v.nome}</title><link>http://127.0.0.1:${porta}/</link><description>Feed fictício</description>\n${itens}\n</channel></rss>`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Notícia fictícia</title><p style="font:16px system-ui;margin:40px">Notícia fictícia do modo de teste. Com dados reais, o link abre a matéria no site do veículo.</p>');
  });
  return {
    server,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => { porta = server.address().port; r(); })),
    fontes: () => VEICULOS.map((v) => ({ id: v.id, nome: v.nome, site: `127.0.0.1:${porta}`, url: `http://127.0.0.1:${porta}/rss/${v.id}.xml` })),
  };
}
