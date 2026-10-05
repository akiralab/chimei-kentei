#!/usr/bin/env python3
"""問題バンク生成スクリプト（外部ライブラリ不使用）。

入力  : abr-data/processed/abr_city_reading.csv, abr_name_reading.csv
        public/geo/municipalities.json … 難易度 ★ の A1（人口）
        KANJIDIC2 … 難易度 ★ の B2（音訓分解）・B4（漢字の難しさ）
出力  : public/questions/{dataVersion}/easy.json, difficult/{prefCode}.json, meta.json
契約  : src/engine/types.ts の Question / BankMeta（キー順も宣言順に合わせる）
実行  : python3 data/build_questions.py   （= npm run build:questions）

難易度 ★（easy と difficult の `stars`）は **build_stars.py が正本**。ここはそれを呼んで
各問に 1〜3 を書き込むだけで、軸・表・閾値はいっさい持たない
（市区町村名は judge_all＝A1×B2×B4、町名は judge_towns＝B2×B4×B5）。
KANJIDIC2（既定 ~/workspace/abr-data/raw/kanjidic2/kanjidic2.xml.gz）が無いと
難易度を付けられないので、場所を `--kanjidic` で渡すか `--download` で取得する。
"""

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_ABR = Path.home() / "workspace" / "abr-data" / "processed"
DATA_VERSION = "abr20260925r2"
SOURCE = (
    "デジタル庁 アドレス・ベース・レジストリ 全国 町字マスター "
    "2026-09-25 版（CC BY 4.0）を加工"
)
# meta.json に添える難易度の説明（画面には出さない。データの出自を JSON だけで辿れるようにする）。
# 軸の中身を変えるときは build_stars.py が正本で、ここは「どの軸を使ったか」だけを書く。
STARS_NOTE = (
    "難易度 stars（★1〜3）は市区町村名（easy）と町名（difficult）の全問に付く。"
    "共通の軸は B2 = 公式の読みを漢字の音訓で分解できるか（素直／変化あり／読めない）と "
    "B4 = 幹のうち最も難しい漢字（教育／常用／人名用／表外）。"
    "市区町村名は A1 = 人口（国勢調査 2020 の全国分位で有名／ふつう／無名）を加えた 3 軸で、"
    "B2×A1 の素点に B4 を加算する。"
    "町名は A1 を使わず（B2×B4×B5）、B2 の素点（素直 1／変化あり 2／読めない 3）に B4 と "
    "B5 = 同じ表記が全国の町名で 2 通り以上に読まれる（B2 が素直のときだけ +1）を加算する。"
    "どちらも ★3 で打ち切る。判定の正本は data/build_stars.py。"
    "読みの出典は KANJIDIC2（EDRDG, CC BY-SA 4.0）"
)

# --- 幹の文字種判定 -------------------------------------------------------
# 「漢字」として扱う文字の集合（々 と 〆 を含む）。数字（半角/全角）・カタカナ・
# ひらがな・記号（・ ー 〇 など）はここに入らない。
KANJI_CLASS = (
    r"々〆"
    r"㐀-䶿"  # CJK 拡張 A
    r"一-鿿"  # CJK 統合漢字
    r"豈-﫿"  # CJK 互換漢字
    r"\U00020000-\U0002ebef"  # CJK 拡張 B 以降
)

# ルール e（difficult）: 幹が「漢字のみ」で構成されるものだけ残す。
KANJI_ONLY = re.compile(rf"^[{KANJI_CLASS}]+$")

# ルール e（easy）: 幹に漢字が 1 字も無いものを除外する。市区町村名は
# 「鎌ケ谷」「ふじみ野」「南アルプス」のように漢字とかなが混ざる形も読みとして成立するので、
# difficult の「漢字のみ」とは別に「1 字以上あるか」で判定する。
KANJI_ANY = re.compile(rf"[{KANJI_CLASS}]")


def has_kanji(stem: str) -> bool:
    """幹に漢字（々・〆 を含む）が 1 字以上あるか。"""
    return KANJI_ANY.search(stem) is not None


# ルール h: 正解として受け付けられる読み（ひらがなと長音符だけ）。
# 解答欄（src/components/HiraganaInput.tsx）はこれ以外の文字を打てないので、
# ここに合わない読みは「正解できない問題」になる。実データで外れるのはすべて全角数字で、
# デジタル庁のカナが漢数字を数字で書いているもの（西十一条北 ＝ にし１１じょうきた）。
KANA_ANSWER = re.compile(r"^[ぁ-ゖー]+$")


