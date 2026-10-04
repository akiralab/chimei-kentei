/**
 * 「地名 ｜ よみ」の 2 列の表（地名帳）。
 *
 * **meta にも scope にも依存しない純粋な表示部品**にしてある。段階 2 で市区町村の下に
 * 町名の一覧をぶら下げるとき、町名（地図も統計も無く、リンクにならない行）を
 * 同じ形で並べられるようにするため（設計 §12.7）。
 *
 * 行は `href` があればリンク、無ければただの行になる。選択中は
 * `aria-current="true"`（読み上げ）＋ 蛍光黄の背景 ＋ 赤ペンの「▶」の 3 つで示す
 * （色だけに頼らない）。
 */
import type { Stars } from '../engine/types.ts'
import { starsAria, starsMark } from '../engine/stars.ts'

export interface AtlasRow {
  /** React の key。市区町村なら lgCode */
  key: string
  /** 表示名（接尾辞つき。「板橋区」） */
  name: string
  /** よみ（接尾辞つき。「いたばしく」） */
  kana: string
  /** 行のリンク先。無い行は選べない（段階 2 の町名） */
  href?: string
  selected?: boolean
  /** 難易度 ★1〜3。問題バンク（easy.json）に無い市区町村と、★ を持たない町名では undefined */
  stars?: Stars
}

interface Props {
  rows: AtlasRow[]
  /** 読み上げ用の一覧名（「東京都・23区の市区町村」） */
  label?: string
}

/** 1 行の中身。リンクでも素の行でも同じ 3 列を描く */
function Cells({ row }: { row: AtlasRow }) {
  return (
    <>
      {/* 選択中の目印。列幅は常に確保して、選んでも名前の位置がずれないようにする */}
      <span className="atlas__mark" aria-hidden="true">
        {row.selected ? '▶' : ''}
      </span>
      <span className="atlas__name">{row.name}</span>
      <span className="atlas__kana">{row.kana}</span>
      {/* ★ の列は中身が無くても置く（行ごとに幅が変わると、よみの右端が揃わない）。
          リンクの中なので記号は読み上げから外し、言い換えだけを添える（CONTRACT.md）*/}
      <span className="atlas__stars">
        {row.stars !== undefined && (
          <>
            <span className="stars" aria-hidden="true">
              {starsMark(row.stars)}
            </span>
            <span className="sr-only">{starsAria(row.stars)}</span>
          </>
        )}
      </span>
    </>
  )
}

export default function AtlasList({ rows, label }: Props) {
  return (
    <ol className="atlas" aria-label={label}>
      {rows.map((row) => (
        <li className={row.selected ? 'atlas__row is-selected' : 'atlas__row'} key={row.key}>
          {row.href === undefined ?
            <span className="atlas__cells">
              <Cells row={row} />
            </span>
          : <a href={row.href} aria-current={row.selected ? 'true' : undefined}>
              <Cells row={row} />
            </a>
          }
        </li>
      ))}
    </ol>
  )
}
