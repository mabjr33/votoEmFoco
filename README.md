# Voto em Foco: apuração do 2º turno de 2026 em tempo real, com dados do TSE, e simulador de quem será eleito

Sistema web que lê os **arquivos oficiais de divulgação do TSE** e mostra a apuração em tempo real. O diferencial é o **simulador ao vivo**: durante a contagem, ele mostra quantos votos válidos ainda faltam e quanto cada candidato precisa receber deles para vencer. Você também define como acha que esse restante vai se dividir e vê na hora quem seria eleito.

## O que tem na tela

Visual claro e limpo, em quatro abas: Resultado, Previsões, Notícias e Simulador.

- **Resultado**: placar no topo, com 1º e 2º turno e, durante a apuração, os modos Oficial, Projeção e Simulação. Abaixo vêm o mapa do Brasil e um painel ao lado. Clique em um estado, ou escolha na lista, para ver Presidente, Governador e Senado ali. Durante a contagem, o quadro **Ainda dá para virar?** mostra de quanto dos votos que faltam quem está atrás precisa, comparado com a estimativa; quando a diferença passa do número de eleitores das seções que faltam (dado do TSE), diz que não dá mais. Mais abaixo ficam a divisão por região, **como a apuração andou** (percentuais ou diferença em votos, com o horário de cada totalização e o botão **Rever a apuração**) e o registro do que aconteceu.
- Abas de disputa: **Presidente**, **Governadores** (mapa por partido, 2º turno ao vivo, lista de estados), **Senado** (bancada eleita) e **Exterior** (mapa-múndi com as cidades e lista por país).
- **Previsões**: modelos para o 2º turno presidencial feitos com o histórico de 1989 a 2026 (veja abaixo).
- **Notícias**: manchetes sobre a eleição de 11 veículos, lidas automaticamente, com filtros, próximas datas (debates e prazos) e pesquisas nas manchetes.
- **Simulador**: "Quem será eleito?", em votos válidos.
- **Modo telão** (`#telao`, link ao lado das disputas): para TV ou projetor. Números grandes, só votos oficiais já totalizados, passa sozinho pelo presidente e pelos 2º turnos de governador a cada 12 s (setas do teclado trocam), relógio de Brasília e botão de tela cheia. No modo de teste, o aviso de 2º turno simulado continua na tela.

O nome do site, **Voto em Foco**, fica em `public/js/marca.js` (e no `<title>`/tags de `public/index.html`). O ícone (`public/favicon.svg`) é inspirado nas cores da bandeira, com uma lupa e um ✓ de voto; não reproduz a bandeira (Lei 5.700/71).

## Como rodar

Requer Node.js 20 ou superior. Não tem dependências externas.

```bash
npm start            # lê https://resultados.tse.jus.br (ambiente "oficial")
# abra http://localhost:3000
```

`npm start` já usa os dados reais: nomes, partidos, números, fotos e votos do 1º turno vêm direto do TSE.

### Testar com o 1º turno real

Fora do dia da eleição, o **modo de teste** mostra o 1º turno real e simula só o 2º turno:

```bash
npm run baixar     # uma vez: baixa do TSE os arquivos oficiais do 1º turno (cerca de 1 minuto)
npm run mock       # 1º turno real + 2º turno simulado de 0 a 100% em 3 minutos
```

O `npm run baixar` usa o mesmo cliente do servidor (no máximo 8 requisições por segundo, sem repetir 404, pausa se o TSE recusar). Ele guarda em `data/tse-1turno/` a configuração, Presidente por estado e no exterior, as cidades do exterior, Governador, Senador e as fotos dos principais candidatos. Ao terminar, imprime um resumo para conferir: candidatos e percentuais, finalistas, disputas de governador no 2º turno e senadores eleitos. Também avisa se algo não bate, por exemplo a soma dos votos diferente dos válidos. O manifesto fica em `data/tse-1turno/manifesto.json`. Se o resumo vier errado, é sinal de que o formato real do TSE difere do documentado: mande o manifesto que eu ajusto a leitura.

