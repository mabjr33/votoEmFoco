FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY src ./src
COPY public ./public
# scripts: npm run baixar dentro do contêiner, para testar o acesso ao TSE a partir do servidor
COPY scripts ./scripts
# 1º turno já baixado do TSE: o MODO=teste usa esses arquivos sem consultar o TSE de novo
COPY data/tse-1turno ./data/tse-1turno
ENV NODE_ENV=production PORT=3000
RUN chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/status >/dev/null || exit 1
# MODO=teste: 1º turno real + 2º turno SIMULADO (com os avisos na tela), para mostrar o site antes
# do dia 25. Qualquer outro valor (ou vazio): produção, com os dados do TSE ao vivo.
CMD ["sh", "-c", "if [ \"$MODO\" = teste ]; then exec node src/mock/run-mock.js; else exec node src/server.js; fi"]
