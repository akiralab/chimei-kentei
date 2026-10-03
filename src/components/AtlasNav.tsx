/**
 * 地名帳の移動（一覧へ戻る・隣の行へめくる・いま何件目か）。
 *
 * 1280 では地図とカードの下、375 では詳細画面の底に置く。単語帳をめくる感覚にしたいので
 * 「前／次」は隣の行の URL を指す **リンク**にする（戻る履歴も自然に残る）。
 * 端（最初・最後）ではリンクにせず、位置だけ残して押せない見た目にする。
 */

export interface AtlasNavTarget {
  href: string
  name: string
}

interface Props {
  /**
   * 「← 一覧へ」の行き先（`#/atlas/{scope}`）。
   * 900px 以上は一覧が隣に出ているので渡さない（戻る先が今の画面になってしまう）
   */
  listHref?: string
  prev?: AtlasNavTarget
  next?: AtlasNavTarget
  /** 1 始まりの位置。行を選んでいなければ省く */
  index?: number
  /** 表示中の行数（検索で絞っていればその数） */
  total: number
}

function Step({ target, dir }: { target: AtlasNavTarget | undefined; dir: 'prev' | 'next' }) {
  const arrow = dir === 'prev' ? '◀' : '▶'
  const word = dir === 'prev' ? '前' : '次'
  if (!target) {
    return (
      <span className="btn btn--ghost atlas-nav__step atlas-nav__step--end" aria-disabled="true">
        <span aria-hidden="true">{dir === 'prev' ? `${arrow} ${word}` : `${word} ${arrow}`}</span>
      </span>
    )
  }
  return (
    <a className="btn btn--ghost atlas-nav__step" href={target.href} aria-label={`${word}: ${target.name}`}>
      {dir === 'prev' ?
        <>
          <span aria-hidden="true">{arrow} </span>
          {word} <span className="atlas-nav__name">{target.name}</span>
        </>
      : <>
          {word} <span className="atlas-nav__name">{target.name}</span>
          <span aria-hidden="true"> {arrow}</span>
        </>
      }
    </a>
  )
}

export default function AtlasNav({ listHref, prev, next, index, total }: Props) {
  return (
    <nav className="atlas-nav" aria-label="地名帳の移動">
      {listHref !== undefined && (
        <a className="btn btn--ghost atlas-nav__back" href={listHref}>
          <span aria-hidden="true">← </span>一覧へ
        </a>
      )}
      <Step target={prev} dir="prev" />
      <Step target={next} dir="next" />
      {index !== undefined && (
        <span className="atlas-nav__count">
          {index} / {total}
        </span>
      )}
    </nav>
  )
}
