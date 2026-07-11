#!/usr/bin/env bash
# 同じPDFをDocling（現行実装）とpdf2htmlEXの両方でHTML化し、出力を並べて比較する（ADR-023）。
# Docling側はdocker-compose.ymlのdoclingサービス（/convert）をそのまま利用するため、
# 事前に `docker compose up -d docling` で起動しておく必要がある。
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

pdf_path="${1:-}"
if [ -z "$pdf_path" ]; then
  echo "使い方: tools/pdf2htmlex/compare-with-docling.sh <PDFのパス>" >&2
  exit 1
fi
if [ ! -f "$pdf_path" ]; then
  echo "PDFが見つかりません: $pdf_path" >&2
  exit 1
fi

base="$(basename "$pdf_path")"
stem="${base%.*}"
out_dir="tools/pdf2htmlex/output"
mkdir -p "$out_dir"

echo "=== pdf2htmlEX ==="
docker compose --profile pdf2htmlex run --rm \
  -v "$(cd "$(dirname "$pdf_path")" && pwd):/input:ro" \
  pdf2htmlex "$base"

echo
echo "=== Docling（比較用の現行実装） ==="
docker compose cp "$pdf_path" "docling:/tmp/${base}"
docker compose exec -T docling \
  curl -sf -F "file=@/tmp/${base}" http://localhost:8100/convert \
  | python3 -c "import json,sys; sys.stdout.write(json.load(sys.stdin)['html'])" \
  > "${out_dir}/${stem}.docling.html"
echo "--- 完了: ${out_dir}/${stem}.docling.html ($(wc -c < "${out_dir}/${stem}.docling.html" | tr -d ' ') bytes)"

echo
echo "ブラウザで見比べる:"
echo "  open ${out_dir}/${stem}.html          # pdf2htmlEX"
echo "  open ${out_dir}/${stem}.docling.html  # Docling"
