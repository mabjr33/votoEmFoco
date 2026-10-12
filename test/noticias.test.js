import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lerFeed, texto, decodificarCorpo } from '../src/noticias/rss.js';
import { classificar, prepararContexto } from '../src/noticias/classificar.js';
import { Noticias, linkCanonico } from '../src/noticias/coletor.js';
import { createNoticiasMock } from '../src/mock/noticias-mock.js';

const CTX = prepararContexto({
  presidente: ['FLÁVIO BOLSONARO', 'LULA'],
  governadores: [{ uf: 'rj', nomes: ['GAROTINHO', 'EDUARDO PAES'] }],
});
const cl = (titulo, extra = {}) => classificar({ titulo, link: 'https://x.com.br/politica/a', resumo: '', categorias: [], ...extra }, CTX);

test('RSS: CDATA, entidades, HTML escapado e item cortado', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
    <item><title><![CDATA[Flávio &amp; Lula no 2&#186; turno]]></title><link>https://a.com/n1?utm_source=rss</link>
      <pubDate>Sun, 11 Oct 2026 15:44:02 +0000</pubDate><category>Política</category>
      <description>&lt;p&gt;Texto &lt;b&gt;forte&lt;/b&gt;&lt;/p&gt;</description></item>
    <item><title>Sem link</title></item>
    <item><title>Cortado no meio`;
  const it = lerFeed(xml);
  assert.equal(it.length, 1);
  assert.equal(it[0].titulo, 'Flávio & Lula no 2º turno');
  assert.equal(it[0].resumo, 'Texto forte');
  assert.equal(it[0].data, Date.UTC(2026, 9, 11, 15, 44, 2));
  assert.deepEqual(it[0].categorias, ['Política']);
});

test('Atom e charset ISO-8859-1', () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Eleição</title><link rel="alternate" href="https://b.com/e"/><published>2026-10-11T10:00:00-03:00</published><category term="Brasil"/></entry></feed>';
  const it = lerFeed(atom);
  assert.equal(it[0].link, 'https://b.com/e');
  assert.equal(it[0].data, Date.UTC(2026, 9, 11, 13));
  const latin = Uint8Array.from([...'<?xml version="1.0" encoding="ISO-8859-1"?><t>'].map((c) => c.charCodeAt(0)).concat([0xe7, 0xe3, 0x6f, 0x3c, 0x2f, 0x74, 0x3e]));
  assert.match(decodificarCorpo(latin), /ção/);
  assert.equal(texto('a&nbsp;&nbsp;b'), 'a b');
});

test('classificador: aceita o que é da eleição e descarta o resto', () => {
  assert.ok(cl('Flávio pede ao TSE cassação de Lula por rede de desinformação'));
  assert.ok(cl('Prefeito de Santo André (SP) anuncia apoio a Flávio'));
  assert.ok(cl('Ato pela reeleição de Lula leva milhares à Avenida Paulista'));
  assert.ok(cl('Datafolha: Flávio tem 52% e Lula 48% dos votos válidos'));
  assert.equal(cl('Estudo identifica alvo para tratar doença de Chagas'), null);
  assert.equal(cl('Grêmio e Internacional empatam clássico'), null);
  assert.equal(cl('Senado adia votação de proposta sobre jornada de trabalho'), null);
  assert.equal(cl('Flávio Dino suspende pagamento de emendas'), null, 'homônimo no STF');
  assert.equal(cl('Pesquisa identifica nova espécie de sapo'), null);
  assert.equal(cl('O que está em jogo no 2º turno', { link: 'https://x.com.br/opiniao/artigo-1' }), null, 'opinião fica de fora');
  assert.equal(cl('Eleição: análise', { categorias: ['Opinião'] }), null);
});

test('classificador: etiquetas e estados', () => {
  const p = cl('Quaest: Flávio e Lula empatam no 2º turno', { resumo: 'Registro BR-02197/2026.' });
  assert.ok(p.etiquetas.includes('pesquisa'));
  assert.ok(p.etiquetas.includes('presidente'));
  assert.deepEqual(p.registros, ['BR-02197/2026']);
  const d = cl('Record confirma debate entre Lula e Flávio no domingo');
  assert.ok(d.etiquetas.includes('debate'));
  const j = cl('Corregedor do TSE manda reativar canal');
  assert.ok(j.etiquetas.includes('justica'));
  const g = cl('Garotinho e Eduardo Paes trocam críticas em ato no Rio de Janeiro');
  assert.ok(g.etiquetas.includes('governadores'));
  assert.deepEqual(g.ufs, ['rj']);
  assert.deepEqual(cl('TRE-RN multa coligação por propaganda eleitoral irregular').ufs, ['rn']);
  assert.deepEqual(cl('Eleição no Pará tem abstenção recorde').ufs, ['pa']);
  assert.deepEqual(cl('Paraná Pesquisas: Flávio lidera em Minas Gerais').ufs, ['mg'], '"Paraná Pesquisas" não é o estado');
});

test('classificador: nome de governador que contém o de um presidenciável não etiqueta o estado à toa', () => {
  const ctx = prepararContexto({
    presidente: ['FLAVIO BOLSONARO', 'LULA'],
    governadores: [{ uf: 'rn', nomes: ['ALLYSON', 'CADU DE LULA'] }, { uf: 'to', nomes: ['PROFESSORA DORINHA', 'VICENTINHO JÚNIOR'] }],
  });
  const c = (titulo) => classificar({ titulo, link: 'https://x.com.br/politica/a', resumo: '', categorias: [] }, ctx);
  const nacional = c('Flávio mente e vai acabar com Farmácia Popular, diz Lula');
  assert.deepEqual(nacional.ufs, []);
  assert.ok(!nacional.etiquetas.includes('governadores'));
  assert.deepEqual(c('Cadu de Lula e Allyson fazem debate em Natal').ufs, ['rn'], 'o nome completo continua valendo');
  assert.equal(c('Júnior diz que vai votar no domingo'), null, 'sufixo sozinho não identifica candidato');
  assert.deepEqual(c('Vicentinho diz que vence no 2º turno').ufs, ['to']);
});

test('link canônico ignora rastreio e barra final', () => {
  assert.equal(linkCanonico('https://www.a.com/x/?utm_source=rss&id=2#c'), 'a.com/x?id=2');
});

test('coletor com feeds fictícios: filtra, deduplica, guarda e avisa', async () => {
  const mock = createNoticiasMock({ cadaSeg: 3600 });
  await mock.listen(0);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'noticias-'));
  try {
    const n = new Noticias({
      fontes: [...mock.fontes(), { id: 'quebrado', nome: 'Fora do ar', url: 'http://127.0.0.1:1/rss.xml' }],
      dataDir: dir, intervaloMs: 60_000,
      contexto: () => ({ presidente: ['Candidato Azul', 'Candidata Vermelha'], governadores: [{ uf: 'ac', nomes: ['Governadora Alfa', 'Senador Beta'] }, { uf: 'rj', nomes: ['Deputado Iota', 'Prefeito Capa'] }, { uf: 'to', nomes: ['Senadora Ni', 'Deputado Csi'] }] }),
    });
    let avisos = 0;
    n.on('update', () => avisos++);
    const novos = await n.atualizar();
    assert.ok(novos >= 10, `entraram ${novos}`);
    assert.equal(avisos, 1);
    const pl = n.payload();
    const titulos = pl.itens.map((i) => i.titulo);
    assert.ok(!titulos.some((t) => /sapo|clássico|café|jornada de trabalho/.test(t)), 'fora do tema');
    assert.ok(!titulos.some((t) => /^Artigo:/.test(t)), 'opinião');
    const pesq = pl.itens.filter((i) => i.etiquetas.includes('pesquisa'));
    assert.ok(pesq.some((i) => i.registros.includes('BR-00001/2026')));
    assert.ok(pl.itens.find((i) => /Governadora Alfa/.test(i.titulo)).ufs.includes('ac'));
    assert.equal(pl.fontes.find((f) => f.id === 'quebrado').ok, false);
    // segunda leitura: nada novo, nada duplicado
    assert.equal(await n.atualizar(), 0);
    assert.equal(avisos, 1);
    // persistência
    const n2 = new Noticias({ fontes: mock.fontes(), dataDir: dir });
    await n2.carregar();
    assert.equal(n2.itens.length, n.itens.length);
  } finally {
    mock.server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('feed acima do limite de tamanho é recusado', async () => {
  const { lerLimitado } = await import('../src/noticias/coletor.js');
  assert.equal((await lerLimitado(new Response(new Uint8Array(100)), 1000)).length, 100);
  await assert.rejects(lerLimitado(new Response(new Uint8Array(2000)), 1000), /grande demais/);
  await assert.rejects(lerLimitado(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); } })), 1000), /grande demais/);
});
