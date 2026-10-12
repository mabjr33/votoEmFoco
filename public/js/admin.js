// Painel: saúde do coletor e aprovação de pesquisas. A senha fica só no sessionStorage desta aba.
import { ELEICOES } from '/shared/historico.js';
import { esc, fmtInt, fmtPct } from './util.js';

const $ = (s) => document.querySelector(s);
const E26 = ELEICOES.find((e) => e.ano === 2026);
const TZ = 'America/Sao_Paulo';
const horaDe = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–');
const duracao = (ms) => (ms == null ? 'nunca' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

let senha = null;
try { senha = sessionStorage.getItem('painel'); } catch { /* sem storage: pede a senha de novo */ }

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { ...opcoes, cache: 'no-store', headers: { ...(opcoes.headers || {}), Authorization: `Bearer ${senha}` } });
  if (r.status === 401) { sair('Senha inválida.'); throw new Error('401'); }
  if (r.status === 404 && caminho === '/api/admin/saude') { sair('Painel desligado: defina ADMIN_TOKEN (16+ caracteres) no servidor.'); throw new Error('404'); }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(corpo.erro || `HTTP ${r.status}`), { corpo });
  return corpo;
}

function sair(msg = '') {
  senha = null;
  try { sessionStorage.removeItem('painel'); } catch {}
  $('#conteudo').hidden = true;
  $('#entrar').hidden = false;
  $('#erro-entrar').textContent = msg;
}

