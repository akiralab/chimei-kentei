// measure-expr.js — ページ内で走る計測式（scripts/measure.mjs が読み込んで Runtime.evaluate に渡す）
//
// 返す JSON のキーと受け入れ条件の対応は README「計測」節と Issue #42 を参照。
//   tapUnder44 … 44x44px 未満の操作要素（受け入れ条件 1）
//   fontUnder16 … 16px 未満のテキスト要素。13px 未満が無いことを見る（受け入れ条件 2）
//   paper.overY … .paper の縦はみ出し（受け入れ条件 6）
//   fonts … 読み込めた書体（受け入れ条件 5）
(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
    const r = el.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) return false
    if (r.bottom <= 0 || r.top >= innerHeight) return false
    return true
  }
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
    return s
  }
  const paper = document.querySelector('.paper')
  const over = (el) => (el ? el.scrollHeight - el.clientHeight : null)

  // --- タップ領域 44x44 未満
  const hit = []
  for (const el of document.querySelectorAll('a, button, input, select, [role=button]')) {
    if (el.closest('.sr-only')) continue
    if (!vis(el)) continue
    const r = el.getBoundingClientRect()
    const w = Math.round(r.width), h = Math.round(r.height)
    if (w < 44 || h < 44) hit.push({ sel: sel(el), text: label(el), w, h, disabled: !!el.disabled })
  }

  // --- font-size 16px 未満（自分の直下にテキストを持つ要素だけ）
  const small = []
  for (const el of document.querySelectorAll('*')) {
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) continue
    let own = ''
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent
    if (!own.trim()) continue
    if (!vis(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 16) small.push({ sel: sel(el), px: Math.round(fs * 100) / 100, text: own.trim().replace(/\s+/g, ' ').slice(0, 24) })
  }

  // --- ボタン階層
  const btns = [...document.querySelectorAll('.btn, .pref-grid__item, .mode-switch__item')].filter(vis)
  const kind = (b) =>
    b.classList.contains('btn--primary') ? 'primary'
    : b.classList.contains('btn--ghost') ? 'ghost'
    : b.classList.contains('pref-grid__item') ? 'pref'
    : b.classList.contains('mode-switch__item') ? 'switch'
    : 'plain'
  const hier = {}
  for (const b of btns) hier[kind(b)] = (hier[kind(b)] || 0) + 1

  // --- 一覧の見える行数
  const rowsIn = (listSel, rowSel) => {
    const list = document.querySelector(listSel)
    if (!list) return null
    const lb = list.getBoundingClientRect()
    const all = [...list.querySelectorAll(rowSel)]
    const seen = all.filter((r) => {
      const b = r.getBoundingClientRect()
      return b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1
    })
    const hs = all.map((r) => Math.round(r.getBoundingClientRect().height))
    return {
      total: all.length,
      visible: seen.length,
      minRowH: hs.length ? Math.min(...hs) : null,
      listH: Math.round(lb.height),
      overY: over(list),
    }
  }

  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    paper: paper ? { overY: over(paper), overX: paper.scrollWidth - paper.clientWidth, h: Math.round(paper.getBoundingClientRect().height) } : null,
    paperCount: document.querySelectorAll('.paper').length,
    bodyOverX: document.body.scrollWidth - document.body.clientWidth,
    docOverX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    docOverY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    tapUnder44: hit,
    fontUnder16: small,
    buttons: hier,
    buttonTotal: btns.length,
    atlas: rowsIn('.atlas', '.atlas__row'),
    ranking: rowsIn('.ranking', '.ranking__row'),
    review: rowsIn('.review', '.review__row'),
    prefGrid: rowsIn('.pref-grid', 'li'),
    layout: !!document.querySelector('.layout'),
    hiddenProps: [...document.querySelectorAll('.cover__prop')].filter((p) => getComputedStyle(p).display === 'none').length,
    propsTotal: document.querySelectorAll('.cover__prop').length,
    title: (document.querySelector('.paper__title')?.textContent || '').trim(),
    revealed: document.querySelector('.q-feedback .marker')?.textContent?.trim() ?? null,
    mark: document.querySelector('.q-feedback .mark')?.textContent?.trim() ?? null,
    // 書体が実際に読めているか。FontFaceSet には @font-face / Google Fonts で
    // 宣言した face だけが入るので、loaded に無い family はフォールバック表示になっている
    fonts: (() => {
      const want = ['Mochiy Pop One', 'Shippori Mincho B1', 'Klee One', 'Yusei Magic', 'Dela Gothic One']
      const loaded = [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))].sort()
      return { loaded, missing: want.filter((f) => !loaded.includes(f)) }
    })(),
  })
})()