import type { ChangeEvent } from 'react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SIZE_PRESETS, useSheetStore } from '@/store/sheetStore'
import type { Orientation, SizePresetName } from '@/store/sheetStore'

// ステップ17: docs/spec.md 2.2「定型サイズ自動入力」のUI再設計。
// 従来は「A4 たて」等の日本語ラベル付きボタンを6つ並べていたが、1つのSelect（`ui/select.tsx`の
// 標準的なBase UI Select）へ統合する。選択肢は6択（A4たて/A4よこ/B5たて/B5よこ/A5たて/A5よこ）。
// 「たて」「よこ」の文字ラベル、mm表記は画面上から排除し、方向は紙のイラスト（`PaperSwatch`、
// 実寸mmの縦横比をそのまま`aspect-ratio`に反映）の縦横比のみで表現する。A4/B5/A5の表記は
// イラストの中に描く。視覚的な文字表記を削除した分、アクセシビリティ用の名前は
// トリガー・各選択肢のaria-labelで別途保持する。
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

function dimensionsOf(size: SizePresetName, orientation: Orientation): { widthMm: number; heightMm: number } {
  const preset = SIZE_PRESETS[size]
  return orientation === 'tate'
    ? { widthMm: preset.yoko, heightMm: preset.tate }
    : { widthMm: preset.tate, heightMm: preset.yoko }
}

function orientationLabelOf(orientation: Orientation): string {
  return orientation === 'tate' ? 'たて' : 'よこ'
}

// A4/B5/A5で面積をわずかに変える倍率（実寸mm²の比そのままだと差が大きすぎるため、
// 「微妙に」大小がわかる程度に圧縮した値。1.0を基準にA4はやや大きく、A5はやや小さくする。
const SIZE_AREA_SCALE: Record<SizePresetName, number> = {
  A5: 0.92,
  B5: 1,
  A4: 1.08,
}

// トリガー・ドロップダウン内の選択肢で共通のスウォッチ基準サイズ。
// 以前はトリガー側を大きめ(56)にしていたが、ユーザーレビュー（「外に表示しているアイコンは
// 中のアイコンと同じサイズにしてほしい」「アイコンを半分に小さくしてほしい」）を受け、
// 両方とも同じ値にし、以前の選択肢側の基準(40)からさらに半分程度(20)に縮小した。
// その後「アイコンを1.25倍程度大きくしてほしい」との追加レビューを受け、20→25に調整。
const SWATCH_BASE_SIZE = 25

// 紙のスウォッチの実ピクセルサイズ(px)を計算する。
// aspect-ratioと高さ(または幅)だけを固定する方式だと、よこ(横長)はたて(縦長)より
// 見かけの面積が大きくなってしまう（同じ高さなら横長の方が面積が大きい）。
// 「面積 = baseSize^2 × areaScale」を固定し、そこから縦横比に応じて幅・高さを
// 逆算することで、同じmm寸法のたて/よこは常に同じ面積になり、areaScaleを渡した分だけ
// （A4/B5/A5間で）面積差がつく。手動入力等プリセット外の寸法はareaScale=1（既定値）でよい。
function swatchPixelSize(widthMm: number, heightMm: number, baseSize: number, areaScale = 1): { width: number; height: number } {
  const aspect = widthMm / heightMm
  const side = baseSize * Math.sqrt(areaScale)
  return { width: side * Math.sqrt(aspect), height: side / Math.sqrt(aspect) }
}

// 現在のwidthMm/heightMmがSIZE_ORDERのどのプリセットと一致するかを逆引きする。
// 手動入力等でどのプリセットとも一致しない場合は空文字列を返し、トリガーは未選択表示になる。
function findMatchingPresetKey(widthMm: number | null, heightMm: number | null): string {
  const match = SIZE_ORDER.find(({ size, orientation }) => {
    const dimensions = dimensionsOf(size, orientation)
    return widthMm === dimensions.widthMm && heightMm === dimensions.heightMm
  })
  return match ? presetKey(match.size, match.orientation) : ''
}

