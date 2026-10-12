FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY src ./src
COPY public ./public
# scripts: npm run baixar dentro do contêiner, para testar o acesso ao TSE a partir do servidor
COPY scripts ./scripts
ENV NODE_ENV=production PORT=3000
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/status >/dev/null || exit 1
CMD ["node", "src/server.js"]
