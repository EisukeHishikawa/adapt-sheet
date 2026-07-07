import type { ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { SIZE_PRESETS, useSheetStore } from '@/store/sheetStore'
import type { Orientation, SizePresetName } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.1「コントロール」/ 2.2「定型サイズ自動入力」のUI。
// プリセット（A4/A5/B5 × たて/よこ）ボタンと、幅・高さの手動入力欄を提供する。
// 値はローカルstateを持たずストアを直接参照/更新し、fetchRender時にそのままAPIへ渡す。

// プリセットボタンの一覧をSIZE_PRESETSから機械的に生成する。
// ボタンを手書きで6つ並べると寸法表（ストア側）と二重管理になり、サイズ追加時に
// 片方だけ更新されるズレが生じるため、定義を単一の情報源（SIZE_PRESETS）に集約する。
const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'tate', label: 'たて' },
  { value: 'yoko', label: 'よこ' },
]

export function SizeControls() {
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)
  const setWidthMm = useSheetStore((state) => state.setWidthMm)
  const setHeightMm = useSheetStore((state) => state.setHeightMm)
  const applySizePreset = useSheetStore((state) => state.applySizePreset)

  // 数値入力欄の共通ハンドラ。空文字はnull（未入力）に、それ以外は数値へ変換する。
  // NaN（不正入力）はストアへ反映せず、直前の値を保持する（type=numberなので通常は空かnumber）。
  const handleNumberChange = (setter: (value: number | null) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    if (raw === '') {
      setter(null)
      return
    }
    const parsed = Number(raw)
    if (!Number.isNaN(parsed)) {
      setter(parsed)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(SIZE_PRESETS) as SizePresetName[]).map((size) =>
          ORIENTATIONS.map((orientation) => (
            <Button
              key={`${size}-${orientation.value}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applySizePreset(size, orientation.value)}
            >
              {`${size} ${orientation.label}`}
            </Button>
          )),
        )}
      </div>
      <div className="flex gap-3">
        <label className="flex items-center gap-1 text-sm">
          <span>横幅 (mm)</span>
          <input
            type="number"
            aria-label="横幅 (mm)"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
            // controlled入力: nullのときは空文字にして「未入力」を表現する
            value={widthMm ?? ''}
            onChange={handleNumberChange(setWidthMm)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <span>縦幅 (mm)</span>
          <input
            type="number"
            aria-label="縦幅 (mm)"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={heightMm ?? ''}
            onChange={handleNumberChange(setHeightMm)}
          />
        </label>
      </div>
    </div>
  )
}