**O 2º turno do modo de teste é simulado.** Ele parte do cenário-base do simulador (votos do 1º turno de cada estado, com os eleitores dos eliminados divididos pela proximidade dos partidos) e soma um deslocamento nacional **sorteado a cada execução**, de até 5 pontos. Não é previsão: o vencedor muda de uma execução para outra. Para repetir um sorteio, use `MOCK_SEED=123 npm run mock`. A tela avisa em cima ("O 1º turno é o real do TSE… O 2º turno é uma simulação…") e no placar ("2º turno simulado para teste · não é resultado"). Nesse modo, a aba Notícias lê os feeds reais.

### Testar com nomes fictícios

```bash
npm run mock:ficticio            # dados sintéticos e nomes fictícios, feeds de notícias fictícios
MOCK_DURATION=600 npm run mock   # mais lento (Windows: $env:MOCK_DURATION=600; npm run mock)
npm test                         # 55 testes (3 deles conferem os dados de data/tse-1turno, se existir)
```

Sem a pasta `data/tse-1turno`, o `npm run mock` também usa os dados fictícios.

Com Docker:

```bash
docker build -t eleicoes-ao-vivo .
docker run -p 3000:3000 -v $(pwd)/data:/app/data eleicoes-ao-vivo
```

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | 3000 | Porta HTTP |
| `POLL_MS` | 15000 | Intervalo entre consultas ao TSE (mínimo 3000) |
| `MAX_RPS` | 8 | Requisições por segundo ao TSE (teto rígido de 50) |
| `TSE_BASE` | `https://resultados.tse.jus.br` | Host dos arquivos |
| `TSE_AMBIENTE` | `oficial` | `oficial` ou o ambiente de simulado do TSE |
| `DATA_DIR` | `./data` | Cache em disco |
| `MAX_SSE` | 5000 | Conexões ao vivo simultâneas (acima disso, a página consulta a cada 30 s) |
| `ADMIN_TOKEN` | (vazio) | Código de instalação do painel `/admin.html` (16+ caracteres): pedido para criar ou redefinir o acesso. Não é a senha |
| `ADMIN_LOGIN` | (vazio) | Usuário e hash da senha do painel (o painel gera a linha). Mantém o acesso quando o disco é apagado |
| `PUBLIC_URL` | (vazio) | Endereço público, ex.: `https://seudominio.com.br` (prévia ao compartilhar) |
| `TRUST_PROXY` | 0 | `1` atrás de proxy/CDN: usa o IP de `X-Forwarded-For` no limite de tentativas do painel |
| `PESQUISAS_AUTO` | 1 | `0` desliga a entrada automática de pesquisas (cadastro do TSE + reportagens) |

## O simulador ao vivo

Tudo é calculado em **votos válidos nacionais**.

1. **Já apurado:** votos oficiais de cada candidato, somados de todos os estados e do exterior.
2. **Quanto falta:** estimado estado a estado, multiplicando o eleitorado das seções ainda não totalizadas pelo comparecimento e pelos votos válidos já observados naquele estado. Antes de haver votos num estado, vale o cenário-base a partir do 1º turno.
3. **Como o que falta se divide:** por padrão, a estimativa de cada estado, que combina a tendência já apurada com o cenário-base. Você pode:
   - arrastar uma barra (fração nacional dos votos que faltam);
   - digitar quantos votos dos que faltam vão para um candidato;
   - usar atalhos: estimativa, igual ao já apurado, igual ao 1º turno, meio a meio ou ponto de empate;
   - definir uma fração por região. O país continua batendo com o número escolhido, e as diferenças entre regiões são mantidas.
4. **Ponto de virada:** a fração dos votos que faltam de que quem está atrás precisa para empatar. Se passar de 100%, a eleição está matematicamente definida.
5. **Ajustes extras:** comparecimento no que falta (70% a 130%) e "somar ou tirar votos" (tirados do adversário ou novos votos).
   Com a apuração em andamento ou encerrada, "Simular o 2º turno inteiro" deixa os votos apurados de fora e refaz tudo a partir do 1º turno.
