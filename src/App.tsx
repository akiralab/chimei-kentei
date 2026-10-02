import { useHashRoute } from './hooks/useHashRoute.ts'
import Cover from './screens/Cover.tsx'
import Select from './screens/Select.tsx'
import Quiz from './screens/Quiz.tsx'
import Result from './screens/Result.tsx'
import Ranking from './screens/Ranking.tsx'

export default function App() {
  const route = useHashRoute()
  return (
    <div className="board">
      {route.name === 'cover' && <Cover />}
      {route.name === 'select' && <Select />}
      {route.name === 'quiz' && <Quiz key={route.setId} setId={route.setId} />}
      {route.name === 'result' && <Result key={route.setId} setId={route.setId} />}
      {route.name === 'ranking' && <Ranking />}
      {route.name === 'rankingPref' && <Ranking key={route.prefCode} prefCode={route.prefCode} />}
      {/* .footer-credit は黒板の上に載る（白系の文字色）ため .paper の外に置く */}
      <p className="footer-credit">
        出典: デジタル庁 アドレス・ベース・レジストリ（
        <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        ）
      </p>
    </div>
  )
}
