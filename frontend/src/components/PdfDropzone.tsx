import { useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react'
import { FileText, UploadCloud, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSheetStore } from '@/store/sheetStore'

// docs/spec.md 2.1「ファイル操作」のPDFアップロードエリア（ドラッグ＆ドロップ対応）。
// <input type="file">自体をドロップ先として重ねる実装にすることで、
// クリックでのファイル選択（ブラウズ）とドラッグ＆ドロップの両方を単一要素・単一のaria-labelで
// 扱える（キーボード操作・スクリーンリーダーの双方でも迷わずアクセスできる）。
// ステップ21: ドラッグ中のハイライト、アイコン、選択済みPDFの削除ボタンを追加してUXを引き上げた。
export function PdfDropzone() {
  const pdfFileName = useSheetStore((state) => state.pdfFileName)
  const setPdfFile = useSheetStore((state) => state.setPdfFile)

  // ドラッグ中かどうか。枠線・背景をハイライトして「ここにドロップできる」ことを視覚的に示す。
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (event: DragEvent<HTMLInputElement>) => {
    // ブラウザ既定の「ファイルを新規タブで開く」動作を止め、dropイベントを発火させるために必須。
    event.preventDefault()
    setIsDragging(true)
  }

  // ドラッグがエリア外へ出た/ドロップ完了時はハイライトを解除する。
  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (event: DragEvent<HTMLInputElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    // docs/spec.md 3.1のpdfフィールドはPDF専用のため、PDF以外のファイルは無視する。
    if (file && file.type === 'application/pdf') {
      setPdfFile(file)
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setPdfFile(file)
  }

  // 選択済みPDFの取り消し。ボタンはinput（ドロップ先）の上に重なるため、クリックがinputの
  // ファイル選択ダイアログへ伝播しないようstopPropagationし、ストアのファイルをクリアする。
  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    setPdfFile(null)
  }

  return (
    <div
      className={cn(
        'relative flex h-20 items-center justify-center gap-2 rounded-md border border-dashed px-3 text-sm transition-colors',
        isDragging
          ? 'border-ring bg-muted/60 text-foreground'
          : 'border-input text-muted-foreground hover:border-ring/60 hover:bg-muted/30',
      )}
    >
      <input
        type="file"
        accept="application/pdf"
        aria-label="PDFドラッグ＆ドロップエリア"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onChange={handleChange}
      />
      {/* アイコン＋説明文。inputへクリックを通すためpointer-events-noneにする。
          ファイル選択済みなら書類アイコン＋ファイル名、未選択ならアップロード導線を表示する。 */}
      <div aria-hidden="true" className="pointer-events-none flex items-center gap-2">
        {pdfFileName ? <FileText className="size-4 shrink-0" /> : <UploadCloud className="size-5 shrink-0" />}
        <span className="truncate">{pdfFileName ?? 'PDFをドラッグ＆ドロップ、またはクリックして選択'}</span>
      </div>
      {/* 削除ボタンは選択済みのときだけ出す。inputより前面(z-10)に置き、クリックの伝播を止める。 */}
      {pdfFileName && (
        <button
          type="button"
          aria-label="PDFを取り消す"
          onClick={handleRemove}
          className="absolute right-2 top-2 z-10 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
