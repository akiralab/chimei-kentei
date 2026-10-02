import { describe, expect, it } from 'vitest'
import type { AnswerRecord, QuestionSet, ResultEntry } from './types.ts'
import { createMemoryStorage } from './ranking.ts'
import { DATA_VERSION, buildQuestionSet } from './bank.ts'
import { fixtureSource } from './__fixtures__/questions.ts'
import {
  WRONG_LIST_KEY,
  WRONG_LIST_MAX,
  appendWrongFromEntry,
  clearWrongList,
  newestFirst,
  readWrongList,
  writeWrongList,
} from './wrongList.ts'

const SET_ID = `${DATA_VERSION}-e-12-1234`

async function easySet(seed = '1234'): Promise<QuestionSet> {
  return buildQuestionSet('e', '12', seed, fixtureSource())
}

/** 先頭 correctCount 問だけ正解した答案 */
function entryFor(set: QuestionSet, correctCount: number, over: Partial<ResultEntry> = {}): ResultEntry {
  const answers: AnswerRecord[] = set.questions.map((q, i) => ({
    questionId: q.id,
    input: i < correctCount ? q.answer : 'ちがう',
    correct: i < correctCount,
    ms: 3000,
    passed: false,
  }))
  return {
    setId: set.setId,
    nickname: 'たろう',
    score: correctCount * 10,
    timeMs: 30_000,
    answers,
    clientToken: 'tok-a',
    createdAt: '2026-10-02T01:00:00.000Z',
    ...over,
  }
}

describe('appendWrongFromEntry', () => {
  it('誤答だけを記録し、正解は入れない', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    const list = appendWrongFromEntry(set, entryFor(set, 7), storage)

    expect(list).toHaveLength(3)
    expect(list.map((i) => i.questionId)).toEqual(set.questions.slice(7).map((q) => q.id))
    expect(list[0]).toMatchObject({
      display: set.questions[7].display,
      answer: set.questions[7].answer,
      input: 'ちがう',
      pref: '千葉県',
      prefCode: '12',
      setId: SET_ID,
      mode: 'e',
      at: '2026-10-02T01:00:00.000Z',
    })
    expect(readWrongList(storage)).toEqual(list)
  })

  it('パス（空欄・時間切れ）も「間違えた」として残す', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    const entry = entryFor(set, 10)
    entry.answers[0] = { questionId: set.questions[0].id, input: '', correct: false, ms: 20_000, passed: true }
    const list = appendWrongFromEntry(set, entry, storage)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ questionId: set.questions[0].id, input: '' })
  })

  it('全問正解なら何も足さない', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    expect(appendWrongFromEntry(set, entryFor(set, 10), storage)).toEqual([])
    expect(readWrongList(storage)).toEqual([])
  })

  it('同じ questionId は最新で上書きする（重複しない）', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    appendWrongFromEntry(set, entryFor(set, 9), storage)
    expect(readWrongList(storage)).toHaveLength(1)

    const again = entryFor(set, 9, { createdAt: '2026-10-03T01:00:00.000Z' })
    again.answers[9] = { ...again.answers[9], input: 'べつのこたえ' }
    const list = appendWrongFromEntry(set, again, storage)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ input: 'べつのこたえ', at: '2026-10-03T01:00:00.000Z' })
  })

  it('別のセットの誤答は足し合わさる（新しいものが末尾）', async () => {
    const storage = createMemoryStorage()
    const a = await easySet('1234')
    const b = await easySet('5678')
    appendWrongFromEntry(a, entryFor(a, 9), storage)
    const list = appendWrongFromEntry(b, entryFor(b, 9, { createdAt: '2026-10-04T00:00:00.000Z' }), storage)

    expect(list).toHaveLength(2)
    expect(list[1].setId).toBe(b.setId)
    expect(newestFirst(list)[0].setId).toBe(b.setId)
  })

  it('difficult は所属市区町村も残す', async () => {
    const storage = createMemoryStorage()
    const set = await buildQuestionSet('d', '120001', '1234', fixtureSource())
    const list = appendWrongFromEntry(set, entryFor(set, 0, { setId: set.setId }), storage)

    expect(list[0].mode).toBe('d')
    expect(list[0].city).toBeTruthy()
  })

  it('出題に無い questionId は無視する', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    const entry = entryFor(set, 10)
    entry.answers[0] = { questionId: 'c:999999:知らない', input: 'x', correct: false, ms: 1000, passed: false }
    expect(appendWrongFromEntry(set, entry, storage)).toEqual([])
  })

  it(`上限 ${WRONG_LIST_MAX} 件を超えたら古い順に捨てる`, async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    // 上限ちょうどまで埋める（questionId は全部別物）
    writeWrongList(
      Array.from({ length: WRONG_LIST_MAX }, (_, i) => ({
        questionId: `c:000000:古い${i}`,
        display: `古い${i}`,
        answer: 'ふるい',
        input: '',
        pref: '北海道',
        prefCode: '01',
        setId: `${DATA_VERSION}-e-01-0000`,
        mode: 'e' as const,
        at: '2026-01-01T00:00:00.000Z',
      })),
      storage,
    )

    const list = appendWrongFromEntry(set, entryFor(set, 7), storage)
    expect(list).toHaveLength(WRONG_LIST_MAX)
    // 最新 3 件が末尾に入り、先頭の古い 3 件が落ちる
    expect(list.slice(-3).map((i) => i.questionId)).toEqual(set.questions.slice(7).map((q) => q.id))
    expect(list[0].questionId).toBe('c:000000:古い3')
  })
})

describe('readWrongList / clearWrongList', () => {
  it('未保存は空配列', () => {
    expect(readWrongList(createMemoryStorage())).toEqual([])
  })

  it('壊れた JSON・配列でない値・形の違う要素は捨てる', () => {
    expect(readWrongList(createMemoryStorage({ [WRONG_LIST_KEY]: '{' }))).toEqual([])
    expect(readWrongList(createMemoryStorage({ [WRONG_LIST_KEY]: '{"a":1}' }))).toEqual([])
    expect(readWrongList(createMemoryStorage({ [WRONG_LIST_KEY]: '[{"questionId":"x"},null,3]' }))).toEqual([])
  })

  it('clearWrongList で空になる', async () => {
    const storage = createMemoryStorage()
    const set = await easySet()
    appendWrongFromEntry(set, entryFor(set, 0), storage)
    expect(readWrongList(storage)).toHaveLength(10)

    clearWrongList(storage)
    expect(readWrongList(storage)).toEqual([])
  })
})
