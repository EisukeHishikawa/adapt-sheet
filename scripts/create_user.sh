#!/usr/bin/env bash
# アカウントを作成する唯一の手段（ADR-021/022）。画面からの新規登録は提供せず、Supabase側でも
# enable_signup = false にしているため、管理者がこのスクリプトを実行した場合のみユーザーが増える。
#
# 使い方:
#   scripts/create_user.sh <Googleアカウントのメールアドレス>
#
# ログイン手段はGoogleアカウントのみのため、パスワードは設定しない（設定しても使えない）。
# ここで作成したメールアドレスと同じGoogleアカウントでログインすると、GoTrueが同一メールアドレスの
# identityを自動的に紐付ける。未登録のGoogleアカウントはenable_signup = falseにより弾かれる。
#
# 接続先・管理者キーは環境変数から取る。ローカル（Supabase Local CLI）では`supabase status`の
# 値を使う。本番プロジェクトへ向ける場合はSUPABASE_URL/SUPABASE_SERVICE_ROLE_KEYを差し替える。
#   SUPABASE_URL                             : 既定 http://127.0.0.1:54321
#   SUPABASE_SERVICE_ROLE_KEY                : 必須（`supabase status`のSERVICE_ROLE_KEY）
#   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID  : 必須（Google Cloudで発行したOAuthクライアント）
#   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET     : 必須（同上）
set -euo pipefail

email="${1:-}"
if [[ -z "${email}" ]]; then
  echo "usage: $0 <email>" >&2
  exit 1
fi

supabase_url="${SUPABASE_URL:-http://127.0.0.1:54321}"
service_role_key="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "${service_role_key}" ]]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY が未設定です（\`supabase status\` のSERVICE_ROLE_KEYを設定してください）" >&2
  exit 1
fi

# Google OAuthが使えない状態でアカウントを作っても、そのユーザーはログインする手段が無い。
# 事故を防ぐため、認証情報が揃っていなければ作成そのものを断る（ADR-022）。
google_client_id="${SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID:-}"
google_secret="${SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET:-}"
for pair in "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID:${google_client_id}" "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET:${google_secret}"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  if [[ -z "${value}" ]]; then
    echo "error: ${name} が未設定です。ログイン手段はGoogleアカウントのみのため、" >&2
    echo "       Google OAuthを設定しないとアカウントを作成できません（docs/supabase-local-cli-setup.md を参照）。" >&2
    exit 1
  fi
  # config.tomlの env(...) 展開は`supabase start`実行時のシェル環境で行われる。未設定のまま
  # 起動するとリテラル "env(...)" がGoTrueへ渡り、一見有効なのにログインだけが失敗する。
  if [[ "${value}" == env\(*\) ]]; then
    echo "error: ${name} が展開されずリテラル値 '${value}' のままです。" >&2
    echo "       .env を読み込んでから \`supabase stop && supabase start\` をやり直してください。" >&2
    exit 1
  fi
done

# GoTrue側でも実際にgoogleプロバイダが有効かを確認する（config.tomlとの食い違いを検出する）。
if ! curl -fsS "${supabase_url}/auth/v1/settings" -H "apikey: ${service_role_key}" \
  | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("external",{}).get("google") else 1)'; then
  echo "error: Supabase(GoTrue)側でGoogleプロバイダが有効になっていません。" >&2
  echo "       よくある原因: supabase/config.toml が無いディレクトリで \`supabase start\` を実行し、" >&2
  echo "       CLIの既定値（google無効・自己登録が有効）で起動している。" >&2
  echo "       現在の起動設定は次で確認できる:" >&2
  echo "         docker inspect supabase_auth_\$(basename \$(pwd)) --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_EXTERNAL_GOOGLE" >&2
  echo "       supabase/config.toml があるディレクトリで、.env を読み込んでから起動し直すこと:" >&2
  echo "         set -a; source .env; set +a && supabase stop && supabase start" >&2
  exit 1
fi

# admin APIはメール確認を挟まずに確定済みユーザーを作れる（email_confirm=true）。パスワードは
# 設定しない（メールプロバイダを無効化しているため、パスワードでのログインは成立しない）。
# --failを付けるとエラー本文が捨てられ原因が分からなくなるため、本文と状態コードを別々に受け取る。
response="$(curl -sS -w '\n%{http_code}' -X POST "${supabase_url}/auth/v1/admin/users" \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"email":%s,"email_confirm":true}' \
    "$(printf '%s' "${email}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")")"
status="$(printf '%s' "${response}" | tail -n1)"
body="$(printf '%s' "${response}" | sed '$d')"

if [[ "${status}" != "200" && "${status}" != "201" ]]; then
  error_code="$(printf '%s' "${body}" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("error_code",""))
except Exception: print("")' 2>/dev/null)"
  if [[ "${error_code}" == "email_exists" ]]; then
    echo "このメールアドレスのアカウントは既に存在します: ${email}"
    echo "追加の作業は不要です。そのまま「Googleでログイン」からログインしてください。"
    exit 0
  fi
  echo "error: アカウント作成に失敗しました（HTTP ${status}）" >&2
  printf '       %s\n' "${body}" >&2
  exit 1
fi

user_id="$(printf '%s' "${body}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

echo "アカウントを作成しました"
echo "  id:    ${user_id}"
echo "  email: ${email}"
echo "このメールアドレスのGoogleアカウントで「Googleでログイン」からログインしてください。"
