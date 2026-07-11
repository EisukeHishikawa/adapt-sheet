import type { ChangeEvent } from 'react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { dimensionsFor, useSheetStore } from '@/store/sheetStore'
import type { Orientation, SizePresetName } from '@/store/sheetStore'

// docs/spec.md 2.2「定型サイズ自動入力」のUI。用紙の向きは「たて」「よこ」の文字ではなく、実寸mmの
// 縦横比をそのまま反映した紙のイラスト（PaperSwatch）の形で表現する。視覚的な文字表記を持たない分、
// アクセシブルネームはトリガー・各選択肢のaria-labelで保持する。
const SIZE_ORDER: readonly { size: SizePresetName; orientation: Orientation }[] = [
  { size: 'A4', orientation: 'tate' },
  { size: 'A4', orientation: 'yoko' },
  { size: 'B5', orientation: 'tate' },
  { size: 'B5', orientation: 'yoko' },
  { size: 'A5', orientation: 'tate' },
  { size: 'A5', orientation: 'yoko' },
]

function presetKey(size: SizePresetName, orientation: Orientation): string {
  return `${size}-${orientation}`
}

function orientationLabelOf(orientation: Orientation): string {
  return orientation === 'tate' ? 'たて' : 'よこ'
}

// 実寸mm²の面積比そのままだとA4とA5の差が大きすぎるため、「微妙に」大小がわかる程度に圧縮した倍率。
const SIZE_AREA_SCALE: Record<SizePresetName, number> = {
  A5: 0.92,
  B5: 1,
  A4: 1.08,
}

const SWATCH_BASE_SIZE = 25

// 「面積 = baseSize² × areaScale」を固定し、そこから縦横比に応じて幅・高さを逆算する。
// aspect-ratioと高さだけを固定する方式では、同じ用紙でも「よこ」が「たて」より見かけの面積が
// 大きくなってしまうため（同じ高さなら横長の方が面積が大きい）。
function swatchPixelSize(widthMm: number, heightMm: number, baseSize: number, areaScale = 1): { width: number; height: number } {
  const aspect = widthMm / heightMm
  const side = baseSize * Math.sqrt(areaScale)
  return { width: side * Math.sqrt(aspect), height: side / Math.sqrt(aspect) }
}

// 現在の寸法に一致するプリセット。手動入力等でどれとも一致しなければundefined（トリガーは無表記になる）。
function findMatchingPreset(widthMm: number | null, heightMm: number | null) {
  return SIZE_ORDER.find(({ size, orientation }) => {
    const dimensions = dimensionsFor(size, orientation)
    return widthMm === dimensions.widthMm && heightMm === dimensions.heightMm
  })
}

// 抽象的な四角アイコンではなく実寸の縦横比を持つ紙の形にすることで、何の用紙か・どちら向きかを
// 文字なしで直感的に示す。labelを省略すると無地になる（プリセット非一致時にA4等の誤表記を出さないため）。
function PaperSwatch({
  widthMm,
  heightMm,
  label,
  baseSize,
  areaScale,
  className,
}: {
  widthMm: number
  heightMm: number
  label?: string
  baseSize: number
  areaScale?: number
  className?: string
}) {
  const orientation: Orientation = widthMm <= heightMm ? 'tate' : 'yoko'
  const { width, height } = swatchPixelSize(widthMm, heightMm, baseSize, areaScale)
  return (
    <span
      aria-hidden="true"
      data-slot="paper-swatch"
      data-orientation={orientation}
      style={{ width, height, aspectRatio: `${widthMm} / ${heightMm}` }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background shadow-[0_1px_3px_rgba(0,0,0,0.15)]',
        className,
      )}
    >
      {label && <span className="text-[0.5rem] leading-none font-semibold tracking-tight text-foreground/70">{label}</span>}
    </span>
  )
}

export function SizeControls() {
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)
  const setWidthMm = useSheetStore((state) => state.setWidthMm)
  const setHeightMm = useSheetStore((state) => state.setHeightMm)
  const applySizePreset = useSheetStore((state) => state.applySizePreset)

  // 空文字はnull（未入力）にする。NaN（不正入力）はストアへ反映せず直前の値を保つ。
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

  const selectedMatch = findMatchingPreset(widthMm, heightMm)
  const selectedKey = selectedMatch ? presetKey(selectedMatch.size, selectedMatch.orientation) : ''

  return (
    <div className="flex flex-row flex-wrap items-center gap-3">
      <Select
        value={selectedKey}
        onValueChange={(value) => {
          if (!value) return
          const [size, orientation] = value.split('-') as [SizePresetName, Orientation]
          applySizePreset(size, orientation)
        }}
      >
        <SelectTrigger
          aria-label={
            selectedMatch
              ? `サイズ選択：${selectedMatch.size} ${orientationLabelOf(selectedMatch.orientation)}`
              : 'サイズ選択'
          }
        >
          {/* SelectValueはBase UIのアクセシビリティ配線（現在値の保持）のために挟むが、見た目は常に
              紙のスウォッチを描画する。手動入力値をそのまま形に反映するとトリガーの縦横比が入力の
              たびに変わってしまうため、プリセット非一致時は固定の1:1・無表記にする。 */}
          <SelectValue>
            {() => {
              const dimensions = selectedMatch
                ? dimensionsFor(selectedMatch.size, selectedMatch.orientation)
                : { widthMm: 1, heightMm: 1 }
              return (
                <PaperSwatch
                  {...dimensions}
                  label={selectedMatch?.size}
                  areaScale={selectedMatch ? SIZE_AREA_SCALE[selectedMatch.size] : undefined}
                  baseSize={SWATCH_BASE_SIZE}
                />
              )
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SIZE_ORDER.map(({ size, orientation }) => (
            <SelectItem
              key={presetKey(size, orientation)}
              value={presetKey(size, orientation)}
              aria-label={`${size} ${orientationLabelOf(orientation)}`}
            >
              <PaperSwatch
                {...dimensionsFor(size, orientation)}
                label={size}
                areaScale={SIZE_AREA_SCALE[size]}
                baseSize={SWATCH_BASE_SIZE}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-3">
        <label className="flex items-center gap-1">
          <span className="text-xs">横幅 (mm)</span>
          <input
            type="number"
            aria-label="横幅 (mm)"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            // nullのときは空文字にして「未入力」を表現する（controlled入力）。
            value={widthMm ?? ''}
            onChange={handleNumberChange(setWidthMm)}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs">縦幅 (mm)</span>
          <input
            type="number"
            aria-label="縦幅 (mm)"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            value={heightMm ?? ''}
            onChange={handleNumberChange(setHeightMm)}
          />
        </label>
      </div>
    </div>
  )
}