6. **Chance:** 2.000 variações sorteiam um erro nacional (±2 pp) e um erro por região (±1,5 pp) sobre o que falta. Com tudo apurado, não há incerteza.

O resultado é recalculado a cada movimento e a cada nova atualização do TSE.

**Cenário-base antes da apuração:** em cada estado, os eleitores do 1º turno são redistribuídos. Os finalistas mantêm 95% dos seus eleitores. Os eliminados mandam 70% dos votos para os finalistas, divididos pela proximidade ideológica do partido. Brancos, nulos e abstenções se dividem meio a meio. Tudo isso é editável em "Premissas antes da apuração".

### Limitações

- A estimativa do que falta trabalha por estado. Dentro de um estado, a ordem de chegada das urnas (capital antes do interior, por exemplo) pode enviesar o começo da apuração.
- O posicionamento ideológico dos partidos (`src/shared/presets.js`) é só a primeira sugestão.
- Simulações não são pesquisas eleitorais e não devem ser divulgadas como tal (Lei 9.504/97, art. 33).

## Previsões

A aba **Previsões** junta fatos e estimativas, sempre separados na tela. Os dados e as fontes estão em `src/shared/historico.js` (reunidos em 11/10/2026). As contas estão em `src/shared/previsao.js`, coberto por `test/previsao.test.js`.

| O quê | Como | Resultado (12/10/2026) |
|---|---|---|
| Pesquisas corrigidas | Média das 6 pesquisas nacionais de 2º turno pós-1º turno, a mais recente de cada instituto (DataTrends, Ipespe, PoderData, Datafolha, AtlasIntel, Vox Brasil: 52,1%) + erro médio das últimas pesquisas de 2º turno em 2010, 2018 e 2022 (PT superestimado em 0,83 pp, 13 pesquisas) | Flávio 53,0% (±2,0) |
| Transferência dos eliminados | 1º turno + média de três leituras de para onde vão os 7,81% dos demais: Datafolha 6–8/10, todos juntos (46% Flávio, 32% Lula) = 51,5%; Ipespe 6–8/10, por candidato (Cury 50/29, Caiado 56/15, Renan 36/20) = 52,0%; perfil dos partidos (regra do simulador) = 51,9% | Flávio 51,8% (±2,0: premissa + discordância entre leituras) |
| Histórico de 2º turnos | As 125 disputas de presidente (7) e governador (118) que foram ao 2º turno de 1989 a 2022, com votos dos arquivos do TSE: em média sobra 51% da vantagem do líder entre os dois; incerteza medida nas 35 disputas com fatia parecida de votos fora dos finalistas | Flávio 50,5% (±4,4) |
| Combinação | Média ponderada pelo inverso da variância; incerteza = média ponderada dos desvios (conservadora, porque os modelos se correlacionam) | Flávio 52,2%, faixa de 80% 49,4 a 55,0; chance de 84% no modelo |
| Abstenção | Variação média do 1º para o 2º turno, 2002 a 2022 (+1,77 pp) | 22,9% (20,7 a 24,5) |
| Mapa provável | Cenário-base do simulador deslocado por igual até bater com a combinação; chance por estado com ±1,5 pp extra | por estado |
| Governadores | Só o cenário-base do simulador (sem pesquisas estaduais reunidas) | por estado |

A página também mostra o erro de cada pesquisa final desde 2010, cenários "e se as pesquisas errarem como em X", o 1º → 2º turno de cada eleição desde 1989, as pesquisas do 2º turno de 2026 com número de registro e a lista de fontes.

**Fatos que a página destaca, calculados dos dados:** o líder do 1º turno venceu as 7 disputas de 2º turno desde 1989; a diferença de 1,87 pp no 1º turno de 2026 é a menor da série; os dois finalistas somaram 92,19%, a maior soma.

