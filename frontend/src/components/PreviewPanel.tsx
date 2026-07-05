import { useSheetStore } from '@/store/sheetStore'

// 右カラムのリアルタイムプレビュー。iframeを使うのは、生成されたHTML/CSSを
// 親ページのスタイルから隔離した状態で描画し、帳票の見た目をそのまま確認できるようにするため
// （docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// srcDocにストアの値をそのまま渡すことで、ストア更新のたびに自動で再描画される。
export function PreviewPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)

  // cssContentは/api/renderのレスポンスから来る（docs/spec.md 3.1）。
  // <style>として末尾に追加するだけで、<head>の有無に関わらずブラウザが適用してくれるため、
  // htmlの構造を解析・書き換えする必要がない。cssContentが空のとき（ステップ4時点の
  // 挙動）はhtmlContentのみをそのまま使い、既存の見た目を変えない。
  const srcDoc = cssContent ? `${htmlContent}\n<style>${cssContent}</style>` : htmlContent

  return (
    <div className="h-full w-1/2 p-4">
      <iframe title="プレビュー" srcDoc={srcDoc} className="h-full w-full rounded-md border border-input bg-white" />
    </div>
  )
}
