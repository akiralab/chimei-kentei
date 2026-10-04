import { useHashRoute } from './hooks/useHashRoute.ts'
import Cover from './screens/Cover.tsx'
import Select from './screens/Select.tsx'
import Quiz from './screens/Quiz.tsx'
import Result from './screens/Result.tsx'
import Ranking from './screens/Ranking.tsx'
import Review from './screens/Review.tsx'
import Atlas from './screens/Atlas.tsx'

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
      {/* 地名帳の 3 ルートは 1 つの要素にまとめる（別の位置に書くと React が作り直して
          検索語と読み込んだ meta が消える）。key も付けない */}
      {(route.name === 'atlas' || route.name === 'atlasScope' || route.name === 'atlasRow') && (
        <Atlas
          scope={route.name === 'atlas' ? undefined : route.scope}
          lgCode={route.name === 'atlasRow' ? route.lgCode : undefined}
        />
      )}
      {/* .footer-credit は黒板の上に載る（白系の文字色）ため .paper の外に置く。
          狭い画面（480px 以下）では正式名が 2 行に折れて用紙の高さを食うので、
          略称 ABR に差し替える。正式名は <abbr title> に残す（どちらを見せるかは CSS） */}
      <p className="footer-credit">
        出典: デジタル庁{' '}
        <span className="footer-credit__full">アドレス・ベース・レジストリ</span>
        <abbr className="footer-credit__abbr" title="アドレス・ベース・レジストリ">
          ABR
        </abbr>
        （
        <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        ）
      </p>
    </div>
  )
}