**Histórico do TSE:** `node scripts/baixar-historico.mjs` baixa uma vez (~2 GB, fora do repositório) os resultados de 1989 a 2022 do Portal de Dados Abertos; `node scripts/historico-segundo-turno.mjs` gera `src/shared/segundos-turnos.js` (125 disputas, poucos KB). Eleições de 1945 a 1960 (turno único, voto restrito) e o período sem eleição direta para presidente não entram: não dizem nada sobre 2º turno. Com vantagem pequena no 1º turno (50% a 52% entre os dois, como em 2026), o líder venceu 13 de 26 disputas.

**Ficou de fora:** pesquisas finais de 2002, 2006 e 2014 (não deu para conferir os números em fonte confiável), 1º turno de 1989 na abstenção, debates e fatos novos.

### Pesquisas novas entram sozinhas

Toda pesquisa eleitoral divulgada tem registro no TSE, mas o cadastro oficial (PesqEle) **não traz os resultados**: é feito antes do campo e guarda instituto, CNPJ, período, data de divulgação e número de entrevistas. Por isso a entrada automática junta duas coisas (`src/pesquisas-auto/`):

1. **Cadastro do TSE** (`registro-tse.js`): o arquivo `pesquisa_eleitoral_2026.zip` do Portal de Dados Abertos (conjunto `pesquisas-eleitorais-2026`), consultado a cada 6 h com pedido condicional (só baixa os ~6 MB quando muda; o TSE o atualiza uma vez por dia). Ficam as pesquisas presidenciais nacionais com campo terminado a partir de 6/10.
2. **Reportagens** (`materias.js`, `extrair.js`): as notícias etiquetadas como pesquisa de presidente são abertas uma vez cada, com pausa entre elas. O extrator só aceita frase que cita os dois finalistas e tem exatamente dois percentuais; recusa frases sobre 1º turno, pesquisa anterior, recortes (região, renda, religião…), expectativa de vitória, rejeição e transferência; ignora manchetes soltas ("leia mais"); classifica por soma (100 = válidos; até 98 = totais) e exige que totais e válidos da mesma reportagem batam.

A pesquisa entra no modelo quando: está no cadastro do TSE; a reportagem cita **exatamente um** registro desse tipo (resumos com várias pesquisas ficam de fora); **dois veículos diferentes** publicaram números; e nenhum veículo diverge dos outros em mais de 0,6 ponto. Instituto, campo e entrevistas vêm do cadastro do TSE, não da reportagem. Fora disso (uma fonte só, números divergentes), a pesquisa fica no painel **já preenchida**, esperando aprovação. Uma automática removida no painel não volta sozinha.

O modelo usa **a pesquisa mais recente de cada instituto**, para quem divulga toda semana não pesar mais do que os outros. A aba mostra também **como a previsão mudou dia a dia** (recalculada só com as pesquisas já divulgadas em cada dia) e as **próximas pesquisas registradas** no TSE.

Para incluir uma pesquisa à mão (sem passar pelo painel), acrescente uma linha em `PESQUISAS_2026_2T` com `depois1T: true` e a fonte em `FONTES`; tudo é recalculado.

Nada disso é pesquisa eleitoral. São estimativas de modelo e devem ser apresentadas assim.

## Notícias

O servidor lê os feeds RSS dos veículos a cada 10 minutos (`config/noticias.json`) e guarda só as manchetes sobre a eleição dos últimos 7 dias, em `data/noticias.json`. Quando entra manchete nova, avisa os visitantes por SSE e a aba Notícias ganha um contador.

| Veículo | Feed |
|---|---|
| Agência Brasil | política |
| Poder360 | geral |
| Congresso em Foco | geral |
| Metrópoles | geral |
| Gazeta do Povo | República |
| CartaCapital | política |
| Revista Oeste | política |
| Brasil de Fato | geral |
| g1 | política |
| Folha de S.Paulo | Poder |
| Estadão | política |

