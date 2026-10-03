/**
 * 都道府県の中の「地域」の定義（北海道 4・東京都 3）。**ここが唯一の情報源**で、
 * エンジン（scope の検証・母集団の絞り込み）・画面・テストはすべてこれを参照する。
 *
 * 北海道（179 市町村）と東京都（62 市区町村）は地名が多く、都道府県まるごとだと
 * 10 問の範囲として大きすぎる。そこで scope に 3 文字の形式 `\d{2}[a-z]` を足し、
 * 都道府県と同じ扱い（母集団を広げない）で出題できるようにした（Issue #34）。
 *
 * 判定は **団体コード（lgCode）だけ**で行い、市区町村名には頼らない（名前は変わり得る）。
 *  - 北海道の市（35）は振興局が連番にならないので **コードの明示リスト**
 *  - 北海道の町村は振興局ごとに団体コードが連番なので **先頭 5 桁の範囲**
 *  - 東京都は 23 区・多摩・島しょがそれぞれ連番なので **先頭 5 桁の範囲**
 *
 * 件数（`public/questions/abr20260925r2/meta.json` で検証。subregions.test.ts が固定する）:
 *   道央 70 ／ 道南 18 ／ 道北 41 ／ 道東 50 ／ 23区 23 ／ 多摩 30 ／ 島しょ 9
 */

export interface Subregion {
  /** scope にそのまま入る 3 文字（都道府県コード 2 桁 ＋ 地域の 1 文字） */
  id: string
  /** 親の都道府県コード（2 桁） */
  prefCode: string
  /** 表示名（例 '道央'・'23区'）。範囲の表示は「北海道・道央」のように親と連ねる */
  name: string
}

/** 表示順もこの配列順（選択画面の切替・テストの期待値） */
export const SUBREGIONS: Subregion[] = [
  { id: '01c', prefCode: '01', name: '道央' },
  { id: '01s', prefCode: '01', name: '道南' },
  { id: '01n', prefCode: '01', name: '道北' },
  { id: '01e', prefCode: '01', name: '道東' },
  { id: '13k', prefCode: '13', name: '23区' },
  { id: '13t', prefCode: '13', name: '多摩' },
  { id: '13i', prefCode: '13', name: '島しょ' },
]

/**
 * 「地域を分けずに都道府県まるごと」を指す選択肢の名前。都道府県ごとに言い方が違う
 * （北海道は「全道」、東京都は「全域」）ので、ここで持つ。地域を持たない県は undefined
 */
const WHOLE_PREF_LABEL: Record<string, string> = { '01': '全道', '13': '全域' }

/** 都道府県まるごとの選択肢名。地域を分けない都道府県なら undefined */
export function wholePrefLabel(prefCode: string): string | undefined {
  return WHOLE_PREF_LABEL[prefCode]
}

/**
 * 北海道の振興局 → 町村の団体コード（先頭 5 桁）の連番範囲 [最小, 最大]（両端を含む）。
 * 市（35）はここに入らない（連番にならないので下の CITY_SUBREGION で明示する）
 */
const HOKKAIDO_BUREAU_RANGE: Record<string, [number, number]> = {
  石狩: [1303, 1304],
  渡島: [1331, 1347],
  檜山: [1361, 1371],
  後志: [1391, 1409],
  空知: [1423, 1438],
  上川: [1452, 1472],
  留萌: [1481, 1487],
  宗谷: [1511, 1520],
  オホーツク: [1543, 1564],
  胆振: [1571, 1586],
  日高: [1601, 1610],
  十勝: [1631, 1649],
  釧路: [1661, 1668],
  根室: [1691, 1694],
}

/** 道庁の 4 区分（道央・道南・道北・道東）が束ねる振興局 */
const HOKKAIDO_SUBREGION_BUREAUS: Record<string, string[]> = {
  '01c': ['石狩', '空知', '後志', '胆振', '日高'],
  '01s': ['渡島', '檜山'],
  '01n': ['上川', '留萌', '宗谷'],
  '01e': ['オホーツク', '十勝', '釧路', '根室'],
}

/** 町村の先頭 5 桁 → 地域 ID。振興局の範囲を展開して作る */
const HOKKAIDO_TOWN_RANGES: { from: number; to: number; id: string }[] = Object.entries(HOKKAIDO_SUBREGION_BUREAUS)
  .flatMap(([id, bureaus]) =>
    bureaus.map((bureau) => {
      const span = HOKKAIDO_BUREAU_RANGE[bureau]
      if (!span) throw new Error(`振興局の範囲が未定義です: ${bureau}`)
      return { from: span[0], to: span[1], id }
    }),
  )
  .sort((a, b) => a.from - b.from)

