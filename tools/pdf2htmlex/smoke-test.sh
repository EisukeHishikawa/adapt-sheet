#!/usr/bin/env bash
# 検証用コンテナが動く状態にあるか（イメージのビルド・変換・単一HTML出力）を確認する。
# 実PDFは既存のdocling-service用フィクスチャを流用するため、input/が空でも実行できる。
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

fixture_dir="docling-service/tests/fixtures"
out_html="tools/pdf2htmlex/output/sample.html"

rm -f "$out_html"

docker compose --profile pdf2htmlex run --rm \
  -v "${repo_root}/${fixture_dir}:/input:ro" \
  pdf2htmlex sample.pdf

fail() {
  echo "NG: $1" >&2
  exit 1
}

[ -s "$out_html" ] || fail "${out_html} が生成されていない"
grep -q "pdf2htmlEX" "$out_html" || fail "pdf2htmlEXの出力HTMLではない"
# 外部ファイル参照が残っていると、HTML1枚をブラウザ・AIへ渡す前提が崩れる。
if grep -Eq '<(link|script)[^>]+(href|src)="[^"]*\.(css|js)"' "$out_html"; then
  fail "外部CSS/JS参照が残っている（--embedの指定を確認）"
fi

echo "OK: ${out_html} ($(wc -c < "$out_html" | tr -d ' ') bytes)"
