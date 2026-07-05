// vite.config.tsのtest.setupFilesから読み込まれる。
// toBeInTheDocument()等のjest-domカスタムマッチャをVitestのexpectに拡張する。
import '@testing-library/jest-dom/vitest'
