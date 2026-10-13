-- Voto em Foco: tabelas no Supabase (Postgres). Rode uma vez no SQL Editor do projeto.
-- O servidor acessa com a chave service_role (só no servidor, variável SUPABASE_SERVICE_KEY).
-- RLS ligado e sem nenhuma política: a chave pública (anon) não lê nem grava nada.

create table if not exists pesquisas (
  registro       text primary key check (registro ~ '^BR-[0-9]{5}/20[0-9]{2}$'),
  instituto      text        not null,
  campo          text,
  divulgacao     text,
  amostra        integer     not null check (amostra between 100 and 200000),
  margem         numeric(4,2) check (margem is null or margem between 0.1 and 10),
  flavio         numeric(5,2) check (flavio between 0 and 100),
  lula           numeric(5,2) check (lula between 0 and 100),
  flavio_valido  numeric(5,2) check (flavio_valido between 0 and 100),
  lula_valido    numeric(5,2) check (lula_valido between 0 and 100),
  depois_1t      boolean     not null default true,
  fonte_url      text        not null,
  fonte_nome     text,
  origem         text        not null default 'painel' check (origem in ('painel', 'automatica')),
  fontes         jsonb,               -- veículos que confirmaram (entradas automáticas)
  cnpj           text,
  fim            date,                -- último dia de campo (cadastro do TSE)
  aprovada_em    timestamptz not null default now()
);

-- Automáticas que o dono removeu no painel: não voltam sozinhas
create table if not exists pesquisas_ignoradas (
  registro  text primary key,
  em        timestamptz not null default now()
);

-- Acesso ao painel: uma linha só (usuário e hash scrypt da senha; nunca a senha)
create table if not exists painel_acesso (
  id             smallint primary key default 1 check (id = 1),
  usuario        text not null check (usuario ~ '^[a-z0-9._-]{3,32}$'),
  hash           text not null check (hash like 'scrypt$%'),
  atualizado_em  timestamptz not null default now()
);

alter table pesquisas enable row level security;
alter table pesquisas_ignoradas enable row level security;
alter table painel_acesso enable row level security;
