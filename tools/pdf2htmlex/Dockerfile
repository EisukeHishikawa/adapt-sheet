# pdf2htmlEXの出力品質を評価するための検証専用イメージ（ADR-023）。
# 公式イメージはx86_64ビルドのみ公開されているため、Apple Silicon上ではエミュレーション実行になる
# （docker-compose.ymlのplatform: linux/amd64指定）。
FROM pdf2htmlex/pdf2htmlex:0.18.8.rc2-master-20200820-ubuntu-20.04-x86_64

# ベースイメージのENTRYPOINTはpdf2htmlEXバイナリ直結だが、入力ディレクトリ内のPDFを
# まとめて変換し、オプションを環境変数で切り替えられるようスクリプトを挟む。
COPY convert.sh /usr/local/bin/convert.sh
RUN chmod +x /usr/local/bin/convert.sh

ENTRYPOINT ["/usr/local/bin/convert.sh"]
