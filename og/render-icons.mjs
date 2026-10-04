// og/icon.html をヘッドレス Chrome で 1024×1024 に撮り、public/ のアプリアイコン一式を作り直す。
//
//   npm run build:icons
//
// 出力（すべて public/ 直下・コミット対象）
//   icon-1024.png         … App Store 提出用の原版
//   icon-512.png          … manifest の 512
//   icon-512-maskable.png … manifest の maskable（中身を 80% に縮めて安全圏に収めたもの）
//   icon-192.png          … manifest の 192
//   apple-touch-icon.png  … iOS のホーム画面（180）
//
// 縮小は macOS 標準の sips を使う（追加の依存を入れないため）。
// Google Chrome は macOS の既定パス。別の場所にあるときは CHROME=/path/to/chrome で上書きする。
// icon.html は文字を使わないので、og/render.mjs と違ってフォントの読み込みは要らない。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, 'icon.html')
const outDir = path.join(here, '..', 'public')
const chromeBin = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9800 + Math.floor(Math.random() * 180)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chimei-icon-'))

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
    `--window-size=${SIZE},${SIZE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

/** sips で正方形に縮小する（拡大はしない。原版 1024 からの一方通行） */
function shrink(from, to, size) {
  const r = spawnSync('sips', ['-z', String(size), String(size), from, '--out', to], { stdio: 'ignore' })
  if (r.status !== 0) throw new Error(`sips に失敗しました: ${path.basename(to)}`)
  console.log(`wrote public/${path.basename(to)} (${size}x${size})`)
}

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
  const shoot = async (file) => {
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 },
    })
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  }

  await send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable')
  await send('Page.navigate', { url: `file://${source}` })
  await sleep(600)

  // --- 通常版
  const base = path.join(outDir, 'icon-1024.png')
  await shoot(base)
  console.log(`wrote public/icon-1024.png (${SIZE}x${SIZE})`)
  shrink(base, path.join(outDir, 'icon-512.png'), 512)
  shrink(base, path.join(outDir, 'icon-192.png'), 192)
  shrink(base, path.join(outDir, 'apple-touch-icon.png'), 180)

  // --- maskable 版（中身だけ 80% に縮める。地の黒板は端まで残す）
  await evaluate(`document.documentElement.style.setProperty('--scale', '0.8'); 'ok'`)
  await sleep(300)
  const masked = path.join(outDir, 'icon-1024-maskable.png')
  await shoot(masked)
  shrink(masked, path.join(outDir, 'icon-512-maskable.png'), 512)
  fs.rmSync(masked)

  ws.close()
} finally {
  // プロファイルは Chrome が閉じきってから消す（書き込み中に消すと ENOTEMPTY になる）
  const exited = new Promise((resolve) => chrome.once('exit', resolve))
  chrome.kill()
  await Promise.race([exited, sleep(5000)])
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