def skip_reason(answer: str) -> str | None:
    """出題しない理由。読みがひらがな・長音符だけなら None（出題できる）。

    ルール h。読みを数字から直すのは土地と後続の字で変わる（一線 ＝ いっせん／
    一区 ＝ いっく／四条 ＝ よじょう・しじょう）ので、機械で付けた読みを正解にはしない
    （Issue #50 の「採らない案」）。
    """
    return None if KANA_ANSWER.match(answer) else "reading"


def attach_skips(questions: list) -> int:
    """各問に `skip`（出題しない理由）を**破壊的に**書き込み、付いた件数を返す。

    **JSON からは消さない。** 抽出（src/engine/sampler.ts）は id 順の母集団を setId の
    乱数で部分シャッフルして選ぶので、母集団から 1 件消すとその範囲のセットがすべて
    別の 10 問になる（既存の共有リンクと登録済みの答案が合わなくなる）。`stars` も残す。
    """
    n = 0
    for q in questions:
        reason = skip_reason(q["answer"])
        if reason is not None:
            q["skip"] = reason
            n += 1
    return n


def askable(questions: list) -> list:
    """出題できる問だけ（ルール h の `skip` が付いていないもの）。meta の件数はこれで数える。"""
    return [q for q in questions if "skip" not in q]


# ルール b: 市区町村の接尾辞とその読み
SUFFIX_KANA = {"市": ("シ",), "区": ("ク",), "町": ("チョウ", "マチ"), "村": ("ソン", "ムラ")}

CROWNS = ("大字", "字")
CROWN_KANA = ("オオアザ", "アザ")  # 長い方から判定する


def to_hira(kana: str) -> str:
    """カタカナ→ひらがな。'ー' など 0x30a1-0x30f6 以外はそのまま。"""
    return "".join(
        chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in kana
    )


def check_digit(code5: str) -> str:
    """全国地方公共団体コードの検査数字。各桁に 6,5,4,3,2 を掛けて合計し、
    11 で割った余りを 11 から引く。10 以上なら 1 の位を採る。"""
    total = sum(int(c) * w for c, w in zip(code5, (6, 5, 4, 3, 2)))
    d = 11 - (total % 11)
    return str(d if d < 10 else d % 10)


def city_code_from_ward(ward_codes) -> str:
    """政令指定都市の市コード。区コードの先頭 4 桁 + '0' + 検査数字。
    設計メモの「先頭 2 桁 + '100'」は 1 県 1 政令市のときの特殊形で、
    神奈川（横浜/川崎/相模原）等では衝突するため先頭 4 桁から導出する。
    検証: 札幌 011002 / 大阪 271004 / 名古屋 231002 / 川崎 141305。"""
    base = min(c[:4] for c in ward_codes) + "0"
    return base + check_digit(base)


# --- easy（市区町村） -----------------------------------------------------
def build_easy(city_csv: Path, report: dict):
    with city_csv.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    groups = defaultdict(list)  # (pref, city) -> rows
    for r in rows:
        groups[(r["pref"], r["city"])].append(r)

    ward_to_city = {}  # 区の lg_code -> 市コード
    questions = []
    suffix_count = Counter()
    cities_meta = []
    dropped_no_kanji = []  # ルール e（easy）で落とした市区町村名

    for (pref, city), rs in groups.items():
        kana_set = {r["city_kana"] for r in rs}
        if len(kana_set) != 1:
            raise ValueError(f"city_kana が不一致: {pref}{city} {kana_set}")
        city_kana = kana_set.pop()

        if rs[0]["ward"]:  # 政令指定都市（区ごとに行がある）
            lg_code = city_code_from_ward([r["lg_code"] for r in rs])
            for r in rs:
                ward_to_city[r["lg_code"]] = lg_code
        else:
            if len(rs) != 1:
                raise ValueError(f"区なしで複数行: {pref}{city}")
            lg_code = rs[0]["lg_code"]

        suffix = city[-1]
        if suffix not in SUFFIX_KANA:
            raise ValueError(f"接尾辞を剥がせない: {pref}{city}")
        stem = city[:-1]
        tail = next((t for t in SUFFIX_KANA[suffix] if city_kana.endswith(t)), None)
        if tail is None or not stem:
            raise ValueError(f"接尾辞の読みを剥がせない: {pref}{city} ({city_kana})")
        stem_kana = city_kana[: -len(tail)]

        # ルール e（easy）: 幹に漢字が 1 字も無いものは読む問題にならないので出題しない。
        # meta.cities には残す（範囲選択の市区町村検索と difficult の絞り込みに使うため）。
        if has_kanji(stem):
            suffix_count[suffix] += 1
            questions.append(
                {
                    "id": f"c:{lg_code}:{stem}",
                    "prefCode": lg_code[:2],
                    "pref": pref,
                    "lgCode": lg_code,
                    "display": stem,
                    "suffix": suffix,
                    "answer": to_hira(stem_kana),
                }
            )
        else:
            dropped_no_kanji.append(city)
        cities_meta.append(
            {
                "lgCode": lg_code,
                "prefCode": lg_code[:2],
                "name": city,
                "kana": to_hira(city_kana),
            }
        )

    questions.sort(key=lambda q: q["id"])
    cities_meta.sort(key=lambda c: c["lgCode"])
    report["easy_total"] = len(questions)
    report["easy_suffix"] = dict(sorted(suffix_count.items()))
    report["cities_total"] = len(cities_meta)
    report["easy_drop_no_kanji"] = sorted(dropped_no_kanji)
    report["seirei_cities"] = len({v for v in ward_to_city.values()})
    return questions, cities_meta, ward_to_city


