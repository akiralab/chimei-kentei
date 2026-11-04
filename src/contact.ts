/**
 * 問い合わせ先（App Store Guideline 1.2・1.5。Issue #57）。公開されるので専用のアドレスにする。
 * public/privacy.html と public/support.html にも同じものを書く（contact.test.ts が揃っているか見る）。
 * example.com のままでは提出用のタグをビルドできない（.github/workflows/ios.yml）。
 */
export const CONTACT_EMAIL = 'chimei-kentei@example.com'

/** 順位表の行を報告するメール。行を特定できるように setId と entryId を本文に入れる */
export function reportMailto(row: { nickname: string; setId: string; entryId: string }): string {
  const subject = '【地名読み検定】順位表の名前の報告'
  const body = [
    '次の名前を報告します。',
    `名前: ${row.nickname}`,
    `問題: ${row.setId}`,
    `登録番号: ${row.entryId}`,
    '',
    '理由（任意）:',
  ].join('\n')
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
