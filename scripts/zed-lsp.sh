#!/bin/sh
# ZedがLSP（ruff / ESLint）を起動するときに実行するラッパー（ADR-024）。
# 標準入出力でLSPを話すため、余計な出力を混ぜないことが唯一の要件。
#
# 使い方: scripts/zed-lsp.sh ruff | scripts/zed-lsp.sh eslint
set -eu

usage() {
  echo "usage: $0 {ruff|eslint}" >&2
  exit 64
}

[ $# -ge 1 ] || usage

# Zedはリポジトリ外をcwdにしてLSPを起動するため、スクリプト位置からリポジトリルートを求める。
# docker-compose.ymlの ${PWD} 展開もこの値に揃える（ホストと同じ絶対パスでマウントするため）。
PWD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$PWD_ROOT"
PWD=$PWD_ROOT
export PWD

case "$1" in
  ruff)
    SERVICE=backend-lsp
    ;;
  eslint)
    SERVICE=frontend-lsp
    ;;
  *)
    usage
    ;;
esac

# --no-depsでbackend/docling等の常駐サービスを巻き込まず、--rmで終了時にコンテナを残さない。
# composeの進捗表示（Creating...）はstderrへ出るためLSPの標準入出力を汚さない。
exec docker compose --profile lsp run --rm --no-deps -T "$SERVICE"
