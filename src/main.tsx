import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @font-face は変数（tokens.css）より先に読む
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/map.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
