// build-fonts.mjs — 同梱フォント（public/fonts/*.woff2）を作り直す。
//
//   npm run build:fonts
//
// なぜ同梱するか: 以前は index.html が Google Fonts から 5 書体を読んでいて、
// 表紙の初回ロード 899KB のうち 788KB（36 リクエスト）が外部ホストだった。
// ネイティブの殻に入れると機内モードで書体が全部フォールバックし、答案用紙テーマが
// 成立しない（App Store の審査 2.5.2「アプリはバンドル内で自己完結すべき」）。
//
// 日本語の全字を入れると数 MB になるので、**このアプリに出る字だけ**を残す。
// 字種は次から集める（増やしたら必ずこのスクリプトに足す。手で woff2 を作らない）:
//   - public/questions/{DATA_VERSION}/**.json の文字列（表示名・読み・接尾辞・都道府県・市区町村）
//   - public/geo/japan.json・public/geo/municipalities.json・public/geo/pref/*.json の name
//   - src/**/*.ts(x)・src/**/*.css・index.html の全文字（UI 文言。コメントごと入れて取りこぼしを防ぐ）
//   - 数字・ASCII・約物・UI で使う記号（★○×◀▶←→／〜・など）
//
// 原本は google/fonts（いずれも SIL OFL 1.1）。ダウンロードしたものは
// scripts/.font-cache/ に残し、ライセンス全文は public/fonts/{family}/OFL.txt として配信物に同梱する。
//
// サブセットは fonttools の pyftsubset。uv があれば uvx で、無ければ pyftsubset / python3 -m fontTools を探す。
//   uv が無い環境: python3 -m pip install --user fonttools brotli
//
// 字の切り分け（@font-face の unicode-range は src/styles/fonts.css が持つ）:
//   - kana  … U+0000〜U+30FF ほか（ASCII・約物・ひらがな・カタカナ・記号）＋ UI に出る漢字
//   - kanji … 残りの漢字（地名の漢字。出題・地名帳・情報カードで初めて要る）
// 表紙は kana スライスだけで足りるので、初回ロードのフォントが軽くなる。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const cacheDir = path.join(here, '.font-cache')
const outDir = path.join(root, 'public', 'fonts')
const DATA_VERSION = 'abr20260925r2'
const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

/**
 * 同梱する 7 フェイス。dir は google/fonts の ofl/ 配下、family は CSS の font-family 名
 * （src/styles/tokens.css の --font-* と一致させる。ここを変えると全画面の書体が変わる）。
 * full: true は地名の漢字を描く書体（本文の明朝と、情報カードの自治体名を描く見出し）。
 */
const FACES = [
  { dir: 'shipporiminchob1', file: 'ShipporiMinchoB1-Regular.ttf', family: 'Shippori Mincho B1', weight: 400, slug: 'shippori-mincho-b1-400', full: true },
  { dir: 'shipporiminchob1', file: 'ShipporiMinchoB1-Bold.ttf', family: 'Shippori Mincho B1', weight: 700, slug: 'shippori-mincho-b1-700', full: true },
  { dir: 'mochiypopone', file: 'MochiyPopOne-Regular.ttf', family: 'Mochiy Pop One', weight: 400, slug: 'mochiy-pop-one-400', full: true },
  { dir: 'kleeone', file: 'KleeOne-Regular.ttf', family: 'Klee One', weight: 400, slug: 'klee-one-400', full: false },
  { dir: 'kleeone', file: 'KleeOne-SemiBold.ttf', family: 'Klee One', weight: 600, slug: 'klee-one-600', full: false },
  { dir: 'yuseimagic', file: 'YuseiMagic-Regular.ttf', family: 'Yusei Magic', weight: 400, slug: 'yusei-magic-400', full: false },
  { dir: 'delagothicone', file: 'DelaGothicOne-Regular.ttf', family: 'Dela Gothic One', weight: 400, slug: 'dela-gothic-one-400', full: false },
]

/** 書体の原本を置く google/fonts のフォルダ（OFL.txt もここから取る） */
const LICENSE_DIRS = [...new Set(FACES.map((f) => f.dir))]

// ---------------------------------------------------------------- 字種を集める
const chars = new Set()
/** UI（表紙・ボタン・見出し）に出る字。kana スライスに混ぜる */
const uiChars = new Set()

const add = (set, text) => {
  for (const ch of String(text)) set.add(ch)
}

