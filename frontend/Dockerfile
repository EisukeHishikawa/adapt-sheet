# 開発用のフロントエンドイメージ（docker-compose.yml参照）。開発環境はこのコンテナのみを対象とする（ADR-014）。
# vite 8 / vitest 4はNode 20以降を前提とするためnode:20を採用する。
FROM node:20-alpine

WORKDIR /app

# 依存関係の定義ファイルだけ先にコピーすることで、ソース変更時に毎回npm installが
# 走らないようDockerのレイヤーキャッシュを効かせる。
# .npmrc（legacy-peer-deps=true）も併せてコピーしないとopenapi-typescriptのpeer依存で
# npm installがERESOLVEで失敗する（frontend/.npmrcのコメント参照）。
COPY package.json package-lock.json .npmrc ./
RUN npm install

COPY . .

# Viteの開発サーバー既定ポート。
EXPOSE 5173

# --hostを付けないとVite開発サーバーはコンテナ内loopbackにしかbindされず、
# ホストPCやbackendコンテナから到達できないため必須。
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
