# 開発用のバックエンドイメージ（docker-compose.yml参照）。開発環境はこのコンテナのみを対象とする（ADR-014）。
# Python 3.9系はCLAUDE.mdに記載のとおりDoclingの動作確認済みバージョンのため採用する。
FROM python:3.9-slim

WORKDIR /app

# .pycをbind mount先(ホスト)に書き込ませない・ログをバッファさせないための開発向け設定。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# opencv-python(cv2)がlibGL.so.1 / libglib2.0を、torchがlibgomp1(OpenMP)を実行時に要求するため、
# slimイメージには含まれないこれらの共有ライブラリを明示的に追加する。
# build-essentialは、manylinuxホイールが無い一部依存パッケージのソースビルドに備えて含める。
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# requirements.txtにはLinux(コンテナ)向けの依存のみを含む（ADR-014）。DoclingはOcrAutoOptionsで
# 実行時に利用可能なOCRエンジンを自動選択する仕組みのため、requirements.txtに含まれる
# クロスプラットフォームなrapidocrが自動選択されて動作する。
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --reloadはdocker-compose.ymlの`./backend:/app`バインドマウントと組み合わせ、
# ホスト側でのコード編集を即座にコンテナへ反映するための開発向け設定。
# --host 0.0.0.0がないとコンテナ内loopbackにしかbindされず、他コンテナ/ホストから到達できない。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