/** JSON の中の文字列をすべて辿る */
function walkJson(value, set) {
  if (typeof value === 'string') add(set, value)
  else if (Array.isArray(value)) for (const v of value) walkJson(v, set)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) walkJson(v, set)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function listFiles(dir, test) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(p, test))
    else if (test(entry.name)) out.push(p)
  }
  return out
}

// --- 問題バンク（表示名・読み・接尾辞・都道府県名・市区町村名）
const bankDir = path.join(root, 'public', 'questions', DATA_VERSION)
for (const file of listFiles(bankDir, (n) => n.endsWith('.json'))) walkJson(readJson(file), chars)

// --- 地図（情報カードの自治体名・都道府県名）。座標は数値なので文字列だけ拾えば足りる
const geoDir = path.join(root, 'public', 'geo')
walkJson(readJson(path.join(geoDir, 'japan.json')), chars)
walkJson(readJson(path.join(geoDir, 'municipalities.json')), chars)
for (const file of listFiles(path.join(geoDir, 'pref'), (n) => n.endsWith('.json'))) {
  walkJson(readJson(file), chars)
}

// --- UI 文言。**コメントを落としてから**拾う（設計コメントの漢字まで UI 扱いにすると、
//     表紙で読む kana スライスに地名以外の漢字が数百字混ざって初回ロードが重くなる）
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
for (const file of listFiles(path.join(root, 'src'), (n) => /\.tsx?$/.test(n))) {
  add(uiChars, stripComments(fs.readFileSync(file, 'utf8')))
}
add(uiChars, fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ' '))
add(uiChars, fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'))

// --- 都道府県名は UI 扱い。かな系の書体（--font-hand）が範囲選択のグリッドや地図の
//     セルで描くので、地名の漢字スライス（明朝・見出しにしか無い）に入れると
//     「鹿児島県」だけフォールバックの明朝になってしまう
for (const pref of readJson(path.join(bankDir, 'meta.json')).prefectures) add(uiChars, pref.name)

// --- 数字・ASCII・約物・UI の記号
for (let c = 0x20; c <= 0x7e; c++) uiChars.add(String.fromCharCode(c))
add(uiChars, '　、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼〜‖｜…‥‘’“”（）〔〕［］｛｝〈〉《》「」『』【】＋－±×÷＝≠＜＞≦≧∞∴°′″℃￥＄％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓◀▶№℡⏳')
// ひらがな・カタカナは全部入れる（解答欄・読みの表示でどれでも出る）
for (let c = 0x3041; c <= 0x30ff; c++) uiChars.add(String.fromCodePoint(c))

for (const ch of uiChars) chars.add(ch)

/** 漢字（CJK 統合漢字とその拡張・互換）かどうか */
function isKanji(ch) {
  const c = ch.codePointAt(0)
  return (
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0x20000 && c <= 0x3ffff)
  )
}

const kanaSet = new Set()
const kanjiSet = new Set()
for (const ch of chars) {
  if (!isKanji(ch) || uiChars.has(ch)) kanaSet.add(ch)
  else kanjiSet.add(ch)
}

console.log(`字種: 全 ${chars.size}（kana スライス ${kanaSet.size} / kanji スライス ${kanjiSet.size}）`)

// ---------------------------------------------------------------- unicode-range
/** コードポイントの集合を U+XX-YY の並びに畳む */
function unicodeRange(set) {
  const cps = [...set].map((ch) => ch.codePointAt(0)).sort((a, b) => a - b)
  const parts = []
  let start = cps[0]
  let prev = cps[0]
  const hex = (n) => n.toString(16).toUpperCase()
  for (const cp of cps.slice(1)) {
    if (cp === prev + 1) {
      prev = cp
      continue
    }
    parts.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`)
    start = cp
    prev = cp
  }
  parts.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`)
  return parts.join(', ')
}

// ---------------------------------------------------------------- pyftsubset
/**
 * subset-font.py の起動の仕方を 1 回だけ決める。
 * fontTools が手元の python3 に入っていればそのまま、無ければ uv run で借りる。
 */
const SUBSET_PY = path.join(here, 'subset-font.py')
function resolveRunner() {
  if (spawnSync('python3', ['-c', 'import fontTools, brotli'], { stdio: 'ignore' }).status === 0) {
    return (args) => spawn('python3', [SUBSET_PY, ...args], { stdio: 'inherit' })
  }
  if (spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0) {
    return (args) => spawn('uv', ['run', '--with', 'fonttools[woff]', 'python3', SUBSET_PY, ...args], { stdio: 'inherit' })
  }
  throw new Error('fontTools が見つかりません。uv を入れる（推奨）か、python3 -m pip install --user fonttools brotli を実行する')
}
const runner = resolveRunner()

