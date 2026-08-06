import type { ComponentType } from 'react'
import { Bot, Brain, FileCode2, FileText, Gem, Layers, Lock, Rows3, Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSheetStore } from '@/store/sheetStore'
import type { RenderEngineId } from '@/store/sheetStore'

type EngineDefinition = {
  id: RenderEngineId
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  // 未ログインでは使えない標準プランの生成AI。判定をバックエンドに一本化するため、選択自体は
  // 許可し、描画を押した時点の403をメッセージとして表示する。
  gated: boolean
}

// 描画エンジンの一覧。生成AI（LLMがHTML/CSS/JSONを作る）5種と、
// AIを介さない変換エンジン（PDF→HTML変換結果をそのまま描画結果にする）3種。
const ENGINES: readonly EngineDefinition[] = [
  {
    id: 'hybrid',
    label: '精密復元',
    description: 'PyMuPDF・Docling・Gemini（無料枠）（数十秒〜数分）',
    icon: Layers,
    gated: false,
  },
  {
    id: 'gemini_free',
    label: 'Gemini API（無料枠）',
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

// 生成エンジン選択のSelect。項目にはアイコン・ラベルに加えて1行の説明文を添える。
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
                  <Lock aria-label="要ログイン" className="size-3 text-muted-foreground" />
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
