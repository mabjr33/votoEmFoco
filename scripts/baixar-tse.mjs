// npm run baixar
// Baixa do TSE, uma vez, os arquivos oficiais do 1º turno de 2026 que o site usa.
// Depois disso, `npm run mock` mostra o 1º turno real e simula só o 2º turno.
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { baixarPrimeiroTurno } from '../src/tse/baixar.js';
import { fmtResumo } from '../src/mock/fonte-real.js';

const destino = process.env.DESTINO || path.join(ROOT, 'data', 'tse-1turno');
try {
  const m = await baixarPrimeiroTurno({ destino });
  console.log(`\n${fmtResumo(m)}\n\nArquivos salvos em ${destino}`);
  console.log('Agora rode `npm run mock` para testar com o 1º turno real.');
} catch (e) {
  console.error(`\n[baixar] Não deu certo: ${e.message}`);
  process.exitCode = 1;
}
process.exit();
