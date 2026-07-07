import { EditorPanel } from '@/components/EditorPanel'
import { PreviewPanel } from '@/components/PreviewPanel'
import { HistorySlider } from '@/components/HistorySlider'
import { MessageToast } from '@/components/MessageToast'

// ステップ4：「左：入力、右：リアルタイムプレビュー」の2カラム最小画面のルートコンポーネント。
// 両パネルはpropsで直接繋がず、それぞれ内部でZustandストア（sheetStore）を参照することで、
// 将来コントロール類（描画ボタン等、ステップ5以降）を挟んでも配線を変えずに済むようにする。
// ステップ8：画面下部に描画履歴スライダ（HistorySlider）を、画面右下にトースト（MessageToast）を
// 追加する。いずれもストア経由で連動するため、2カラム部分の配線は変更していない。
function App() {
  return (
    <main className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* 2カラムの主要領域。flex-1で縦方向の残り高さを占有し、はみ出しは各パネル内でスクロールさせる。 */}
      <div className="flex min-h-0 flex-1">
        <EditorPanel />
        <PreviewPanel />
      </div>
      {/* ステップ8: 描画履歴スライダ（docs/spec.md 2.2）。画面下部に横並びで固定表示する。 */}
      <div className="border-t border-input px-4">
        <HistorySlider />
      </div>
      {/* ステップ8: エラー/成功メッセージのトースト（docs/spec.md 2.2）。position:fixedで最前面に出す。 */}
      <MessageToast />
    </main>
  )
}

export default App
