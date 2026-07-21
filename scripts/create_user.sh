#!/usr/bin/env bash
# アカウントを作成する唯一の手段（ADR-021）。画面からの新規登録は提供せず、Supabase側でも
# enable_signup = false にしているため、管理者がこのスクリプトを実行した場合のみユーザーが増える。
#
# 使い方:
#   scripts/create_user.sh <メールアドレス> [パスワード]
#
# パスワードを省略した場合はランダムな値を生成して表示する。Googleログインだけを使わせたい場合も、
# 先にこのスクリプトで同じメールアドレスのアカウントを作っておく必要がある（未登録のGoogle
# アカウントはenable_signup = falseにより弾かれる）。
#
# 接続先・管理者キーは環境変数から取る。ローカル（Supabase Local CLI）では`supabase status`の
# 値を使う。本番プロジェクトへ向ける場合はSUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYを差し替える。
#   SUPABASE_URL              : 既定 http://127.0.0.1:54321
#   SUPABASE_SERVICE_ROLE_KEY : 必須（`supabase status`のSERVICE_ROLE_KEY）
set -euo pipefail

email="${1:-}"
if [[ -z "${email}" ]]; then
  echo "usage: $0 <email> [password]" >&2
  exit 1
fi

supabase_url="${SUPABASE_URL:-http://127.0.0.1:54321}"
service_role_key="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "${service_role_key}" ]]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY が未設定です（\`supabase status\` のSERVICE_ROLE_KEYを設定してください）" >&2
  exit 1
fi

password="${2:-}"
generated=false
if [[ -z "${password}" ]]; then
  # LC_ALLを固定しないと、macOSのtrがUTF-8バイト列を不正入力として扱って失敗する。
  password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
  generated=true
fi

# admin APIはメール確認を挟まずに確定済みユーザーを作れる（email_confirm=true）。
response="$(curl -fsS -X POST "${supabase_url}/auth/v1/admin/users" \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"email":%s,"password":%s,"email_confirm":true}' \
    "$(printf '%s' "${email}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "${password}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")")"

user_id="$(printf '%s' "${response}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

echo "アカウントを作成しました"
echo "  id:    ${user_id}"
echo "  email: ${email}"
if [[ "${generated}" == true ]]; then
  echo "  password: ${password}"
  echo "（このパスワードは再表示できません。パスワードログインを使わずGoogleログインのみ利用する場合は控え不要です）"
fi
