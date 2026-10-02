/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages（プロジェクトサイト）配下で配信するため base をリポジトリ名に合わせる
export default defineConfig({
  base: '/chimei-kentei/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
