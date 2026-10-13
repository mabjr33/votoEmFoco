// Acesso ao painel: usuário e senha criados pelo dono do site. Não existe conta padrão.
//
// - O primeiro acesso (e a redefinição, se a senha for esquecida) exige o código de instalação,
//   que é o ADMIN_TOKEN: só quem administra o servidor o vê. Assim ninguém cria o acesso antes do dono.
// - A senha é guardada só como hash scrypt (sal aleatório), em data/admin-acesso.json e, para
//   sobreviver a reinícios em hospedagens que apagam o disco, na variável ADMIN_LOGIN
//   ("usuario:hash", gerada pelo próprio painel; não contém a senha).
// - Sessão: código aleatório enviado no cabeçalho Authorization (sem cookie, então sem CSRF),
//   válido por 12 horas; trocar a senha encerra todas as sessões.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const PARAM = { N: 16384, r: 8, p: 1 }; // ~16 MB de memória por cálculo
const DURACAO_SESSAO = 12 * 3_600_000;
const MAX_SESSOES = 20;
const USUARIO = /^[a-z0-9._-]{3,32}$/;
// Senhas que aparecem em qualquer lista de vazamento (comparação sem maiúsculas e sem acento)
const COMUNS = new Set(['admin', 'administrador', 'administrator', 'senha', 'password', 'qwerty', 'abc123', 'root', 'eleicao', 'eleicoes', 'votoemfoco', 'brasil']);
const sha = (s) => createHash('sha256').update(String(s)).digest();

// Cada cálculo usa ~16 MB: uma enxurrada de tentativas de login ao mesmo tempo esgotaria a memória
// do servidor. Poucos cálculos de cada vez, fila curta; o resto recebe "ocupado" (503) na hora.
const MAX_SIMULTANEOS = 2;
const MAX_FILA = 16;
let ocupados = 0;
const fila = [];
async function comVaga(fn) {
  if (ocupados >= MAX_SIMULTANEOS) {
    if (fila.length >= MAX_FILA) throw Object.assign(new Error('Servidor ocupado. Tente de novo em instantes.'), { ocupado: true });
    await new Promise((r) => fila.push(r)); // a vaga é passada direto por quem terminou
  } else ocupados++;
  try { return await fn(); } finally { const prox = fila.shift(); if (prox) prox(); else ocupados--; }
}

