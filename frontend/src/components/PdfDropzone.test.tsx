import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PdfDropzone } from './PdfDropzone'
import { useSheetStore } from '@/store/sheetStore'

// DEVELOPMENT.md ステップ7のTDD要件: PDFドラッグ＆ドロップエリア（docs/spec.md 2.1）の
// 実装前に、「PDFをドロップ/選択したらストアにpdfFileが格納される」という期待値を先に定義する。
describe('PdfDropzone（PDFドラッグ＆ドロップエリア）', () => {
  beforeEach(() => {
    useSheetStore.setState({ pdfFile: null, pdfFileName: null })
  })

  it('PDFファイルをドロップすると、ストアのpdfFileに格納される', () => {
    render(<PdfDropzone />)
    const file = new File(['%PDF-1.4 dummy'], 'invoice.pdf', { type: 'application/pdf' })
    const dropzone = screen.getByLabelText('PDFドラッグ＆ドロップエリア')

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(useSheetStore.getState().pdfFile).toBe(file)
    expect(useSheetStore.getState().pdfFileName).toBe('invoice.pdf')
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
  })

  it('クリックしてファイル選択した場合もストアのpdfFileに格納される', async () => {
    const user = userEvent.setup()
    render(<PdfDropzone />)
    const file = new File(['%PDF-1.4 dummy'], 'report.pdf', { type: 'application/pdf' })

    const input = screen.getByLabelText('PDFドラッグ＆ドロップエリア', { selector: 'input' })
    await user.upload(input, file)

    expect(useSheetStore.getState().pdfFile).toBe(file)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  it('PDF以外のファイルをドロップした場合は無視される', () => {
    render(<PdfDropzone />)
    const file = new File(['plain text'], 'note.txt', { type: 'text/plain' })
    const dropzone = screen.getByLabelText('PDFドラッグ＆ドロップエリア')

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(useSheetStore.getState().pdfFile).toBeNull()
  })
})
