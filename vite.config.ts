/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages（プロジェクトサイト）配下で配信するため base をリポジトリ名に合わせる
export default defineConfig({
  base: '/chimei-kentei/',
  plugins: [react()],
  test: {
    // 既定は node（エンジンのテスト）。画面テストはファイル先頭の
    // `// @vitest-environment jsdom` コメントで jsdom に切り替える
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
  },
})
