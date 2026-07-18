# pdf2htmlEXによるPDF→HTML変換専用の内部サービス用イメージ（docker-compose.yml参照、ADR-023）。
#
# pdf2htmlEXは特殊パッチ済みpoppler/libfontforgeに強く依存し、Debian/Ubuntu標準リポジトリでは
# 配布が終了している（apt-cache検証済み、backend/docling-serviceと同じpython:3.9-slimベースでは
# 導入不可）。そのため、pdf2htmlEXバイナリを同梱した唯一の実用的な配布経路である
# pdf2htmlex/pdf2htmlexイメージを土台にする。Alpineベースのタグはmusl 1.1のみに対応し、
# ruff等の一部パッケージがmusllinux_1_2向けの配布しか持たずソースビルドも失敗するため、
# glibcベースのUbuntu 20.04（focal）タグを採用する。
# ADR-019で撤去されたpdf2htmlEX専用コンテナを、モデル選択機能の1エンジンとして復活させたもの。
FROM pdf2htmlex/pdf2htmlex:0.18.8.rc1-master-20200630-Ubuntu-focal-x86_64

WORKDIR /app

# ベースイメージのENTRYPOINTがpdf2htmlEX本体（/usr/local/bin/pdf2htmlEX）に固定されているため、
# FastAPI（uvicorn）を起動できるよう解除する。pdf2htmlEXはconverter.py側でsubprocess経由で呼ぶ。
ENTRYPOINT []

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ベースイメージ（Ubuntu 20.04）はPython 3.8のみ既定インストール対象のため、backend/
# docling-serviceと合わせたPython 3.9系をuniverseリポジトリから追加する。pipはUbuntu標準の
# python3-pip（Python 3.8向け）ではなくget-pip.py経由でPython 3.9向けに導入する
# （3.9向けはbootstrap.pypa.io/pip/3.9/get-pip.pyを使う必要がある。3.10以降向けの通常URLは
# 「Python 3.9非対応」エラーになる）。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.9 \
    python3.9-distutils \
    curl \
    ca-certificates \
    && curl -sS https://bootstrap.pypa.io/pip/3.9/get-pip.py -o /tmp/get-pip.py \
    && python3.9 /tmp/get-pip.py \
    && rm /tmp/get-pip.py \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN python3.9 -m pip install --no-cache-dir --upgrade pip \
    && python3.9 -m pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8200

# --reloadはdocker-compose.ymlの`./pdf2htmlex-service:/app`バインドマウントと組み合わせ、
# ホスト側でのコード編集を即座にコンテナへ反映するための開発向け設定。
# --host 0.0.0.0がないとコンテナ内loopbackにしかbindされず、backendコンテナから到達できない。
# docling(8100)と衝突しないよう、内部専用ポートとして8200番を使う。
CMD ["python3.9", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200", "--reload"]
