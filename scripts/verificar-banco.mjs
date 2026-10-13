// Confere a ligação com o Supabase: npm run banco
// Usa SUPABASE_URL e SUPABASE_SERVICE_KEY do ambiente. Só lê; não grava nada.
import { criarBanco } from '../src/banco.js';

const cfg = { supabaseUrl: process.env.SUPABASE_URL, supabaseChave: process.env.SUPABASE_SERVICE_KEY };
if (!cfg.supabaseUrl || !cfg.supabaseChave) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY antes (veja o README, seção "Banco de dados").');
  process.exit(1);
}
if (cfg.supabaseChave.startsWith('sb_publishable_')) {
  console.error('Essa é a chave pública (publishable). Use a chave secreta (sb_secret_...) ou a service_role.');
  process.exit(1);
}

let banco;
try { banco = criarBanco(cfg); } catch (e) { console.error(e.message); process.exit(1); }
try {
  const p = await banco.lerPesquisas();
  const a = await banco.lerAcesso();
  console.log('Banco ok.');
  console.log(`- pesquisas no banco: ${p.itens.length} (removidas no painel: ${p.ignoradas.length})`);
  console.log(`- acesso ao painel: ${a ? `usuário "${a.usuario}"` : 'ainda não criado (vai ser levado na primeira partida ou ao criar no painel)'}`);
} catch (e) {
  const m = e.message;
  console.error(`Falhou: ${m}`);
  if (/HTTP 404|PGRST205|does not exist/.test(m)) console.error('As tabelas não existem: rode supabase/schema.sql no SQL Editor do projeto.');
  else if (/HTTP 401|HTTP 403/.test(m)) console.error('Chave recusada: confira se é a chave secreta (sb_secret_...) ou a service_role, do mesmo projeto da URL.');
  else console.error('Confira a URL (https://<projeto>.supabase.co) e a internet.');
  process.exit(1);
}
