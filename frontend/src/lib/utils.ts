import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// shadcn/uiの各コンポーネントが前提とするヘルパー。
// clsxで条件付きクラスを結合し、twMergeでTailwindクラスの重複・競合を解決する。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
