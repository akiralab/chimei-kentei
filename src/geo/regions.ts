/**
 * 地方（9 グループ）の定義。**ここが唯一の情報源**で、画面・CSS・テストはすべてこれを参照する。
 *
 * 区分は本人指定の 8 つに「中国・四国」を足した 9 つ。
 * 気象アプリの地点選択と同じく「まず地方 → 次に都道府県」の 2 段階に使う。
 *
 * anchor は地方名チップを置く経度緯度。**重心ではなく手で選んだ点**にしている。
 * 重心だと中国・四国のように海の上へ出たり、関東のように隣の地方と重なったりするため。
 * 「地理的な配置はだいたい合っていればよい」という方針に沿って、読める位置を優先する。
 * （実際の重なりは RegionPicker 側でピクセル単位にほどく）
 */

export interface Region {
  /** CSS クラスの接尾辞にもなる識別子 */
  id: string
  name: string
  /** 所属する都道府県コード（2 桁）。昇順 */
  prefCodes: string[]
  /** 地方名チップを置く位置 [経度, 緯度]（広い画面用。実際の投影位置に置く） */
  anchor: [number, number]
  /**
   * 狭い画面用の概略位置 [x, y]（ステージに対する 0〜1 の割合）。
   *
   * スマホの地図は高さ 170px 程度しか取れず、9 個のチップ（各 44px）を実際の投影位置へ
   * 置くと必ず重なる。押し合いでほどくと「中部が関東の東」のような地理的な嘘になるので、
   * **3 段 × 3 列の概略配置**を手で決めてある。各行は左から右が西から東、
   * 上から下が北から南。「だいたい合っていればよい」という方針の具体化。
   */
  compact: [number, number]
}

/** 連番の都道府県コードを作る（'02'〜'07' のような範囲指定用） */
function range(from: number, to: number): string[] {
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(String(i).padStart(2, '0'))
  return out
}

export const REGIONS: Region[] = [
  // 上段（北）: 北陸 — 東北 — 北海道
  { id: 'hokkaido', name: '北海道', prefCodes: ['01'], anchor: [143.0, 43.5], compact: [0.8, 0.16] },
  { id: 'tohoku', name: '東北', prefCodes: range(2, 7), anchor: [141.0, 39.6], compact: [0.52, 0.16] },
  { id: 'hokuriku', name: '北陸', prefCodes: ['15', '16', '17', '18'], anchor: [137.3, 37.2], compact: [0.22, 0.16] },
  // 中段: 近畿 — 中部 — 関東
  { id: 'kanto', name: '関東', prefCodes: range(8, 14), anchor: [140.4, 36.2], compact: [0.82, 0.5] },
  { id: 'chubu', name: '中部', prefCodes: ['19', '20', '21', '22', '23'], anchor: [137.8, 35.4], compact: [0.52, 0.5] },
  { id: 'kinki', name: '近畿', prefCodes: range(24, 30), anchor: [135.6, 34.3], compact: [0.2, 0.5] },
  // 下段（南）: 沖縄 — 九州 — 中国・四国
  { id: 'chugoku-shikoku', name: '中国・四国', prefCodes: range(31, 39), anchor: [132.8, 34.0], compact: [0.72, 0.84] },
  { id: 'kyushu', name: '九州', prefCodes: range(40, 46), anchor: [130.8, 32.4], compact: [0.3, 0.84] },
  { id: 'okinawa', name: '沖縄', prefCodes: ['47'], anchor: [127.9, 26.4], compact: [0.08, 0.84] },
]

/** インセット（別枠）で描く地方。本土と同じ縮尺に入れると本土が縮むため */
export const INSET_REGION_ID = 'okinawa'

const BY_PREF = new Map<string, Region>()
for (const region of REGIONS) for (const code of region.prefCodes) BY_PREF.set(code, region)

/** 都道府県コードが属する地方。未知のコードなら undefined */
export function regionOfPref(prefCode: string): Region | undefined {
  return BY_PREF.get(prefCode)
}

export function regionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

/** 全 47 都道府県がちょうど 1 つの地方に属することの保証（テストで検証する） */
export const ALL_PREF_CODES: string[] = REGIONS.flatMap((r) => r.prefCodes)
