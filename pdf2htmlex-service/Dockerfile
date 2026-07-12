# pdf2htmlEXによるレイアウトHTML生成専用の内部サービス用イメージ（docker-compose.yml参照、ADR-023）。
# pdf2htmlEXはPoppler/FontForgeに依存するC++バイナリのためpipでは入らず、公式イメージをベースに
# FastAPIラッパーを載せる。公式イメージはx86_64ビルドのみ公開されており、Apple Silicon上では
# エミュレーション実行になる（docker-compose.ymlのplatform: linux/amd64）。
FROM pdf2htmlex/pdf2htmlex:0.18.8.rc2-master-20200820-ubuntu-20.04-x86_64

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ベースイメージはUbuntu 20.04（既定のpython3は3.8系）だが、backend/docling-serviceと
# Pythonバージョンを揃えるためuniverseリポジトリのpython3.9を明示的に入れる。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.9 \
    python3.9-distutils \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN python3.9 -m pip install --no-cache-dir --upgrade pip \
    && python3.9 -m pip install --no-cache-dir -r requirements.txt

COPY . .

# 検証用の一括変換スクリプト（品質確認時に`docker compose run --rm pdf2htmlex convert.sh`で使う）。
RUN ln -s /app/scripts/convert.sh /usr/local/bin/convert.sh && chmod +x /app/scripts/convert.sh

EXPOSE 8200

# ベースイメージのENTRYPOINTはpdf2htmlEXバイナリ直結のため、サービスとして起動できるよう解除する。
ENTRYPOINT []

# --reloadはdocker-compose.ymlのバインドマウントと組み合わせた開発向け設定。
# backend(8000)・docling(8100)と衝突しない内部専用ポートとして8200番を使う。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200", "--reload"]
