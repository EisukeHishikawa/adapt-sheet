# Docling変換専用の内部サービス用イメージ（docker-compose.yml参照、ADR-018）。
# torch/opencv-python等の大容量ML依存を含むため、backend（入口エンドポイント）とは
# 別イメージ・別コンテナに分離し、backend側の起動を高速化する。
# Python 3.9系はCLAUDE.mdに記載のとおりDoclingの動作確認済みバージョンのため、backendと揃える。
FROM python:3.9-slim

WORKDIR /app

# .pycをbind mount先(ホスト)に書き込ませない・ログをバッファさせないための開発向け設定。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# opencv-python(cv2)がlibGL.so.1 / libglib2.0を、torchがlibgomp1(OpenMP)を実行時に要求するため、
# slimイメージには含まれないこれらの共有ライブラリを明示的に追加する。
# requirements.txtの全依存（torch/opencv-python等を含む）はバイナリwheelで導入でき、
# ソースビルドが発生しないため、build-essential（gcc/g++等で約280MB）は含めない（ADR-016）。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# requirements.txtにはLinux(コンテナ)向けの依存のみを含む（ADR-013）。DoclingはOcrAutoOptionsで
# 実行時に利用可能なOCRエンジンを自動選択する仕組みのため、requirements.txtに含まれる
# クロスプラットフォームなrapidocrが自動選択されて動作する。
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8100

# --reloadはdocker-compose.ymlの`./docling-service:/app`バインドマウントと組み合わせ、
# ホスト側でのコード編集を即座にコンテナへ反映するための開発向け設定。
# --host 0.0.0.0がないとコンテナ内loopbackにしかbindされず、backendコンテナから到達できない。
# backendの8000番と衝突しないよう、内部専用ポートとして8100番を使う。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--reload"]
