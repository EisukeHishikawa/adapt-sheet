# Zed等のエディタからESLintをDocker内で動かすためのLSPイメージ（ADR-024）。
# 開発用のfrontendイメージと同じベース・同じ依存導入手順にすることで、エディタが見る
# ESLintの挙動を`docker compose exec frontend npm run lint`と一致させる。
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install

# vscode-eslint-language-server（VSCodeのESLint拡張のサーバー実体）。エディタとESLintを
# LSPで仲介するのはこのパッケージだけで、リント規則自体はプロジェクトのeslint.config.jsに従う。
RUN npm install -g vscode-langservers-extracted@4.10.0

COPY scripts/lsp-entrypoint.sh /usr/local/bin/lsp-entrypoint
COPY scripts/eslint-lsp-launcher.js /usr/local/lib/eslint-lsp-launcher.js
RUN chmod +x /usr/local/bin/lsp-entrypoint

ENTRYPOINT ["/usr/local/bin/lsp-entrypoint"]
CMD ["node", "/usr/local/lib/eslint-lsp-launcher.js"]