# --- difficult（大字・町） ------------------------------------------------
def build_difficult(name_csv: Path, ward_to_city: dict, pref_names: dict, report: dict):
    by_pref = defaultdict(list)
    # (lgCode, display) -> 候補 Question のリスト（answer が割れたキーは後段で全件落とす）
    buckets: dict = {}
    order: list = []
    stat = Counter()

    with name_csv.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["level"] != "大字・町":
                continue
            stat["level_match"] += 1
            # ルール c
            if r["n_readings"] != "1":
                stat["drop_multi_reading"] += 1
                continue
            if r["kana_small_suspect"] != "False":
                stat["drop_kana_suspect"] += 1
                continue
            stat["after_c"] += 1

            # ルール d: 冠「大字」「字」を外す。kanji に冠があるとき、読みの先頭が
            # オオアザ / アザ の *どちらであっても* 外す（大字↔アザ の食い違いがあるため）。
            stem, kana = r["kanji"], r["yomi_kana"]
            for crown in CROWNS:
                if stem.startswith(crown):
                    stem = stem[len(crown) :]
                    stat["crown_" + crown] += 1
                    for crown_kana in CROWN_KANA:  # 長い方から判定する
                        if kana.startswith(crown_kana):
                            kana = kana[len(crown_kana) :]
                            stat["crown_kana_stripped"] += 1
                            break
                    else:
                        stat["crown_kanji_only"] += 1
                    break

            if not stem or not kana:
                stat["drop_empty"] += 1
                continue
            # ルール e
            if not KANJI_ONLY.match(stem):
                stat["drop_non_kanji"] += 1
                continue
            # ルール f/g: 丁目は対応表で分離済み・status_flg は対応表に無い → 何もしない

            lg_code = ward_to_city.get(r["lg_code"], r["lg_code"])
            pref_code = lg_code[:2]
            key = (lg_code, stem)
            q = {
                "id": f"o:{lg_code}:{stem}",
                "prefCode": pref_code,
                "pref": r["pref"],
                "lgCode": lg_code,
                "city": r["city_full"],
                "display": stem,
                "answer": to_hira(kana),
            }
            if key in buckets:
                buckets[key].append(q)
            else:
                buckets[key] = [q]
                order.append(key)

    # 重複の扱い: answer が一意なら先着 1 件に集約。answer が割れるキーは
    # 正解を一意に決められないのでキーごと全件落とす。
    conflicts = []
    for key in order:
        qs = buckets[key]
        answers = {q["answer"] for q in qs}
        if len(answers) > 1:
            stat["drop_conflict_display"] += 1
            stat["drop_conflict_rows"] += len(qs)
            conflicts.append((key, sorted(answers), qs[0]["city"]))
            continue
        if len(qs) > 1:
            stat["drop_duplicate_same_answer"] += len(qs) - 1
        by_pref[key[0][:2]].append(qs[0])

    report["conflicts"] = conflicts

    for code in pref_names:
        by_pref.setdefault(code, [])
    for qs in by_pref.values():
        qs.sort(key=lambda q: q["id"])

    report["difficult_stat"] = dict(sorted(stat.items()))
    report["difficult_total"] = sum(len(v) for v in by_pref.values())
    return by_pref