function run(args) {
  return new Promise((resolve, reject) => {
    const p = runner(args)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`サブセットに失敗しました（${code}）`))))
  })
}

// ---------------------------------------------------------------- 原本の取得
async function download(url, dest) {
  if (fs.existsSync(dest)) return
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  console.log(`  download ${url.replace(RAW + '/', '')}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`取得できません（${res.status}）: ${url}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

fs.mkdirSync(outDir, { recursive: true })
console.log('原本（google/fonts）:')
for (const face of FACES) await download(`${RAW}/${face.dir}/${face.file}`, path.join(cacheDir, face.dir, face.file))
for (const dir of LICENSE_DIRS) {
  await download(`${RAW}/${dir}/OFL.txt`, path.join(cacheDir, dir, 'OFL.txt'))
  // ライセンス全文は配信物に同梱する（OFL 1.1 の条件）
  fs.mkdirSync(path.join(outDir, dir), { recursive: true })
  fs.copyFileSync(path.join(cacheDir, dir, 'OFL.txt'), path.join(outDir, dir, 'OFL.txt'))
}

// ---------------------------------------------------------------- 切り出し
const charFile = path.join(cacheDir, 'chars')
fs.mkdirSync(cacheDir, { recursive: true })
fs.writeFileSync(path.join(charFile + '-kana.txt'), [...kanaSet].join(''))
fs.writeFileSync(path.join(charFile + '-kanji.txt'), [...kanjiSet].join(''))

const report = []
for (const face of FACES) {
  const src = path.join(cacheDir, face.dir, face.file)
  const slices = face.full ? ['kana', 'kanji'] : ['kana']
  for (const slice of slices) {
    const out = path.join(outDir, `${face.slug}-${slice}.woff2`)
    // 内部名は「<元の名> Subset」。CSS の font-family 名は変えない（tokens.css の --font-* と一致させる）
    await run([src, `${charFile}-${slice}.txt`, out, `${face.family} Subset`])
    const kb = fs.statSync(out).size / 1024
    report.push({ file: path.basename(out), slice, kb })
  }
}

report.sort((a, b) => b.kb - a.kb)
const total = report.reduce((s, r) => s + r.kb, 0)
console.log('\npublic/fonts:')
for (const r of report) console.log(`  ${r.file.padEnd(36)} ${r.kb.toFixed(1)} KB`)
console.log(`  ${'合計'.padEnd(36)} ${(total / 1024).toFixed(2)} MB`)

// ---------------------------------------------------------------- fonts.css
// unicode-range は数千のコードポイントを畳んだ長い文字列なので、手で書くと必ず腐る。
// このスクリプトが毎回まるごと書き出す（手で編集しない）。
const RANGES = { kana: unicodeRange(kanaSet), kanji: unicodeRange(kanjiSet) }
const cssPath = path.join(root, 'src', 'styles', 'fonts.css')
const blocks = FACES.flatMap((face) =>
  (face.full ? ['kanji', 'kana'] : ['kana']).map(
    (slice) => `@font-face {
  font-family: '${face.family}';
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url('/fonts/${face.slug}-${slice}.woff2') format('woff2');
  unicode-range: ${RANGES[slice]};
}`,
  ),
)
fs.writeFileSync(
  cssPath,
  `/* ==========================================================================
   fonts.css — 同梱フォントの @font-face（**自動生成。手で編集しない**）
   --------------------------------------------------------------------------
   作り直す: npm run build:fonts（scripts/build-fonts.mjs）
   woff2 は public/fonts/、ライセンス全文は public/fonts/{書体}/OFL.txt。
   いずれも SIL Open Font License 1.1 の書体を、このアプリに出る字だけに絞ったもの。

   family 名は src/styles/tokens.css の --font-* と一致させてある（変えない）。
   スライスは 2 つ:
     -kana  … ASCII・約物・かな・記号・UI に出る漢字・都道府県名（表紙はこれだけで足りる）
     -kanji … 地名の漢字（出題・地名帳・情報カードで初めて読む）
   どちらにも無い字は tokens.css のフォールバック（和文のシステムフォント）へ落ちる。
   ========================================================================== */

${blocks.join('\n\n')}
`,
)
console.log(`\nwrote ${path.relative(root, cssPath)}（@font-face ${blocks.length} 件）`)
