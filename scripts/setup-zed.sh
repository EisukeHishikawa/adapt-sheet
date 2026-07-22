#!/bin/sh
# .zed/settings.json のLSPラッパー絶対パスを、このリポジトリの実際の位置へ揃える（ADR-024）。
# Zedはbinary.pathの相対パスを解決しないため、クローン先が異なる環境では一度実行する。
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
SETTINGS="$ROOT/.zed/settings.json"

[ -f "$SETTINGS" ] || { echo "not found: $SETTINGS" >&2; exit 1; }

TMP=$(mktemp)
sed -E "s|\"path\": \".*/scripts/zed-lsp\.sh\"|\"path\": \"$ROOT/scripts/zed-lsp.sh\"|" "$SETTINGS" >"$TMP"
mv "$TMP" "$SETTINGS"

echo "updated: $SETTINGS -> $ROOT/scripts/zed-lsp.sh"
