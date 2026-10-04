/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base はビルドモードで切り替える。
//   既定           … GitHub Pages（プロジェクトサイト）配下なのでリポジトリ名
//   --mode capacitor … ネイティブの殻。capacitor://localhost 直下に置くので相対
// 実行時の取得は src/engine/bank.ts と src/geo/load.ts が import.meta.env.BASE_URL を
// 見ているので、切替はここ 1 か所で足りる（設計ノート §13.1・Issue #42）
export default defineConfig(({ mode }) => ({
  base: mode === 'capacitor' ? './' : '/chimei-kentei/',
  plugins: [react()],
  test: {
    // 既定は node（エンジンのテスト）。画面テストはファイル先頭の
    // `// @vitest-environment jsdom` コメントで jsdom に切り替える
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'infra/**/*.test.ts'],
    passWithNoTests: true,
  },
}))
