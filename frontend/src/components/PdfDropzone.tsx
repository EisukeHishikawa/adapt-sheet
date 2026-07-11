import { useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react'
import { FileText, UploadCloud, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSheetStore } from '@/store/sheetStore'

// docs/spec.md 2.1「ファイル操作」のPDFアップロードエリア。<input type="file">自体を透明にして
// ドロップ先に重ねることで、クリックでのファイル選択とドラッグ＆ドロップを単一要素・単一の
// aria-labelで扱える（キーボード・スクリーンリーダーからも迷わずアクセスできる）。
export function PdfDropzone() {
  const pdfFileName = useSheetStore((state) => state.pdfFileName)
  const setPdfFile = useSheetStore((state) => state.setPdfFile)

  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (event: DragEvent<HTMLInputElement>) => {
    // ブラウザ既定の「ファイルを新規タブで開く」動作を止めないとdropイベントが発火しない。
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleDrop = (event: DragEvent<HTMLInputElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    // docs/spec.md 3.1のpdfフィールドはPDF専用のため、PDF以外は無視する。
    if (file && file.type === 'application/pdf') {
      setPdfFile(file)
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(event.target.files?.[0] ?? null)
  }

  // 削除ボタンはinput（ドロップ先）の上に重なるため、クリックがファイル選択ダイアログへ
  // 伝播しないよう止める。
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
      {/* pointer-events-noneで、この表示部分へのクリックを背面のinputへ通す。 */}
      <div aria-hidden="true" className="pointer-events-none flex items-center gap-2">
        {pdfFileName ? <FileText className="size-4 shrink-0" /> : <UploadCloud className="size-5 shrink-0" />}
        <span className="truncate">{pdfFileName ?? 'PDFをドラッグ＆ドロップ、またはクリックして選択'}</span>
      </div>
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
