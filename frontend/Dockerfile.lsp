# Zed等のエディタからBiomeをDocker内で動かすためのLSPイメージ。
# 開発用のfrontendイメージと同じベース・同じ依存導入手順にすることで、エディタが見る
# Biomeの挙動を`docker compose exec frontend npm run lint`と一致させる。
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install

COPY scripts/lsp-entrypoint.sh /usr/local/bin/lsp-entrypoint
RUN chmod +x /usr/local/bin/lsp-entrypoint

ENTRYPOINT ["/usr/local/bin/lsp-entrypoint"]
CMD ["node_modules/.bin/biome", "lsp-proxy"]
