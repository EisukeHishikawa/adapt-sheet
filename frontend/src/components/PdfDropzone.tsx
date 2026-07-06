import type { ChangeEvent, DragEvent } from 'react'
import { useSheetStore } from '@/store/sheetStore'

// docs/spec.md 2.1「ファイル操作」のPDFアップロードエリア（ドラッグ＆ドロップ対応）。
// <input type="file">自体をドロップ先として重ねる実装にすることで、
// クリックでのファイル選択（ブラウズ）とドラッグ＆ドロップの両方を単一要素・単一のaria-labelで
// 扱える（キーボード操作・スクリーンリーダーの双方でも迷わずアクセスできる）。
export function PdfDropzone() {
  const pdfFileName = useSheetStore((state) => state.pdfFileName)
  const setPdfFile = useSheetStore((state) => state.setPdfFile)

  const handleDragOver = (event: DragEvent<HTMLInputElement>) => {
    // ブラウザ既定の「ファイルを新規タブで開く」動作を止め、dropイベントを発火させるために必須。
    event.preventDefault()
  }

  const handleDrop = (event: DragEvent<HTMLInputElement>) => {
    event.preventDefault()
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

  return (
    <div className="relative flex h-20 items-center justify-center rounded-md border border-dashed border-input text-sm text-muted-foreground">
      <input
        type="file"
        accept="application/pdf"
        aria-label="PDFドラッグ＆ドロップエリア"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onChange={handleChange}
      />
      <p aria-hidden="true">{pdfFileName ?? 'PDFをドラッグ＆ドロップ、またはクリックして選択'}</p>
    </div>
  )
}