Os 8 primeiros foram conferidos em 11/10/2026; g1, Folha e Estadão, em 12/10/2026 (entraram porque costumam publicar primeiro as pesquisas de Quaest, Datafolha e afins). A lista mistura veículos de linhas editoriais diferentes. O feed do Poder360 só traz as 10 últimas notícias de todos os assuntos; o da seção de eleições está parado desde 2024. CNN Brasil (404) e UOL (feed genérico) ficaram de fora. Para incluir, acrescente `{ id, nome, site, url }` em `config/noticias.json`.

**Como a seleção funciona** (`src/noticias/classificar.js`): só pelo título, por palavras-chave. Entra quem cita eleição, turno, TSE ou TRE, urna, candidatos, institutos de pesquisa e afins, ou o nome de um finalista junto de um termo de campanha (apoio, debate, ato, diz, pede…). A regra é a mesma para todos os candidatos. Os nomes vêm do próprio TSE: finalistas de presidente e dos 2º turnos de governador. Colunas, artigos e editoriais ficam de fora pelo endereço ou pela categoria. As etiquetas são Pesquisa, Debate, Justiça Eleitoral, Presidente, Governadores e estado. O número de registro da pesquisa (ex.: BR-02949/2026) é destacado quando aparece. É automático e imperfeito: pode deixar passar algo ou incluir algo fora do tema.

**Direitos:** a página mostra só título, veículo, horário e link, que são o que o próprio veículo publica no feed. O texto fica no site de cada um.

**Próximas datas** (`src/shared/agenda.js`) é uma lista conferida à mão, com fonte: debates na Record (11/10), Band (18/10) e Globo (23/10), prazos de propaganda e votação. Datas de debate são das emissoras e podem mudar.

