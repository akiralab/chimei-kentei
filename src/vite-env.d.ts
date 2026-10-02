/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 共有ランキング API のベース URL（例 `https://xxxx.execute-api.ap-northeast-1.amazonaws.com`）。
   * 未設定なら localStorage のローカルランキングにフォールバックする。
   * GitHub Actions では repository variable `VITE_RANKING_API` を build に渡す。
   */
  readonly VITE_RANKING_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
