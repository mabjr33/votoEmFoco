// Liga as peças da entrada automática de pesquisas:
//   cadastro do TSE (a cada 6 h) + reportagens novas de pesquisa (a cada leitura dos feeds)
//   -> conferência em Pesquisas.sincronizarAutomaticas -> previsão recalculada para todos.

import { RegistroPesquisas } from './registro-tse.js';
import { LeitorMaterias } from './materias.js';
import { simplificar } from './extrair.js';

/** Nomes pelos quais as reportagens chamam cada finalista: nome completo e primeiro nome. */
export function candidatosDe(e26) {
  const nomes = (n) => { const s = simplificar(n); const p = s.split(' ')[0]; return p !== s && p.length >= 4 ? [s, p] : [s]; };
  return [{ chave: 'flavio', nomes: nomes(e26.lider.nome) }, { chave: 'lula', nomes: nomes(e26.segundo.nome) }];
}

export function criarAutomacao({ cfg, noticias, pesquisas, e26, fetch, log = console }) {
  const c = cfg.pesquisasTse || {};
  const cadastro = new RegistroPesquisas({ url: c.url, desde: c.desde, intervaloMs: c.intervaloMs, dataDir: cfg.cacheDir || cfg.dataDir, fetch, log });
  const materias = new LeitorMaterias({ dataDir: cfg.dataDir, candidatos: candidatosDe(e26), fetch, log });
  let timer = null;

  async function ciclo() {
    try {
      await materias.processar(noticias.payload().itens);
      const novas = await pesquisas.sincronizarAutomaticas(cadastro, materias.extracoes());
      if (novas) log.info?.(`[pesquisas] ${novas} pesquisa(s) entraram no modelo automaticamente`);
    } catch (e) { log.error?.('[pesquisas]', e); }
  }

  return {
    cadastro, materias, ciclo,
    async start() {
      await materias.carregar();
      await cadastro.start(ciclo);
      noticias.on('update', ciclo);
      // Também de tempos em tempos: reportagens que falharam por rede, cadastro que chegou depois
      timer = setInterval(ciclo, 15 * 60_000);
      timer.unref?.();
      ciclo();
    },
    stop() { cadastro.stop(); clearInterval(timer); noticias.off('update', ciclo); },
  };
}
