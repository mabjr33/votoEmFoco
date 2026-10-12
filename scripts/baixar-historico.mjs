// Baixa os arquivos de resultado do TSE (Portal de Dados Abertos) usados no histórico de 2º turnos:
// 1989 e 1990 (votação por UF) e 1994 a 2022 (votação por município e zona). São ~2 GB, baixados
// uma vez para data/historico-tse/ (fora do repositório). Um arquivo de cada vez, sem varredura:
// as URLs são as listadas no catálogo oficial (dadosabertos.tse.jus.br, conjuntos resultados-AAAA).
//   node scripts/baixar-historico.mjs
import { createWriteStream } from 'node:fs';
import { stat, mkdir, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
export const ARQUIVOS = [
  ...[1989, 1990].map((a) => `votacao_candidato_uf/votacao_candidato_uf_${a}.zip`),
  ...[1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022].map((a) => `votacao_candidato_munzona/votacao_candidato_munzona_${a}.zip`),
];
export const PASTA = path.join(ROOT, 'data', 'historico-tse');
const AGENTE = 'eleicoes-ao-vivo/1.0 (historico de 2o turno; download unico)';

async function baixar(rel) {
  const destino = path.join(PASTA, path.basename(rel));
  const url = `${BASE}/${rel}`;
  const cab = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': AGENTE } });
  if (!cab.ok) throw new Error(`${url}: HTTP ${cab.status}`);
  const tamanho = Number(cab.headers.get('content-length'));
  try { if ((await stat(destino)).size === tamanho) { console.log(`já baixado: ${path.basename(rel)}`); return; } } catch { /* ainda não */ }
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': AGENTE } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(`${destino}.parcial`));
  await rename(`${destino}.parcial`, destino);
  console.log(`baixado: ${path.basename(rel)} (${(tamanho / 1e6).toFixed(0)} MB em ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await mkdir(PASTA, { recursive: true });
  for (const a of ARQUIVOS) await baixar(a);
  console.log('pronto');
}
