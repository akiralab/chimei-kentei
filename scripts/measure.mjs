// measure.mjs — 全画面 × ビューポートを巡回して撮影し、計測値を JSON に吐く。
//
//   npm run build && npm run measure
//
// 既定では自分で `vite preview` を立ち上げ、終了時に落とす。すでに配信しているものを
// 測りたいときは --base で URL を渡す。
//
//   node scripts/measure.mjs --json measure-after.json --out shots-after
//   node scripts/measure.mjs --base http://localhost:4317/chimei-kentei/
//
// 出力は 3 つ。受け入れ条件の判定はこれで機械的に行う（Issue #42「計測方法」）。
//   <json>           … 画面ごとの tapUnder44 / fontUnder16 / paper.overY / 見える行数
//   <network-json>   … 初回ロードのリクエスト数・バイト・外部ホスト（external が空であること）
//   <out>/*.png      … スクリーンショット（前後で差分を取る）
//
// ビューポートは 375×667（SE3）・390×844（15/16）・430×932（Pro Max）・1280×800（PC）と、
// ソフトキーボード出現時の近似 390×508（844 − 日本語キーボード 336）。
//
// Chrome は macOS の既定パス。別の場所にあるときは CHROME=/path/to/chrome で上書きする。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

// ---------------------------------------------------------------- 引数
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const PORT = Number(flag('port', 4317))
const CDP = Number(flag('cdp', 9444))
const OUT = path.resolve(root, flag('out', 'shots'))
const JSON_OUT = path.resolve(root, flag('json', 'measure.json'))
const NET_OUT = path.resolve(root, flag('network-json', 'network.json'))
const BASE_URL = flag('base', null)
const SKIP_NETWORK = has('no-network')
const SKIP_SHOTS = has('no-shots')

const SET_ID = 'abr20260925r2-e-13-1234' // 東京都・市区町村名・seed 1234（決定論）
const NICK = 'けんてい太郎'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MEASURE = fs.readFileSync(path.join(here, 'measure-expr.js'), 'utf8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- vite preview
let preview = null
let base = BASE_URL
if (!base) {
  preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  })
  base = `http://localhost:${PORT}/chimei-kentei/`
  let up = false
  for (let i = 0; i < 80 && !up; i++) {
    try {
      const r = await fetch(base)
      up = r.ok
    } catch {
      await sleep(250)
    }
  }
  if (!up) {
    preview.kill()
    throw new Error(`vite preview に接続できません（${base}）。先に npm run build を実行したか確認する`)
  }
}
console.log(`base: ${base}`)

// ---------------------------------------------------------------- Chrome
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chimei-measure-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
let ready = false
for (let i = 0; i < 80 && !ready; i++) {
  try {
    await fetch(`http://127.0.0.1:${CDP}/json/version`)
    ready = true
  } catch {
    await sleep(250)
  }
}
if (!ready) {
  chrome.kill()
  preview?.kill()
  throw new Error(`Chrome の DevTools に接続できません（${CHROME}）`)
}

// ---------------------------------------------------------------- 画面内で走らせる式
const CLICK = (label) => `(() => {
  const all = [...document.querySelectorAll('button, a')]
  const b = all.find((x) => !x.disabled && (x.getAttribute('aria-label') === ${JSON.stringify(label)} || x.textContent.trim() === ${JSON.stringify(label)}))
  if (!b) return 'NOT FOUND: ' + ${JSON.stringify(label)}
  b.click(); return 'ok'
})()`

