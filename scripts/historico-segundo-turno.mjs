// Monta src/shared/segundos-turnos.js: todas as disputas de presidente e de governador que foram
// ao 2º turno de 1989 a 2022, com os votos válidos de cada finalista nos dois turnos. Fonte única:
// os arquivos de resultado do TSE baixados por scripts/baixar-historico.mjs (data/historico-tse/).
//   node scripts/historico-segundo-turno.mjs
// Precisa de `unzip` e `grep` (Git Bash no Windows, ou qualquer Linux/macOS).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { PASTA } from './baixar-historico.mjs';

const ANOS_NOVOS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];
const disputas = new Map(); // "ano|cargo|uf" -> { ano, cargo, uf, turnos: { 1: Map(n -> cand), 2: Map } }

function somar(ano, cargo, uf, turno, n, nome, partido, votos) {
  const k = `${ano}|${cargo}|${uf}`;
  if (!disputas.has(k)) disputas.set(k, { ano, cargo, uf, turnos: { 1: new Map(), 2: new Map() } });
  const t = disputas.get(k).turnos[turno];
  if (!t) return;
  const c = t.get(n) || { n, nome, partido, votos: 0 };
  c.votos += votos;
  t.set(n, c);
}

/** Linha de CSV do TSE: separador ";", campos entre aspas ou não. */
function campos(linha) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (q) { if (ch === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Lê um arquivo de dentro do zip, já filtrado pelo grep, linha a linha (latin1 nos antigos). */
function linhas(zip, arquivo, filtro, aoLer) {
  return new Promise((resolve, reject) => {
    const unz = spawn('unzip', ['-p', zip, arquivo]);
    const grep = spawn('grep', ['-a', '-i', '-E', filtro]);
    unz.stdout.pipe(grep.stdin);
    unz.on('error', reject); grep.on('error', reject);
    grep.stdin.on('error', () => {}); // grep pode fechar antes
    const rl = createInterface({ input: grep.stdout.setEncoding('latin1') });
    rl.on('line', aoLer);
    grep.on('close', resolve);
  });
}

// ---------- 1989 (presidente) e 1990 (governador): formato antigo, sem cabeçalho ----------
// Colunas (Leia-me do TSE): 3 turno, 5 UF, 7 código do cargo, 8 número, 11 nome de urna (10 nome), 20 partido, 25 votos
async function antigos() {
  const ler = (zip, arq, cargoQuer) => linhas(zip, arq, cargoQuer === 1 ? 'PRESIDENTE' : 'GOVERNADOR', (l) => {
    const f = campos(l);
    if (Number(f[7]) !== cargoQuer) return;
    const nome = f[11] && !f[11].startsWith('#') ? f[11] : f[10];
    somar(Number(f[2]), cargoQuer === 1 ? 'presidente' : 'governador', cargoQuer === 1 ? 'BR' : f[5], Number(f[3]), f[8], nome, f[20], Number(f[25]) || 0);
  });
  const z89 = path.join(PASTA, 'votacao_candidato_uf_1989.zip');
  await ler(z89, 'VOTACAO_CANDIDATO_UF_1989/VOTACAO_CANDIDATO_UF_1989.txt', 1);
  const z90 = path.join(PASTA, 'votacao_candidato_uf_1990.zip');
  for (const arq of execFileSync('unzip', ['-Z1', z90], { encoding: 'utf8' }).split(/\r?\n/).filter((a) => /_[A-Z]{2}\.txt$/i.test(a))) await ler(z90, arq, 3);
}

// ---------- 1994 a 2022: votação por município e zona, com cabeçalho ----------
async function novos(ano) {
  const zip = path.join(PASTA, `votacao_candidato_munzona_${ano}.zip`);
  const arquivos = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const cab = campos(execFileSync('bash', ['-c', `unzip -p "${zip}" "${arquivos[0]}" | head -1`], { encoding: 'latin1' }).trim());
  const ix = (nome) => { const i = cab.indexOf(nome); if (i < 0) throw new Error(`${ano}: sem coluna ${nome}`); return i; };
  // Alguns anos não têm a coluna de votos válidos: aí vale QT_VOTOS_NOMINAIS, descartando os votos
  // que o TSE marca como não válidos (anulados, nulos técnicos) na coluna de destinação, se houver
  const temValidos = cab.includes('QT_VOTOS_NOMINAIS_VALIDOS');
  const I = { turno: ix('NR_TURNO'), uf: ix('SG_UF'), cargo: ix('CD_CARGO'), n: ix('NR_CANDIDATO'), urna: ix('NM_URNA_CANDIDATO'), partido: ix('SG_PARTIDO'),
    validos: ix(temValidos ? 'QT_VOTOS_NOMINAIS_VALIDOS' : 'QT_VOTOS_NOMINAIS'), destino: cab.indexOf('NM_TIPO_DESTINACAO_VOTOS') };
  const valido = (f) => temValidos || I.destino < 0 || !/anulad|nul|inv/i.test(f[I.destino] || '');
  for (const arq of arquivos) {
    const m = arq.match(/_([A-Z]{2}|BRASIL)\.csv$/i);
    if (!m || m[1].toUpperCase() === 'BRASIL') continue; // BRASIL repete todos os estados
    const br = m[1].toUpperCase() === 'BR';
    // Presidente: só no arquivo BR (os dos estados não repetem presidente). Governador: arquivos dos estados.
    const filtro = br ? ';1;"Presidente";' : ';3;"Governador";';
    await linhas(zip, arq, filtro, (l) => {
      const f = campos(l);
      const cargo = Number(f[I.cargo]);
      if ((br && cargo !== 1) || (!br && cargo !== 3) || !valido(f)) return;
      somar(ano, br ? 'presidente' : 'governador', br ? 'BR' : f[I.uf], Number(f[I.turno]), f[I.n], f[I.urna], f[I.partido], Number(f[I.validos]) || 0);
    });
  }
  console.log(`${ano}: lido`);
}

await antigos();
console.log('1989 e 1990: lidos');
for (const a of ANOS_NOVOS) await novos(a);

// ---------- só as disputas com 2º turno ----------
const r1 = (x) => Math.round(x * 100) / 100;
const lista = [];
for (const d of disputas.values()) {
  const t1 = [...d.turnos[1].values()], t2 = [...d.turnos[2].values()].filter((c) => c.votos > 0);
  if (t2.length !== 2 || !t1.length) continue;
  const v1 = t1.reduce((s, c) => s + c.votos, 0), v2 = t2.reduce((s, c) => s + c.votos, 0);
  const fin = t2.map((c) => ({ ...c, v1: d.turnos[1].get(c.n)?.votos || 0, v2: c.votos }));
  fin.sort((a, b) => b.v1 - a.v1); // a = mais votado no 1º turno
  const [a, b] = fin;
  const pos1 = (c) => t1.filter((x) => x.votos > c.v1).length + 1;
  lista.push({
    ano: d.ano, cargo: d.cargo, uf: d.uf.toLowerCase(),
    a: { nome: a.nome, partido: a.partido, p1: r1((100 * a.v1) / v1), p2: r1((100 * a.v2) / v2), pos1: pos1(a) },
    b: { nome: b.nome, partido: b.partido, p1: r1((100 * b.v1) / v1), p2: r1((100 * b.v2) / v2), pos1: pos1(b) },
    validos1: v1, validos2: v2,
  });
}
lista.sort((x, y) => x.ano - y.ano || (x.cargo === y.cargo ? x.uf.localeCompare(y.uf) : x.cargo === 'presidente' ? -1 : 1));
const js = `// Gerado por scripts/historico-segundo-turno.mjs a partir dos arquivos de resultado do TSE
// (Portal de Dados Abertos, conjuntos resultados-1989 a resultados-2022). Não editar à mão.
// Cada item: uma disputa de presidente ou governador que foi ao 2º turno. a = mais votado no 1º turno.
// p1, p2: % dos votos válidos no 1º e no 2º turno; pos1: colocação no 1º turno.
export const SEGUNDOS_TURNOS = ${JSON.stringify(lista, null, 0).replace(/\},\{"ano"/g, '},\n  {"ano"')};
`;
await writeFile(path.join(ROOT, 'src', 'shared', 'segundos-turnos.js'), js);
console.log(`${lista.length} disputas com 2º turno (${lista.filter((x) => x.cargo === 'presidente').length} de presidente)`);
