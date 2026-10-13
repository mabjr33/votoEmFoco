// Painel: acesso com usuário e senha (criados pelo dono do site), acessos ao site, pesquisas e saúde.
// Depois de entrar, só o código da sessão fica no sessionStorage desta aba (nunca a senha).
import { ELEICOES } from '/shared/historico.js';
import { esc, fmtInt, fmtPct } from './util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const E26 = ELEICOES.find((e) => e.ano === 2026);
const TZ = 'America/Sao_Paulo';
const horaDe = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const duracao = (ms) => (ms == null ? 'nunca' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);
// Links vindos de feeds: só http(s) vira link clicável
const urlSegura = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const link = (url, nome) => (urlSegura(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(nome || 'fonte')}</a>` : esc(nome || ''));

let sessao = null;
try { sessao = sessionStorage.getItem('painel-sessao'); } catch { /* sem storage: entra de novo */ }
const guardarSessao = (s) => { sessao = s; try { if (s) sessionStorage.setItem('painel-sessao', s); else sessionStorage.removeItem('painel-sessao'); } catch {} };

async function api(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}) };
  if (sessao) headers.Authorization = `Bearer ${sessao}`;
  const r = await fetch(caminho, { ...opcoes, cache: 'no-store', headers });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && sessao && !/\/(entrar|criar|senha)$/.test(caminho)) { mostrarAcesso('Sessão expirada. Entre de novo.'); throw new Error('401'); }
  if (!r.ok) throw Object.assign(new Error(corpo.erro || (r.status === 404 ? 'Painel desligado: defina ADMIN_TOKEN (16+ caracteres) no servidor.' : `HTTP ${r.status}`)), { status: r.status, corpo });
  return corpo;
}
const postar = (caminho, dados) => api(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });

// ---------------- telas de acesso ----------------
function tela(qual) {
  for (const id of ['entrar', 'criar', 'guardar', 'conteudo']) $(`#${id}`).hidden = id !== qual;
  $('#quem').hidden = qual !== 'conteudo';
}
let estado = { configurado: false, podeCriar: false };
async function mostrarAcesso(msg = '') {
  guardarSessao(null);
  $('#aviso-acesso').textContent = msg;
  try { estado = await api('/api/admin/estado'); } catch (err) { tela(null); $('#aviso-acesso').textContent = err.message; return; }
  if (estado.configurado) return tela('entrar');
  modoCriar(false);
}
function modoCriar(redefinir) {
  $('#titulo-criar').textContent = redefinir ? 'Redefinir acesso' : 'Criar acesso';
  $('#intro-criar').innerHTML = redefinir
    ? 'Com o <b>código de instalação</b> (o valor de <code>ADMIN_TOKEN</code> no Render, em Environment) você define usuário e senha novos. As sessões abertas são encerradas.'
    : 'Escolha seu usuário e sua senha. Para provar que você administra o servidor, informe o <b>código de instalação</b>: o valor de <code>ADMIN_TOKEN</code> no Render, em Environment.';
  $('#voltar-entrar').hidden = !redefinir;
  if (!estado.podeCriar) $('#aviso-acesso').textContent = 'Este servidor não tem ADMIN_TOKEN (código de instalação): não dá para criar ou redefinir o acesso por aqui.';
  tela('criar');
}
function mostrarVariavel(linha) {
  $('#linha-env').textContent = linha || '';
  tela('guardar');
}

// ---------------- abas ----------------
function abrirAba(nome) {
  for (const b of $$('[data-aba]')) b.setAttribute('aria-selected', String(b.dataset.aba === nome));
  for (const p of $$('[data-painel]')) p.hidden = p.dataset.painel !== nome;
  try { sessionStorage.setItem('painel-aba', nome); } catch {}
}

// ---------------- visão geral ----------------
const pilula = (texto, ruim = false, neutra = false) => `<span class="adm-pilula ${ruim ? 'ruim' : neutra ? 'neutra' : ''}">${esc(texto)}</span>`;
let ultimaSaude = null;

