import { useHashRoute } from './hooks/useHashRoute.ts'
import { clearAnswerSheet } from './hooks/answerSheet.ts'
import Cover from './screens/Cover.tsx'
import Select from './screens/Select.tsx'
import Quiz from './screens/Quiz.tsx'
import Result from './screens/Result.tsx'
import Ranking from './screens/Ranking.tsx'
import Review from './screens/Review.tsx'
import Atlas from './screens/Atlas.tsx'
import HowTo from './screens/HowTo.tsx'
import TabBar from './components/TabBar.tsx'

export default function App() {
  // navigated が false なら「ページを開いた直後の画面」＝共有リンクからの着地（出題なら挑戦状を挟む）
  const { route, navigated } = useHashRoute()
  return (
    <div className="board">
      {route.name === 'cover' && <Cover />}
      {route.name === 'select' && <Select />}
      {route.name === 'quiz' && <Quiz key={route.setId} setId={route.setId} direct={!navigated} />}
      {route.name === 'result' && <Result key={route.setId} setId={route.setId} />}
      {route.name === 'ranking' && <Ranking />}
      {route.name === 'rankingPref' && <Ranking key={route.prefCode} prefCode={route.prefCode} />}
      {route.name === 'review' && <Review />}
      {route.name === 'howto' && <HowTo />}
      {/* 地名帳の 3 ルートは 1 つの要素にまとめる（別の位置に書くと React が作り直して
          検索語と読み込んだ meta が消える）。key も付けない */}
      {(route.name === 'atlas' || route.name === 'atlasScope' || route.name === 'atlasRow') && (
        <Atlas
          scope={route.name === 'atlas' ? undefined : route.scope}
          lgCode={route.name === 'atlasRow' ? route.lgCode : undefined}
        />
      )}
      {/* 戻る導線は全画面でここ 1 か所（第 3 波 D1）。用紙（.paper）の外・黒板の中に固定で置く。
          出題中も出すので（決定 ③）、出題中にタブを押したときだけ進行中の答案を捨てる
          ＝ 以前の用紙右上「タイトルへ戻る」と同じ始末。どのタブも押せば移動するだけなので、
          App にルート別の分岐表は増えない */}
      <TabBar
        route={route}
        onLeave={route.name === 'quiz' ? () => clearAnswerSheet(route.setId) : undefined}
      />
    </div>
  )
}
