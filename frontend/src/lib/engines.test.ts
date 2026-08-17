import { describe, expect, it } from 'vitest'
import { AI_ENGINES, ENGINES, GEMINI_FREE_QUOTA_ENGINES, PDF_REQUIRED_ENGINES } from '@/lib/engines'

describe('engines', () => {
  it('各エンジンをちょうど1行ずつ持つ', () => {
    const ids = ENGINES.map((engine) => engine.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('非同期ジョブ経路の対象は生成AIエンジンだけ', () => {
    expect(AI_ENGINES).toEqual(new Set(['gemini_free', 'gemini', 'claude', 'openai', 'hybrid']))
  })

  it('無料枠カウンタの対象はgemini_freeと同じモデルを使うエンジンだけ', () => {
    expect(GEMINI_FREE_QUOTA_ENGINES).toEqual(new Set(['gemini_free', 'hybrid']))
  })

  // backendのapp/services/engines.pyのPDF_REQUIRED_ENGINESと同じ集合であること。
  it('PDF必須の対象は変換エンジンとhybridだけ', () => {
    expect(PDF_REQUIRED_ENGINES).toEqual(new Set(['hybrid', 'docling', 'pdf2htmlex', 'pymupdf']))
  })

  it('要ログインのエンジンはすべて生成AIエンジン', () => {
    for (const engine of ENGINES) {
      if (engine.gated) expect(engine.usesAi).toBe(true)
    }
  })

  it('無料枠カウンタの対象はすべて生成AIエンジン', () => {
    for (const engine of ENGINES) {
      if (engine.countsFreeQuota) expect(engine.usesAi).toBe(true)
    }
  })
})
