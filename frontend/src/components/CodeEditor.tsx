import { useRef, useState, type ChangeEvent, type KeyboardEvent, type UIEvent } from 'react'
import Prism from 'prismjs'
// PrismコアはHTML(markup)を同梱するが、JSONは別途読み込んで文法を拡張する。
import 'prismjs/components/prism-json'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

// シンタックスハイライト付きのコード入力欄。編集可能なまま色分けするため、外部エディタライブラリを
// 足さず、prismでハイライトした<pre>を背面に敷き、文字色を透明にした<textarea>を前面に重ねる方式にした。
// 見出しは画面に出さないため、アクセシビリティ・テスト用の名前はtextareaのaria-labelで保持する。
type CodeLanguage = 'html' | 'json'

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  language: CodeLanguage
  id?: string
}

// 背面<pre>・行番号ガター・前面<textarea>で一致させないと表示がずれるため定数化する。
const LINE_HEIGHT_PX = 20

export function CodeEditor({ value, onChange, ariaLabel, language, id }: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  // wrap=offで折り返さないため「論理行＝表示行」となり、改行数の単純なカウントで行番号が揃う。
  const lineCount = Math.max(1, value.split('\n').length)

  // 末尾が改行の場合、<pre>では最終空行の高さが出ずtextareaと1行ぶんずれるため末尾に空白を補う。
  const grammar = language === 'json' ? Prism.languages.json : Prism.languages.markup
  const highlighted = Prism.highlight(value.endsWith('\n') ? `${value} ` : value, grammar, language)

  // textareaのスクロール量を背面<pre>と行番号ガターへ転写し、スクロールしても各層を揃え続ける。
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop
    }
  }

  // Tabキーの既定のフォーカス移動を止め、コードエディタらしく2スペースを挿入する。
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード非対応・権限なしの環境では、機能の失敗をUIへ波及させず黙って何もしない。
    }
  }

  // 背面<pre>と前面<textarea>で厳密に一致させるべき行のメトリクス。
  const sharedTextStyle = { lineHeight: `${LINE_HEIGHT_PX}px`, tabSize: 2 } as const

  return (
    // 配色はGitHub Dark系で固定し、テーマに関わらず「コード入力エリア」と分かるようにする。
    <div className="group relative flex flex-1 overflow-hidden rounded-md border border-input bg-[#0d1117] font-mono text-sm">
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

      <div className="relative flex-1">
        {/* トークンの配色はindex.cssの.code-editor配下で定義する。 */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="code-editor pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre py-2 pr-3 pl-2 text-[#e6edf3]"
          style={sharedTextStyle}
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        {/* 文字は透明にして背面の色付き文字を見せ、キャレットのみ明色にする。 */}
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