# --- 難易度 ★（判定は build_stars.py） -----------------------------------
def attach_stars(questions: list, geo: dict, kd: dict, report: dict) -> None:
    """easy の各問に `stars`（1〜3）を**破壊的に**書き込む。

    判定は build_stars.judge_all に任せる（A1 の分位点は渡した全件から取るので、
    **easy 全件をまとめて渡す**こと。都道府県ごとに呼ぶと境界がずれる）。
    import を関数の中でするのは、build_stars が build_questions を import していて
    モジュール先頭では循環になるため。
    """
    from build_stars import judge_all  # noqa: PLC0415 — 循環 import を避けるため遅延

    rows, upper, lower = judge_all(questions, geo, kd)
    stars_by_id = {r["id"]: r["stars"] for r in rows}
    for q in questions:
        q["stars"] = stars_by_id[q["id"]]
    report["stars"] = dict(sorted(Counter(q["stars"] for q in questions).items()))
    report["stars_bands"] = (upper, lower)


def attach_town_stars(difficult: dict, kd: dict, report: dict) -> None:
    """difficult の各問に `stars`（1〜3）を**破壊的に**書き込む。

    判定は build_stars.judge_towns に任せる（B5 ＝ 同表記異読みは渡した町名全体で
    数えるので、**全国 107,681 件をまとめて渡す**こと。都道府県ごとに呼ぶと
    「本町 ＝ 3 通り」が県内の通り数に縮んで ★ が変わる）。
    """
    from build_stars import judge_towns  # noqa: PLC0415 — 循環 import を避けるため遅延

    all_questions = [q for code in sorted(difficult) for q in difficult[code]]
    rows = judge_towns(all_questions, kd)
    stars_by_id = {r["id"]: r["stars"] for r in rows}
    for q in all_questions:
        q["stars"] = stars_by_id[q["id"]]
    report["town_stars"] = dict(sorted(Counter(q["stars"] for q in all_questions).items()))
    report["town_b5"] = sum(1 for r in rows if r["b5"])


def stars_triple(questions: list) -> list:
    """`[★1 の件数, ★2, ★3]`。meta の difficultStars / townStars の形。"""
    counts = Counter(q["stars"] for q in questions)
    return [counts.get(s, 0) for s in (1, 2, 3)]


def load_stars_inputs(geo_path: Path, kanjidic_path: Path, download: bool):
    """難易度 ★ の入力（人口・KANJIDIC2）を読む。欠けていれば直し方を添えて止める。"""
    from build_stars import load_kanjidic  # noqa: PLC0415 — 同上

    if not geo_path.exists():
        raise SystemExit(
            f"人口データが無いので難易度 ★ を付けられない: {geo_path}\n"
            f"  python3 data/build_geo.py で生成するか、--geo で場所を渡す。"
        )
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    # KANJIDIC2 が無いときの案内（取得コマンド）は load_kanjidic が出す
    kd = load_kanjidic(kanjidic_path, download=download)
    return geo, kd


