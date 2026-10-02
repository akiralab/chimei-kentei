#!/usr/bin/env python3
"""問題バンク生成スクリプト（外部ライブラリ不使用）。

入力  : abr-data/processed/abr_city_reading.csv, abr_name_reading.csv
出力  : public/questions/{dataVersion}/easy.json, difficult/{prefCode}.json, meta.json
契約  : src/engine/types.ts の Question / BankMeta（キー順も宣言順に合わせる）
実行  : python3 data/build_questions.py   （= npm run build:questions）
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
DATA_VERSION = "abr20260925"
SOURCE = (
    "デジタル庁 アドレス・ベース・レジストリ 全国 町字マスター "
    "2026-09-25 版（CC BY 4.0）を加工"
)

# --- 幹の文字種判定 -------------------------------------------------------
# ルール e: 幹が「漢字（々 と 〆 を含む）のみ」で構成されるものだけ残す。
# 数字（半角/全角）・カタカナ・ひらがな・記号（・ ー 〇 など）を含む行は除外。
KANJI_ONLY = re.compile(
    r"^[々〆"
    r"㐀-䶿"  # CJK 拡張 A
    r"一-鿿"  # CJK 統合漢字
    r"豈-﫿"  # CJK 互換漢字
    r"\U00020000-\U0002ebef"  # CJK 拡張 B 以降
    r"]+$"
)

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
    args = ap.parse_args()

    city_csv = args.abr_dir / "abr_city_reading.csv"
    name_csv = args.abr_dir / "abr_name_reading.csv"
    for p in (city_csv, name_csv):
        if not p.exists():
            print(f"入力が見つからない: {p}", file=sys.stderr)
            return 1

    report: dict = {}
    easy, cities_meta, ward_to_city = build_easy(city_csv, report)
    pref_names = {c["prefCode"]: c["lgCode"] for c in cities_meta}
    pref_name_by_code = {}
    for q in easy:
        pref_name_by_code[q["prefCode"]] = q["pref"]

    difficult = build_difficult(name_csv, ward_to_city, pref_name_by_code, report)

    easy_by_pref = Counter(q["prefCode"] for q in easy)
    meta = {
        "dataVersion": DATA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": SOURCE,
        "prefectures": [
            {
                "code": code,
                "name": pref_name_by_code[code],
                "easyCount": easy_by_pref[code],
                "difficultCount": len(difficult.get(code, [])),
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
    print(f"easy            : {report['easy_total']} 件 {report['easy_suffix']}")
    print(f"政令指定都市     : {report['seirei_cities']} 市（区コードを市コードへ集約）")
    print(f"difficult       : {report['difficult_total']} 件 / {len(difficult)} 都道府県")
    print(f"  最小 {lo[0]}={lo[1]}  最大 {hi[0]}={hi[1]}")
    for k, v in report["difficult_stat"].items():
        print(f"  {k}: {v}")
    print(f"出力 {args.out_dir} / 合計 {total / 1024 / 1024:.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