function renderStatus(s) {
  const t = s.tse;
  const parado = t.semRespostaMs == null || t.semRespostaMs > (t.limiteSemRespostaMs || 90_000);
  const pausado = t.pausadoAte && Date.parse(t.pausadoAte) > Date.now();
  const feedsRuins = (s.noticias?.fontes || []).filter((f) => f.ok === false).length;
  $('#status-geral').innerHTML = [
    pausado ? pilula(`TSE: em pausa até ${horaDe(t.pausadoAte)}`, true) : parado ? pilula(`TSE: sem resposta há ${duracao(t.semRespostaMs)}`, true) : pilula('TSE respondendo'),
    !s.banco ? pilula('Banco: não configurado', false, true) : s.banco.ok ? pilula('Banco ok') : pilula('Banco com erro', true),
    s.noticias ? (feedsRuins ? pilula(`Notícias: ${feedsRuins} veículo(s) com erro`, true) : pilula('Notícias ok')) : '',
    s.cadastroPesquisas ? (s.cadastroPesquisas.erro ? pilula('Cadastro de pesquisas com erro', true) : pilula('Cadastro de pesquisas ok')) : '',
  ].join('');
}

async function atualizarVisitas() {
  const v = await api('/api/admin/visitas');
  const max = Math.max(1, ...v.dias.map((d) => d.visitantes));
  const dia = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };
  $('#visitas').innerHTML = `<div class="adm-numeros">
      <div class="adm-num"><div class="v">${fmtInt(v.hoje?.visitantes)}</div><div class="r">visitantes hoje</div></div>
      <div class="adm-num"><div class="v">${fmtInt(v.hoje?.paginas)}</div><div class="r">aberturas do site hoje</div></div>
      <div class="adm-num"><div class="v">${fmtInt(v.agora)}</div><div class="r">com o site aberto agora</div></div>
      <div class="adm-num"><div class="v">${fmtInt(v.ontem?.visitantes)}</div><div class="r">visitantes ontem</div></div>
    </div>
    <div class="adm-barras" role="img" aria-label="Visitantes por dia nos últimos 14 dias">
      ${v.dias.map((d, i) => `<div class="b ${i === v.dias.length - 1 ? 'hoje' : ''}" style="height:${Math.round((100 * d.visitantes) / max)}%" title="${esc(dia(d.dia))}: ${fmtInt(d.visitantes)} visitantes, ${fmtInt(d.paginas)} aberturas"></div>`).join('')}
    </div>
    <div class="adm-dias">${v.dias.map((d, i) => `<span>${i % 2 === v.dias.length % 2 ? '' : esc(dia(d.dia))}</span>`).join('')}</div>
    <p class="nota">Visitantes contados sem cookie e sem guardar IP; robôs e prévias de link não contam. Depois de um reinício do servidor, quem voltar no mesmo dia pode contar de novo. "Com o site aberto agora" são abas conectadas ao vivo.${v.erro ? ` <b>Atenção:</b> ${esc(v.erro)}.` : ''}</p>`;
}