def write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description="ABR から問題バンク JSON を生成する")
    ap.add_argument("--abr-dir", type=Path, default=DEFAULT_ABR, help="入力 CSV のディレクトリ")
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO / "public" / "questions" / DATA_VERSION,
        help="出力ディレクトリ",
    )
    ap.add_argument(
        "--geo",
        type=Path,
        default=REPO / "public" / "geo" / "municipalities.json",
        help="難易度 ★ の A1 に使う人口データ",
    )
    ap.add_argument("--kanjidic", type=Path, default=None, help="難易度 ★ に使う KANJIDIC2 の場所")
    ap.add_argument("--download", action="store_true", help="KANJIDIC2 が無ければ取得する")
    args = ap.parse_args()

    city_csv = args.abr_dir / "abr_city_reading.csv"
    name_csv = args.abr_dir / "abr_name_reading.csv"
    for p in (city_csv, name_csv):
        if not p.exists():
            print(f"入力が見つからない: {p}", file=sys.stderr)
            return 1

    # 難易度 ★ の入力は easy を組む前に読む（KANJIDIC2 が無いなら 56 MiB の CSV を読む前に止める）
    from build_stars import KANJIDIC2_CACHE  # noqa: PLC0415 — 循環 import を避けるため遅延

    geo, kd = load_stars_inputs(args.geo, args.kanjidic or KANJIDIC2_CACHE, args.download)

    report: dict = {}
    easy, cities_meta, ward_to_city = build_easy(city_csv, report)
    attach_stars(easy, geo, kd, report)
    pref_names = {c["prefCode"]: c["lgCode"] for c in cities_meta}
    pref_name_by_code = {}
    for q in easy:
        pref_name_by_code[q["prefCode"]] = q["pref"]

    difficult = build_difficult(name_csv, ward_to_city, pref_name_by_code, report)
    attach_town_stars(difficult, kd, report)

    # ルール h（Issue #50）: 読みにひらがな・ー 以外が混ざる問に `skip` を付ける。
    # ★ を付けた **あと**に通す（B5 ＝ 同表記異読みは母集団全体で数えるので、
    # skip を先に外すと残る町名の ★ が動いてしまう）。
    report["skip_easy"] = attach_skips(easy)
    report["skip_difficult"] = sum(attach_skips(qs) for qs in difficult.values())
    report["skipped_readings"] = report["skip_easy"] + report["skip_difficult"]

    # 市区町村ごとの町名の件数と ★ 別内訳。選択画面が meta だけで
    # 「全町名（97 問）」と「★★★ 26問」を出せるようにする（町名 0 件は 0 / [0,0,0]）。
    # **数えるのは出題できる問だけ**（skip を除く）＝ 画面の件数と出題が一致する
    towns_by_lg: dict = defaultdict(list)
    for qs in difficult.values():
        for q in askable(qs):
            towns_by_lg[q["lgCode"]].append(q)
    for city in cities_meta:
        in_city = towns_by_lg.get(city["lgCode"], [])
        city["towns"] = len(in_city)
        city["townStars"] = stars_triple(in_city)

    easy_by_pref = Counter(q["prefCode"] for q in askable(easy))
    difficult_askable = {code: askable(qs) for code, qs in difficult.items()}
    meta = {
        "dataVersion": DATA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": SOURCE,
        "starsNote": STARS_NOTE,
        "skippedReadings": report["skipped_readings"],
        "prefectures": [
            {
                "code": code,
                "name": pref_name_by_code[code],
                "easyCount": easy_by_pref[code],
                "difficultCount": len(difficult_askable.get(code, [])),
                "difficultStars": stars_triple(difficult_askable.get(code, [])),
            }
            for code in sorted(pref_name_by_code)
        ],
        "cities": cities_meta,
    }

    total = write_json(args.out_dir / "easy.json", easy)
    for code, qs in sorted(difficult.items()):
        total += write_json(args.out_dir / "difficult" / f"{code}.json", qs)
    total += write_json(args.out_dir / "meta.json", meta)

    counts = {c: len(v) for c, v in difficult.items()}
    lo = min(counts.items(), key=lambda kv: kv[1])
    hi = max(counts.items(), key=lambda kv: kv[1])
    dropped = report["easy_drop_no_kanji"]
    easy_counts = {p["code"]: p["easyCount"] for p in meta["prefectures"]}
    easy_lo = min(easy_counts.items(), key=lambda kv: kv[1])
    print(f"easy            : {report['easy_total']} 件 {report['easy_suffix']}")
    print(f"  最小 {easy_lo[0]}={easy_lo[1]}  （meta.cities は全 {report['cities_total']} 件を残す）")
    print(f"  ルール e で除外（幹に漢字なし）: {len(dropped)} 件 {'・'.join(dropped)}")
    upper, lower = report["stars_bands"]
    print("難易度 ★         : " + " / ".join(
        f"{'★' * s} {report['stars'].get(s, 0)} 件"
        f"（{report['stars'].get(s, 0) / report['easy_total']:.0%}）" for s in (1, 2, 3)
    ))
    print(f"  A1 の境界: 有名 ≥ {upper:,} 人／無名 < {lower:,} 人（判定は data/build_stars.py）")
    print(f"政令指定都市     : {report['seirei_cities']} 市（区コードを市コードへ集約）")
    print(f"difficult       : {report['difficult_total']} 件 / {len(difficult)} 都道府県")
    print(f"  最小 {lo[0]}={lo[1]}  最大 {hi[0]}={hi[1]}")
    print("  難易度 ★: " + " / ".join(
        f"{'★' * s} {report['town_stars'].get(s, 0)} 件"
        f"（{report['town_stars'].get(s, 0) / report['difficult_total']:.0%}）" for s in (1, 2, 3)
    ))
    print(f"  B5（同表記異読みで +1 が効いた町名）: {report['town_b5']} 件"
          f"（判定は data/build_stars.py の judge_towns）")
    print(f"ルール h で出題しない（skip: reading）: {report['skipped_readings']} 件"
          f"（町名 {report['skip_difficult']}／市区町村名 {report['skip_easy']}）")
    print(f"  JSON には残して meta の件数から除く（出題できる町名は "
          f"{report['difficult_total'] - report['skip_difficult']} 件）")
    towns = [c["towns"] for c in meta["cities"]]
    print(f"  町名を持つ市区町村: {sum(1 for n in towns if n)} / {len(towns)} 件"
          f"（最大 {max(towns)}）")
    for k, v in report["difficult_stat"].items():
        print(f"  {k}: {v}")
    print(f"出力 {args.out_dir} / 合計 {total / 1024 / 1024:.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
