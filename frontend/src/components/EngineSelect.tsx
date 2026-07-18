import type { ComponentType } from 'react'
import { Bot, Brain, FileCode2, FileText, Gem, Lock, Rows3, Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSheetStore } from '@/store/sheetStore'
import type { RenderEngineId } from '@/store/sheetStore'

type EngineDefinition = {
  id: RenderEngineId
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  // フェーズ5（Supabase Auth導入）まで自由アクセスのユーザーは利用できない標準プランの生成AI（ADR-015）。
  // 選択自体は許可し、実際に描画を押した時点でバックエンドが403を返しメッセージを表示する
  // （フロント側で無効化すると、フェーズ5解禁時にフロントの変更が必要になってしまうため）。
  gated: boolean
}

// 描画エンジンの一覧（ADR-015）。生成AI（LLMがHTML/CSS/JSONを作る）4種と、
// AIを介さない変換エンジン（PDF→HTML変換結果をそのまま描画結果にする）3種。
const ENGINES: readonly EngineDefinition[] = [
  {
    id: 'gemini_free',
    label: 'Gemini API（無料）',
    description: 'PDFを直接読み取り、無料枠モデルで整形します',
    icon: Sparkles,
    gated: false,
  },
  {
    id: 'gemini',
    label: 'Gemini API',
    description: '標準プランのモデルでより高精度に整形します',
    icon: Gem,
    gated: true,
  },
  {
    id: 'claude',
    label: 'Claude API',
    description: 'Anthropic Claudeで高精度に整形します',
    icon: Bot,
    gated: true,
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    description: 'OpenAIのモデルで高精度に整形します',
    icon: Brain,
    gated: true,
  },
  {
    id: 'docling',
    label: 'Docling',
    description: 'PDFのテキストと構造をHTML化します（AIなし）',
    icon: FileText,
    gated: false,
  },
  {
    id: 'pdf2htmlex',
    label: 'pdf2htmlEX',
    description: 'PDFの見た目をそのままHTML化します（AIなし）',
    icon: FileCode2,
    gated: false,
  },
  {
    id: 'pymupdf',
    label: 'PyMuPDF',
    description: 'PDFのレイアウトを座標付きで再現します（AIなし）',
    icon: Rows3,
    gated: false,
  },
] as const

const ENGINE_BY_ID = new Map(ENGINES.map((engine) => [engine.id, engine]))

// 描画ボタンの隣に置く、生成エンジン選択のSelect（ADR-015）。SizeControlsと同じ
// 「Selectの項目をアイコン化する」パターンを踏襲し、各項目にはアイコン・ラベルに加えて
// 1行の説明文を添えて選び分けやすくする。
export function EngineSelect() {
  const engine = useSheetStore((state) => state.engine)
  const setEngine = useSheetStore((state) => state.setEngine)
  const selected = ENGINE_BY_ID.get(engine) ?? ENGINES[0]
  const SelectedIcon = selected.icon

  return (
    <Select value={engine} onValueChange={(value) => setEngine(value as RenderEngineId)}>
      <SelectTrigger aria-label={`生成エンジン選択：${selected.label}`} className="min-w-44">
        <SelectValue>
          {() => (
            <span className="flex items-center gap-1.5">
              <SelectedIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{selected.label}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-72">
        {ENGINES.map((option) => (
          <SelectItem key={option.id} value={option.id} className="py-2">
            <option.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1 font-medium">
                {option.label}
                {option.gated && (
                  <Lock aria-label="要アカウント登録（フェーズ5で利用可能予定）" className="size-3 text-muted-foreground" />
                )}
              </span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
