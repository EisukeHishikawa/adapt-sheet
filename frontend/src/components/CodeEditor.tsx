import { useRef, useState, type ChangeEvent, type KeyboardEvent, type UIEvent } from 'react'
import Prism from 'prismjs'
// PrismコアはHTML(markup)を同梱するが、JSONは別途読み込んで文法を拡張する。
import 'prismjs/components/prism-json'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

// ステップ18: HTML/JSON入力を「今風のモダンなコードエディタUI」にするコンポーネント。
// 参考: shadcnドキュメントのコードブロック（シンタックスハイライト＋コピーボタン）。
// 編集可能なまま色分けするため、prismjsでハイライトした<pre>を背面に敷き、その上に
// 文字色を透明にした<textarea>を重ねる定番のオーバーレイ方式にした（外部エディタライブラリは足さない）。
//   - 背面<pre>: prismでトークン化した色付きコードを表示（クリック不可・スクロールはtextareaへ同期）。
//   - 前面<textarea>: 実際の入力を受ける。文字色は透明・キャレットのみ明色にして、背面の色付き文字が透けて見える。
//   - 左に行番号ガター、右上にコピーボタンを配置。折り返しなし(wrap=off)で横スクロールする。
// アクセシビリティ・テスト用の名前は非表示ラベル(sr-only)＋textareaのaria-labelで保持する。
type CodeLanguage = 'html' | 'json'

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  // getByRole('textbox', { name }) 等で参照する識別名。見出しは非表示のため唯一の名前になる。
  ariaLabel: string
  // ハイライトに使う文法。HTMLはmarkup、JSONはjsonのPrism文法を割り当てる。
  language: CodeLanguage
  id?: string
}

// 行番号・コード行・ハイライト層で共有する行の高さ(px)。全層で一致させないと表示がずれるため定数化する。
const LINE_HEIGHT_PX = 20

export function CodeEditor({ value, onChange, ariaLabel, language, id }: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  // 行番号は改行数から算出する。空文字でも1行目は表示する。
  // wrap=offで折り返さないため「論理行＝表示行」となり、この単純なカウントで行番号が正しく揃う。
  const lineCount = Math.max(1, value.split('\n').length)

  // prismでトークン化したHTML文字列。背面<pre>へdangerouslySetInnerHTMLで流し込む。
  // 末尾が改行の場合、<pre>だと最終空行の高さが出ずtextareaと1行ぶんずれるため、末尾に空白を補う。
  const grammar = language === 'json' ? Prism.languages.json : Prism.languages.markup
  const highlighted = Prism.highlight(value.endsWith('\n') ? `${value} ` : value, grammar, language)

  // textareaの縦横スクロール量を背面<pre>と行番号ガターへ転写し、スクロールしても各層を揃え続ける。
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) {
      // ガターは横スクロールさせず縦位置のみ合わせる。
      gutterRef.current.scrollTop = scrollTop
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
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2
    })
  }

  // コピー: クリップボードへ全文をコピーし、一定時間だけ「コピー済み」表示に切り替える。
  // navigator.clipboardが無い環境（一部テスト環境等）では黙って何もしない。
  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード権限が無い場合等はコピー状態にしない（機能の失敗をUIに波及させない）。
    }
  }

  // 背面<pre>・前面<textarea>で厳密に一致させるべき行のメトリクス。ズレ防止のため一箇所にまとめる。
  const sharedTextStyle = { lineHeight: `${LINE_HEIGHT_PX}px`, tabSize: 2 } as const

  return (
    // GitHub Dark系のエディタ配色を固定で当て、明確に「コード入力エリア」と分かるようにする。
    // groupにしてホバー時のみコピーボタンを強調表示する。
    <div className="group relative flex flex-1 overflow-hidden rounded-md border border-input bg-[#0d1117] font-mono text-sm">
      {/* 行番号ガター。overflow-hiddenにしてtextarea側のscrollTopを転写し縦スクロールへ追従させる。 */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="shrink-0 select-none overflow-hidden py-2 pr-2 pl-3 text-right text-[#6e7681]"
      >
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} style={{ height: LINE_HEIGHT_PX, lineHeight: `${LINE_HEIGHT_PX}px` }}>
            {index + 1}
          </div>
        ))}
      </div>

      {/* コード領域。背面ハイライト<pre>と前面<textarea>を重ねる。 */}
      <div className="relative flex-1">
        {/* 背面: prismで色付けしたコード。code-editorクラス配下のトークン配色はindex.cssで定義。 */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="code-editor pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre py-2 pr-3 pl-2 text-[#e6edf3]"
          style={sharedTextStyle}
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        {/* 前面: 実入力用textarea。文字は透明にして背面の色付き文字を見せ、キャレットのみ明色にする。 */}
        <textarea
          id={id}
          aria-label={ariaLabel}
          value={value}
          spellCheck={false}
          wrap="off"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent py-2 pr-3 pl-2 text-transparent caret-[#e6edf3] outline-none"
          style={sharedTextStyle}
        />
      </div>

      {/* コピーボタン。右上に固定し、通常は控えめ・ホバー/フォーカスで明確化する（モダンなコードブロック風）。 */}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'コピーしました' : 'コピー'}
        className={cn(
          'absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22] text-[#c9d1d9] opacity-60 transition-all hover:bg-[#21262d] hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      >
        {copied ? <Check className="size-3.5 text-[#3fb950]" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
