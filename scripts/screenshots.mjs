// screenshots.mjs — App Store 用のスクリーンショット 5 枚（6.9 インチ・1290×2796）を撮る。
//
//   npm run screenshots          # shots-store/ に PNG を出す
//
// 順位表は本番の登録を映さない。小さな偽の API をここで立てて、その URL を埋めてビルドする
// （Issue #57 の決定。出すのは見本の名前だけ）。Chrome は measure.mjs と同じく macOS の既定パス。
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'shots-store')
const OUT_DIST = path.join(os.tmpdir(), `chimei-store-${process.pid}`)
const API_PORT = 4398
const WEB_PORT = 4399
const CDP_PORT = 9498
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SET_ID = 'abr20260925r2-e-00-20261105-s3' // 全国 × 市区町村名 × ★★★（決定論）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- 見本の順位表
const SAMPLE = [
  ['ちずずき', 100, 95_000],
  ['はなまる', 90, 128_000],
  ['旅するカメ', 80, 101_000],
  ['ことのは', 80, 164_000],
  ['みなと町', 70, 140_000],
  ['よみびと', 60, 171_000],
].map(([nickname, score, timeMs], i) => ({
  entryId: `sample-${i}`,
  setId: SET_ID,
  nickname,
  score,
  correct: score / 10,
  total: 10,
  timeMs,
  createdAt: '2026-11-05T01:00:00.000Z',
  mode: 'e',
  scope: '00',
  timeLimitMs: 0,
}))

const api = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('content-type', 'application/json')
  if (req.url.startsWith('/stats/prefectures')) {
    const count = { entries: SAMPLE.length, players: SAMPLE.length }
    const byMode = { e: count, d: { entries: 0, players: 0 }, all: { entries: 0, players: 0 } }
    res.end(JSON.stringify({ prefectures: [{ prefCode: '00', ...count, byMode }] }))
    return
  }
  res.end(JSON.stringify({ entries: SAMPLE }))
})
api.listen(API_PORT)

// ---------------------------------------------------------------- ビルドと配信
execFileSync('npx', ['vite', 'build', '--outDir', OUT_DIST, '--emptyOutDir'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, VITE_RANKING_API: `http://localhost:${API_PORT}` },
})
const preview = spawn('npx', ['vite', 'preview', '--outDir', OUT_DIST, '--port', String(WEB_PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
})
const base = `http://localhost:${WEB_PORT}/chimei-kentei/`
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break
  } catch {
    await sleep(250)
  }
}

// ---------------------------------------------------------------- Chrome
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chimei-store-chrome-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
)
for (let i = 0; i < 80; i++) {
  try {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    break
  } catch {
    await sleep(250)
  }
}
const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl
const ws = new WebSocket(page)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    pending.set(++id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value
const click = (name) =>
  ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(name)})); b.click(); return 'ok' })()`)
const type = (text) =>
  ev(`(() => { const i = document.querySelector('.answer-input input, input.answer-input'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`)
const go = async (hash, wait = 2500) => {
  await ev(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(wait)
}

fs.mkdirSync(OUT, { recursive: true })
let shotNo = 0
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(OUT, `${++shotNo}-${name}.png`)
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'))
  console.log(file)
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.navigate', { url: base })
  await sleep(2500)
  await ev(`localStorage.setItem('nickname', 'ちずずき')`)

  // ① 出題（アプリの中から入るので挑戦状は挟まない）
  await go(`#/q/${SET_ID}`, 3000)
  await type('あばし') // この seed の第 1 問は網走。打っている途中の形で撮る
  await sleep(400)
  await shot('quiz')

  // ② 解答後の ○× と正解 ③ 地図と情報のシート
  await click('解答')
  await sleep(800)
  await shot('answer')
  await click('地図と情報')
  await sleep(1500)
  await shot('map-sheet')
  await click('問題へ')
  await sleep(400)

  // ④ 順位表（見本） ⑤ 地名帳
  await go('#/ranking/00', 2500)
  await shot('ranking')
  await go('#/atlas/13/131016', 3500)
  await shot('atlas')
} finally {
  ws.close()
  chrome.kill()
  preview.kill()
  api.close()
  fs.rmSync(OUT_DIST, { recursive: true, force: true })
}
