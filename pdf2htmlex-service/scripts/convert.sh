#!/usr/bin/env bash
# pdf2htmlEXの出力を目視確認するための一括変換スクリプト（ADR-023）。サービス（/convert）を
# 介さずCLIを直接叩き、変換オプションの効き方を手元のPDFで確かめるために使う。
#   docker compose run --rm -v "$PWD/somewhere:/input:ro" -v "$PWD/somewhere:/output" pdf2htmlex convert.sh
set -euo pipefail

INPUT_DIR="${INPUT_DIR:-/input}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
ZOOM="${PDF2HTMLEX_ZOOM:-1.5}"
# 人がブラウザで見た目を確認する用途のため、サービス本体（app/converter.py、Gemini向けに
# フォント・画像・JSを落とす）とは異なり、既定ではすべて埋め込んだ自己完結HTMLを出力する。
EMBED="${PDF2HTMLEX_EMBED:-CFIJ}"
PROCESS_NONTEXT="${PDF2HTMLEX_PROCESS_NONTEXT:-1}"
FIRST_PAGE="${FIRST_PAGE:-1}"
# 空文字なら最終ページまで。空文字を既定値へ戻さないよう`:-`ではなく`-`を使う。
LAST_PAGE="${LAST_PAGE-1}"

shopt -s nullglob

targets=()
if [ "$#" -gt 0 ]; then
  for arg in "$@"; do
    if [ -f "$arg" ]; then
      targets+=("$arg")
    else
      targets+=("$INPUT_DIR/$arg")
    fi
  done
else
  targets=("$INPUT_DIR"/*.pdf "$INPUT_DIR"/*.PDF)
fi

if [ "${#targets[@]}" -eq 0 ]; then
  echo "変換対象のPDFがありません（${INPUT_DIR}）。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

page_args=(--first-page "$FIRST_PAGE")
if [ -n "$LAST_PAGE" ]; then
  page_args+=(--last-page "$LAST_PAGE")
fi

for pdf in "${targets[@]}"; do
  if [ ! -f "$pdf" ]; then
    echo "PDFが見つかりません: $pdf" >&2
    exit 1
  fi

  base="$(basename "$pdf")"
  html="${base%.*}.html"

  echo "--- 変換: ${base} -> ${html} (zoom=${ZOOM}, embed=${EMBED}, pages=${FIRST_PAGE}-${LAST_PAGE:-end}, nontext=${PROCESS_NONTEXT})"

  pdf2htmlEX \
    --zoom "$ZOOM" \
    --embed "$EMBED" \
    --split-pages 0 \
    --process-outline 0 \
    --process-nontext "$PROCESS_NONTEXT" \
    "${page_args[@]}" \
    --dest-dir "$OUTPUT_DIR" \
    "$pdf" "$html"

  echo "--- 完了: ${OUTPUT_DIR}/${html} ($(wc -c < "${OUTPUT_DIR}/${html}") bytes)"
done