export async function gerarHash(senha) {
  const sal = randomBytes(16);
  const h = await comVaga(() => scrypt(String(senha).normalize('NFC'), sal, 32, PARAM));
  return `scrypt$${PARAM.N}$${PARAM.r}$${PARAM.p}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export async function conferirHash(senha, guardado) {
  const [tipo, N, r, p, sal, h] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64url');
  const calc = await comVaga(() => scrypt(String(senha).normalize('NFC'), Buffer.from(sal, 'base64url'), esperado.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 }));
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

/** Regras de usuário e senha. Devolve uma mensagem de erro ou null. */
export function validarCredenciais(usuario, senha) {
  const u = String(usuario || '').trim().toLowerCase();
  const s = String(senha || '');
  if (!USUARIO.test(u)) return 'Usuário: de 3 a 32 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.';
  if (s.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (s.length > 200) return 'Senha longa demais.';
  const simples = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (simples.includes(u)) return 'A senha não pode conter o nome de usuário.';
  const semNumeros = simples.replace(/[^a-z]/g, '');
  if (COMUNS.has(simples) || COMUNS.has(semNumeros) || /^(.)\1+$/.test(s) || /^(0123456789|1234567890|9876543210)/.test(simples)) return 'Senha fácil demais de adivinhar. Use uma frase ou uma combinação sua.';
  if (new Set(s).size < 5) return 'Use pelo menos 5 caracteres diferentes na senha.';
  return null;
}

export class Acesso {
  /** opcoes: { dataDir, loginEnv (ADMIN_LOGIN "usuario:hash"), codigoInstalacao (ADMIN_TOKEN), banco (src/banco.js) } */
  constructor({ dataDir = null, loginEnv = null, codigoInstalacao = null, banco = null, log = console } = {}) {
    this.banco = banco;
    this.log = log;
    this.arquivo = dataDir ? path.join(dataDir, 'admin-acesso.json') : null;
    this.codigo = typeof codigoInstalacao === 'string' && codigoInstalacao.length >= 16 ? codigoInstalacao : null;
    this.conta = null; // { usuario, hash }
    const m = String(loginEnv || '').match(/^([a-z0-9._-]{3,32}):(scrypt\$[^\s]+)$/);
    if (m) this.conta = { usuario: m[1], hash: m[2], origem: 'variavel' };
    this.sessoes = new Map(); // sha(código) -> { usuario, expira }
  }

  async carregar() {
    let bancoOk = false;
    if (this.banco) {
      try {
        const c = await this.banco.lerAcesso();
        bancoOk = true;
        if (c && USUARIO.test(c.usuario) && String(c.hash).startsWith('scrypt$')) { this.conta = { ...c, origem: 'banco' }; return; }
      } catch (e) { this.log.warn?.(`[admin] banco indisponível, usando arquivo/variável: ${e.message}`); }
    }
    if (this.arquivo) {
      try {
        const j = JSON.parse(await readFile(this.arquivo, 'utf8'));
        // O arquivo é o mais recente (criado ou trocado neste servidor): vale mais que a variável
        if (USUARIO.test(j.usuario) && String(j.hash).startsWith('scrypt$')) this.conta = { usuario: j.usuario, hash: j.hash, origem: 'arquivo' };
      } catch { /* ainda não criado */ }
    }
    // Banco novo e vazio: leva para ele o acesso que já existia (arquivo ou ADMIN_LOGIN)
    if (bancoOk && this.conta) {
      try { await this.banco.gravarAcesso(this.conta); this.conta.origem = 'banco'; } catch (e) { this.log.warn?.(`[admin] acesso não gravado no banco: ${e.message}`); }
    }
  }

  async salvar() {
    if (!this.conta) return;
    if (this.arquivo) {
      await mkdir(path.dirname(this.arquivo), { recursive: true });
      const tmp = `${this.arquivo}.tmp`;
      await writeFile(tmp, JSON.stringify({ usuario: this.conta.usuario, hash: this.conta.hash }), { mode: 0o600 });
      await rename(tmp, this.arquivo);
    }
    if (this.banco) {
      try { await this.banco.gravarAcesso(this.conta); this.conta.origem = 'banco'; } catch (e) { this.log.warn?.(`[admin] acesso não gravado no banco: ${e.message}`); }
    }
  }

  /** O painel existe se há conta ou código para criá-la. */
  get ativo() { return !!(this.conta || this.codigo); }
  get configurado() { return !!this.conta; }
  linhaVariavel() { return this.conta ? `ADMIN_LOGIN=${this.conta.usuario}:${this.conta.hash}` : null; }

  codigoConfere(codigo) {
    if (!this.codigo || typeof codigo !== 'string') return false;
    return timingSafeEqual(sha(codigo), sha(this.codigo));
  }

  /** Cria a conta (ou redefine, se esquecida). Exige o código de instalação. */
  async definir({ codigo, usuario, senha }) {
    if (!this.codigoConfere(codigo)) return { erro: 'Código de instalação inválido.', status: 401 };
    const erro = validarCredenciais(usuario, senha);
    if (erro) return { erro, status: 422 };
    this.conta = { usuario: String(usuario).trim().toLowerCase(), hash: await gerarHash(senha), origem: 'arquivo' };
    this.sessoes.clear();
    await this.salvar();
    return { sessao: this.abrirSessao(this.conta.usuario), linhaVariavel: this.linhaVariavel(), noBanco: this.conta.origem === 'banco' };
  }

  async entrar({ usuario, senha }) {
    if (typeof senha !== 'string' || senha.length > 200) return { erro: 'Usuário ou senha incorretos.', status: 401 };
    const u = String(usuario || '').trim().toLowerCase();
    const certo = this.conta && u === this.conta.usuario;
    // Mesmo com usuário errado, faz a conta inteira: o tempo de resposta não revela se o usuário existe
    const ok = await conferirHash(senha, certo ? this.conta.hash : FALSO);
    return certo && ok ? { sessao: this.abrirSessao(u) } : { erro: 'Usuário ou senha incorretos.', status: 401 };
  }

  async trocarSenha(sessao, { senhaAtual, novaSenha }) {
    const s = this.sessao(sessao);
    if (!s) return { erro: 'Sessão expirada.', status: 401 };
    if (!(await conferirHash(senhaAtual, this.conta.hash))) return { erro: 'Senha atual incorreta.', status: 401 };
    const erro = validarCredenciais(this.conta.usuario, novaSenha);
    if (erro) return { erro, status: 422 };
    this.conta = { ...this.conta, hash: await gerarHash(novaSenha), origem: 'arquivo' };
    this.sessoes.clear();
    await this.salvar();
    return { sessao: this.abrirSessao(this.conta.usuario), linhaVariavel: this.linhaVariavel(), noBanco: this.conta.origem === 'banco' };
  }

  abrirSessao(usuario) {
    const agora = Date.now();
    for (const [k, v] of this.sessoes) if (v.expira < agora) this.sessoes.delete(k);
    while (this.sessoes.size >= MAX_SESSOES) this.sessoes.delete(this.sessoes.keys().next().value);
    const codigo = randomBytes(32).toString('base64url');
    this.sessoes.set(sha(codigo).toString('hex'), { usuario, expira: agora + DURACAO_SESSAO });
    return codigo;
  }

  sessao(codigo) {
    if (!codigo) return null;
    const k = sha(codigo).toString('hex');
    const s = this.sessoes.get(k);
    if (!s || s.expira < Date.now()) { this.sessoes.delete(k); return null; }
    return s;
  }

  sair(codigo) { if (codigo) this.sessoes.delete(sha(codigo).toString('hex')); }

  /** Só para testes e para apagar o acesso local. */
  async apagarArquivo() { if (this.arquivo) await unlink(this.arquivo).catch(() => {}); }
}

// Hash de uma senha que ninguém sabe, para conferir quando o usuário não existe (tempo igual)
const FALSO = `scrypt$${PARAM.N}$${PARAM.r}$${PARAM.p}$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`;
