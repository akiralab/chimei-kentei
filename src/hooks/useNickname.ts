import { useCallback, useState } from 'react'

export const NICKNAME_KEY = 'nickname'

export function readNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeNickname(value: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, value)
  } catch {
    // プライベートモード等では保存できない。氏名欄が毎回空になるだけなので無視する
  }
}

/** localStorage 'nickname' と同期する氏名欄の状態 */
export function useNickname(): [string, (value: string) => void] {
  const [nickname, setNickname] = useState<string>(() => readNickname())
  const update = useCallback((value: string) => {
    setNickname(value)
    writeNickname(value)
  }, [])
  return [nickname, update]
}