/**
 * 北海道の市（35）の団体コード → 地域 ID。
 * 市は振興局の連番に乗らないので全件を明示する（コメントは名前・振興局）
 */
const HOKKAIDO_CITY_SUBREGION: Record<string, string> = {
  '011002': '01c', // 札幌市（石狩）
  '012025': '01s', // 函館市（渡島）
  '012033': '01c', // 小樽市（後志）
  '012041': '01n', // 旭川市（上川）
  '012050': '01c', // 室蘭市（胆振）
  '012068': '01e', // 釧路市（釧路）
  '012076': '01e', // 帯広市（十勝）
  '012084': '01e', // 北見市（オホーツク）
  '012092': '01c', // 夕張市（空知）
  '012106': '01c', // 岩見沢市（空知）
  '012114': '01e', // 網走市（オホーツク）
  '012122': '01n', // 留萌市（留萌）
  '012131': '01c', // 苫小牧市（胆振）
  '012149': '01n', // 稚内市（宗谷）
  '012157': '01c', // 美唄市（空知）
  '012165': '01c', // 芦別市（空知）
  '012173': '01c', // 江別市（石狩）
  '012181': '01c', // 赤平市（空知）
  '012190': '01e', // 紋別市（オホーツク）
  '012203': '01n', // 士別市（上川）
  '012211': '01n', // 名寄市（上川）
  '012220': '01c', // 三笠市（空知）
  '012238': '01e', // 根室市（根室）
  '012246': '01c', // 千歳市（石狩）
  '012254': '01c', // 滝川市（空知）
  '012262': '01c', // 砂川市（空知）
  '012271': '01c', // 歌志内市（空知）
  '012289': '01c', // 深川市（空知）
  '012297': '01n', // 富良野市（上川）
  '012301': '01c', // 登別市（胆振）
  '012319': '01c', // 恵庭市（石狩）
  '012335': '01c', // 伊達市（胆振）
  '012343': '01c', // 北広島市（石狩）
  '012351': '01c', // 石狩市（石狩）
  '012360': '01s', // 北斗市（渡島）
}

/**
 * 東京都の先頭 5 桁の範囲 → 地域 ID。
 *  23区 13101〜13123 ／ 多摩 13201〜13229（26 市）と 13303〜13308（西多摩郡 4 町村）
 *  島しょ 13361 以降（大島・三宅・八丈・小笠原の各支庁）
 */
const TOKYO_RANGES: { from: number; to: number; id: string }[] = [
  { from: 13101, to: 13123, id: '13k' },
  { from: 13201, to: 13229, id: '13t' },
  { from: 13303, to: 13308, id: '13t' },
  { from: 13361, to: 13999, id: '13i' },
]

const BY_ID = new Map(SUBREGIONS.map((s) => [s.id, s]))

function inRanges(head5: number, ranges: { from: number; to: number; id: string }[]): string | undefined {
  return ranges.find((r) => head5 >= r.from && head5 <= r.to)?.id
}

/**
 * 市区町村コード（6 桁）が属する地域。北海道・東京都以外、または範囲外なら undefined。
 * 北海道は市を明示リスト、町村を振興局の連番で判定する
 */
export function subregionOf(lgCode: string): Subregion | undefined {
  if (lgCode.length !== 6) return undefined
  const prefCode = lgCode.slice(0, 2)
  if (prefCode !== '01' && prefCode !== '13') return undefined
  const head5 = Number(lgCode.slice(0, 5))
  if (!Number.isFinite(head5)) return undefined
  const id =
    prefCode === '01' ? (HOKKAIDO_CITY_SUBREGION[lgCode] ?? inRanges(head5, HOKKAIDO_TOWN_RANGES)) : inRanges(head5, TOKYO_RANGES)
  return id === undefined ? undefined : BY_ID.get(id)
}

/** その都道府県の地域（表示順）。地域を分けない都道府県なら空配列 */
export function subregionsOf(prefCode: string): Subregion[] {
  return SUBREGIONS.filter((s) => s.prefCode === prefCode)
}

export function subregionById(id: string): Subregion | undefined {
  return BY_ID.get(id)
}

/** scope が実在する地域の 3 文字か（'01z' のような綴りは false） */
export function isSubregionScope(scope: string): boolean {
  return BY_ID.has(scope)
}
