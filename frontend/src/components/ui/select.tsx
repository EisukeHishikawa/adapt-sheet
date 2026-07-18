import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

// docs/spec.md 2.2「定型サイズ自動入力」のUIを、1つのSelect（トリガー+ドロップダウン）に
// 統合するための土台。shadcn/uiのBase UI版Selectと同じ、標準的なRoot/Trigger/Content/Item
// 構成で、ポップアップの位置・見た目もBase UIの既定に従う（独自の重ね合わせ配置は保守性が
// 落ちるため採用しない）。中身（紙のスウォッチアイコン）はSizeControls側で渡す。

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
        "flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-muted-foreground">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

// 選択中の値の表示部分。childrenにrender propを渡すと現在値に応じた任意のReactNode
// （アイコン+ラベル等）を表示できるため、SizeControlsではここでプレビューを切り替える。
const SelectValue = SelectPrimitive.Value

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "sideOffset" | "align">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={sideOffset} align="start" className="z-50 outline-none">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            // Firefox向けにscrollbar-width:thin、WebKit系ブラウザ向けに
            // ::-webkit-scrollbarの幅を細くし、ドロップダウンのスクロールバーを目立たせない。
            "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
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
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex items-center gap-2">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
