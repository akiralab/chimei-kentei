// og/og.html をヘッドレス Chrome で 1200×630 に撮影し、public/og.png を上書きする。
//
//   npm run build:og
//
// Google Chrome は macOS の既定パスを使う。別の場所にあるときは CHROME=/path/to/chrome で上書きする。
// フォントは og.html が Google Fonts から読む（ネットワークが要る）。読み込めていなければ失敗させる。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 1200
const HEIGHT = 630
const REQUIRED_FONTS = ['Mochiy Pop One', 'Klee One', 'Shippori Mincho B1', 'Yusei Magic']

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, 'og.html')
const output = path.join(here, '..', 'public', 'og.png')
const chromeBin = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chimei-og-'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      ready = true
    } catch {
      await sleep(250)
    }
  }
  if (!ready) throw new Error(`Chrome の DevTools に接続できません（${chromeBin}）`)

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text)
    return reply.result?.result?.value
  }

  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable')
  await send('Page.navigate', { url: `file://${source}` })
  await sleep(500)
  await evaluate('document.fonts.ready.then(() => document.fonts.status)')

  const loaded = await evaluate('[...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))')
  const missing = REQUIRED_FONTS.filter((family) => !loaded.includes(family))
  if (missing.length > 0) throw new Error(`フォントが読み込めていません: ${missing.join(', ')}`)
  await sleep(300)

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  })
  fs.writeFileSync(output, Buffer.from(shot.result.data, 'base64'))
  const kb = Math.round(fs.statSync(output).size / 1024)
  console.log(`wrote ${path.relative(process.cwd(), output)} (${WIDTH}x${HEIGHT}, ${kb} KB)`)
  ws.close()
} finally {
  // プロファイルは Chrome が閉じきってから消す（書き込み中に消すと ENOTEMPTY になる）
  const exited = new Promise((resolve) => chrome.once('exit', resolve))
  chrome.kill()
  await Promise.race([exited, sleep(5000)])
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
