import type { CapacitorConfig } from '@capacitor/cli'

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
  },
}

export default config
