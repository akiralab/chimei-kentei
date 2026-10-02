/**
 * 自治体情報カードの数値整形。
 * toLocaleString は実行環境の ICU に左右されるので使わず、自前で 3 桁区切りにする。
 */

/** 3 桁区切り。fractionDigits を渡すと小数部をその桁に丸めて添える（面積の 2 桁など） */
export function groupDigits(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const fixed = Math.abs(value).toFixed(fractionDigits)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`
}
