import { useCallback, useState } from 'react'

/**
 * この端末で非表示にした順位表の名前（App Store Guideline 1.2 の「利用者をブロックする手段」）。
 * API は端末の識別子を返さないので名前で隠す。サーバーには何も送らない。
 */
export const HIDDEN_NAMES_KEY = 'hiddenNames'

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_NAMES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

function write(names: string[]): void {
  try {
    localStorage.setItem(HIDDEN_NAMES_KEY, JSON.stringify(names))
  } catch {
    // 保存できない環境ではこの画面のあいだだけ隠す
  }
}

export function useHiddenNames(): {
  isHidden: (name: string) => boolean
  hide: (name: string) => void
  restoreAll: () => void
} {
  const [names, setNames] = useState<string[]>(read)
  const isHidden = useCallback((name: string) => names.includes(name), [names])
  const hide = useCallback((name: string) => {
    setNames((prev) => {
      const next = prev.includes(name) ? prev : [...prev, name]
      write(next)
      return next
    })
  }, [])
  const restoreAll = useCallback(() => {
    write([])
    setNames([])
  }, [])
  return { isHidden, hide, restoreAll }
}
