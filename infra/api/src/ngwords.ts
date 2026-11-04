/**
 * 順位表に載せる名前のフィルタ（App Store Guideline 1.2・Issue #56）。
 *
 * 判定にだけ正規化を使い、保存する名前は従来どおり trim のみ。語リストは公開リポジトリに
 * 置く（2026-10-18 の決定。迂回されたら private 側へ移す）。誤爆は完全一致の表へ寄せて防ぐ。
 */

/** 部分一致で弾く語。短い語は普通の言葉に含まれやすいので下の完全一致の表へ */
const NG_PARTIAL = [
  // 性的な語
  'おまんこ', 'ちんぽ', 'ちんちん', 'せっくす', 'れいぷ', 'ふぇらちお', 'ぱいぱん', 'porn', 'fuck', 'pussy', 'penis',
  // 差別語・侮蔑語
  'きちがい', '基地外', '気違い', 'ちょんこ', '在日', '部落', 'nigger', 'nigga', 'bitch', 'asshole', 'faggot', 'retard',
  // 危害
  '死ね', '氏ね', '殺す', 'ころしてやる', 'しんでしまえ', 'killyou',
  // なりすまし
  '運営', '公式', '管理者', 'かんりしゃ', 'admin', 'official', 'appstore',
]

/** 名前全体がこれに一致したときだけ弾く語 */
const NG_EXACT = [
  'まんこ', 'ちんこ', 'えろ', 'ぶす', 'でぶ', 'はげ', 'ばか', 'あほ', 'かす', 'くず', 'ごみ', 'しね', 'うんこ',
  'がいじ', 'かたわ', 'めくら', 'つんぼ', 'ちょん', 'えた', 'ひにん', 'ころす', 'ふぇら', 'apple', 'sex', 'shit', 'dick', 'cock',
]

/** 連絡先に見えるもの。名前が公開されるので本人にも他人にも載せさせない */
const CONTACT_LIKE = [/https?:/i, /www\./i, /[\w.+-]+@[\w-]+\.[\w.]+/, /\d{7,}/]

/** NFKC → 英字を小文字に → カタカナをひらがなに → 文字と数字以外（記号・空白・長音）を落とす */
export function normalizeNickname(nickname: string): string {
  return nickname
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}]|ー/gu, '')
}

/** 順位表に載せられない名前なら true */
export function containsNgWord(nickname: string): boolean {
  if (CONTACT_LIKE.some((re) => re.test(nickname.normalize('NFKC')))) return true
  const normalized = normalizeNickname(nickname)
  if (NG_EXACT.includes(normalized)) return true
  return NG_PARTIAL.some((word) => normalized.includes(word))
}
