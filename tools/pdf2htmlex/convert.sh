#!/usr/bin/env bash
# 入力ディレクトリのPDFをpdf2htmlEXでHTML化する（ADR-023の品質評価用）。
set -euo pipefail

INPUT_DIR="${INPUT_DIR:-/input}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
ZOOM="${ZOOM:-1.5}"
# pdf2htmlEXの--embedは大文字が埋め込み・小文字が外部ファイル出力。ブラウザで単体表示でき、
# かつHTML1枚をそのままAIへ渡せるよう、既定はCSS/フォント/画像/JSをすべて埋め込む。
EMBED="${EMBED:-CFIJ}"
FIRST_PAGE="${FIRST_PAGE:-1}"
# 空文字なら最終ページまで。帳票は1ページ完結が前提のため（ADR-021）、既定は1ページ目のみ。
# 空文字を既定値へ戻さないよう`:-`ではなく`-`を使う。
LAST_PAGE="${LAST_PAGE-1}"
# 0にすると背景（罫線・図形をラスタライズしたPNG）を出力せずテキストのみになる。
PROCESS_NONTEXT="${PROCESS_NONTEXT:-1}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

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
  echo "変換対象のPDFがありません。ホスト側の tools/pdf2htmlex/input/ にPDFを置いてください。" >&2
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

  # shellcheck disable=SC2086 # EXTRA_ARGSは複数オプションの文字列として意図的に単語分割する
  pdf2htmlEX \
    --zoom "$ZOOM" \
    --embed "$EMBED" \
    --split-pages 0 \
    --process-outline 0 \
    --process-nontext "$PROCESS_NONTEXT" \
    "${page_args[@]}" \
    $EXTRA_ARGS \
    --dest-dir "$OUTPUT_DIR" \
    "$pdf" "$html"

  bytes="$(wc -c < "${OUTPUT_DIR}/${html}")"
  echo "--- 完了: ${OUTPUT_DIR}/${html} (${bytes} bytes)"
done

echo
echo "出力先（ホスト側）: tools/pdf2htmlex/output/"
