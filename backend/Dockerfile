# 開発用の入口エンドポイントイメージ（docker-compose.yml参照）。開発環境はDocker Composeのみを
# 対象とする（ADR-014）。ADR-018によりDocling本体は別コンテナ（docling-service）へ分離したため、
# このイメージはtorch/opencv-python等の重量級ML依存を含まず、Python 3.9系は他サービスとの
# バージョン統一のため踏襲する。
FROM python:3.9-slim

WORKDIR /app

# .pycをbind mount先(ホスト)に書き込ませない・ログをバッファさせないための開発向け設定。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ADR-018によりopencv-python/torch（libgl1/libglib2.0-0/libgomp1を要求）を含まなくなったため、
# それらのapt依存は削除した。build-essentialは、manylinuxホイールが無い一部依存パッケージの
# ソースビルドに備えて残す。
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --reloadはdocker-compose.ymlの`./backend:/app`バインドマウントと組み合わせ、
# ホスト側でのコード編集を即座にコンテナへ反映するための開発向け設定。
# --host 0.0.0.0がないとコンテナ内loopbackにしかbindされず、他コンテナ/ホストから到達できない。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
