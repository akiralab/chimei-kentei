# App Store Connect の原稿（Issue #57）

提出のときに各欄へ貼る。文字数の上限は App Store Connect の表示に従う。審査で落ちやすい点と対策の背景は設計ノート §18。

## 提出の前に

1. `src/contact.ts`・`public/privacy.html`・`public/support.html` の `example.com` を専用アドレスに差し替える（残っていると提出用タグのビルドが止まる）
2. `#73`〜`#77` と審査対応の PR をマージし、Pages → `npm run deploy:api` の順に反映する
3. 順位表の試験登録を消す: `node infra/scripts/delete-entry.ts --find テスト` のあと 1 件ずつ `--yes`
4. 提出用タグ `ios-v1.0.0`（`-rc` なし）を打ち、TestFlight で最後の通し確認をする
5. App Store Connect のバージョンを **1.0.0** に直す（作成時の 1.0 のままだと、ビルドの 1.0.0 と食い違う）

## App 情報

| 欄 | 入れるもの |
|---|---|
| 名前 | 地名読み検定 - 難読地名クイズ |
| サブタイトル | この地名、読めますか |
| プライマリ言語 | 日本語 |
| カテゴリ | 主: 教育 ／ 副: ゲーム（トリビア） |
| コンテンツ権利 | 第三者のコンテンツを含み、利用する権利がある（下の出典） |
| 使用許諾 | Apple 標準の EULA のまま |
| 価格 | 無料 |
| 配信地域 | **日本のみ**（中国本土の ICP 申請や EU の事業者情報の公開を避けられる。内容も日本語だけ） |
| EU のデジタルサービス法 | 事業者ではない（This is not a trader account）。住所・電話番号の掲載は不要 |
| 公開方法 | **手動で公開**（承認されても自動で出ない。作成時の既定は自動なので変える） |

## このバージョンの情報

**プロモーションテキスト**

```
毎日変わる「今日の10問」は、全国の難読地名から出題。だれが解いても同じ10問なので、順位表で腕前を比べられます。通信がなくても遊べます。
```

**説明**

```
答案用紙に読みを書き込む、日本の地名の読みクイズです。匝瑳、放出、我孫子。読めそうで読めない地名に、10問ずつ挑戦できます。

■ 遊び方
・範囲は全国・都道府県から。北海道と東京都は地域でも選べます
・科目は「市区町村名」（約1,700問）と「市区町村名＋町名」（約10万問）の2つ
・難易度は★1〜3の3段階
・読みをひらがなで書きます。ローマ字で打ってもひらがなになります
・毎日変わる「今日の10問」は、全国の★★★からだれが解いても同じ10問

■ 解くほど地名に詳しくなる
・解答のあとに、その市区町村の場所を地図で、人口などの情報を一緒に確かめられます
・間違えた問題は「見直し」にたまります
・「地名帳」で市区町村名の読みと場所を一覧できます。難易度と検索で絞れます

■ 順位表
・登録すると、同じ問題を解いた人と得点を比べられます。登録は任意で、アカウントは要りません
・不適切な名前はサーバーで拒否し、順位表の各行から報告と非表示ができます

■ 通信がなくても遊べます
問題と地図はすべてアプリに入っています。通信を使うのは順位表だけです。広告はなく、課金もありません。

■ 出典
出題: デジタル庁「アドレス・ベース・レジストリ」（CC BY 4.0）を加工して作成
人口・地図: 総務省統計局 e-Stat（2020年国勢調査）
難易度の判定: KANJIDIC2（EDRDG, CC BY-SA 4.0）
```

| 欄 | 入れるもの |
|---|---|
| キーワード | `難読,読み方,漢字,検定,都道府県,市区町村,町名,地理,暗記,日本地図,雑学` |
| サポート URL | `https://akiralab.github.io/chimei-kentei/support.html` |
| プライバシーポリシー URL | `https://akiralab.github.io/chimei-kentei/privacy.html` |
| マーケティング URL | 空欄 |
| 著作権 | 2026 Akira Kawai |
| スクリーンショット | `npm run screenshots` の 5 枚（6.9 インチ・1290×2796） |

