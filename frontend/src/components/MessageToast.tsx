import { CircleAlert, CircleCheck } from 'lucide-react'
import { useSheetStore } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「インテリジェントメッセージ表示」のUI。
// ストアのerror/successMessageを画面右下のトーストとして表示する。
// 表示文言の生成（ステータスコード→日本語メッセージ）はストア側（sheetStore.messageForStatus）に
// 集約し、本コンポーネントは「どう見せるか」だけに責務を絞る。
export function MessageToast() {
  const error = useSheetStore((state) => state.error)
  const successMessage = useSheetStore((state) => state.successMessage)
  const dismissError = useSheetStore((state) => state.dismissError)
  const dismissSuccessMessage = useSheetStore((state) => state.dismissSuccessMessage)

  // エラーと成功が同時に立つことは通常ないが、万一同時なら重大度の高いエラーを優先表示する。
  const message = error ?? successMessage
  if (!message) return null

  const isError = error !== null
  // 支援技術向けにrole属性を出し分ける。エラーは即時に読み上げるalert、
  // 成功は割り込みの弱いstatusにして、テスト（MessageToast.test.tsx）からも役割で判別できるようにする。
  const role = isError ? 'alert' : 'status'

  // 閉じるボタンは両メッセージをまとめてクリアする。どちらか一方しか立っていない前提だが、
  // 個別のdismissを2つ呼ぶことで表示中でない側を消しても副作用がないようにしている。
  const handleDismiss = () => {
    dismissError()
    dismissSuccessMessage()
  }

  return (
    // ステップ21: 先頭に種別アイコン（成功=チェック / エラー=警告）を添え、tw-animate-cssの
    // animate-inで下からスッと現れる登場アニメーションを付けて視認性を高める。
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
