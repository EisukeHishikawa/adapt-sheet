# pdf2htmlEX 品質評価用の検証環境（ADR-023）

DoclingのHTML出力はレイアウト（座標・罫線・フォント）を再現せず、帳票の「見た目」を起点にしたHTML生成には精度が不足していた。その代替候補である [pdf2htmlEX](https://github.com/pdf2htmlEX/pdf2htmlEX) の出力品質を、実装へ組み込む前に手元のPDFで目視評価するための検証専用環境。

**この時点ではbackend/docling-serviceには一切手を入れていない**。品質が要件を満たすと判断できてから、`docling-service`の置き換え（またはコンバータの差し替え）を別ステップで実装する。

## 使い方

### 1. 評価したいPDFを置く

```bash
cp ~/Desktop/請求書サンプル.pdf tools/pdf2htmlex/input/
```

`input/` と `output/` の中身はGit管理対象外（`.gitignore`）。

### 2. 変換する

```bash
docker compose --profile pdf2htmlex run --rm pdf2htmlex
```

`input/` 内のすべてのPDFを変換し、`output/<PDF名>.html` を生成する。ファイルを指定して変換することもできる。

```bash
docker compose --profile pdf2htmlex run --rm pdf2htmlex 請求書サンプル.pdf
```

### 3. 出力を見る

```bash
open tools/pdf2htmlex/output/請求書サンプル.html
```

CSS・フォント・画像・JSをすべて埋め込んだ単一HTMLを出力するため、そのままブラウザで開ける（HTML1枚をそのままAIへ渡せる形でもある）。

## オプション（環境変数で上書き）

```bash
# 例: 全ページ変換 + 拡大率2.0 + 背景画像なし（テキストのみ）
docker compose --profile pdf2htmlex run --rm \
  -e LAST_PAGE= -e ZOOM=2.0 -e PROCESS_NONTEXT=0 \
  pdf2htmlex
```

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `ZOOM` | `1.5` | 出力の拡大率。大きいほど埋め込み画像が精細になりファイルサイズも増える |
| `EMBED` | `CFIJ` | 埋め込む要素（大文字=埋め込み / 小文字=外部ファイル）。C=CSS, F=フォント, I=画像, J=JS |
| `FIRST_PAGE` | `1` | 変換開始ページ |
| `LAST_PAGE` | `1` | 変換終了ページ。空文字にすると最終ページまで。帳票は1ページ完結が前提のため既定は1ページ目のみ（ADR-021） |
| `PROCESS_NONTEXT` | `1` | `0`にすると背景（罫線・図形をラスタライズしたPNG）を出力せずテキストのみになる。AIへ渡す入力としてはこちらが軽量 |
| `EXTRA_ARGS` | （空） | pdf2htmlEXへ渡す追加オプション（例: `--font-size-multiplier 1.2`） |

## Doclingとの比較

同じPDFをDocling（現行実装）とpdf2htmlEXの両方でHTML化して並べる。Docling側は`docling`サービスの`/convert`をそのまま使うため、事前起動が必要。

```bash
docker compose up -d docling
tools/pdf2htmlex/compare-with-docling.sh ~/Desktop/請求書サンプル.pdf
# → output/請求書サンプル.html（pdf2htmlEX） と output/請求書サンプル.docling.html（Docling）
```

## 検証環境そのものの確認

`docling-service`のテスト用PDFを変換し、単一HTMLが生成されることを確認する（`input/`が空でも実行可）。

```bash
tools/pdf2htmlex/smoke-test.sh
```

## 既知の制約

- 公式Dockerイメージは**x86_64ビルドのみ**。Apple Silicon上はエミュレーション実行になる（`docker-compose.yml`の`platform: linux/amd64`）。1ページのPDFで1秒未満のため検証には支障ないが、本番採用時はAWS Lambda（x86_64）側でネイティブ実行になる想定。
- pdf2htmlEXはPDFの見た目を絶対座標のdiv＋埋め込みフォントで忠実に再現する方式であり、Doclingのような意味構造（表・見出し）の抽出は行わない。「見た目の再現度」と「構造化のしやすさ」はトレードオフになるため、評価時は両面を見る。
