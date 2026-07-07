# ローカル開発用のバックエンドイメージ（docker-compose.yml参照）。
# Python 3.9系はREADME/CLAUDE.mdに記載のとおりDoclingの動作確認済みバージョンのため、
# ホストのmacOS標準pythonと揃えてローカル(.venv)との差異を避ける。
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

# requirements.txtのocrmac / pyobjc-framework-*は、DoclingのOCRエンジンとしてmacOSの
# Apple Vision framework(pyobjc経由)を使うための依存で、Linux上ではビルドできない。
# Doclingは実行時にOcrAutoOptionsで利用可能なOCRエンジンを自動選択する仕組みのため、
# requirements.txtに含まれるクロスプラットフォームなrapidocrを残したままmacOS専用パッケージのみ
# 除外すれば、コンテナ内ではrapidocrが自動選択されて動作する（requirements.txt自体はmacOS用の
# ままローカル開発と互換を保つため変更しない）。
RUN grep -vE '^(ocrmac|pyobjc-core|pyobjc-framework-(Cocoa|CoreML|Quartz|Vision))==' requirements.txt > requirements.linux.txt \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.linux.txt

COPY . .

EXPOSE 8000

# --reloadはdocker-compose.ymlの`./backend:/app`バインドマウントと組み合わせ、
# ホスト側でのコード編集を即座にコンテナへ反映するための開発向け設定。
# --host 0.0.0.0がないとコンテナ内loopbackにしかbindされず、他コンテナ/ホストから到達できない。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
