import { useRef, type ChangeEvent, type KeyboardEvent, type UIEvent } from 'react'

// ステップ18: HTML/JSON入力を「コードを書くときのUI」に寄せるためのコードエディタ風textarea。
// 外部ライブラリ（CodeMirror等）を足さず、以下だけで“エディタらしさ”を出す軽量実装にした
// （プロジェクトの最小構成・ADR方針を尊重）。
//   - 左に行番号ガターを置き、textareaの縦スクロールに追従させる（行番号とコード行が常に揃う）。
//   - 折り返しを切って（wrap=off）長い行は横スクロールさせる＝コードエディタと同じ挙動。
//   - 暗色のエディタ配色（GitHub Dark系）を固定で当て、明確に「コード入力エリア」と分かるようにする。
//   - Tabキーはフォーカス移動ではなく2スペース挿入にする。
// アクセシビリティ・テスト用の名前はtextareaのaria-labelで保持する（既存の検証と互換）。
type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  // getByRole('textbox', { name }) 等で参照する識別名。見出しは非表示のため唯一の名前になる。
  ariaLabel: string
  id?: string
}

// 行番号・コード行で共有する行の高さ(px)。ガターとtextareaで必ず一致させないと行番号がずれるため定数化する。
const LINE_HEIGHT_PX = 20

export function CodeEditor({ value, onChange, ariaLabel, id }: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null)

  // 行番号は改行数から算出する。空文字でも1行目は表示する。
  // wrap=offで折り返さないため「論理行＝表示行」となり、この単純なカウントで行番号が正しく揃う。
  const lineCount = Math.max(1, value.split('\n').length)

  // textareaの縦スクロール量を行番号ガターへ同期し、スクロールしても行番号とコード行を揃え続ける。
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop
    }
  }

  // Tabキー: 既定のフォーカス移動を止め、コードエディタらしくキャレット位置へ2スペースを挿入する。
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const el = event.currentTarget
    const { selectionStart, selectionEnd } = el
    const nextValue = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
    onChange(nextValue)
    // 再レンダリング後にキャレットを挿入した2文字分だけ進める（同じDOMノードなのでrefは有効なまま）。
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2
    })
  }

  return (
    <div
      className="flex flex-1 overflow-hidden rounded-md border border-input font-mono text-sm"
      // GitHub Dark系のエディタ配色を固定で当てる（アプリのライト/ダークに依らず常にコード面として見せる）。
      style={{ backgroundColor: '#0d1117' }}
    >
      {/* 行番号ガター。overflow-hiddenにしてtextarea側のscrollTopを転写することで縦スクロールに追従させる。 */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="shrink-0 select-none overflow-hidden py-2 pr-2 pl-3 text-right"
        style={{ color: '#6e7681' }}
      >
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} style={{ height: LINE_HEIGHT_PX, lineHeight: `${LINE_HEIGHT_PX}px` }}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        id={id}
        aria-label={ariaLabel}
        value={value}
        // コードなのでスペルチェックの赤波線は邪魔になるため無効化する。
        spellCheck={false}
        // wrap=off: 折り返さず横スクロールさせる（行番号と論理行の対応を保つためにも必須）。
        wrap="off"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="flex-1 resize-none overflow-auto bg-transparent py-2 pr-3 pl-2 outline-none"
        // 行の高さをガターと厳密に一致させ、明るい文字色・キャレット色を指定する。
        style={{ color: '#e6edf3', caretColor: '#e6edf3', lineHeight: `${LINE_HEIGHT_PX}px` }}
      />
    </div>
  )
}