const TYPE = (text) => `(() => {
  const el = document.querySelector('.answer-input') || document.querySelector('input[type=text]')
  if (!el) return 'NO INPUT'
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, ${JSON.stringify(text)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

// ---------------------------------------------------------------- CDP セッション
async function session(w, h, { blockExternal = false } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pend = new Map()
  const reqs = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
      return
    }
    if (m.method === 'Network.requestWillBeSent') {
      reqs.set(m.params.requestId, { url: m.params.request.url, type: m.params.type, bytes: 0, status: null })
    }
    if (m.method === 'Network.responseReceived') {
      const r = reqs.get(m.params.requestId)
      if (r) {
        r.status = m.params.response.status
        r.type = m.params.type
      }
    }
    if (m.method === 'Network.loadingFinished') {
      const r = reqs.get(m.params.requestId)
      if (r) r.bytes = m.params.encodedDataLength
    }
  }
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      pend.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value
  await send('Network.enable')
  if (blockExternal) {
    // 外部ホストを遮断して「同梱だけで足りているか」を見る。全遮断（offline）だと
    // ローカルの配信サーバまで止まってしまうので、審査で問題になる外部依存だけを落とす
    await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] })
  }
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: w < 700 })
  await send('Emulation.setTouchEmulationEnabled', { enabled: w < 700, maxTouchPoints: 5 })
  const go = async (hash, wait = 2600) => {
    await send('Page.navigate', { url: base + hash })
    await sleep(wait)
  }
  const shot = async (name) => {
    if (SKIP_SHOTS) return
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'))
  }
  return { send, ev, go, shot, reqs, close: () => ws.close() }
}

const results = {}
async function record(s, name, w, h) {
  const m = JSON.parse(await s.ev(MEASURE))
  results[`${name}-${w}x${h}`] = m
  await s.shot(`${name}-${w}x${h}`)
  const flag = []
  if (m.paper && m.paper.overY > 0) flag.push(`paperOverY=${m.paper.overY}`)
  if (m.docOverY > 0) flag.push(`docOverY=${m.docOverY}`)
  if (m.docOverX > 0) flag.push(`docOverX=${m.docOverX}`)
  if (m.fonts?.missing.length) flag.push(`fontMissing=${m.fonts.missing.length}`)
  console.log(`  ${name}-${w}x${h}  tap<44=${m.tapUnder44.length} font<16=${m.fontUnder16.length} ${flag.join(' ')}`)
  return m
}

// ---------------------------------------------------------------- 巡回
const VIEWPORTS = [
  [375, 667],
  [390, 844],
  [430, 932],
  [1280, 800],
]

try {
  for (const [w, h] of VIEWPORTS) {
    console.log(`\n=== ${w}x${h} ===`)
    const s = await session(w, h)

    // storage を白紙に戻してから氏名だけ入れる
    await s.go('#/', 2600)
    await s.ev(`(() => { localStorage.clear(); sessionStorage.clear(); return 'ok' })()`)
    await s.ev(`(() => { localStorage.setItem('nickname', ${JSON.stringify(NICK)}); return 'ok' })()`)

    // --- 空状態（seed 前に撮る）
    await s.go('#/review', 2000)
    await record(s, 'review-empty', w, h)
    await s.go('#/ranking', 2600)
    await record(s, 'ranking-empty', w, h)

    // --- 表紙・範囲選択
    await s.go('#/', 2600)
    await record(s, 'cover', w, h)
    await s.go('#/select', 3000)
    await record(s, 'select', w, h)

    // --- あそびかた（.board--scroll。指標は docOverY / lastButtonCut で、paper.overY は見ない）。
    //     表紙・選択の paper.overY が 0 のままであること（見出し行の「？」で縦が増えていない）も
    //     上の 2 件で確かめている
    await s.go('#/howto', 2200)
    await record(s, 'howto', w, h)

    // --- 地名帳
    await s.go('#/atlas', 2600)
    await record(s, 'atlas', w, h)
    await s.go('#/atlas/13', 3000)
    await record(s, 'atlas-13', w, h)
    await s.go('#/atlas/13/131016', 3400)
    await record(s, 'atlas-13-131016', w, h)

    // --- 挑戦状（共有リンク直接着地）
    await s.go(`#/q/${SET_ID}`, 3200)
    await record(s, 'challenge', w, h)

    // --- 出題: 未入力 → 入力中 → 不正解
    console.log('  ' + (await s.ev(CLICK('はじめる'))))
    await sleep(1400)
    await record(s, 'quiz-empty', w, h)
    await s.ev(TYPE('あいうえ'))
    await sleep(500)
    await record(s, 'quiz-typing', w, h)
    await s.ev(CLICK('解答'))
    await sleep(700)
    const wrong = await record(s, 'quiz-wrong', w, h)
    const answer = wrong.revealed

    // --- 残りをパスで埋めて結果へ
    for (let i = 0; i < 12; i++) {
      const r1 = await s.ev(CLICK('次へ'))
      if (r1 !== 'ok') {
        const r2 = await s.ev(CLICK('結果を見る'))
        if (r2 === 'ok') break
      }
      await sleep(350)
      await s.ev(CLICK('解答'))
      await sleep(600)
    }
    await sleep(2200)
    await record(s, 'result', w, h)

    // --- ランキングに登録（ローカルストア。本番 API は VITE_RANKING_API 未設定なので呼ばない）
    console.log('  register: ' + (await s.ev(CLICK('ランキングに登録'))))
    await sleep(1600)
    await record(s, 'result-registered', w, h)

    // --- 登録後の間違えた問題・ランキング
    await s.go('#/review', 2200)
    await record(s, 'review', w, h)
    await s.go('#/ranking', 2800)
    await record(s, 'ranking', w, h)
    await s.go('#/ranking/13', 2800)
    await record(s, 'ranking-13', w, h)

    // --- 出題（正解表示）。同じ setId は決定論なので第 1 問の正解を再利用する
    if (answer) {
      await s.go(`#/q/${SET_ID}`, 3200)
      await s.ev(CLICK('はじめる'))
      await sleep(1400)
      await s.ev(TYPE(answer))
      await sleep(350)
      await s.ev(CLICK('解答'))
      await sleep(260) // ○ は 1000ms で自動遷移するので急いで撮る
      await record(s, 'quiz-correct', w, h)
    } else {
      console.log('  !! 正解が取れなかったので quiz-correct を飛ばす')
    }

    // --- 旧版 setId（削除した abr20260925）の共有リンク。白画面・未捕捉例外にならないこと
    await s.go('#/q/abr20260925-e-13-1234', 3000)
    await record(s, 'legacy-set', w, h)

    s.close()
  }

  // -------------------------------------------------------------- キーボード出現時
  // iOS の日本語キーボード高さ（336px）を引いた 390x508 で入力中を撮る。
  // 時間制限 20 秒も入れて砂時計つきの状態を押さえる。
  {
    console.log(`\n=== 390x508 (keyboard) ===`)
    const s = await session(390, 508)
    await s.go('#/', 2600)
    await s.ev(
      `(() => { localStorage.clear(); localStorage.setItem('nickname', ${JSON.stringify(NICK)}); localStorage.setItem('timeLimitMs', '20000'); return 'ok' })()`,
    )
    await s.go(`#/q/${SET_ID}`, 3200)
    await record(s, 'challenge-kbd', 390, 508)
    await s.ev(CLICK('はじめる'))
    await sleep(1400)
    await record(s, 'quiz-empty-kbd', 390, 508)
    await s.ev(TYPE('あいうえ'))
    await sleep(500)
    await record(s, 'quiz-typing-kbd', 390, 508)
    s.close()
  }

  // -------------------------------------------------------------- 外部遮断（受け入れ条件 5）
  {
    console.log(`\n=== 390x844 (外部ホスト遮断) ===`)
    const s = await session(390, 844, { blockExternal: true })
    await s.go('#/', 3200)
    await record(s, 'offline-cover', 390, 844)
    await s.go(`#/q/${SET_ID}`, 3200)
    await s.ev(CLICK('はじめる'))
    await sleep(1600)
    await record(s, 'offline-quiz', 390, 844)
    s.close()
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2))
  console.log(`\nwrote ${path.relative(root, JSON_OUT)} (${Object.keys(results).length} 件)`)

  // -------------------------------------------------------------- 初回ロードのネットワーク
  if (!SKIP_NETWORK) {
    const net = {}
    for (const [name, hash, wait] of [
      ['cover', '#/', 6000],
      ['atlas-13', '#/atlas/13', 8000],
      ['quiz', `#/q/${SET_ID}`, 8000],
    ]) {
      const s = await session(390, 844)
      await s.send('Network.setCacheDisabled', { cacheDisabled: true })
      await s.go(hash, wait)
      const list = [...s.reqs.values()].filter((r) => r.url.startsWith('http'))
      const byHost = {}
      for (const r of list) {
        const host = new URL(r.url).host
        byHost[host] ??= { count: 0, bytes: 0 }
        byHost[host].count++
        byHost[host].bytes += r.bytes
      }
      const byType = {}
      for (const r of list) {
        byType[r.type] ??= { count: 0, bytes: 0 }
        byType[r.type].count++
        byType[r.type].bytes += r.bytes
      }
      net[name] = {
        requests: list.length,
        totalBytes: list.reduce((sum, r) => sum + r.bytes, 0),
        fontBytes: list.filter((r) => r.type === 'Font').reduce((sum, r) => sum + r.bytes, 0),
        byHost,
        byType,
        external: Object.keys(byHost).filter((h) => !h.startsWith('localhost') && !h.startsWith('127.0.0.1')),
        biggest: list
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 8)
          .map((r) => ({ url: r.url.replace(base, '…/'), bytes: r.bytes, type: r.type })),
      }
      console.log(`\n## ${name}: ${list.length} req / ${(net[name].totalBytes / 1024).toFixed(0)} KB（フォント ${(net[name].fontBytes / 1024).toFixed(0)} KB）`)
      for (const [h, v] of Object.entries(byHost)) console.log(`   ${h}  ${v.count} req  ${(v.bytes / 1024).toFixed(1)} KB`)
      s.close()
    }
    fs.writeFileSync(NET_OUT, JSON.stringify(net, null, 2))
    console.log(`\nwrote ${path.relative(root, NET_OUT)}`)
  }
} finally {
  const exited = new Promise((r) => chrome.once('exit', r))
  chrome.kill()
  await Promise.race([exited, sleep(5000)])
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  preview?.kill()
}