// ---------------- sistema ----------------
const cartao = (r, v, ruim = false) => `<div class="cartao ${ruim ? 'ruim' : ''}"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;
async function atualizarSaude() {
  const s = await api('/api/admin/saude');
  ultimaSaude = s;
  renderStatus(s);
  const t = s.tse;
  const parado = t.semRespostaMs == null || t.semRespostaMs > (t.limiteSemRespostaMs || 90_000);
  const pausado = t.pausadoAte && Date.parse(t.pausadoAte) > Date.now();
  $('#saude').innerHTML = `<h2>TSE</h2><div class="cartoes">
      ${cartao('Última resposta', `há ${duracao(t.semRespostaMs)}`, parado)}
      ${cartao('Consultas', pausado ? `em pausa até ${esc(horaDe(t.pausadoAte))}` : 'normais', pausado)}
      ${cartao('Requisições', `${fmtInt(t.requisicoes.requests)} · ${fmtInt(t.requisicoes.notFound)} 404 · ${fmtInt(t.requisicoes.errors)} erros`, t.requisicoes.errors > 0 && parado)}
      ${cartao('2º turno presidente', t.segundoTurnoFederal ? 'preparado pelo TSE' : 'ainda não')}
      ${cartao('2º turno de governador', esc((t.ufsGovernador2T || []).join(', ').toUpperCase() || 'nenhum'))}
    </div>
    <p class="nota">${esc(t.fonte)} · configuração do TSE de ${esc(t.configuracaoEm || '–')}${t.requisicoes.lastError ? ` · último erro: ${esc(t.requisicoes.lastError)}` : ''}</p>
    <h2>Servidor</h2><div class="cartoes">
      ${cartao('No ar desde', esc(horaDe(s.noArDesde)))}
      ${cartao('Memória', `${fmtInt(s.memoriaMb)} MB`, s.memoriaMb > 420)}
      ${cartao('Conexões ao vivo', fmtInt(s.conexoesAoVivo))}
      ${s.banco ? cartao('Banco de dados', s.banco.ok ? (s.banco.ultimoOk ? `ok · ${esc(horaDe(new Date(s.banco.ultimoOk).toISOString()))}` : 'ligado') : `erro: ${esc(s.banco.erro)}`, !s.banco.ok) : cartao('Banco de dados', 'não configurado')}
      ${s.cadastroPesquisas ? cartao('Cadastro de pesquisas', s.cadastroPesquisas.erro ? `erro: ${esc(s.cadastroPesquisas.erro)}` : `${fmtInt(s.cadastroPesquisas.pesquisas)} presidenciais · ${esc(horaDe(s.cadastroPesquisas.atualizadoEm))}`, !!s.cadastroPesquisas.erro) : ''}
    </div>
    <details class="adm-dobra"><summary>Disputas (${fmtInt(s.disputas.length)})</summary>
      <table class="tab-admin"><thead><tr><th>Disputa</th><th>Ao vivo</th><th>Seções</th><th>Totalização</th></tr></thead><tbody>
      ${s.disputas.map((d) => `<tr><td>${esc(d.label)}</td><td>${d.aoVivo ? 'sim' : 'não'}</td><td>${d.pst == null ? '–' : `${fmtPct(d.pst, 1)}%`}</td><td>${esc(d.totalizadoEm || '–')}</td></tr>`).join('')}
      </tbody></table></details>
    ${s.noticias ? `<details class="adm-dobra"><summary>Veículos de notícias (${fmtInt(s.noticias.fontes.length)})</summary>
      <table class="tab-admin"><thead><tr><th>Veículo</th><th>Situação</th><th>Manchetes</th></tr></thead><tbody>
      ${s.noticias.fontes.map((f) => `<tr><td>${esc(f.nome)}</td><td>${f.ok === null ? 'ainda não lido' : f.ok ? 'ok' : `erro: ${esc(f.erro || '')}`}</td><td>${fmtInt(f.itens)}</td></tr>`).join('')}
      </tbody></table></details>` : ''}`;
}

// ---------------- pesquisas ----------------
let pendentes = new Map();
const parTexto = (f) => [f.validos && `válidos ${fmtPct(f.validos.flavio, 1)} × ${fmtPct(f.validos.lula, 1)}`, f.totais && `totais ${fmtPct(f.totais.flavio, 1)} × ${fmtPct(f.totais.lula, 1)}`].filter(Boolean).join('; ');
const badge = (sel, n) => { const b = $(sel); b.hidden = !n; b.textContent = String(n); };

async function atualizarPesquisas() {
  const d = await api('/api/admin/pesquisas');
  pendentes = new Map(d.pendentes.map((p) => [p.registro, p]));
  badge('#badge-pesquisas', d.pendentes.length);
  badge('#badge-detectadas', d.detectadas.length);
  $('#aviso-pesquisas').innerHTML = d.pendentes.length
    ? `<h2>Pesquisas</h2><p class="adm-alerta">${d.pendentes.length === 1 ? '1 pesquisa espera' : `${d.pendentes.length} pesquisas esperam`} sua aprovação. <button class="link" type="button" data-ir="pesquisas">Ver</button></p>` : '';

  $('#pendentes').innerHTML = !d.automatica ? '<p class="adm-vazio">Entrada automática desligada neste servidor.</p>'
    : d.pendentes.length ? `<ul class="adm-lista">${d.pendentes.map((p) => `<li>
        <div class="adm-linha"><div><div class="t">${esc(p.instituto)}</div><div class="s">${esc(p.registro)} · campo ${esc(p.campo)} · ${fmtInt(p.amostra)} entrevistas</div></div>
        <button type="button" class="botao-2" data-pendente="${esc(p.registro)}">Conferir e aprovar</button></div>
        <div class="s">${(p.fontes || []).map((f) => `${link(f.url, f.nome)}: ${esc(parTexto(f))}`).join('<br>')}</div>
        <div class="nota">Por que espera: ${esc(p.motivo)}</div></li>`).join('')}</ul>`
      : '<p class="adm-vazio">Nada esperando aprovação.</p>';

  $('#aprovadas').innerHTML = d.aprovadas.length ? `<table class="tab-admin"><thead><tr><th>Pesquisa</th><th>Válidos</th><th>Fonte</th><th></th></tr></thead><tbody>
      ${d.aprovadas.map((p) => `<tr><td>${esc(p.instituto)}<br><small>${esc(p.registro)} · ${esc(p.campo)}</small></td>
        <td>${p.flavioValido == null ? (p.flavio == null ? '–' : `${fmtPct(p.flavio, 1)} × ${fmtPct(p.lula, 1)} (totais)`) : `${fmtPct(p.flavioValido, 1)} × ${fmtPct(p.lulaValido, 1)}`}</td>
        <td>${p.origem === 'automatica' ? `automática: ${(p.fontes || []).map((f) => link(f.url, f.nome)).join(', ')}` : `painel: ${link(p.fonteUrl, p.fonteNome)}`}</td>
        <td><button type="button" class="link" data-remover="${esc(p.registro)}">Remover</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="adm-vazio">Nenhuma além das fixas.</p>';

  const manchete = (m) => `<li>${link(m.link, m.titulo)} <small>(${esc(m.fonte)})</small></li>`;
  $('#detectadas').innerHTML = (d.detectadas.length ? `<ul class="adm-lista">${d.detectadas.map((p) => `<li><div class="t">${esc(p.registro)}</div><ul>${p.manchetes.map(manchete).join('')}</ul>
      <button type="button" class="botao-2" data-preencher="${esc(p.registro)}" data-link="${esc(urlSegura(p.manchetes[0].link) || '')}" data-fonte="${esc(p.manchetes[0].fonte)}">Preencher no formulário</button></li>`).join('')}</ul>`
    : '<p class="adm-vazio">Nenhuma pesquisa nova com registro nas manchetes.</p>')
    + (d.semRegistro.length ? `<p class="nota">Manchetes de pesquisa sem número de registro (podem ser estaduais ou repercussão):</p><ul>${d.semRegistro.map(manchete).join('')}</ul>` : '');
}

// ---------------- conta ----------------
async function carregar() {
  tela('conteudo');
  $('#aviso-acesso').textContent = '';
  const conta = await api('/api/admin/conta');
  $('#quem-nome').textContent = conta.usuario;
  $('#conta-info').textContent = `Você entrou como "${conta.usuario}". ${conta.origem === 'banco' ? 'O acesso está guardado no banco de dados.' : conta.origem === 'variavel' ? 'O acesso está guardado na variável ADMIN_LOGIN do servidor.' : 'O acesso está só no disco deste servidor; para não perdê-lo num reinício, guarde a variável ADMIN_LOGIN.'}`;
  $('#ver-env').hidden = conta.origem === 'banco';
  $('#conta-ip').textContent = `O servidor vê você no endereço ${conta.ipVisto}. Confira se é o seu IP de verdade (pesquise "qual é meu ip"): é ele que o limite de tentativas de login usa. `
    + `Configuração atual: TRUST_PROXY=${conta.saltosProxy}, ${conta.enderecosNoCabecalho} endereço(s) no cabeçalho do proxy.`;
  let aba = 'geral';
  try { aba = sessionStorage.getItem('painel-aba') || 'geral'; } catch {}
  abrirAba(aba);
  await Promise.all([atualizarSaude(), atualizarPesquisas(), atualizarVisitas()]);
}
async function iniciar() {
  if (sessao) {
    try { return await carregar(); } catch { /* sessão vencida: cai na tela de acesso */ }
  }
  await mostrarAcesso();
}

$('#rot-a').textContent = $('#rot-va').textContent = E26.lider.nome;
$('#rot-b').textContent = $('#rot-vb').textContent = E26.segundo.nome;

$('#form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#aviso-acesso').textContent = '';
  try {
    const r = await postar('/api/admin/entrar', { usuario: f.usuario.value, senha: f.senha.value });
    f.senha.value = '';
    guardarSessao(r.sessao);
    await carregar();
  } catch (err) { $('#aviso-acesso').textContent = err.message; f.senha.value = ''; }
});

$('#form-criar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#aviso-acesso').textContent = '';
  if (f.senha.value !== f.senha2.value) { $('#aviso-acesso').textContent = 'As duas senhas não são iguais.'; return; }
  try {
    const r = await postar('/api/admin/criar', { codigo: f.codigo.value, usuario: f.usuario.value, senha: f.senha.value });
    f.reset();
    guardarSessao(r.sessao);
    if (r.noBanco) await carregar(); else mostrarVariavel(r.linhaVariavel);
  } catch (err) { $('#aviso-acesso').textContent = err.message; }
});

$('#form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#erro-senha').textContent = '';
  if (f.novaSenha.value !== f.novaSenha2.value) { $('#erro-senha').textContent = 'As duas senhas novas não são iguais.'; return; }
  try {
    const r = await postar('/api/admin/senha', { senhaAtual: f.senhaAtual.value, novaSenha: f.novaSenha.value });
    f.reset();
    guardarSessao(r.sessao);
    if (r.noBanco) { $('#erro-senha').textContent = 'Senha trocada.'; } else mostrarVariavel(r.linhaVariavel);
  } catch (err) { $('#erro-senha').textContent = err.message; }
});

$('#ir-redefinir').addEventListener('click', () => { $('#aviso-acesso').textContent = ''; modoCriar(true); });
$('#voltar-entrar').addEventListener('click', () => { $('#aviso-acesso').textContent = ''; tela('entrar'); });
$('#continuar').addEventListener('click', () => carregar().catch((err) => { $('#aviso-acesso').textContent = err.message; }));
$('#copiar-env').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText($('#linha-env').textContent); e.target.textContent = 'Copiado'; } catch { e.target.textContent = 'Selecione e copie o texto acima'; }
});
$('#ver-env').addEventListener('click', async () => {
  try { const c = await api('/api/admin/conta'); mostrarVariavel(c.linhaVariavel); } catch (err) { $('#erro-senha').textContent = err.message; }
});
$('#sair').addEventListener('click', async () => {
  await postar('/api/admin/sair', {}).catch(() => {});
  mostrarAcesso('Você saiu.');
});

$('#form-pesquisa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  $('#erro-pesquisa').textContent = '';
  try {
    const r = await api('/api/admin/pesquisas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    e.target.reset();
    $('#erro-pesquisa').textContent = `Publicada: ${r.pesquisa.instituto} ${r.pesquisa.registro}. A previsão já foi recalculada para todos.`;
    await atualizarPesquisas();
  } catch (err) { $('#erro-pesquisa').textContent = err.message; }
});

function abrirFormulario() {
  const dobra = $('#dobra-form');
  dobra.open = true;
  dobra.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return $('#form-pesquisa');
}

document.addEventListener('click', async (e) => {
  const aba = e.target.closest('[data-aba], [data-ir]');
  if (aba) { abrirAba(aba.dataset.aba || aba.dataset.ir); return; }
  const p = e.target.closest('[data-preencher]');
  if (p) {
    const f = abrirFormulario();
    f.registro.value = p.dataset.preencher;
    f.fonteUrl.value = p.dataset.link;
    f.fonteNome.value = p.dataset.fonte;
    f.instituto.focus();
    return;
  }
  const pend = pendentes.get(e.target.closest('[data-pendente]')?.dataset.pendente);
  if (pend) {
    // Preenche com o que foi lido; quem aprova confere na fonte antes de publicar
    const f = abrirFormulario();
    for (const k of ['registro', 'instituto', 'campo', 'divulgacao', 'amostra', 'margem', 'flavio', 'lula', 'flavioValido', 'lulaValido', 'fonteNome']) {
      f[k].value = pend[k] == null ? '' : String(pend[k]).replace('.', ',');
    }
    f.fonteUrl.value = urlSegura(pend.fonteUrl) || '';
    $('#erro-pesquisa').textContent = 'Preenchido com o que foi lido nas reportagens. Confira na fonte antes de aprovar.';
    return;
  }
  const r = e.target.closest('[data-remover]');
  if (r && confirm(`Remover a pesquisa ${r.dataset.remover} do modelo?`)) {
    await api(`/api/admin/pesquisas/${encodeURIComponent(r.dataset.remover)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
    await atualizarPesquisas();
  }
});

iniciar();
setInterval(() => {
  if (!sessao || $('#conteudo').hidden || document.hidden) return;
  atualizarSaude().catch(() => {});
  if (!$('[data-painel="geral"]').hidden) atualizarVisitas().catch(() => {});
}, 15_000);
