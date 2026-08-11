#!/bin/sh
# frontend-lspサービスの起動前処理。
#
# Biomeの実体はnode_modules配下のプラットフォーム別バイナリだが、ホストのfrontend/node_modulesは
# 空（実体はコンテナ内のみ）で、それが名前付きボリュームとして被さる。初回のみイメージ内の依存を
# 実体としてコピーし、package.jsonで固定したバージョンのBiomeがエディタからも使われるようにする。
set -e

if [ ! -x node_modules/.bin/biome ]; then
  cp -a /app/node_modules/. node_modules/
fi

exec "$@"
