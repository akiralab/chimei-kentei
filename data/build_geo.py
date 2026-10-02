#!/usr/bin/env python3
"""地図 GeoJSON ＋ 市区町村統計の生成スクリプト。

入力  : e-Stat 境界データ 2020 年国勢調査 小地域（shape, 世界測地系緯度経度）
        ~/workspace/akiralab-data/raw/estat/shochiiki_2020/r2ka{01..47}.zip
        市区町村コードの読み対応表 ~/workspace/abr-data/processed/abr_city_reading.csv
出力  : public/geo/pref/{prefCode}.json  … 市区町村ポリゴン（政令市は区を市へ溶かす）
        public/geo/japan.json            … 都道府県ポリゴン（強く簡略化）
        public/geo/municipalities.json   … Record<lgCode, MunicipalityStats>
契約  : src/engine/types.ts の「地図・統計（v1）」節
        MunicipalityFeatureProps / PrefectureFeatureProps / MunicipalityStats
実行  : cd data && uv run python build_geo.py
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import shapely

# lgCode の算出は問題バンク生成と同一実装を再利用する（easy.json との lgCode 一致が最重要）
from build_questions import city_code_from_ward

REPO = Path(__file__).resolve().parent.parent
DEFAULT_ESTAT = Path.home() / "workspace" / "akiralab-data" / "raw" / "estat" / "shochiiki_2020"
DEFAULT_ABR = Path.home() / "workspace" / "abr-data" / "processed" / "abr_city_reading.csv"
DEFAULT_OUT = REPO / "public" / "geo"

# e-Stat の HCODE。8101=通常の調査区、8154=水面調査区（面積・人口の集計から除く）
HCODE_WATER = 8154

# 読み込む属性。面積・人口・世帯と市区町村コードの特定に必要なものだけ
COLUMNS = ["PREF", "CITY", "PREF_NAME", "CITY_NAME", "HCODE", "AREA", "JINKO", "SETAI"]

# 座標の丸め桁数。4 桁 ≒ 11m。統計の代表点だけは 5 桁（≒1m）で持つ
COORD_DIGITS = 4
CENTROID_DIGITS = 5


# --- 市区町村コードの対応表 ------------------------------------------------
def load_city_map(abr_csv: Path):
    """ABR から code5（5 桁コード）→ (lgCode, 表示名, prefCode) を作る。

    政令指定都市は区の行をまとめて 1 市にし、区の code5 もすべて市の lgCode へ向ける。
    表示名は ABR の city 列そのまま（郡名・区名を含まない）。
    """
    with abr_csv.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    groups: dict = collections.defaultdict(list)
    for r in rows:
        groups[(r["pref"], r["city"])].append(r)

    code5_to_city: dict[str, tuple[str, str]] = {}
    pref_name_by_code: dict[str, str] = {}
    seirei: dict[str, str] = {}  # 政令市の表示名 -> lgCode（前方一致の救済用）
    for (pref, city), rs in groups.items():
        if rs[0]["ward"]:  # 政令指定都市（区ごとに行がある）
            lg_code = city_code_from_ward([r["lg_code"] for r in rs])
            seirei[city] = lg_code
        else:
            if len(rs) != 1:
                raise ValueError(f"区なしで複数行: {pref}{city}")
            lg_code = rs[0]["lg_code"]
        for r in rs:
            code5_to_city[r["lg_code"][:5]] = (lg_code, city)
        pref_name_by_code[lg_code[:2]] = pref
    return code5_to_city, pref_name_by_code, seirei


# --- ジオメトリの後始末 ----------------------------------------------------
def polygonal(geom):
    """make_valid がよこす GeometryCollection から面だけを取り出す。面が無ければ None。"""
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in shapely.get_parts(geom) if g.geom_type in ("Polygon", "MultiPolygon")]
    if not parts:
        return None
    return shapely.union_all(parts)


def fix_geometries(gdf: gpd.GeoDataFrame):
    """無効ジオメトリを make_valid で直す（buffer(0) は面を削るので使わない）。"""
    bad = ~gdf.geometry.is_valid
    n = int(bad.sum())
    if n:
        gdf.loc[bad, "geometry"] = gdf.loc[bad, "geometry"].make_valid().apply(polygonal)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    return gdf, n


def snap_to_grid(gdf: gpd.GeoDataFrame, grid: float) -> gpd.GeoDataFrame:
    """小地域ポリゴンを格子にスナップ丸めする（dissolve の前処理）。

    e-Stat の小地域は隣接ポリゴンの境界座標が完全一致しないため、そのまま dissolve すると
    市区町村ポリゴンの内部に幅 cm 級の隙間（スリーバー穴）が大量に残る。北海道では穴 19,916 個で、
    1 穴＝最低 4 頂点が削れないので coverage_simplify が tolerance をいくら上げても効かなくなる
    （簡略化後 161,579 頂点で飽和）。出力の座標丸めと同じ 1e-4 度の格子にスナップしてから
    dissolve すると共有境界が一致し、同じ tolerance で 20,625 頂点まで落ちる。
    """
    gdf = gdf.copy()
    gdf["geometry"] = shapely.set_precision(gdf.geometry.values, grid)
    gdf["geometry"] = [polygonal(shapely.make_valid(g)) if g is not None else None
                       for g in gdf.geometry.values]
    return gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]


# --- GeoJSON の書き出し（座標を丸めてから直列化する） ----------------------
def round_ring(ring, digits):
    """座標を丸め、丸めで重なった連続点をつぶす。環として成立しなければ None。"""
    out = []
    for x, y in ring:
        p = [round(x, digits), round(y, digits)]
        if not out or out[-1] != p:
            out.append(p)
    if len(out) >= 2 and out[0] != out[-1]:
        out.append(list(out[0]))
    return out if len(out) >= 4 else None


def round_geometry(geom, digits):
    """Polygon / MultiPolygon の座標を丸めた GeoJSON geometry dict を返す。"""
    parts = shapely.get_parts(geom) if geom.geom_type == "MultiPolygon" else [geom]
    polys = []
    for poly in parts:
        ext = round_ring(poly.exterior.coords, digits)
        if ext is None:
            continue
        rings = [ext]
        for hole in poly.interiors:
            r = round_ring(hole.coords, digits)
            if r is not None:
                rings.append(r)
        polys.append(rings)
    if not polys:
        return None
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def write_text(path: Path, text: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def approx_km2(geom) -> float:
    """緯度帯のスケールだけ考えた面積の概算（離島の切り捨て判定に使う）。"""
    return geom.area * (111.32**2) * math.cos(math.radians(geom.centroid.y))


def clean_polygon(geom, min_part_km2: float, min_hole_km2: float):
    """極小の島と極小の穴を落とす。全部の島が落ちるときは最大の島だけ残す。

    穴の掃除が効くのは、小地域の境界座標がスナップ格子を超えてずれている箇所が
    dissolve / union のあとに幅 1m 級のスリーバー穴として残るため。1 穴＝最低 4 頂点が
    coverage_simplify では削れないので、放っておくとサイズが頂点数ではなく穴の数で決まる。
    実在の飛び地（例 和歌山県北山村 48km²）は閾値よりはるかに大きいので消えない。
    """
    parts = list(shapely.get_parts(geom)) if geom.geom_type == "MultiPolygon" else [geom]
    keep = [p for p in parts if approx_km2(p) >= min_part_km2] if min_part_km2 > 0 else list(parts)
    if not keep:
        keep = [max(parts, key=lambda p: p.area)]
    dropped_parts = len(parts) - len(keep)

    dropped_holes = 0
    rebuilt = []
    for p in keep:
        holes = [h for h in p.interiors
                 if approx_km2(shapely.Polygon(h)) >= min_hole_km2] if min_hole_km2 > 0 else list(p.interiors)
        dropped_holes += len(p.interiors) - len(holes)
        rebuilt.append(shapely.Polygon(p.exterior, holes) if len(holes) != len(p.interiors) else p)

    out = rebuilt[0] if len(rebuilt) == 1 else shapely.MultiPolygon(rebuilt)
    return polygonal(shapely.make_valid(out)), dropped_parts, dropped_holes


# --- 簡略化（隣接境界を保ったまま、サイズ上限に収まる tolerance を探す） ----
class Collection:
    """1 つの FeatureCollection の直列化結果と、簡略化後のジオメトリ。"""

    def __init__(self, tolerance, text, geoms, dropped):
        self.tolerance = tolerance
        self.text = text
        self.geoms = geoms  # 簡略化後のジオメトリ（さらに溶かして上位の地図を作るのに使う）
        self.dropped = dropped
        self.bytes = len(text.encode("utf-8"))

    @property
    def n_features(self):
        return len(self.geoms)


def build_collection(geoms, props_list, tolerance: float) -> Collection:
    """coverage_simplify（面の被覆の共有境界を保つ）→ 座標丸め → FeatureCollection の文字列。"""
    simplified = shapely.coverage_simplify(geoms, tolerance=tolerance)
    features, kept, dropped = [], [], []
    for props, geom in zip(props_list, simplified):
        geom = polygonal(shapely.make_valid(geom))
        gj = round_geometry(geom, COORD_DIGITS) if geom is not None else None
        if gj is None:
            dropped.append(props)
            continue
        features.append({"type": "Feature", "properties": props, "geometry": gj})
        kept.append(geom)
    return Collection(tolerance, dumps({"type": "FeatureCollection", "features": features}),
                      kept, dropped)


def fit_collection(geoms, props_list, base_tol: float, max_bytes: int,
                   max_tol: float = float("inf"), factor: float = 1.5, steps: int = 8) -> Collection:
    """base_tol から factor 倍ずつ tolerance を上げ、最初に max_bytes に収まった結果を返す。

    県ごとに事情が違う（北海道は海岸線が長く、長崎は島が多い）ので、一律の tolerance では
    detail の無駄か上限超えのどちらかになる。max_tol まで上げても収まらなければそこで打ち切る
    （coverage_simplify は飽和するので、それ以上上げても形が崩れるだけでサイズは減らない）。
    """
    tol = base_tol
    while True:
        col = build_collection(geoms, props_list, tol)
        if col.bytes <= max_bytes or tol >= max_tol:
            return col
        steps -= 1
        if steps <= 0:
            return col
        tol = min(tol * factor, max_tol)


# --- 本体 ------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="e-Stat 小地域から地図 GeoJSON と市区町村統計を生成する")
    ap.add_argument("--estat-dir", type=Path, default=DEFAULT_ESTAT, help="r2ka{NN}.zip のディレクトリ")
    ap.add_argument("--abr-csv", type=Path, default=DEFAULT_ABR, help="abr_city_reading.csv")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT, help="出力ディレクトリ（public/geo）")
    ap.add_argument("--snap-grid", type=float, default=1e-4,
                    help="dissolve 前に小地域をスナップする格子の大きさ（度）")
    ap.add_argument("--pref-tolerance", type=float, default=0.002,
                    help="市区町村ポリゴンの簡略化許容量の下限（度）")
    ap.add_argument("--pref-max-kb", type=int, default=300, help="pref/{prefCode}.json のサイズ上限")
    ap.add_argument("--japan-tolerance", type=float, default=0.006,
                    help="都道府県ポリゴンの簡略化許容量の下限（度）")
    ap.add_argument("--japan-max-kb", type=int, default=150, help="japan.json のサイズ目標")
    ap.add_argument("--japan-max-tolerance", type=float, default=0.03,
                    help="japan.json の簡略化許容量の上限（度）。これ以上上げても頂点数は減らず形だけ崩れる")
    ap.add_argument("--japan-min-island-km2", type=float, default=15.0,
                    help="japan.json で残す島の最小面積（概算 km²）")
    ap.add_argument("--japan-min-hole-km2", type=float, default=20.0,
                    help="japan.json で残す穴（飛び地・境界未定地）の最小面積（概算 km²）")
    ap.add_argument("--min-hole-km2", type=float, default=0.01,
                    help="pref/*.json で残す穴の最小面積（概算 km²）。これ未満はスリーバーとして埋める")
    ap.add_argument("--prefs", type=str, default="",
                    help="処理する都道府県番号をカンマ区切りで限定する（動作確認用）")
    ap.add_argument("--keep-water", action="store_true",
                    help="水面調査区（HCODE=8154）を除外せず含める（面積比較の検証用）")
    args = ap.parse_args()

    if not args.abr_csv.exists():
        print(f"入力が見つからない: {args.abr_csv}", file=sys.stderr)
        return 1

    code5_to_city, pref_name_by_code, seirei = load_city_map(args.abr_csv)
    print(f"ABR 市区町村: code5 {len(code5_to_city)} 件 / lgCode "
          f"{len({v[0] for v in code5_to_city.values()})} 件")

    stats: dict[str, dict] = {}
    pref_geoms: dict[str, object] = {}
    pref_sizes: dict[str, int] = {}
    pref_tols: dict[str, float] = {}
    hcode_counter = collections.Counter()
    invalid_total = water_rows = holes_removed = 0
    estat_code5: set[str] = set()
    fallback_hits: list[tuple[str, str, str]] = []
    unmatched: list[tuple[str, str]] = []

    pref_numbers = [int(x) for x in args.prefs.split(",")] if args.prefs else list(range(1, 48))
    for i in pref_numbers:
        pp = f"{i:02d}"
        zip_path = args.estat_dir / f"r2ka{pp}.zip"
        if not zip_path.exists():
            print(f"入力が見つからない: {zip_path}", file=sys.stderr)
            return 1
        gdf = gpd.read_file(f"zip://{zip_path}!r2ka{pp}.shp", engine="pyogrio", columns=COLUMNS)
        native_crs = gdf.crs
        hcode_counter.update(gdf["HCODE"].value_counts().to_dict())

        gdf["code5"] = gdf["PREF"] + gdf["CITY"]
        estat_code5.update(gdf["code5"].unique())

        # 水面調査区を落とす（面積・人口・ポリゴンすべてから）
        if not args.keep_water:
            water = gdf["HCODE"] == HCODE_WATER
            water_rows += int(water.sum())
            gdf = gdf[~water]

        # code5 -> lgCode。ABR に無い code5 は政令市名の前方一致で救う（旧 区割り）
        lg, names = [], []
        for c5, cname in zip(gdf["code5"], gdf["CITY_NAME"]):
            hit = code5_to_city.get(c5)
            if hit is None and isinstance(cname, str):
                for city, code in seirei.items():
                    if cname.startswith(city):
                        hit = (code, city)
                        if (c5, cname, code) not in fallback_hits:
                            fallback_hits.append((c5, cname, code))
                        break
            if hit is None:
                key = (c5, cname if isinstance(cname, str) else "(名称なし)")
                if key not in unmatched:
                    unmatched.append(key)
            lg.append(hit[0] if hit else None)
            names.append(hit[1] if hit else None)
        gdf["lgCode"] = lg
        gdf["name"] = names
        gdf = gdf[gdf["lgCode"].notna()]

        # 統計はジオメトリの後始末より前に取る（スナップで消える小地域の人口・面積を落とさない）
        agg = gdf.groupby("lgCode", sort=True).agg(
            name=("name", "first"), population=("JINKO", "sum"),
            households=("SETAI", "sum"), area_m2=("AREA", "sum"),
        )

        gdf, n_invalid = fix_geometries(gdf)
        invalid_total += n_invalid
        gdf = snap_to_grid(gdf, args.snap_grid)

        # 市区町村へ集約（政令市は区が溶ける）
        muni = gdf[["lgCode", "geometry"]].dissolve(by="lgCode", sort=True)
        muni["geometry"] = muni.geometry.make_valid().apply(polygonal)
        cleaned = [clean_polygon(g, 0.0, args.min_hole_km2) for g in muni.geometry.values]
        muni["geometry"] = [c[0] for c in cleaned]
        holes_removed += sum(c[2] for c in cleaned)
        muni = muni.set_crs(native_crs, allow_override=True).to_crs("EPSG:4326")
        missing = sorted(set(agg.index) - set(muni.index))
        if missing:
            print(f"  警告: ポリゴンが残らなかった市区町村 {missing}", file=sys.stderr)
        muni = muni.join(agg)

        # 統計（代表点・面積は簡略化前の値から取る）
        for lg_code, row in muni.iterrows():
            pt = row.geometry.representative_point()
            area_km2 = round(row.area_m2 / 1e6, 2)
            stats[lg_code] = {
                "lgCode": lg_code,
                "prefCode": lg_code[:2],
                "name": row["name"],
                "population": int(row.population),
                "households": int(row.households),
                "areaKm2": area_km2,
                "densityPerKm2": int(round(row.population / area_km2)) if area_km2 > 0 else 0,
                "centroid": [round(pt.x, CENTROID_DIGITS), round(pt.y, CENTROID_DIGITS)],
                "source": "census2020",
            }

        pref_code = muni.index[0][:2]
        props = [{"lgCode": c, "prefCode": c[:2], "name": n}
                 for c, n in zip(muni.index, muni["name"])]
        col = fit_collection(muni.geometry.values, props, args.pref_tolerance,
                             args.pref_max_kb * 1024)
        for d in col.dropped:
            print(f"  警告: 簡略化でポリゴンが消えた {d['lgCode']} {d['name']}", file=sys.stderr)
        pref_tols[pref_code] = col.tolerance
        pref_sizes[pref_code] = write_text(args.out_dir / "pref" / f"{pref_code}.json", col.text)
        # japan.json は「簡略化済みの市区町村」を溶かして作る。簡略化前の生ポリゴンから作ると、
        # 県境の座標が県ファイル間で一致しない（＝被覆として不正な）ぶん coverage_simplify が
        # 辺を潰せず、関東 10 県だけでも 26,000 頂点で飽和してしまう。先に県内で簡略化しておくと
        # 不一致の元になる細かい頂点が消え、全国 47 県で 12,000 頂点まで落ちる。
        pref_geoms[pref_code] = polygonal(shapely.make_valid(shapely.union_all(col.geoms)))
        print(f"  {pref_code} {pref_name_by_code.get(pref_code, '?')}: {col.n_features} 市区町村 / "
              f"{pref_sizes[pref_code] / 1024:.0f} KB / tolerance={col.tolerance:.5f}", flush=True)

    # --- japan.json ---
    codes = sorted(pref_geoms)
    dropped_islands = dropped_jp_holes = 0
    jp_geoms, jp_props = [], []
    for code in codes:
        geom, dropped, holes = clean_polygon(
            pref_geoms[code], args.japan_min_island_km2, args.japan_min_hole_km2)
        dropped_islands += dropped
        dropped_jp_holes += holes
        jp_geoms.append(geom)
        jp_props.append({"prefCode": code, "name": pref_name_by_code[code]})
    japan = fit_collection(jp_geoms, jp_props, args.japan_tolerance,
                           args.japan_max_kb * 1024, max_tol=args.japan_max_tolerance)
    japan_size = write_text(args.out_dir / "japan.json", japan.text)

    # --- municipalities.json ---
    muni_size = write_text(args.out_dir / "municipalities.json",
                           dumps({k: stats[k] for k in sorted(stats)}))

    # --- レポート ---
    print()
    print(f"HCODE 分布      : {dict(sorted(hcode_counter.items()))}")
    print(f"水面調査区      : {'含めた（--keep-water）' if args.keep_water else f'{water_rows} 区画を除外'}")
    print(f"無効ジオメトリ  : make_valid で修正 {invalid_total} 件")
    print(f"スリーバー穴    : {holes_removed} 個を埋めた（< {args.min_hole_km2} km²）")
    print(f"市区町村        : {len(stats)} 件（問題バンク easy は 1,741 件）")
    abr_lg = {v[0] for v in code5_to_city.values()}
    print(f"  lgCode 突合   : ABR のみ {len(abr_lg - set(stats))} 件 / e-Stat のみ {len(set(stats) - abr_lg)} 件")
    estat_only = [c for c in sorted(estat_code5) if c not in code5_to_city]
    print(f"  e-Stat にあって ABR に無い code5: {len(estat_only)} 件")
    for c5, cname, code in fallback_hits:
        print(f"    前方一致で救済 {c5} {cname} -> {code}")
    for c5, cname in unmatched:
        print(f"    対応なし（除外） {c5} {cname}")
    abr_only = sorted(c for c in code5_to_city if c not in estat_code5)
    print(f"  ABR にあって e-Stat に無い code5: {len(abr_only)} 件"
          + (f" 例 {[(c, code5_to_city[c][1]) for c in abr_only[:5]]}" if abr_only else ""))
    print(f"人口合計        : {sum(s['population'] for s in stats.values()):,}")
    print(f"世帯合計        : {sum(s['households'] for s in stats.values()):,}")
    print(f"面積合計        : {sum(s['areaKm2'] for s in stats.values()):,.1f} km²")
    lo = min(pref_sizes.items(), key=lambda kv: kv[1])
    hi = max(pref_sizes.items(), key=lambda kv: kv[1])
    print(f"pref/*.json     : {len(pref_sizes)} ファイル 合計 {sum(pref_sizes.values()) / 1024:.0f} KB "
          f"/ 最小 {lo[0]}={lo[1] / 1024:.0f} KB / 最大 {hi[0]}={hi[1] / 1024:.0f} KB")
    raised = {k: round(v, 5) for k, v in sorted(pref_tols.items()) if v > args.pref_tolerance}
    print(f"  tolerance     : 下限 {args.pref_tolerance} / 引き上げた県 {raised}")
    print(f"japan.json      : {japan_size / 1024:.0f} KB（目標 {args.japan_max_kb} KB）"
          f" (tolerance={japan.tolerance:.5f}, "
          f"島の切り捨て {dropped_islands} 個 / 閾値 {args.japan_min_island_km2} km², "
          f"穴の埋め {dropped_jp_holes} 個 / 閾値 {args.japan_min_hole_km2} km²)")
    print(f"municipalities.json: {muni_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
