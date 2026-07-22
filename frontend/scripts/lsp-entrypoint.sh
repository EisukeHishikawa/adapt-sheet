#!/bin/sh
# frontend-lspサービスの起動前処理（ADR-024）。
#
# ESLintのflat config（eslint.config.js）はプラグインをESMのbare importで読み込むため、
# 解決はconfigファイルの位置（ホストからbind mountしたfrontend配下）からのnode_modules探索に
# 限られ、NODE_PATHやイメージ内の/app/node_modulesでは代替できない。そのためホストの空の
# node_modulesを名前付きボリュームで覆い、初回のみイメージ内の依存を実体としてコピーする。
set -e

if [ ! -x node_modules/.bin/eslint ]; then
  cp -a /app/node_modules/. node_modules/
fi

exec "$@"