const cartao = (r, v, ruim = false) => `<div class="cartao ${ruim ? 'ruim' : ''}"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;

async function atualizarSaude() {
  const s = await api('/api/admin/saude');
  const t = s.tse;
  const parado = t.semRespostaMs == null || t.semRespostaMs > 90_000;
  const pausado = t.pausadoAte && Date.parse(t.pausadoAte) > Date.now();
  $('#saude').innerHTML = `<div class="cartoes">
      ${cartao('Última resposta do TSE', `há ${duracao(t.semRespostaMs)}`, parado)}
      ${cartao('Consultas ao TSE', pausado ? `em pausa até ${esc(horaDe(t.pausadoAte))}` : 'normais', pausado)}
      ${cartao('2º turno presidente', t.segundoTurnoFederal ? 'publicado' : 'ainda não', false)}
      ${cartao('UFs do 2º turno de governador', esc((t.ufsGovernador2T || []).join(', ').toUpperCase() || 'nenhuma'))}
      ${cartao('Conexões ao vivo', fmtInt(s.conexoesAoVivo))}
      ${cartao('Memória do servidor', `${fmtInt(s.memoriaMb)} MB`)}
      ${cartao('Requisições ao TSE', `${fmtInt(t.requisicoes.requests)} (${fmtInt(t.requisicoes.notFound)} 404, ${fmtInt(t.requisicoes.errors)} erros)`, t.requisicoes.errors > 0 && parado)}
      ${cartao('No ar desde', esc(horaDe(s.noArDesde)))}
      ${s.cadastroPesquisas ? cartao('Cadastro de pesquisas do TSE', s.cadastroPesquisas.erro ? `erro: ${esc(s.cadastroPesquisas.erro)}` : `${fmtInt(s.cadastroPesquisas.pesquisas)} presidenciais · lido ${esc(horaDe(s.cadastroPesquisas.atualizadoEm))}`, !!s.cadastroPesquisas.erro) : ''}
    </div>
    <p class="nota">Fonte: ${esc(t.fonte)} · configuração do TSE de ${esc(t.configuracaoEm || '–')} · atualizado ${esc(horaDe(s.agora))}${t.requisicoes.lastError ? ` · último erro: ${esc(t.requisicoes.lastError)}` : ''}</p>
    <table class="tab-admin"><thead><tr><th>Disputa</th><th>Ao vivo</th><th>Seções</th><th>Totalização do TSE</th></tr></thead><tbody>
      ${s.disputas.map((d) => `<tr><td>${esc(d.label)}</td><td>${d.aoVivo ? 'sim' : 'não'}</td><td>${d.pst == null ? '–' : `${fmtPct(d.pst, 1)}%`}</td><td>${esc(d.totalizadoEm || '–')}</td></tr>`).join('')}
    </tbody></table>
    ${s.noticias ? `<table class="tab-admin"><thead><tr><th>Veículo</th><th>Situação</th><th>Manchetes</th></tr></thead><tbody>
      ${s.noticias.fontes.map((f) => `<tr><td>${esc(f.nome)}</td><td>${f.ok === null ? 'ainda não lido' : f.ok ? 'ok' : `erro: ${esc(f.erro || '')}`}</td><td>${fmtInt(f.itens)}</td></tr>`).join('')}
    </tbody></table>` : ''}`;
}

async function atualizarPesquisas() {
  const d = await api('/api/admin/pesquisas');
  const manchete = (m) => `<li><a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">${esc(m.titulo)}</a> <small>(${esc(m.fonte)})</small></li>`;
  $('#detectadas').innerHTML = (d.detectadas.length ? `<ul class="lista-det">${d.detectadas.map((p) => `<li><b>${esc(p.registro)}</b><ul>${p.manchetes.map(manchete).join('')}</ul>
      <button type="button" class="botao-2" data-preencher="${esc(p.registro)}" data-link="${esc(p.manchetes[0].link)}" data-fonte="${esc(p.manchetes[0].fonte)}">Preencher o registro no formulário</button></li>`).join('')}</ul>`
    : '<p class="nota">Nenhuma pesquisa nova com registro nas manchetes.</p>')
    + (d.semRegistro.length ? `<h3>Manchetes de pesquisa sem número de registro</h3><p class="nota">Podem ser pesquisas estaduais, repercussão de outras já no modelo ou pesquisas cujo registro só aparece no texto.</p><ul>${d.semRegistro.map(manchete).join('')}</ul>` : '');
  const link = (f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.nome)}</a>`;
  pendentes = new Map(d.pendentes.map((p) => [p.registro, p]));
  $('#pendentes').innerHTML = !d.automatica ? '<p class="nota">Entrada automática desligada neste servidor.</p>'
    : d.pendentes.length ? `<table class="tab-admin"><thead><tr><th>Pesquisa</th><th>Lido nas reportagens</th><th>Por que espera</th><th></th></tr></thead><tbody>
      ${d.pendentes.map((p) => `<tr><td>${esc(p.instituto)}<br><small>${esc(p.registro)} · campo ${esc(p.campo)} · ${fmtInt(p.amostra)} entrevistas</small></td>
        <td>${p.fontes.map((f) => `${link(f)}: ${parTexto(f)}`).join('<br>')}</td><td>${esc(p.motivo)}</td>
        <td><button type="button" class="botao-2" data-pendente="${esc(p.registro)}">Conferir e preencher</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="nota">Nada esperando aprovação.</p>';
  $('#aprovadas').innerHTML = d.aprovadas.length ? `<table class="tab-admin"><thead><tr><th>Instituto</th><th>Registro</th><th>Válidos</th><th>Origem e fonte</th><th></th></tr></thead><tbody>
      ${d.aprovadas.map((p) => `<tr><td>${esc(p.instituto)}<br><small>${esc(p.campo)}</small></td><td>${esc(p.registro)}</td>
        <td>${p.flavioValido == null ? (p.flavio == null ? '–' : `${fmtPct(p.flavio, 1)} a ${fmtPct(p.lula, 1)} (totais)`) : `${fmtPct(p.flavioValido, 1)} a ${fmtPct(p.lulaValido, 1)}`}</td>
        <td>${p.origem === 'automatica' ? `automática: ${(p.fontes || []).map(link).join(', ')}` : `painel: ${link({ url: p.fonteUrl, nome: p.fonteNome })}`}</td>
        <td><button type="button" class="link" data-remover="${esc(p.registro)}">Remover</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="nota">Nenhuma pesquisa além das fixas (src/shared/historico.js).</p>';
}
let pendentes = new Map();
const parTexto = (f) => [f.validos && `válidos ${fmtPct(f.validos.flavio, 1)} a ${fmtPct(f.validos.lula, 1)}`, f.totais && `totais ${fmtPct(f.totais.flavio, 1)} a ${fmtPct(f.totais.lula, 1)}`].filter(Boolean).join('; ');

async function carregar() {
  $('#entrar').hidden = true;
  $('#conteudo').hidden = false;
  await Promise.all([atualizarSaude(), atualizarPesquisas()]);
}

$('#rot-a').textContent = $('#rot-va').textContent = E26.lider.nome;
$('#rot-b').textContent = $('#rot-vb').textContent = E26.segundo.nome;

$('#form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  senha = $('#senha').value;
  try { sessionStorage.setItem('painel', senha); } catch {}
  $('#senha').value = '';
  carregar().catch(() => {});
});
$('#sair').addEventListener('click', () => sair());

$('#form-pesquisa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  $('#erro-pesquisa').textContent = '';
  try {
    const r = await api('/api/admin/pesquisas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    e.target.reset();
    $('#erro-pesquisa').textContent = `Publicada: ${r.pesquisa.instituto} ${r.pesquisa.registro}. A aba Previsões já foi recalculada para todos.`;
    await atualizarPesquisas();
  } catch (err) { $('#erro-pesquisa').textContent = err.message; }
});

document.addEventListener('click', async (e) => {
  const p = e.target.closest('[data-preencher]');
  if (p) {
    const f = $('#form-pesquisa');
    f.registro.value = p.dataset.preencher;
    f.fonteUrl.value = p.dataset.link;
    f.fonteNome.value = p.dataset.fonte;
    f.instituto.focus();
    return;
  }
  const pend = pendentes.get(e.target.closest('[data-pendente]')?.dataset.pendente);
  if (pend) {
    // Preenche com o que foi lido; quem aprova confere na fonte antes de publicar
    const f = $('#form-pesquisa');
    for (const k of ['registro', 'instituto', 'campo', 'divulgacao', 'amostra', 'margem', 'flavio', 'lula', 'flavioValido', 'lulaValido', 'fonteUrl', 'fonteNome']) {
      f[k].value = pend[k] == null ? '' : String(pend[k]).replace('.', ',');
    }
    f.fonteUrl.value = pend.fonteUrl || '';
    $('#erro-pesquisa').textContent = 'Preenchido com o que foi lido nas reportagens. Confira na fonte antes de aprovar.';
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const r = e.target.closest('[data-remover]');
  if (r && confirm(`Remover a pesquisa ${r.dataset.remover} do modelo?`)) {
    await api(`/api/admin/pesquisas/${encodeURIComponent(r.dataset.remover)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
    await atualizarPesquisas();
  }
});

if (senha) carregar().catch(() => {});
setInterval(() => { if (senha) atualizarSaude().catch(() => {}); }, 10_000);
