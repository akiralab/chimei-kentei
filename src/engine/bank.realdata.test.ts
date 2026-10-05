/**
 * 生成済みの問題バンク（public/questions/{DATA_VERSION}/）そのものを検査する（node 環境）。
 * フィクスチャではなく実データを読むので、data/build_questions.py の出力と
 * src/engine の契約がずれたらここで落ちる（Issue #14 の再発防止）。
 *
 * 読み込みは `import.meta.glob`（Vite 標準）。node:fs を使うと tsconfig.app の
 * `types: ["vite/client"]` に @types/node が入っていないので tsc が通らない
 * （src/geo/project.realdata.test.ts と同じ理由）。glob のパターンは静的でなければ
 * ならないので、版のディレクトリは `*` で拾って DATA_VERSION のものだけを await する。
 * 旧版のディレクトリは残してあるが、eager: false なので読み込まれない。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, allQuestions, buildQuestionSet } from './bank.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import type { BankMeta, Question } from './types.ts'

const EASY_FILES = import.meta.glob<Question[]>('../../public/questions/*/easy.json', { import: 'default' })
const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })
const DIFFICULT_FILES = import.meta.glob<Question[]>('../../public/questions/*/difficult/*.json', {
  import: 'default',
})

function load<T>(files: Record<string, () => Promise<T>>, name: string): Promise<T> {
  const hit = Object.entries(files).find(([path]) => path.includes(`/${DATA_VERSION}/`))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/${name} が無い（npm run build:questions）`)
  return hit[1]()
}

/** ルール e と同じ文字集合（々・〆 を含む漢字）。easy は 1 字でも含めば読みとして成立する */
const KANJI = /[々〆㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2ebef}]/u

/**
 * ルール h と同じ文字集合（解答欄が受け付ける文字 ＝ ひらがなと長音符）。
 * data/build_questions.py の `KANA_ANSWER` と同じ（Issue #50）
 */
const KANA_ANSWER = /^[ぁ-ゖー]+$/u

let easy: Question[]
let meta: BankMeta
let difficult: Map<string, Question[]>
let source: BankSource

/** prefCode -> easy の件数 */
function countByPref(list: Question[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const q of list) counts.set(q.prefCode, (counts.get(q.prefCode) ?? 0) + 1)
  return counts
}

beforeAll(async () => {
  easy = await load(EASY_FILES, 'easy.json')
  meta = await load(META_FILES, 'meta.json')
  difficult = new Map<string, Question[]>()
  for (const [path, loader] of Object.entries(DIFFICULT_FILES)) {
    if (!path.includes(`/${DATA_VERSION}/`)) continue
    difficult.set(path.slice(-7, -5), await loader())
  }
  if (difficult.size !== 47) throw new Error(`difficult/*.json が 47 件でない: ${String(difficult.size)}`)
  source = {
    meta: () => Promise.resolve(meta),
    easy: () => Promise.resolve(easy),
    difficult: (prefCode: string) => Promise.resolve(difficult.get(prefCode) ?? []),
  }
}, 60_000)

describe('問題バンク実データ / easy', () => {
  it('全エントリの display に漢字が 1 字以上ある（Issue #14）', () => {
    const kanaOnly = easy.filter((q) => !KANJI.test(q.display))
    expect(kanaOnly.map((q) => `${q.pref}${q.display}${q.suffix ?? ''}`)).toEqual([])
  })

  it('id が重複しない', () => {
    expect(new Set(easy.map((q) => q.id)).size).toBe(easy.length)
  })

  it('47 都道府県すべてに 1 セット分以上ある', () => {
    const counts = countByPref(easy)
    expect(counts.size).toBe(47)
    expect([...counts].filter(([, n]) => n < QUESTIONS_PER_SET)).toEqual([])
  })
})

describe('問題バンク実データ / meta', () => {
  it('dataVersion が DATA_VERSION と一致する', () => {
    expect(meta.dataVersion).toBe(DATA_VERSION)
  })

  it('prefectures の easyCount が easy.json の実数と一致する', () => {
    const counts = countByPref(easy)
    for (const p of meta.prefectures) {
      expect(p.easyCount, `${p.code} ${p.name}`).toBe(counts.get(p.code) ?? 0)
    }
  })

  it('cities は除外前の全市区町村を持つ（範囲選択と difficult の絞り込みに使う）', () => {
    expect(meta.cities.length).toBeGreaterThan(easy.length)
    const lgCodes = new Set(meta.cities.map((c) => c.lgCode))
    expect(easy.every((q) => lgCodes.has(q.lgCode))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ルール h（出題しない問・Issue #50）
// ---------------------------------------------------------------------------

/**
 * **実装前（ルール h を入れる前）のコードで実データから取った 10 問**。
 * どれも `skip` を 1 件も引いていないセットなので、**前後で同じ 10 問**でなければならない
 * （母集団から消すのではなく印を付けて飛ばすのは、これを守るため）
 */
const UNCHANGED_SETS: { mode: 'e' | 'd'; scope: string; seed: string; stars?: 1 | 2 | 3; ids: string[] }[] = [
  {
    mode: 'd',
    scope: '27',
    seed: '1234',
    ids: [
      'o:272141:山中田町',
      'o:272272:稲葉',
      'o:272027:北町',
      'o:272191:芦部町',
      'o:272027:山直中町',
      'o:271004:心斎橋筋',
      'o:271004:天下茶屋東',
      'o:272264:北條町',
      'o:271403:槇塚台',
      'o:273414:忠岡中',
    ],
  },
  {
    mode: 'd',
    scope: '12',
    seed: '5678',
    ids: [
      'o:122173:青田新田飛地',
      'o:124265:田代',
      'o:122076:大谷口新田',
      'o:122351:堀川',
      'o:122181:大森上植野入会地',
      'o:124265:力丸',
      'o:122254:外箕輪',
      'o:124109:取立',
      'o:122319:松木',
      'o:122238:金束',
    ],
  },
  {
    // 今日の 10 問の形（全国 × 市区町村名 × ★★★）
    mode: 'e',
    scope: '00',
    seed: '20261005',
    stars: 3,
    ids: [
      'c:014532:東神楽',
      'c:294276:河合',
      'c:053490:八峰',
      'c:014656:剣淵',
      'c:223417:清水',
      'c:154059:出雲崎',
      'c:103446:榛東',
      'c:363839:牟岐',
      'c:023213:鰺ヶ沢',
      'c:042030:塩竈',
    ],
  },
  {
    // skip が最も多い北海道（109 件）でも、引いていないセットは動かない
    mode: 'd',
    scope: '01',
    seed: '1111',
    ids: [
      'o:016489:上利別基線',
      'o:012025:花園町',
      'o:016314:東和',
      'o:012297:山部中町',
      'o:012025:宝来町',
      'o:012297:布部石綿',
      'o:014303:柳橋通',
      'o:016918:西春別清川町',
      'c:012092:夕張',
      'o:016934:川北',
    ],
  },
  {
    mode: 'd',
    scope: '01',
    seed: '3333',
    ids: [
      'o:012173:野幌若葉町',
      'o:012246:北斗',
      'o:012246:流通',
      'o:013994:松川',
      'o:016080:幌満',
      'o:014699:南町',
      'o:016438:相川',
      'o:012041:緑町',
      'o:016331:黒石平',
      'o:012149:声問',
    ],
  },
  {
    // skip が 2 番目に多い宮城県（80 件）
    mode: 'd',
    scope: '04',
    seed: '1234',
    ids: [
      'o:042064:上堰',
      'o:041009:穀町',
      'o:041009:古内',
      'o:042021:桃生町城内',
      'o:041009:青山',
      'o:041009:大和町',
      'o:042021:新館',
      'o:043613:逢隈榎袋',
      'o:044458:鹿原大松',
      'o:041009:金剛沢',
    ],
  },
  {
    mode: 'd',
    scope: '22',
    seed: '1234',
    ids: [
      'o:221007:渡',
      'o:223026:縄地',
      'o:222038:西沢田',
      'o:221007:堂林',
      'o:221309:千歳町',
      'o:222224:下白岩',
      'o:221007:本通西町',
      'o:221007:下野東',
      'o:222135:倉真',
      'o:223441:一色',
    ],
  },
  {
    mode: 'd',
    scope: '02',
    seed: '1234',
    ids: [
      'o:022039:南郷大字島守字黒坂',
      'o:022047:昭和町',
      'c:024431:田子',
      'o:024422:惣林橋',
      'o:024082:向屋敷',
      'o:022039:白銀',
      'o:022101:新館',
      'o:022039:妙',
      'o:023230:黒崎',
      'o:022021:八代町',
    ],
  },
  {
    // 市区町村名は 1 件も skip が無いので、科目 'e' のセットはどれも動かない
    mode: 'e',
    scope: '12',
    seed: '1234',
    ids: [
      'c:122238:鴨川',
      'c:122033:市川',
      'c:122025:銚子',
      'c:121002:千葉',
      'c:124222:睦沢',
      'c:124036:九十九里',
      'c:122360:香取',
      'c:123498:東庄',
      'c:122254:君津',
      'c:122068:木更津',
    ],
  },
]

/**
 * **実装前のコードで `skip` を引いていた** セット。skip の問が後ろの問に置き換わり、
 * **残りは前のまま**になる（正解できない問題を含んでいたセットだけが変わる）
 */
const REPLACED_SETS: { mode: 'd'; scope: string; seed: string; before: string[]; skipped: string[] }[] = [
  {
    mode: 'd',
    scope: '01',
    seed: '1234',
    before: [
      'o:013030:金沢',
      'o:012360:萩野',
      'o:016918:西春別清川町',
      'o:016322:中士幌勝和',
      'o:012050:香川町',
      'o:012238:東和田',
      'o:015750:滝之町',
      'o:012181:東文京町',
      'o:016675:久著呂原野',
      'o:016616:別保原野南二十六線', // べっぽげんやみなみ２６せん
    ],
    skipped: ['o:016616:別保原野南二十六線'],
  },
  {
    mode: 'd',
    scope: '04',
    seed: '5678',
    before: [
      'o:044458:上野目穴沢二番',
      'o:042137:金成片馬合',
      'o:044458:鹿原茨谷地',
      'o:042056:川口町',
      'o:042081:鳩原',
      'o:043419:馬渕',
      'o:043419:四反田',
      'o:044458:芋沢北平一番', // いもざわきたひら１ばん
      'o:044458:鹿原新青野二番', // かのはらしんあおの２ばん
      'o:044067:菅谷台',
    ],
    skipped: ['o:044458:芋沢北平一番', 'o:044458:鹿原新青野二番'],
  },
]

describe('問題バンク実データ / 出題しない問（ルール h・Issue #50）', () => {
  it('skip の件数が meta.skippedReadings と一致し、すべて町名（市区町村名は 0 件）', () => {
    const towns = [...difficult.values()].flat().filter((q) => q.skip !== undefined)
    expect(towns).toHaveLength(345)
    expect(towns.every((q) => q.skip === 'reading')).toBe(true)
    expect(easy.filter((q) => q.skip !== undefined)).toEqual([])
    expect(meta.skippedReadings).toBe(towns.length)
  })

  it('出題対象（skip を除く全問）の正解はすべてひらがなと「ー」だけ', () => {
    const all = [...easy, ...[...difficult.values()].flat()]
    const bad = all.filter((q) => q.skip === undefined && !KANA_ANSWER.test(q.answer))
    expect(bad.map((q) => `${q.id} = ${q.answer}`)).toEqual([])
    // 逆に skip の問は 1 件も通らない（印の付け漏れが無い）
    const missed = all.filter((q) => q.skip !== undefined && KANA_ANSWER.test(q.answer))
    expect(missed.map((q) => q.id)).toEqual([])
  })

  it('meta の件数は出題できる件数（skip を除く）', () => {
    for (const p of meta.prefectures) {
      const pool = difficult.get(p.code) ?? []
      expect(p.difficultCount, `${p.code} ${p.name}`).toBe(pool.filter((q) => q.skip === undefined).length)
    }
    const total = meta.prefectures.reduce((a, p) => a + p.difficultCount, 0)
    expect(total).toBe([...difficult.values()].flat().length - 345)
  })

  it.each(UNCHANGED_SETS)(
    'skip を含まない既存セット（$mode-$scope-$seed）は前後で同じ 10 問',
    async ({ mode, scope, seed, stars, ids }) => {
      const set = await buildQuestionSet(mode, scope, seed, source, false, stars ?? null)
      expect(set.questions.map((q) => q.id)).toEqual(ids)
      expect(set.questions.every((q) => q.skip === undefined)).toBe(true)
    },
  )

  it.each(REPLACED_SETS)(
    'skip を引いていたセット（$mode-$scope-$seed）は skip の問だけが置き換わる',
    async ({ mode, scope, seed, before, skipped }) => {
      const set = await buildQuestionSet(mode, scope, seed, source, false, null)
      const got = set.questions.map((q) => q.id)
      expect(got).toHaveLength(QUESTIONS_PER_SET)
      expect(set.questions.every((q) => q.skip === undefined)).toBe(true)
      expect(set.questions.every((q) => KANA_ANSWER.test(q.answer))).toBe(true)
      // 残った問は前と同じ並び、skip の問は 1 件も出ない
      expect(got.filter((id) => before.includes(id))).toEqual(before.filter((id) => !skipped.includes(id)))
      expect(got.filter((id) => skipped.includes(id))).toEqual([])
    },
  )

  it('北海道（skip 109 件）の町名はどの seed でも skip を出さない', async () => {
    for (let seed = 1000; seed < 1060; seed++) {
      const set = await buildQuestionSet('d', '01', String(seed), source, false, null)
      expect(set.questions, String(seed)).toHaveLength(QUESTIONS_PER_SET)
      expect(
        set.questions.filter((q) => q.skip !== undefined || !KANA_ANSWER.test(q.answer)).map((q) => q.id),
        String(seed),
      ).toEqual([])
    }
  }, 30_000)

  it('全町名は skip を出さず、件数が meta.cities[].towns と一致する（名寄市）', async () => {
    const NAYORO = '012211' // 西十一条北・東八条南 … 44 件が skip（全 77 件）
    const city = meta.cities.find((c) => c.lgCode === NAYORO)
    if (!city) throw new Error(`meta.cities に ${NAYORO} が無い`)
    const pool = (difficult.get('01') ?? []).filter((q) => q.lgCode === NAYORO)
    expect(pool.filter((q) => q.skip !== undefined)).toHaveLength(44)

    const towns = await allQuestions('d', NAYORO, source)
    expect(towns).toHaveLength(city.towns)
    expect(towns).toHaveLength(pool.length - 44)
    expect(towns.every((q) => q.skip === undefined && KANA_ANSWER.test(q.answer))).toBe(true)

    const set = await buildQuestionSet('d', NAYORO, '1234', source, true)
    expect(set.questions).toHaveLength(city.towns)
    expect(set.questions.every((q) => q.skip === undefined && KANA_ANSWER.test(q.answer))).toBe(true)
  })
})
