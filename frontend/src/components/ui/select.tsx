import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// ステップ17: docs/spec.md 2.2「定型サイズ自動入力」のUIを、1つのSelect（トリガー+
// ドロップダウン）に統合するための土台。shadcn/uiのBase UI版Select
// （https://www.shadcn.net/ja/docs/components/select）と同じ構成（Root/Trigger/Content/Item）
// を素のBase UIプリミティブから組む。ポップアップはPortalで body 直下に描画されるため、
// 親要素のoverflow/z-indexの影響を受けない。
// アニメーションはBase UI公式の推奨パターンに従い、キーフレームではなく
// data-starting-style/data-ending-style（アニメーション開始/終了時にのみ付与される属性）を
// トリガーにしたCSS transitionで実装する（アンマウントのタイミングもBase UI側が
// transitionendを検知して自動制御するため、追加のJSは不要）。
// ユーザーレビュー（「プルダウンをやめてほしい」）を受け、トリガーに枠線・シェブロン等の
// 「フォーム部品らしい」装飾は持たせず、渡された中身（アイコン）だけがそのままボタンになる
// ミニマルな実装にしている。見た目の装飾は呼び出し側（SizeControls）が完全に受け持つ。

const Select = SelectPrimitive.Root

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md outline-none transition-transform duration-150 select-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </SelectPrimitive.Trigger>
  )
}

// 選択中の値の表示部分。childrenにrender propを渡すと現在値に応じた任意のReactNode
// （紙のスウォッチ等）を表示できるため、SizeControlsではここでプレビューを切り替える。
const SelectValue = SelectPrimitive.Value

function SelectContent({
  className,
  children,
  sideOffset = 8,
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "sideOffset" | "align">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        sideOffset={sideOffset}
        align="start"
        // Base UIの既定(true)は「選択中の項目をトリガーの位置に重ねて表示する」動作。
        // 縦一列のリストであっても、選択中の項目がリストの末尾に近いと同様の理由で
        // ポップアップが画面外へ押し上げられうるため無効化し、トリガーの下に素直に開く。
        alignItemWithTrigger={false}
        className="z-50 outline-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "origin-[var(--transform-origin)] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none transition-[opacity,transform] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List className="flex flex-col items-center gap-2 p-1">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "group/select-item relative flex cursor-pointer items-center justify-center rounded-lg border border-transparent p-1.5 outline-none transition-all duration-150 select-none data-highlighted:border-border data-highlighted:bg-muted data-selected:border-primary/50 data-selected:bg-primary/5",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex items-center justify-center">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <Check className="size-3" strokeWidth={3} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
