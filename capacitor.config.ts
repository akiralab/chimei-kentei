import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

// ネイティブの殻（Issue #58・設計ノート §16）。
//   appId  … GitHub Pages のドメインの逆順。後から変えると別アプリ扱いになるので固定
//   webDir … `npm run build:ios`（vite build --mode capacitor → base './'）の出力
//   backgroundColor … 黒板の緑。WebView が描く前の一瞬を白にしない
const config: CapacitorConfig = {
  appId: 'io.github.akiralab.chimeikentei',
  appName: '地名読み検定',
  webDir: 'dist',
  backgroundColor: '#2e6b5e',
  ios: {
    contentInset: 'never',
    // 長押しで URL のプレビューを出さない。外側の WebView は動かさない（中の用紙はそれぞれ
    // overflow で動く）。どちらも「Web ページらしさ」を消すため（App Store Guideline 4.2）
    allowsLinkPreview: false,
    scrollEnabled: false,
  },
  plugins: {
    // ソフトキーボードの高さぶん WebView そのものを縮める（Issue #61）。プラグインが無いと
    // WKWebView はページをスクロールして入力欄を見せるので、出題中に画面が上下に動く。
    // 縮んだ用紙は 390×508（設計ノート §13 のキーボード近似）で整えた形に収まる
    Keyboard: {
      resize: KeyboardResize.Native,
    },
  },
}

export default config
