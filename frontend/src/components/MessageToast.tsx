import { CircleAlert, CircleCheck } from 'lucide-react'
import { useSheetStore } from '@/store/sheetStore'

// docs/spec.md 2.2「インテリジェントメッセージ表示」のUI。表示文言の決定はストア側に集約し、
// このコンポーネントは「どう見せるか」だけに責務を絞る。
export function MessageToast() {
  const error = useSheetStore((state) => state.error)
  const successMessage = useSheetStore((state) => state.successMessage)
  const dismissError = useSheetStore((state) => state.dismissError)
  const dismissSuccessMessage = useSheetStore((state) => state.dismissSuccessMessage)

  // 通常は同時に立たないが、万一同時なら重大度の高いエラーを優先表示する。
  const message = error ?? successMessage
  if (!message) return null

  const isError = error !== null
  // エラーは即時読み上げのalert、成功は割り込みの弱いstatusにする。
  const role = isError ? 'alert' : 'status'

  // 表示中でない側をクリアしても副作用がないため、両方まとめて消す。
  const handleDismiss = () => {
    dismissError()
    dismissSuccessMessage()
  }

  return (
    <div
      role={role}
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        isError
          ? 'border-destructive/50 bg-destructive text-destructive-foreground'
          : 'border-input bg-background text-foreground'
      }`}
    >
      {isError ? (
        <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
      ) : (
        <CircleCheck aria-hidden="true" className="mt-px size-4 shrink-0 text-emerald-500" />
      )}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="メッセージを閉じる"
        onClick={handleDismiss}
        className="-mr-1 shrink-0 rounded px-1 leading-none opacity-70 transition-opacity hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}
