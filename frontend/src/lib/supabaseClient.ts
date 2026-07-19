import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// フェーズ5より前（Supabaseプロジェクト未作成）や、環境変数を設定していないローカル環境でも
// アプリ全体がクラッシュしないよう、未設定時はnullにする（DEVELOPMENT.md ステップ27）。
// authStoreはnullの場合「認証機能なし＝常に未ログイン」として扱う。
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