URL はどちらも静的なページを指す。審査の人がブラウザで開いたときに、JavaScript に頼らず連絡先まですぐ読める形にする。

## 年齢区分の質問票

**結果の見込みは 4+。**

| 質問 | 回答 | 理由 |
|---|---|---|
| ユーザー生成コンテンツ | はい | 順位表の名前は他の利用者に見える |
| コンテスト | まれ／軽度 | 順位表は登録が任意で、賞品も期間つきの大会もない。**「頻繁」を選ぶと 13+ になる**（本人判断） |
| メッセージとチャット／ソーシャルメディア | いいえ | 利用者同士のやり取りも、広めるフィードもない |
| 無制限の Web アクセス | いいえ | 外部リンクは OS のブラウザで開く。アプリ内で自由に閲覧できない |
| 広告・保護者機能・年齢確認 | いいえ | |
| それ以外（暴力・性・賭博・医療など） | なし | |

## App のプライバシー

データを**収集する**。

| 種類 | 中身 | 目的 | ユーザーに紐づく | トラッキング |
|---|---|---|---|---|
| 識別子 → ユーザー ID | 順位表の名前、端末ごとのランダムな識別子 | App の機能 | はい | いいえ |
| ユーザーコンテンツ → ゲームプレイの内容 | 問題番号、得点、正解数、所要時間 | App の機能 | はい | いいえ |

- 登録しないと何も送らないが、任意でも主要な機能の一部なので申告する
- 各問の解答は採点に使うだけで保存しないので申告しない
- 位置情報・連絡先・購入履歴・解析・診断は扱わない

## App Review に関する情報

連絡先（氏名・電話番号・メール）は本人のものを入れる。公開はされない。ログインは無いのでデモアカウントは不要。

**メモ**（本文は英語にする。審査の人が日本語を読めるとは限らないので）

```
This is a Japanese place-name reading quiz. The UI is Japanese only. There is no login, purchase, advertising or tracking.

HOW TO TEST (about 2 minutes, no Japanese keyboard needed)
1. On the first screen tap 今日の10問（全国） (Today's 10 questions). The name field is optional.
2. Type any Latin letters, for example "sousa". They are converted to hiragana as you type. Tap 解答 (Answer), or tap it with an empty field to skip a question.
3. After each answer tap 次へ (Next). 地図と情報 (Map and info) opens a full-screen sheet with the municipality's location.
4. After 10 questions the result screen appears. ランキングに登録 registers the score on the shared leaderboard.
The other tabs at the bottom are 地名帳 (gazetteer), 順位 (leaderboards) and 見直し (questions you got wrong).

WHY THIS IS MORE THAN A WEBSITE
All questions (about 1,700 municipalities and 100,000 town names), maps and fonts are bundled in the app. Turn on Airplane Mode: every quiz, map and the gazetteer still work. Only the leaderboard uses the network. The app uses the native share sheet, native keyboard handling and a tab bar, and it keeps your mistakes on the device for review.

USER-GENERATED CONTENT (Guideline 1.2)
The only user-generated content is the display name on the leaderboard. There is no chat, profile or free text anywhere else.
- Filter: the server rejects objectionable names, contact details and impersonation. To see it, enter "admin" as the name on the result screen and tap ランキングに登録.
- Report and block: in 順位, open 全国 and tap the "…" at the end of a row. この名前を報告する (report) composes an email containing the entry ID; この名前を非表示にする (hide) blocks that name on this device. Reports are reviewed within 24 hours and offending entries are removed.
- Terms: the zero-tolerance rule is shown before registering and in 順位表の利用条件 (Leaderboard terms).
- Contact: the ? button on the first screen → section 8, and the support URL.

DATA SOURCES
Digital Agency of Japan, Address Base Registry (CC BY 4.0, modified); Statistics Bureau of Japan, e-Stat; KANJIDIC2 (EDRDG, CC BY-SA 4.0); fonts under the SIL Open Font License. Credits are in the ? screen, section 7.
```
