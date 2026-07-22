import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// フェーズ5より前（Supabaseプロジェクト未作成）や、環境変数を設定していないローカル環境でも
// アプリ全体がクラッシュしないよう、未設定時はnullにする（DEVELOPMENT.md ステップ27）。
// authStoreはnullの場合「認証機能なし＝常に未ログイン」として扱う。
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// SSR・非ブラウザ環境（Node上でのツール実行）でwindowを参照してクラッシュさせない。
const browserSessionStorage = typeof window === 'undefined' ? undefined : window.sessionStorage

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // 認可コード＋PKCE。SPAはクライアントシークレットを秘匿できず、implicitフローは
          // アクセストークンがURLフラグメントへ露出するため使わない（ADR-021）。
          flowType: 'pkce',
          // 既定のlocalStorageはタブを閉じても残るため、XSSでトークンを盗まれた際の
          // 被害時間が長い。sessionStorageにしてタブを閉じた時点で破棄する（ADR-021）。
          storage: browserSessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          // Google OAuthのリダイレクトで戻ったURLからセッションを復元するために必要。
          detectSessionInUrl: true,
        },
      })
    : null
