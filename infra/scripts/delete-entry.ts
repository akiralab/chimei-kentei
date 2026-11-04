/**
 * 順位表の行を探して消す（App Store Guideline 1.2 の通報対応・Issue #56）。
 * 本番のテーブルを手元の AWS 認証情報で直接触る。Node 24 ならそのまま動く。
 *
 *   node infra/scripts/delete-entry.ts --find テスト       # 名前で探す（書き込まない）
 *   node infra/scripts/delete-entry.ts <setId> <entryId>   # 消すものを表示するだけ
 *   node infra/scripts/delete-entry.ts <setId> <entryId> --yes
 *
 * 1 行は 3 か所にある（set# の本体・pref# の写し・token# の予約）。全部消すので、
 * 同じ端末は同じ問題にもう一度登録できる。件数のカウンタも減らし、その端末が都道府県に
 * 残す行が無くなったら人数の印とカウンタも減らす（infra/API.md「保存の形」）。
 * PITR のバックアップには最大 35 日残る。
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

export interface Item {
  pk: string
  sk: string
  [key: string]: unknown
}

/** テストでメモリ実装に差し替えられるように DynamoDB をポートにする */
export interface AdminDb {
  /** pk が一致し sk が prefix で始まるアイテム */
  query(pk: string, skPrefix: string): Promise<Item[]>
  /** テーブル全体から条件に合うアイテム（行数が小さい前提の管理用途） */
  scan(match: (item: Item) => boolean): Promise<Item[]>
  remove(pk: string, sk: string): Promise<void>
  /** stats#pref のカウンタを 1 減らす。0 より下には行かない */
  decrement(sk: string, field: 'entries' | 'players'): Promise<void>
}

/** setId の末尾から都道府県と順位表の区分を読む（`abr…-e-01c-7460-all-s3`） */
export function regionOfSetId(setId: string): { prefCode: string; mode: string } | null {
  const m = /^[^-]+-([ed])-([0-9a-z]+)-[^-]+(-all)?(?:-s[1-3])?$/.exec(setId)
  if (!m) return null
  return { prefCode: m[2].slice(0, 2), mode: m[3] ? 'all' : m[1] }
}

export interface Plan {
  entry: Item
  token: string | null
  prefCode: string
  mode: string
  /** 消すキー（本体・写し・予約・人数の印） */
  removals: { pk: string; sk: string }[]
  /** 減らすカウンタ */
  decrements: { sk: string; field: 'entries' | 'players' }[]
}

/** 何を消すかを決める。書き込みはしない。見つからなければ null */
export async function planDeletion(db: AdminDb, setId: string, entryId: string): Promise<Plan | null> {
  const region = regionOfSetId(setId)
  if (!region) throw new Error(`setId が読めません: ${setId}`)
  const { prefCode, mode } = region
  const pk = `set#${setId}`
  const rows = await db.query(pk, '')
  const entry = rows.find((i) => i.sk.startsWith('entry#') && i.entryId === entryId)
  if (!entry) return null

  const reservation = rows.find((i) => i.sk.startsWith('token#') && i.entryId === entryId)
  const removals = [
    { pk, sk: entry.sk },
    { pk: `pref#${prefCode}`, sk: entry.sk },
  ]
  const decrements: Plan['decrements'] = [
    { sk: prefCode, field: 'entries' },
    { sk: `${prefCode}#${mode}`, field: 'entries' },
  ]
  if (!reservation) return { entry, token: null, prefCode, mode, removals, decrements }

  removals.push({ pk, sk: reservation.sk })
  const token = reservation.sk.slice('token#'.length)
  // 同じ端末が同じ都道府県に残す行が無いときだけ人数を減らす
  const others = (await db.scan((i) => i.sk === reservation.sk && i.pk !== pk))
    .map((i) => regionOfSetId(i.pk.slice('set#'.length)))
    .filter((r) => r?.prefCode === prefCode)
  const markers = await db.query(`pref#${prefCode}`, 'player#')
  const dropMarker = (sk: string, statSk: string) => {
    if (!markers.some((m) => m.sk === sk)) return
    removals.push({ pk: `pref#${prefCode}`, sk })
    decrements.push({ sk: statSk, field: 'players' })
  }
  if (others.length === 0) dropMarker(`player#${token}`, prefCode)
  if (!others.some((r) => r?.mode === mode)) dropMarker(`player#${mode}#${token}`, `${prefCode}#${mode}`)
  return { entry, token, prefCode, mode, removals, decrements }
}

export async function applyPlan(db: AdminDb, plan: Plan): Promise<void> {
  for (const key of plan.removals) await db.remove(key.pk, key.sk)
  for (const d of plan.decrements) await db.decrement(d.sk, d.field)
}

function dynamoDb(table: string, region: string): AdminDb {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
  return {
    async query(pk, skPrefix) {
      const out: Item[] = []
      let start: Record<string, unknown> | undefined
      do {
        const res = await doc.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix },
            ExclusiveStartKey: start,
          }),
        )
        out.push(...((res.Items ?? []) as Item[]))
        start = res.LastEvaluatedKey
      } while (start)
      return out
    },
    async scan(match) {
      const out: Item[] = []
      let start: Record<string, unknown> | undefined
      do {
        const res = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }))
        out.push(...((res.Items ?? []) as Item[]).filter(match))
        start = res.LastEvaluatedKey
      } while (start)
      return out
    },
    async remove(pk, sk) {
      await doc.send(new DeleteCommand({ TableName: table, Key: { pk, sk } }))
    },
    async decrement(sk, field) {
      try {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: 'stats#pref', sk },
            UpdateExpression: 'ADD #f :minus',
            ConditionExpression: '#f > :zero',
            ExpressionAttributeNames: { '#f': field },
            ExpressionAttributeValues: { ':minus': -1, ':zero': 0 },
          }),
        )
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException)) throw e
      }
    },
  }
}

function tableName(region: string): string {
  if (process.env.TABLE_NAME) return process.env.TABLE_NAME
  const stack = process.env.STACK_NAME ?? 'chimei-kentei'
  return execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stack,
      '--region',
      region,
      '--query',
      "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue",
      '--output',
      'text',
    ],
    { encoding: 'utf8' },
  ).trim()
}

async function main(argv: string[]): Promise<void> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1'
  const db = dynamoDb(tableName(region), region)

  if (argv[0] === '--find') {
    const name = argv[1] ?? ''
    if (name === '') throw new Error('--find には名前を渡してください')
    const rows = await db.scan(
      (i) => i.pk.startsWith('set#') && i.sk.startsWith('entry#') && String(i.nickname).includes(name),
    )
    for (const r of rows) console.log(`${String(r.setId)} ${String(r.entryId)} ${String(r.nickname)} ${String(r.score)}点 ${String(r.createdAt)}`)
    console.log(`${rows.length} 件`)
    return
  }

  const [setId, entryId] = argv
  if (!setId || !entryId) throw new Error('使い方: delete-entry.ts <setId> <entryId> [--yes] / --find <名前>')
  const plan = await planDeletion(db, setId, entryId)
  if (!plan) {
    console.log('見つかりませんでした。')
    return
  }
  console.log(`対象: ${String(plan.entry.nickname)} ${String(plan.entry.score)}点 ${String(plan.entry.createdAt)}`)
  for (const k of plan.removals) console.log(`  消す ${k.pk} | ${k.sk}`)
  for (const d of plan.decrements) console.log(`  減らす stats#pref | ${d.sk} の ${d.field}`)
  if (!argv.includes('--yes')) {
    console.log('--yes を付けると実行します。')
    return
  }
  await applyPlan(db, plan)
  console.log('消しました。')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
