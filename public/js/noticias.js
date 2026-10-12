// Aba Notícias: manchetes dos veículos (via servidor), datas do 2º turno e pesquisas recentes.
import { AGENDA, FONTES_AGENDA } from '/shared/agenda.js';
import { esc } from './util.js';

const TZ = 'America/Sao_Paulo';
const ETIQUETAS = { pesquisa: 'Pesquisas', debate: 'Debates', justica: 'Justiça Eleitoral', presidente: 'Presidente', governadores: 'Governadores' };
const ETQ_CURTA = { pesquisa: 'Pesquisa', debate: 'Debate', justica: 'Justiça Eleitoral' };
const UF_NOME = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás',
  ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais', pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco',
  pi: 'Piauí', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina',
  sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
};
const PESQELE = 'https://www.tse.jus.br/eleicoes/pesquisa-eleitorais/consulta-as-pesquisas-registradas';

const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDiaChave = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const fmtDiaLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const hora = (t) => fmtHora.format(t).replace(':', 'h');
const diaDe = (t) => fmtDiaChave.format(t);
const hoje = () => diaDe(Date.now());
const ontem = () => diaDe(Date.now() - 86_400_000);
function rotuloDia(chave, t) {
  if (chave === hoje()) return 'Hoje';
  if (chave === ontem()) return 'Ontem';
  const s = fmtDiaLongo.format(t);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ler = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const E = { filtro: 'tudo', uf: '', fonte: '', limite: 40, vistoAntes: null, ligado: false, raiz: null, dados: null };

function passa(i, { semFiltro = false } = {}) {
  if (E.uf && !i.ufs.includes(E.uf)) return false;
  if (E.fonte && i.fonteId !== E.fonte) return false;
  if (!semFiltro && E.filtro !== 'tudo' && !i.etiquetas.includes(E.filtro)) return false;
  return true;
}

function item(i) {
  const novo = E.vistoAntes && i.data > E.vistoAntes;
  const etq = i.etiquetas.filter((e) => ETQ_CURTA[e]).map((e) => `<span class="etq etq-${e}">${ETQ_CURTA[e]}</span>`).join('');
  const ufs = i.ufs.slice(0, 3).map((u) => `<span class="etq">${u.toUpperCase()}</span>`).join('');
  return `<li class="${novo ? 'novo' : ''}"><span class="h">${hora(i.data)}</span><div>
    <a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(i.titulo)}</a>
    <div class="meta"><span class="fonte">${esc(i.fonte)}</span>${etq}${ufs}${i.registros?.length ? `<span class="reg">Registro ${esc(i.registros[0])}</span>` : ''}${novo ? '<span class="novo-t">Novo</span>' : ''}</div></div></li>`;
}

function blocoFeed(d) {
  const base = d.itens.filter((i) => passa(i, { semFiltro: true }));
  const conta = (k) => (k === 'tudo' ? base.length : base.filter((i) => i.etiquetas.includes(k)).length);
  const chips = [['tudo', 'Tudo'], ...Object.entries(ETIQUETAS)].map(([k, t]) =>
    `<button type="button" data-nfiltro="${k}" aria-pressed="${E.filtro === k}">${t} <small>${conta(k)}</small></button>`).join('');
  const ufsComNoticia = [...new Set(d.itens.flatMap((i) => i.ufs))].sort((a, b) => UF_NOME[a].localeCompare(UF_NOME[b], 'pt'));
  const selUf = `<select class="entrada" id="n-uf" aria-label="Estado"><option value="">Todos os estados</option>${ufsComNoticia.map((u) => `<option value="${u}" ${E.uf === u ? 'selected' : ''}>${UF_NOME[u]}</option>`).join('')}</select>`;
  const selFonte = `<select class="entrada" id="n-fonte" aria-label="Veículo"><option value="">Todos os veículos</option>${d.fontes.map((f) => `<option value="${esc(f.id)}" ${E.fonte === f.id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>`;
  const lista = d.itens.filter((i) => passa(i));
  let html = '', diaAtual = null, n = 0;
  for (const i of lista.slice(0, E.limite)) {
    const k = diaDe(i.data);
    if (k !== diaAtual) { if (diaAtual) html += '</ul>'; html += `<h3 class="dia">${rotuloDia(k, i.data)}</h3><ul class="manchetes">`; diaAtual = k; }
    html += item(i); n++;
  }
  if (diaAtual) html += '</ul>';
  if (!n) html = `<p class="nota vazio">${d.atualizadoEm ? 'Nenhuma manchete com esse filtro nos últimos dias.' : 'Lendo os feeds dos veículos pela primeira vez…'}</p>`;
  const mais = lista.length > E.limite ? `<button type="button" class="botao-2" id="n-mais">Mostrar mais (${lista.length - E.limite})</button>` : '';
  return `<div class="filtros" role="group" aria-label="Assunto">${chips}</div><div class="filtros-2">${selUf}${selFonte}</div>${html}<div class="acoes">${mais}</div>`;
}

function blocoAgenda() {
  const h = hoje();
  const prox = AGENDA.filter((a) => (a.ate || a.data) >= h);
  if (!prox.length) return '';
  const fmt = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 15)); };
  const dm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' });
  const ds = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short' });
  const linhas = prox.map((a) => {
    const emCurso = a.ate && a.data <= h && a.ate >= h;
    const quando = a.data === h ? 'Hoje' : emCurso ? 'Até' : ds.format(fmt(a.data)).replace('.', '');
    const dia = emCurso ? dm.format(fmt(a.ate)) : dm.format(fmt(a.data));
    return `<li class="ag-${a.tipo} ${a.data === h ? 'hoje' : ''}"><span class="quando"><b>${dia.replace(' de ', ' ').replace('.', '')}</b><small>${quando}</small></span>
      <span><span class="t">${esc(a.titulo)}</span>${a.detalhe ? `<small>${esc(a.detalhe)}</small>` : ''}</span></li>`;
  }).join('');
  const fontes = [...new Set(prox.map((a) => a.fonte))].map((k) => `<a href="${esc(FONTES_AGENDA[k].url)}" target="_blank" rel="noopener">${esc(FONTES_AGENDA[k].nome.split(':')[0])}</a>`).join(', ');
  return `<section><h2>Próximas datas</h2><ul class="agenda">${linhas}</ul><p class="nota">Datas de debates são das emissoras e podem mudar. Fontes: ${fontes}.</p></section>`;
}

function blocoPesquisas(d) {
  const p = d.itens.filter((i) => i.etiquetas.includes('pesquisa')).slice(0, 5);
  const lista = p.length ? `<ul class="mini">${p.map((i) => `<li><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(i.titulo)}</a><small>${esc(i.fonte)}, ${rotuloDia(diaDe(i.data), i.data).toLowerCase()} às ${hora(i.data)}${i.registros?.length ? ` · ${esc(i.registros[0])}` : ''}</small></li>`).join('')}</ul>` : '<p class="nota">Nenhuma pesquisa nas manchetes dos últimos dias.</p>';
  return `<section><h2>Pesquisas nas manchetes</h2>${lista}
    <p class="nota">Toda pesquisa divulgada precisa de registro no TSE. Confira pelo número no <a href="${PESQELE}" target="_blank" rel="noopener">PesqEle</a>. A aba <a href="#previsoes">Previsões</a> usa só pesquisas já conferidas.</p></section>`;
}

function blocoFontes(d) {
  const linhas = d.fontes.map((f) => {
    const st = f.ok === null ? 'espera' : f.ok ? 'ok' : 'erro';
    const tit = f.ok === false ? `Sem resposta na última leitura (${f.erro || 'erro'})` : f.ok ? 'Lido normalmente' : 'Ainda não lido';
    return `<li title="${esc(tit)}"><span class="st st-${st}"></span><span>${esc(f.nome)}</span><b>${f.itens}</b></li>`;
  }).join('');
  return `<section><h2>Veículos</h2><ul class="veiculos">${linhas}</ul><p class="nota">Número de manchetes sobre a eleição nos últimos 7 dias. O título e o link são de cada veículo; o texto fica no site deles.</p></section>`;
}

function desenhar() {
  const d = E.dados || { fontes: [], itens: [], atualizadoEm: null };
  const ult = d.atualizadoEm ? `Última leitura às ${hora(d.atualizadoEm)}, repetida a cada ${Math.round((d.intervaloMs || 600000) / 60000) || 1} min.` : '';
  E.raiz.innerHTML = `<div class="not-cab"><h1>Notícias da eleição</h1>
      <p class="intro">Manchetes de ${d.fontes.length} veículos sobre a eleição. A seleção é automática, por palavras-chave: pode deixar passar alguma notícia ou incluir uma fora do tema. Colunas de opinião ficam de fora. Clique para ler no site do veículo.</p>
      <p class="nota">${ult}</p></div>
    <div class="not-grade"><div class="not-feed">${blocoFeed(d)}</div><aside class="not-lado">${blocoAgenda()}${blocoPesquisas(d)}${blocoFontes(d)}</aside></div>`;
}

function ligar(raiz) {
  raiz.addEventListener('click', (e) => {
    const f = e.target.closest('[data-nfiltro]');
    if (f) { E.filtro = f.dataset.nfiltro; E.limite = 40; return desenhar(); }
    if (e.target.id === 'n-mais') { E.limite += 40; return desenhar(); }
  });
  raiz.addEventListener('change', (e) => {
    if (e.target.id === 'n-uf') { E.uf = e.target.value; E.limite = 40; desenhar(); }
    if (e.target.id === 'n-fonte') { E.fonte = e.target.value; E.limite = 40; desenhar(); }
  });
}

/** Desenha a aba. Chamada ao abrir a aba e quando chegam manchetes novas. */
export function renderNoticias(raiz, dados, { entrando = false } = {}) {
  if (!E.ligado) { ligar(raiz); E.ligado = true; }
  // "Novo" = chegou depois da última vez que a aba foi aberta
  if (entrando || E.vistoAntes === null) E.vistoAntes = ler('noticias:visto', 0);
  E.raiz = raiz;
  E.dados = dados;
  desenhar();
  if (dados?.itens?.length) gravar('noticias:visto', Math.max(...dados.itens.map((i) => i.data)));
}

/** Quantas manchetes chegaram desde a última visita à aba. */
export function contarNovas(dados) {
  const visto = ler('noticias:visto', 0);
  return visto ? (dados?.itens || []).filter((i) => i.data > visto).length : 0;
}
