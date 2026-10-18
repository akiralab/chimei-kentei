/**
 * ネイティブ（Capacitor の殻）でだけ効く機能の窓口（Issue #58・設計ノート §16）。
 *
 * Web では何もしないか、従来の Web API に落とす。プラグインは動的 import にして、
 * GitHub Pages 向けのバンドルと jsdom のテストに殻のコードが混ざらないようにする。
 * 画面側はこのファイルの関数だけを呼び、`@capacitor/*` を直接 import しない。
 */
import { Capacitor } from '@capacitor/core'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export type HapticKind = 'success' | 'error' | 'light'

/**
 * 触覚。正解＝success、不正解・パス・時間切れ＝error、「次へ」＝light。
 * Web、触覚の無い端末、設定で切っている場合は黙って何もしない。
 */
export async function haptic(kind: HapticKind): Promise<void> {
  if (!isNative()) return
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
    if (kind === 'light') {
      await Haptics.impact({ style: ImpactStyle.Light })
      return
    }
    await Haptics.notification({
      type: kind === 'success' ? NotificationType.Success : NotificationType.Error,
    })
  } catch {
    // 触覚が使えない環境では黙る
  }
}

export interface SharePayload {
  title?: string
  text?: string
  url?: string
}

/**
 * 共有。ネイティブなら OS の共有シート（@capacitor/share）、Web なら `navigator.share`。
 * どちらも無ければ false を返し、呼び手がクリップボードに落とす。
 * シートを取り消した（AbortError）場合も true（シートは出たので、呼び手は何も出さない）。
 */
export async function shareNative(payload: SharePayload): Promise<boolean> {
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share(payload)
    } catch {
      // 取り消し・失敗のどちらでも黙って戻る
    }
    return true
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(payload)
    } catch {
      // 同上
    }
    return true
  }
  return false
}

/**
 * ステータスバーの文字色。盤面（.board）の上端は黒板の緑なので白文字
 * （@capacitor/status-bar の `Style.Dark` ＝「暗い背景に明るい文字」）。起動時に 1 回。
 */
export async function setupStatusBar(): Promise<void> {
  if (!isNative()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
  } catch {
    // 殻の外（Web）やプラグイン未登録のときは黙る
  }
}
