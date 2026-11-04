import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @font-face は変数（tokens.css）より先に読む
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/map.css'
import App from './App.tsx'
import { startStatsSync } from './engine/ranking-cache.ts'
import { setupStatusBar } from './native.ts'

// 殻のときだけステータスバーを白文字に（Web では何もしない）
void setupStatusBar()

// 順位タブを開く前に一覧を温めておく。前面にいる間は古くなるたびに取り直す
startStatsSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
