import { Lock } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSheetStore } from '@/store/sheetStore'
import { ENGINES } from '@/lib/engines'
import type { RenderEngineId } from '@/lib/engines'

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
