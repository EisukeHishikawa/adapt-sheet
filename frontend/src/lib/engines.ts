import { Bot, Brain, FileCode2, FileText, Gem, Layers, Rows3, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'

// backendのapp/services/engines.pyのENGINE_SPECSと同じ値。
export type RenderEngineId =
  | 'gemini_free'
  | 'gemini'
  | 'claude'
  | 'openai'
  | 'hybrid'
  | 'docling'
  | 'pdf2htmlex'
  | 'pymupdf'

export type EngineDefinition = {
  id: RenderEngineId
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  // 未ログインでは使えない標準プランの生成AI。判定をバックエンドに一本化するため、選択自体は
  // 許可し、描画を押した時点の403をメッセージとして表示する。
  gated: boolean
  // LLMがHTML/CSS/JSONを生成する。生成は20〜60秒以上かかることがあり、API Gatewayの29秒固定
  // タイムアウトを受けるため、このエンジンだけ非同期ジョブ＋ポーリングで描画する。
  usesAi: boolean
  // gemini_freeと同じ無料枠モデルを使うため、共有カウンタの表示対象になる。
  countsFreeQuota: boolean
}

// 描画エンジンの一覧。表示情報（ラベル・説明・アイコン）と挙動の分岐条件を1行にまとめ、
// エンジンの追加・変更をこの表だけで完結させる。
export const ENGINES: readonly EngineDefinition[] = [
  {
    id: 'hybrid',
    label: '精密復元',
    description: 'PyMuPDF・Docling・Gemini（無料枠）（数十秒〜数分）',
    icon: Layers,
    gated: false,
    usesAi: true,
    countsFreeQuota: true,
  },
  {
    id: 'gemini_free',
    label: 'Gemini API（無料枠）',
    description: 'PDFを直接読み取り、無料枠モデルで整形します',
    icon: Sparkles,
    gated: false,
    usesAi: true,
    countsFreeQuota: true,
  },
  {
    id: 'gemini',
    label: 'Gemini API',
    description: '標準プランのモデルでより高精度に整形します',
    icon: Gem,
    gated: true,
    usesAi: true,
    countsFreeQuota: false,
  },
  {
    id: 'claude',
    label: 'Claude API',
    description: 'Anthropic Claudeで高精度に整形します',
    icon: Bot,
    gated: true,
    usesAi: true,
    countsFreeQuota: false,
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    description: 'OpenAIのモデルで高精度に整形します',
    icon: Brain,
    gated: true,
    usesAi: true,
    countsFreeQuota: false,
  },
  {
    id: 'docling',
    label: 'Docling',
    description: 'PDFのテキストと構造をHTML化します（AIなし）',
    icon: FileText,
    gated: false,
    usesAi: false,
    countsFreeQuota: false,
  },
  {
    id: 'pdf2htmlex',
    label: 'pdf2htmlEX',
    description: 'PDFの見た目をそのままHTML化します（AIなし）',
    icon: FileCode2,
    gated: false,
    usesAi: false,
    countsFreeQuota: false,
  },
  {
    id: 'pymupdf',
    label: 'PyMuPDF',
    description: 'PDFのレイアウトを座標付きで再現します（AIなし）',
    icon: Rows3,
    gated: false,
    usesAi: false,
    countsFreeQuota: false,
  },
]

function idsWhere(predicate: (engine: EngineDefinition) => boolean): ReadonlySet<RenderEngineId> {
  return new Set(ENGINES.filter(predicate).map((engine) => engine.id))
}

export const AI_ENGINES = idsWhere((engine) => engine.usesAi)
export const GEMINI_FREE_QUOTA_ENGINES = idsWhere((engine) => engine.countsFreeQuota)
