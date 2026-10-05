// measure-expr.js — ページ内で走る計測式（scripts/measure.mjs が読み込んで Runtime.evaluate に渡す）
//
// 返す JSON のキーと受け入れ条件の対応は README「計測」節と Issue #42 を参照。
//   tapUnder44 … 44x44px 未満の操作要素（#42 受け入れ条件 1）
//   fontUnder16 … 16px 未満のテキスト要素。13px 未満が無いことを見る（#42 条件 2 / #44 条件 4）
//                 除外は作らない。`.footer-credit a` も数える（#44 で 13px に上げたため）
//   paper.overY … .paper の縦はみ出し（#42 条件 6 / #44 条件 1）
//   fonts … 読み込めた書体（#42 条件 5）
//   backInPaper … .paper の中に残った「タイトルへ戻る / 範囲・科目へ / 表紙へ」の数（#51 条件 1）
//                 第 3 波で戻る導線を下タブバーに集約したので、**全画面で 0** であること
//   tabbar … 下タブバーの有無・高さ・現在地（aria-current）の数（#51 条件 1・7）
//   primaryCount … 可視の .btn--primary の数。表紙は 1 つ（#51 条件 4）
//   atlasVisible … 地名帳の一覧の見える行数（atlas.visible の別名。375x667 で 8 以上。#51 条件 3）
//   quizMap … 出題画面の地図パネルの高さと、情報カードに覆われずに見える高さ（#51 やること 6）
//
// 用紙ごと縦スクロールする 3 画面（.board--scroll ＝ 結果・間違えた問題・あそびかた。#44 条件 2）は
// paper.overY が 0 でも「切れていない」とは言えないので、専用の 3 つで判定する。
//   docOverY … ページのスクロール量（スクロールする画面では > 0 が正常）
//   lastButtonCut … 最後の .btn が、スクロールしても届かない位置にはみ出していないか
//   reviewVisibleFirstView … スクロール前（最初のビューポート）に見える .review__row の数
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

  // --- 用紙ごとスクロールする画面（.board--scroll）の指標
  //
  // スクロールの主体は .board--scroll のときは文書（body の overflow を開けてある）。
  // 最後の .btn が scrollHeight を超えていれば、どれだけスクロールしても届かない＝切れている
  const scroller = document.scrollingElement ?? document.documentElement
  const allBtns = [...document.querySelectorAll('.btn')].filter((b) => {
    const cs = getComputedStyle(b)
    return cs.display !== 'none' && cs.visibility !== 'hidden'
  })
  const lastBtn = allBtns[allBtns.length - 1] ?? null
  const lastButtonCut =
    lastBtn === null ? null : Math.round(lastBtn.getBoundingClientRect().bottom + scroller.scrollTop) > scroller.scrollHeight + 1

  // スクロールしていない状態（最初のビューポート）に収まっている見直しの行数
  const reviewVisibleFirstView = [...document.querySelectorAll('.review__row')].filter((r) => {
    const b = r.getBoundingClientRect()
    return b.top - scroller.scrollTop >= 0 && b.bottom - scroller.scrollTop <= innerHeight
  }).length

  // キーボード近似（390x508）で「解答」が画面内に残っているか（#44 条件 3）
  const answerBtn = [...document.querySelectorAll('button.btn')].find((b) => b.textContent.trim() === '解答') ?? null
  const answerBtnVisible = answerBtn === null ? null : answerBtn.getBoundingClientRect().bottom <= innerHeight

  // --- 用紙の中に残った戻る導線（#51 条件 1）。語彙は 3 つに限る
  //     （「← 一覧へ」「都道府県の一覧へ」は同じ画面の中の移動なので数えない）
  const BACK_LABELS = ['タイトルへ戻る', '範囲・科目へ', '表紙へ']
  const backInPaper = [...document.querySelectorAll('.paper a, .paper button')]
    .filter((el) => BACK_LABELS.includes((el.textContent || '').trim()))
    .map((el) => ({ sel: sel(el), text: label(el) }))

  // --- 下タブバー（#51 条件 1・7）。.paper の外に 1 本だけあること
  const tabbar = (() => {
    const nav = document.querySelector('.tabbar')
    if (nav === null) return { present: false }
    const r = nav.getBoundingClientRect()
    const items = [...nav.querySelectorAll('.tabbar__item')]
    return {
      present: true,
      inPaper: nav.closest('.paper') !== null,
      visible: vis(nav),
      h: Math.round(r.height),
      bottomGap: Math.round(innerHeight - r.bottom),
      ariaLabel: nav.getAttribute('aria-label'),
      items: items.length,
      current: items.filter((el) => el.getAttribute('aria-current') === 'page').length,
      labels: items.map((el) => (el.textContent || '').trim()),
      // 用紙がタブバーの下に隠れていないか（用紙の下端が帯の上端より上にあること）。
      // 用紙ごとスクロールする画面（.board--scroll）は用紙がビューポートより長いのが
      // 正常なので見ない（そちらは docOverY / lastButtonCut で判定する）
      paperClear:
        paper === null || document.querySelector('.board--scroll') !== null ?
          null
        : Math.round(r.top - paper.getBoundingClientRect().bottom),
    }
  })()

  // --- 出題画面の地図パネル。スマホは .info-card を地図の下端に重ねるので、
  //     「地図として見える高さ」は カードの上端 − パネルの上端（#51 やること 6）
  const quizMap = (() => {
    const panel = document.querySelector('.layout__map')
    if (panel === null) return null
    const pb = panel.getBoundingClientRect()
    const card = panel.querySelector('.info-card')
    const cb = card !== null && vis(card) ? card.getBoundingClientRect() : null
    return {
      h: Math.round(pb.height),
      folded: panel.classList.contains('layout__map--folded'),
      cardH: cb === null ? 0 : Math.round(cb.height),
      uncovered: Math.round(cb === null ? pb.height : cb.top - pb.top),
    }
  })()

  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    boardScroll: !!document.querySelector('.board--scroll'),
    lastButtonCut,
    lastButtonBottom: lastBtn === null ? null : Math.round(lastBtn.getBoundingClientRect().bottom + scroller.scrollTop),
    scrollHeight: scroller.scrollHeight,
    reviewVisibleFirstView,
    answerBtnVisible,
    skeleton: document.querySelectorAll('.skeleton').length,
    paper: paper ? { overY: over(paper), overX: paper.scrollWidth - paper.clientWidth, h: Math.round(paper.getBoundingClientRect().height) } : null,
    paperCount: document.querySelectorAll('.paper').length,
    bodyOverX: document.body.scrollWidth - document.body.clientWidth,
    docOverX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    docOverY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    tapUnder44: hit,
    fontUnder16: small,
    buttons: hier,
    buttonTotal: btns.length,
    primaryCount: hier.primary || 0,
    backInPaper,
    tabbar,
    quizMap,
    atlas: rowsIn('.atlas', '.atlas__row'),
    ranking: rowsIn('.ranking', '.ranking__row'),
    review: rowsIn('.review', '.review__row'),
    prefGrid: rowsIn('.pref-grid', 'li'),
    layout: !!document.querySelector('.layout'),
    atlasVisible: (rowsIn('.atlas', '.atlas__row') ?? {}).visible ?? null,
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