Números de manchete não entram no modelo. Pesquisas entram pela conferência descrita em [Pesquisas novas entram sozinhas](#pesquisas-novas-entram-sozinhas): cadastro do TSE + texto de duas reportagens de veículos diferentes.

| Variável | Padrão | Uso |
|---|---|---|
| `NEWS_POLL_MS` | 600000 | Intervalo entre leituras dos feeds |
| `NOTICIAS` | 1 | `0` desliga as notícias |

## Como os dados do TSE são lidos

Segue a documentação técnica oficial ([Informações técnicas sobre a divulgação de resultados 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados)).

| Arquivo | Caminho | Uso |
|---|---|---|
| Configuração (EA11) | `/oficial/comum/config/ele-c.json` | Pastas dos arquivos e código do 2º turno (`cdt2`): 6257 → 6258 (federal), 6259 → 6260 (estadual) |
| Resultado (EA20) | `…/<eleição>/dados/<uf>/<uf>-c<cargo>-e<eleição>-u.json` | Presidente (0001), Governador (0003), Senador (0005) |
| Exterior por cidade (EA20) | `…/dados/zz/zz<cidade 5 dígitos>-c0001-e<eleição>-u.json` | Votos de cada cidade no exterior |
| Municípios (EA12) | `…/<eleição>/config/mun-e<eleição>-cm.json` | Lista das cidades do exterior (UF "ZZ") |
| Fotos | `…/<eleição>/fotos/<uf>/<sqcand>.jpeg` | Retratos dos candidatos (via proxy, com iniciais se faltar) |

**Proteção contra bloqueio:** o TSE limita 100 requisições por segundo por IP e pode bloquear quem gera muitos 404. Por isso só o servidor consulta o TSE, e todos os visitantes leem do cache dele, atualizado por Server-Sent Events. O cliente:

- usa no máximo 8 requisições por segundo;
- faz requisições condicionais (respostas 304);
- monta URLs só a partir da configuração oficial;
- põe em quarentena o que retorna 404 e pausa tudo após vários 404, ou após 403/429;
- guarda tudo em disco.

As cidades do exterior só são varridas quando o total do exterior muda, no máximo uma vez por minuto. As fotos só são pedidas para candidatos já carregados.

**Cidades do exterior no mapa:** o arquivo do TSE traz o nome da cidade, não o país nem as coordenadas. O país e a posição vêm de um cadastro próprio com 197 cidades (`scripts/cidades-exterior.mjs`). Uma cidade que não estiver nele aparece em "Outros locais" na lista, sem ponto no mapa. Para incluir, edite o cadastro e rode `node scripts/gerar-mundo.mjs public/js/mundo.js`. Esse script precisa de `world-atlas`, `topojson-client` e `d3-geo`, que só servem para gerar o arquivo.

## Painel (saúde e pesquisas)

`/admin.html` tem **usuário e senha criados por você**. Não existe conta padrão (nada de admin/admin).

1. **Primeiro acesso:** a página pede o **código de instalação** (o valor de `ADMIN_TOKEN`, 16+ caracteres; no Render, em Environment), o usuário e a senha. O código prova que quem cria o acesso administra o servidor; ele não serve para entrar no painel.
2. **Senha:** 10+ caracteres, sem conter o usuário e sem ser senha comum. Guardada só como hash scrypt com sal (`data/admin-acesso.json`), nunca em texto.
3. **Guardar no servidor:** depois de criar (ou trocar a senha), o painel mostra a linha `ADMIN_LOGIN=usuario:hash`. Cole-a em Environment no Render: o plano gratuito apaga o disco a cada reinício e, sem ela, seria preciso criar o acesso de novo. A linha não contém a senha.
4. **Esqueceu a senha:** "Esqueci a senha" com o código de instalação define usuário e senha novos e encerra todas as sessões.
5. **Sessão:** 12 h, no cabeçalho `Authorization` (sem cookie, então sem CSRF), guardada só na aba do navegador. Dez tentativas erradas bloqueiam o IP por alguns minutos.

Sem `ADMIN_TOKEN` e sem `ADMIN_LOGIN`, o painel não existe (as rotas respondem 404). O painel mostra:

- **Saúde:** há quanto tempo o TSE respondeu, pausas por limite de acesso, UFs do 2º turno na configuração do TSE, disputas, feeds e conexões ao vivo. Atualiza a cada 10 s.
- **Cadastro de pesquisas do TSE:** quantas pesquisas presidenciais tem e quando foi lido.
- **Esperando aprovação:** pesquisas do cadastro do TSE com números lidos nas reportagens, mas sem a confirmação de dois veículos (ou com números divergentes). O botão preenche o formulário; você confere na fonte e aprova.
- **Pesquisas detectadas nas manchetes:** registros nacionais citados em manchetes que ainda não estão no modelo.
- **No modelo:** automáticas (com os veículos que confirmaram) e aprovadas no painel. Ao aprovar ou remover, a aba Previsões é recalculada para todos na hora. Ficam em `data/pesquisas.json`.


**Aviso de dados parados:** se o TSE não responde há mais de 3 ciclos de consulta (mínimo 90 s), aparece uma faixa no topo e a linha "Ao vivo" troca por "Último dado recebido".

## Hospedagem

O servidor precisa ficar ligado o tempo todo (consulta o TSE a cada 15 s), então serviços só de funções, como o Vercel, não servem sem reescrever.

- **Render:** `render.yaml` pronto ("New > Blueprint"). O plano gratuito dorme após 15 min sem acesso: use um monitor externo (ex.: UptimeRobot a cada 10 min) e lembre que o disco é apagado a cada reinício.
- **`MODO=teste`** (padrão no `render.yaml`): sobe o modo de teste com o 1º turno real (`data/tse-1turno`, que vai no repositório e na imagem) e o 2º turno simulado em `MOCK_DURATION` segundos, para mostrar o site antes do dia 25. Os avisos de simulação ficam na tela, a prévia do link diz "TESTE · 2º turno simulado, não é resultado" e a página pede para não ser indexada. Cada reinício (inclusive ao acordar) sorteia uma apuração nova. **No dia da eleição, apague `MODO`** para usar o TSE ao vivo.
- **Oracle Cloud Always Free ou VPS:** `deploy/oracle.sh` instala Docker e Caddy (HTTPS automático) numa VM Ubuntu; precisa de um domínio apontando para a VM.
- **Antes de tudo:** rode `npm run baixar` no servidor para confirmar que ele acessa o TSE. Na noite da eleição, um CDN (ex.: Cloudflare) na frente de `/api/*` absorve o pico.

## Segurança e desempenho

- **Cabeçalhos:** Content-Security-Policy só com scripts, estilos e fontes do próprio site (scripts nada inline; as fontes Barlow ficam em `public/fonts`, sem Google Fonts), `nosniff`, proteção contra o site ser embutido em outro (`frame-ancestors 'self'`), Referrer-Policy e Permissions-Policy. HSTS quando o proxy informa HTTPS.
- **Conteúdo de fora:** tudo que vem do TSE e dos feeds passa por escape antes de virar HTML; links de notícia só com `http(s)`; feed acima de 5 MB é recusado; o proxy de fotos só serve candidatos já carregados e só JPEG, PNG, WebP ou GIF.
- **Arquivos:** os estáticos saem só de `public/` e `src/shared/`, sem como escapar da pasta.
- **Carga:** cada resposta é comprimida uma vez (Brotli ou gzip) e reaproveitada enquanto não muda; ETag devolve 304 sem corpo. Num teste local, com 200 clientes simultâneos na apuração de presidente, o servidor foi de cerca de 1.000 para 15.000 respostas por segundo. Fotos iguais pedidas ao mesmo tempo viram uma só requisição ao TSE.
- **Fica com a hospedagem:** HTTPS, limite de requisições por IP e CDN na frente de `/api/*`.

## Estrutura

```
config/elections.json        códigos oficiais, UFs, limites de taxa
src/tse/                     URLs, cliente HTTP com proteção, leitura do EA20/EA12
src/noticias/                leitor de RSS, classificador e coletor de notícias
src/pesquisas-auto/          cadastro de pesquisas do TSE, leitura de reportagens, entrada automática
src/pesquisas.js             pesquisas do painel e automáticas (conferência entre veículos)
src/collector.js             descoberta, 1º turno, 2º turno ao vivo, exterior, eventos, fotos
src/shared/engine.js         cenário-base, projeção e Monte Carlo
src/shared/aovivo.js         simulador ao vivo (apurado + o que falta, ponto de virada)
src/shared/historico.js      eleições de 1989 a 2026, pesquisas e fontes
src/shared/previsao.js       modelos de previsão do 2º turno
src/shared/agenda.js         datas do 2º turno (debates e prazos)
src/server.js                API JSON + SSE + arquivos estáticos
src/mock/                    TSE de teste: sintético ou 1º turno real baixado, com 2º turno simulado
src/tse/baixar.js            download do 1º turno real (npm run baixar)
public/                      interface
scripts/                     geração do mapa-múndi e cadastro de cidades
test/                        testes (node --test)
```

API: `/api/status`, `/api/races`, `/api/race/:id`, `/api/endorsers`, `/api/exterior`, `/api/eventos`, `/api/noticias`, `/api/pesquisas`, `/api/foto/:sqcand`, `/api/stream`.

Mapas: [@svg-maps/brazil](https://github.com/VictorCazanave/svg-maps), de Victor Cazanave (CC BY 4.0), e Natural Earth via [world-atlas](https://github.com/topojson/world-atlas) (ISC).

## Dia da eleição (25/10)

1. Suba o servidor antes das 17h (Brasília). Ele carrega o 1º turno e espera o TSE publicar o 2º turno na configuração.
2. Confira `/api/status`: `discovery.federal2Disponivel` deve ficar `true`.
3. Com muito acesso, ponha um CDN na frente de `/api/*` com cache de 2 a 5 s.
4. Para TV ou projetor, abra `/#telao` e clique em **Tela cheia**.
