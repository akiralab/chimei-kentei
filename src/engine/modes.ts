/**
 * 出題の種類（Mode）の表示名。
 *
 * 'e' / 'd' は難易度ではなく **出題する地名の種類**（市区町村名だけか、大字・町名も含むか）なので、
 * 画面では easy / difficult と呼ばない。識別子（セット ID・問題バンクのファイル名・API の mode）は
 * 互換のため 'e' / 'd' のまま。
 */
import type { Mode } from './types.ts'

export const MODE_LABELS: Record<Mode, { name: string; short: string }> = {
  e: { name: '市区町村名', short: '市区町村' },
  d: { name: '市区町村名＋町名', short: '町名も' },
}

export const MODES: Mode[] = ['e', 'd']

export function modeName(mode: Mode): string {
  return MODE_LABELS[mode].name
}