// 「アイコン」ではなく実寸の縦横比(mm)をそのままaspect-ratioに反映した紙のプレビュー。
// 抽象的な四角アイコンより、実際に何の用紙かが直感的にわかり、たて/よこの切り替えも
// 形そのもので表現する。サイズ名(A4/B5/A5)を表示する場合はイラストの中に描くが、
// labelを省略すると無地（無印）のイラストになる。これは幅・高さの手動入力等、
// どのプリセットとも一致しない寸法のときにA4等の実際と異なる表記を出さないための分岐
// （呼び出し側で`label`を渡すかどうかを判断する）。
// アクセシブルネームは呼び出し側でaria-labelとして別途付与する。
// width/heightはswatchPixelSizeで面積を揃えた実ピクセル値を明示的に指定する
// （baseSizeはこのスウォッチが使われる文脈ごとの基準サイズ、例:トリガーは大きめ、
// ドロップダウン内の選択肢は小さめ）。
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

  // 数値入力欄の共通ハンドラ。空文字はnull（未入力）に、それ以外は数値へ変換する。
  // NaN（不正入力）はストアへ反映せず、直前の値を保持する(type=numberなので通常は空かnumber)。
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

  const selectedKey = findMatchingPresetKey(widthMm, heightMm)
  const selectedMatch = SIZE_ORDER.find(({ size, orientation }) => presetKey(size, orientation) === selectedKey)

  return (
    // items-center + flex-row: Selectと横幅・縦幅の入力欄をユーザーレビューに沿って
    // 横並びにする。items-centerを外すとSelectTrigger（ボタン）が縦方向に伸びて
    // 入力欄と高さが揃わなくなるため、中央揃えにしている。
    // ステップ20: flex-wrapを追加し、狭幅(モバイル)で横幅が足りないときは折り返す
    // （デスクトップでは元々収まる幅があるため見た目は変わらない）。
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
          {/* SelectValueはBase UI上のアクセシビリティ配線（現在値の保持）のために挟むが、
              見た目は常にchildren（紙のスウォッチ）を描画する。
              手動入力等でプリセットに一致しない場合（selectedMatchがundefined）は、
              実際の横幅・縦幅を反映せず固定の1:1（正方形）にし、ラベルも表示しない（無表記）。
              手動入力値をそのまま形に反映すると、入力のたびにトリガーの縦横比・大きさが
              変わってしまう（過去のレビューで指摘された「ボタンが動的に変わる」問題の再発）ため、
              プリセット非一致時は常に同じ見た目に固定する。 */}
          <SelectValue>
            {() => {
              const dimensions = selectedMatch ? dimensionsOf(selectedMatch.size, selectedMatch.orientation) : { widthMm: 1, heightMm: 1 }
              return (
                <PaperSwatch
                  widthMm={dimensions.widthMm}
                  heightMm={dimensions.heightMm}
                  label={selectedMatch?.size}
                  areaScale={selectedMatch ? SIZE_AREA_SCALE[selectedMatch.size] : undefined}
                  baseSize={SWATCH_BASE_SIZE}
                />
              )
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SIZE_ORDER.map(({ size, orientation }) => {
            const dimensions = dimensionsOf(size, orientation)
            return (
              <SelectItem
                key={presetKey(size, orientation)}
                value={presetKey(size, orientation)}
                aria-label={`${size} ${orientationLabelOf(orientation)}`}
              >
                <PaperSwatch {...dimensions} label={size} areaScale={SIZE_AREA_SCALE[size]} baseSize={SWATCH_BASE_SIZE} />
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <div className="flex gap-3">
        <label className="flex items-center gap-1">
          <span className="text-xs">横幅 (mm)</span>
          <input
            type="number"
            aria-label="横幅 (mm)"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
            // controlled入力: nullのときは空文字にして「未入力」を表現する
            value={widthMm ?? ''}
            onChange={handleNumberChange(setWidthMm)}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs">縦幅 (mm)</span>
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
