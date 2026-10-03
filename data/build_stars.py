#!/usr/bin/env python3
"""市区町村名（mode e）の難易度 ★（1〜3）を機械的に付ける（Issue #33・外部ライブラリ不使用）。

Issue #33 の軸のうち **A1（人口による知名度）**・**B2（漢字の音訓辞書で公式読みを
分解できるか）**・**B4（漢字の難しさ）** の 3 軸を実装し、B2×A1 の表で素点を出して
B4 で加算する。

**この判定が easy.json の `stars` の正本。** `build_questions.py` が judge_all() を
呼んで各問に書き込む（＝ここを直すと問題バンクの難易度が変わるので、変更後は
`npm run build:questions` で easy.json を作り直す）。このスクリプト単体では
easy.json を書き換えず、分布・クロス集計・アンカーの検算だけを出す。

入力
    public/questions/{DATA_VERSION}/easy.json … display / answer / lgCode / pref
    public/geo/municipalities.json            … lgCode → population（国勢調査 2020）
    KANJIDIC2                                 … 漢字の音読み・訓読み・名乗りと配当学年

出力
    標準出力（既定）  … 帯の境界・★ の分布・クロス集計・アンカーの検算
    --markdown FILE   … サンプル N 件の Markdown 表
    --json FILE       … 全件の判定を JSON Lines で（検算用）

実行
    python3 data/build_stars.py                                   # 全件の分布だけ
    python3 data/build_stars.py --sample 100 --seed 20261003 \
        --markdown /tmp/sample100.md                              # サンプル表を書き出す
    python3 data/build_stars.py --nanori b                        # 名乗り読みを (b) 扱いにした場合
    python3 data/build_stars.py --major-exempt                    # 政令市・県庁所在地は B4 加算を免除
    python3 -m unittest data/test_build_stars.py                  # 分解判定の単体テスト

漢字の読みの出典
    KANJIDIC2 — Electronic Dictionary Research and Development Group (EDRDG), Monash
    University. https://www.edrdg.org/kanjidic/kanjidic2.xml.gz
    ライセンス: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
    https://www.edrdg.org/edrdg/licence.html
    **ファイルはリポジトリに含めない。** 下の KANJIDIC2_CACHE に無ければ取得する
    （`--download` を付けるか、手動で
     `curl -A 'Mozilla/5.0' -L -o <cache> https://www.edrdg.org/kanjidic/kanjidic2.xml.gz`）。
"""

import argparse
import gzip
import json
import random
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from build_questions import DATA_VERSION, to_hira

REPO = Path(__file__).resolve().parent.parent
KANJIDIC2_URL = "https://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
KANJIDIC2_CACHE = Path.home() / "workspace" / "abr-data" / "raw" / "kanjidic2" / "kanjidic2.xml.gz"

# --- A1: 人口の分位で 3 帯に切る ------------------------------------------
# 全国一律の分位点（Issue #33「分位点は全国一律で切る」）。easy.json 1,700 件の人口分布は
# 上に長い裾を持ち（中央値 23,219 人／最大 377 万人）、分位点で切ると境界はこうなる。
#   p80 = 79,306 人 … 「有名」341 件。47 都道府県庁所在地（最小 甲府市 189,591 人）と
#                      20 政令指定都市（最小 静岡市 693,389 人）はすべてここに入る
#                      （main() の sanity_capitals() で毎回検算する）
#   p40 = 14,959 人 … 「無名」680 件。下回るのは町村が大半で、全国ニュースに名前が出ない
FAME_UPPER_Q = 0.80  # これ以上を「有名」
FAME_LOWER_Q = 0.40  # これ未満を「無名」
FAME_LABELS = ("有名", "ふつう", "無名")

# --- 総合: B2 の段階 × A1 の帯 → ★ --------------------------------------
# Issue #33 のたたき台から 1 マスだけ変えている（(c)×有名 を ★3 → ★2）。理由は
# アンカー「我孫子＝★2 付近」。あびこ は熟字訓で (c) だが人口 13 万で誰でも知っている。
# 同じ理屈で 渋谷・神戸・奈良・枚方 も ★2 に収まる（★3 のままだと ★3 が水で薄まる）。
STAR_TABLE = {
    #        有名        ふつう      無名
    "a": {"有名": 1, "ふつう": 1, "無名": 2},
    "b": {"有名": 1, "ふつう": 2, "無名": 3},
    "c": {"有名": 2, "ふつう": 3, "無名": 3},
}
B2_LABELS = {"a": "素直", "b": "変化あり", "c": "読めない"}

# --- B4: 漢字の難しさ（KANJIDIC2 の <grade>）------------------------------
# <grade> は 1〜6＝教育漢字の配当学年、8＝それ以外の常用漢字（中学で習う）、
# 9・10＝人名用漢字、無し＝常用漢字表外。幹の中で **最も難しい 1 字**でランクを決める。
# 漢字以外（かな・ケ・ノ・々）はランク 0 として扱う。
B4_LABELS = ("教育", "常用", "人名用", "表外")
# 素点（B2×A1）への加算。cap は ★3。
#   教育・常用 … +0。常用に +1 すると「横浜（浜 は常用）」が ★2 に上がってアンカーを外す
#   人名用     … +1。幌・樽・槻・旭・函・萩・蕨 など「読めるが書けない」層
#   表外       … +2。匝・竈・鰺・檮 など字そのものが読めない層（全 1,700 件中 36 件だけ）
B4_BONUS = (0, 0, 1, 2)

# JIS 水準は採らなかった。難読の代表である「匝」（匝瑳市）が JIS X 0208 第 1 水準に
# 入っており（区点 1-33-57）、水準では拾えない。<grade> が無いこと（＝常用漢字表外）の
# ほうが「読めなさ」をよく表す。

# --- B2: 読みの変化 -------------------------------------------------------
# 連濁（頭の清音が濁る）。は行は濁音と半濁音の両方を許す。
RENDAKU = {
    "か": "が", "き": "ぎ", "く": "ぐ", "け": "げ", "こ": "ご",
    "さ": "ざ", "し": "じ", "す": "ず", "せ": "ぜ", "そ": "ぞ",
    "た": "だ", "ち": "ぢ", "つ": "づ", "て": "で", "と": "ど",
    "は": "ば", "ひ": "び", "ふ": "ぶ", "へ": "べ", "ほ": "ぼ",
}
HANDAKU = {"は": "ぱ", "ひ": "ぴ", "ふ": "ぷ", "へ": "ぺ", "ほ": "ぽ"}
# 促音化（後続の語に引かれて末尾が詰まる）。例 札 サツ→さっ（札幌）
SOKUON_TAIL = "つちくきふ"
# 長音のゆれ（表記と読みのずれ）。例 大 おお↔おう
CHOON_PAIRS = (("おう", "おお"), ("えい", "ええ"))
VOWELS = "あいうえお"

# 漢字以外の文字に与える読みの追加分。カタカナ・ひらがなは字そのまま
# （カタカナはひらがなに）読ませるのが既定で、ここはそれだけでは足りない字。
# 「ケ」「ヶ」は助詞「が」の表記（鎌ケ谷＝かまがや・茅ヶ崎＝ちがさき）、「ノ」「之」は「の」。
EXTRA_KANA_READINGS = {
    "ケ": ("か", "こ"),
    "ヶ": ("か", "こ"),
    "ノ": ("の",),
    "之": ("の",),
    "ツ": ("っ",),
    "〆": ("しめ",),
}
# 繰り返し記号。直前の字の読みを引き継ぐ（_with_repeat() で特別扱いするので
# KANJIDIC2 に無くても「読めない字」としては数えない）。
REPEAT_MARK = "々"


def strip_okurigana(kun: str) -> str:
    """KANJIDIC2 の訓読みから送り仮名と接辞マーク（-）を落とす。
    'やど.る' → 'やど'、'お-' → 'お'、'ちい.さい' → 'ちい'。"""
    return kun.split(".")[0].replace("-", "")


def kun_forms(kun: str) -> list:
    """訓読みを「送り仮名をどこまで読むか」のゆれに展開する。
    'た.ち-' → ['た', 'たち']、'こ.える' → ['こ', 'こえ', 'こえる']、'はら' → ['はら']。
    地名では送り仮名が読みに残ることが多い（立川＝たちかわ・川越＝かわごえ）ので、
    幹だけでなく途中までの形も「素直な訓読み」として許す。"""
    stem = strip_okurigana(kun)
    full = kun.replace(".", "").replace("-", "")
    return [full[:n] for n in range(len(stem), len(full) + 1) if full[:n]]


def load_kanjidic(path: Path = KANJIDIC2_CACHE, download: bool = False) -> dict:
    """KANJIDIC2 を読み、{漢字: {'on', 'kun', 'nanori', 'grade'}} を返す。
    読みはすべてひらがな。'kun' は kun_forms() で展開済み（先頭が幹）。
    'grade' は常用漢字の配当学年 1〜6／中学 8／人名用 9・10／常用外は None。"""
    if not path.exists():
        if not download:
            raise SystemExit(
                f"KANJIDIC2 が無い: {path}\n"
                f"  --download を付けるか、次を実行する:\n"
                f"  mkdir -p {path.parent} && curl -A 'Mozilla/5.0' -L -o {path} {KANJIDIC2_URL}"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(KANJIDIC2_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as res, path.open("wb") as out:
            out.write(res.read())

    with gzip.open(path, "rb") as f:
        root = ET.parse(f).getroot()

    table = {}
    for ch in root.iter("character"):
        lit = ch.findtext("literal")
        if not lit:
            continue
        on, kun = [], []
        for r in ch.iter("reading"):
            if not r.text:
                continue
            if r.get("r_type") == "ja_on":
                on.append(to_hira(r.text).replace("-", "").split(".")[0])
            elif r.get("r_type") == "ja_kun":
                kun.extend(kun_forms(to_hira(r.text)))
        nanori = [to_hira(n.text) for n in ch.iter("nanori") if n.text]
        grade = ch.findtext("misc/grade")
        table[lit] = {
            "on": on,
            "kun": kun,
            "nanori": nanori,
            "grade": int(grade) if grade else None,
        }
    return table


def plain_candidates(char: str, kd: dict) -> list:
    """(a) 素直: 音読み・訓読み（送り仮名のゆれを含む）そのまま。
    漢字以外はその字自身の読み（カタカナはひらがなに）。
    返り値は (読み, 種別ラベル) のリスト。先に来た候補が優先される。"""
    entry = kd.get(char)
    out = []
    if entry:
        for r in entry["kun"]:
            out.append((r, "訓"))
        for r in entry["on"]:
            out.append((r, "音"))
    kana = to_hira(char)
    if kana != char or ("ぁ" <= char <= "ん"):
        out.append((kana, "字"))
    return _dedup(out)


def variant_candidates(char: str, kd: dict) -> list:
    """(b) 変化あり: (a) に音便のゆれを足す。連濁・半濁音化・促音化・長音のゆれ・
    末尾の母音の脱落と、漢字以外の字の追加読み（ケ→か など）。
    **名乗り読みは含めない**（nanori_candidates を参照）。"""
    out = list(plain_candidates(char, kd))
    for r in EXTRA_KANA_READINGS.get(char, ()):
        out.append((r, "字"))
    for r, kind in list(out):
        out.extend(_sound_changes(r, kind))
    return _dedup(out)


def nanori_candidates(char: str, kd: dict) -> list:
    """(b) に名乗り読み（とその音便）を足した候補。

    既定ではこれを **(c) の内訳を人が読めるようにするためだけ**に使い、★ の判定では
    (b) に昇格させない（`--nanori b` で切り替えられる）。KANJIDIC2 の <nanori> には
    「その地名があるからこそ載っている読み」が入っているため: 宿=すく ← 宿毛、
    南=は・風=え・原=ばる ← 南風原。名乗りを (b) に入れると ★3 にしたい当て字が
    そのまま ★2 に落ち、アンカーの一致が 7/11 → 4/11 に下がる。"""
    out = list(variant_candidates(char, kd))
    entry = kd.get(char)
    if entry:
        for r in entry["nanori"]:
            out.append((r, "名"))
            out.extend(_sound_changes(r, "名"))
    return _dedup(out)


def _sound_changes(r: str, kind: str) -> list:
    """読み 1 つから音便のゆれを作る。"""
    if not r:
        return []
    out = []
    if r[0] in RENDAKU:
        out.append((RENDAKU[r[0]] + r[1:], f"{kind}→連濁"))
    if r[0] in HANDAKU:
        out.append((HANDAKU[r[0]] + r[1:], f"{kind}→半濁"))
    if len(r) >= 2 and r[-1] in SOKUON_TAIL:
        out.append((r[:-1] + "っ", f"{kind}→促音"))
    for a, b in CHOON_PAIRS:
        if a in r:
            out.append((r.replace(a, b), f"{kind}→長音"))
        if b in r:
            out.append((r.replace(b, a), f"{kind}→長音"))
    if len(r) >= 2 and r[-1] in VOWELS:
        out.append((r[:-1], f"{kind}→母音脱落"))
    return out


def _dedup(pairs: list) -> list:
    seen, out = set(), []
    for r, kind in pairs:
        if r and r not in seen:
            seen.add(r)
            out.append((r, kind))
    return out


def decompose(display: str, answer: str, candidates) -> list:
    """`display` を 1 字ずつ読みに割り当てて `answer` を左から消費できるかを DP で判定する。
    割り当てられたら [(字, 読み, 種別), ...]、できなければ None。
    `candidates(char, prev_reading)` が候補を返す。「々」は直前の字の読みを引き継ぐ。"""
    memo = {}

    def rec(i: int, j: int, prev: str):
        if i == len(display):
            return [] if j == len(answer) else None
        key = (i, j, prev)
        if key in memo:
            return memo[key]
        memo[key] = None  # 同じ状態を 2 度展開しない
        for reading, kind in candidates(display[i], prev):
            if answer.startswith(reading, j):
                tail = rec(i + 1, j + len(reading), reading)
                if tail is not None:
                    memo[key] = [(display[i], reading, kind)] + tail
                    break
        return memo[key]

    return rec(0, 0, "")


def _with_repeat(base, kd, sound_changes: bool):
    """candidates を「々 は直前の字の読みを引き継ぐ」仕様に包む。
    (b) 以降では引き継いだ読みの音便も許す（佐々＝ささ だけでなく さざ も通す）。"""

    def inner(char: str, prev: str):
        if char == REPEAT_MARK:
            if not prev:
                return []
            out = [(prev, "々")]
            if sound_changes:
                out.extend(_sound_changes(prev, "々"))
            return _dedup(out)
        return base(char, kd)

    return inner


def classify_b2(display: str, answer: str, kd: dict, nanori_level: str = "c") -> tuple:
    """B2 の段階と、人が検算できる割り当てを返す → (level, 内訳).
    level は 'a' 素直 / 'b' 変化あり / 'c' 読めない。
    nanori_level='b' にすると名乗り読みでの分解を (b) として認める。"""
    for level, fn in (("a", plain_candidates), ("b", variant_candidates)):
        segs = decompose(display, answer, _with_repeat(fn, kd, level != "a"))
        if segs is not None:
            return level, format_segments(segs)
    segs = decompose(display, answer, _with_repeat(nanori_candidates, kd, True))
    if segs is not None:
        if nanori_level == "b":
            return "b", format_segments(segs)
        return "c", "名乗り: " + format_segments(segs)
    return "c", "分解不能"


def format_segments(segs: list) -> str:
    return "＋".join(f"{c}={r}({k})" for c, r, k in segs)


def kanji_rank(char: str, kd: dict) -> int:
    """B4: 1 字の難しさ。0 教育 / 1 常用 / 2 人名用 / 3 表外。
    漢字以外（かな・ケ・ノ・々）と KANJIDIC2 に無い字は 0。"""
    entry = kd.get(char)
    if entry is None:
        return 0
    grade = entry["grade"]
    if grade is None:
        return 3
    if grade >= 9:
        return 2
    if grade == 8:
        return 1
    return 0


def b4_rank(display: str, kd: dict) -> tuple:
    """幹の中で最も難しい字のランクと、その字を返す → (rank, 内訳).
    内訳は「人名用: 幌」のような形で、どの字でそのランクになったかを人が検算できる。"""
    rank = max((kanji_rank(c, kd) for c in display), default=0)
    hardest = "".join(c for c in display if kanji_rank(c, kd) == rank)
    return rank, f"{B4_LABELS[rank]}: {hardest}"


def quantile(sorted_values: list, q: float):
    """最近傍順位法の分位点（決定論的・補間しない）。"""
    if not sorted_values:
        raise ValueError("empty")
    return sorted_values[int(round((len(sorted_values) - 1) * q))]


def fame_band(pop, upper, lower) -> str:
    """A1: 人口の帯。人口が取れないものは安全側に「無名」へ寄せる。"""
    if pop is None:
        return "無名"
    if pop >= upper:
        return "有名"
    if pop < lower:
        return "無名"
    return "ふつう"


def combine(b2: str, a1: str, b4: int, exempt: bool = False) -> tuple:
    """B2×A1 の素点に B4 を加算して ★ を決める → (★, 素点, 加算).
    exempt=True（政令市・県庁所在地）のときは B4 の加算をしない。"""
    base = STAR_TABLE[b2][a1]
    bonus = 0 if exempt else B4_BONUS[b4]
    return min(3, base + bonus), base, bonus


def judge_all(questions: list, geo: dict, kd: dict, nanori_level: str = "c",
              major_exempt: bool = False) -> tuple:
    pops = sorted(geo[q["lgCode"]]["population"] for q in questions if q["lgCode"] in geo)
    upper = quantile(pops, FAME_UPPER_Q)
    lower = quantile(pops, FAME_LOWER_Q)
    rows = []
    for q in questions:
        pop = geo.get(q["lgCode"], {}).get("population")
        band = fame_band(pop, upper, lower)
        level, detail = classify_b2(q["display"], q["answer"], kd, nanori_level)
        rank, rank_detail = b4_rank(q["display"], kd)
        major = is_major(q["display"], q["prefCode"], q["suffix"])
        stars, base, bonus = combine(level, band, rank, major_exempt and major)
        rows.append(
            {
                "id": q["id"],
                "prefCode": q["prefCode"],
                "pref": q["pref"],
                "lgCode": q["lgCode"],
                "display": q["display"],
                "suffix": q["suffix"],
                "answer": q["answer"],
                "population": pop,
                "a1": band,
                "b2": level,
                "b2detail": detail,
                "b4": rank,
                "b4detail": rank_detail,
                "baseStars": base,
                "b4Bonus": bonus,
                "stars": stars,
            }
        )
    return rows, upper, lower


# --- アンカー（既知例での検算） -------------------------------------------
# 「★2 付近」の 3 件は A1×B2 の 2 軸だけでは当たらない（README と Issue のコメント参照）。
ANCHORS = {
    "011002": 1,  # 札幌市
    "131041": 1,  # 新宿区
    "141003": 1,  # 横浜市（神奈川県。青森県横浜町 024066 とは別物）
    "231002": 1,  # 名古屋市
    "012033": 2,  # 小樽市
    "272078": 2,  # 高槻市
    "122220": 2,  # 我孫子市
    "392081": 3,  # 宿毛市
    "473502": 3,  # 南風原町
    "473626": 3,  # 八重瀬町（アンカー候補の「東風平」は 2006 年の合併で消滅したため差し替え）
    "122351": 3,  # 匝瑳市
}

# 政令指定都市 20 市と都道府県庁所在地。A1 の「有名」帯に全部入るかを検算する。
# 東京都は都庁のある新宿区を代表にする。さいたま市は easy.json にない（かな書きのため
# ルール e で除外済み）ので、名前での照合から自然に外れる。
SEIREI = (
    "札幌", "仙台", "さいたま", "千葉", "横浜", "川崎", "相模原", "新潟", "静岡", "浜松",
    "名古屋", "京都", "大阪", "堺", "神戸", "岡山", "広島", "北九州", "福岡", "熊本",
)
CAPITALS = (
    "札幌", "青森", "盛岡", "仙台", "秋田", "山形", "福島", "水戸", "宇都宮", "前橋",
    "さいたま", "千葉", "新宿", "横浜", "新潟", "富山", "金沢", "福井", "甲府", "長野",
    "岐阜", "静岡", "名古屋", "津", "大津", "京都", "大阪", "神戸", "奈良", "和歌山",
    "鳥取", "松江", "岡山", "広島", "山口", "徳島", "高松", "松山", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "那覇",
)
# 同名の別自治体（青森県横浜町・福島県広島…）を拾わないよう、県庁所在地は県コードで縛る。
CAPITAL_PREF = {name: f"{i:02d}" for i, name in enumerate(CAPITALS, start=1)}


def is_major(display: str, pref_code: str, suffix: str) -> bool:
    """政令指定都市 or 都道府県庁所在地か（同名の別自治体を拾わないよう県コードで縛る）。"""
    if CAPITAL_PREF.get(display) == pref_code:
        return True
    return display in SEIREI and suffix == "市"


def sanity_capitals(rows: list) -> list:
    """政令市・県庁所在地のうち「有名」帯に入らなかったものを返す。"""
    return [r for r in rows
            if is_major(r["display"], r["prefCode"], r["suffix"]) and r["a1"] != "有名"]


def markdown_table(rows: list) -> str:
    lines = [
        "| 地名（接尾辞） | 都道府県 | 読み | 人口 | A1 | B2（割り当て） | B4 | ★ |",
        "|---|---|---|---:|---|---|---|---|",
    ]
    for r in rows:
        pop = f"{r['population']:,}" if r["population"] is not None else "—"
        bonus = f" +{r['b4Bonus']}" if r["b4Bonus"] else ""
        lines.append(
            f"| {r['display']}（{r['suffix']}） | {r['pref']} | {r['answer']} | {pop} "
            f"| {r['a1']} | ({r['b2']}) {r['b2detail']} | {r['b4detail']}{bonus} "
            f"| {'★' * r['stars']} |"
        )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="市区町村名に難易度 ★ を付ける試作（Issue #33）")
    ap.add_argument("--questions", type=Path,
                    default=REPO / "public" / "questions" / DATA_VERSION / "easy.json")
    ap.add_argument("--geo", type=Path, default=REPO / "public" / "geo" / "municipalities.json")
    ap.add_argument("--kanjidic", type=Path, default=KANJIDIC2_CACHE)
    ap.add_argument("--download", action="store_true", help="KANJIDIC2 が無ければ取得する")
    ap.add_argument("--nanori", choices=("b", "c"), default="c",
                    help="名乗り読みでしか分解できないものを (b) 変化あり とみなすか（既定 c）")
    ap.add_argument("--major-exempt", action="store_true",
                    help="政令市・県庁所在地は B4 の加算を免除する（Issue #33 の軸 A2 の試し打ち）")
    ap.add_argument("--sample", type=int, default=0,
                    help="サンプル表の件数。アンカーを必ず含め、残りを無作為抽出する")
    ap.add_argument("--seed", type=int, default=20261003)
    ap.add_argument("--markdown", type=Path, help="サンプル表の書き出し先")
    ap.add_argument("--json", type=Path, help="全件の判定を JSON Lines で書き出す")
    args = ap.parse_args()

    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    geo = json.loads(args.geo.read_text(encoding="utf-8"))
    kd = load_kanjidic(args.kanjidic, download=args.download)

    rows, upper, lower = judge_all(questions, geo, kd, args.nanori, args.major_exempt)
    by_lg = {r["lgCode"]: r for r in rows}

    print(f"問題 {len(rows)} 件 / KANJIDIC2 {len(kd)} 字 / 名乗りの扱い=({args.nanori})"
          f"{' / 政令市・県庁所在地は B4 免除' if args.major_exempt else ''}")
    print(f"A1 の境界: 有名 ≥ {upper:,} 人（p{FAME_UPPER_Q:.0%}）／"
          f"無名 < {lower:,} 人（p{FAME_LOWER_Q:.0%}）")
    bands = Counter(r["a1"] for r in rows)
    print("  " + " / ".join(f"{b} {bands[b]}" for b in FAME_LABELS))
    strays = sanity_capitals(rows)
    if strays:
        print("  ⚠ 政令市・県庁所在地で『有名』に入らなかったもの: "
              + " ".join(f"{r['display']}{r['suffix']}({r['population']:,}/{r['a1']})"
                         for r in strays))
    else:
        print("  政令市 20 市・県庁所在地はすべて『有名』帯に入る")

    b2 = Counter(r["b2"] for r in rows)
    print("B2: " + " / ".join(f"({k}) {B2_LABELS[k]} {b2[k]}" for k in "abc"))
    undecomposable = [r for r in rows if r["b2detail"] == "分解不能"]
    print(f"  うち名乗りを使っても分解できない: {len(undecomposable)} 件")

    b4 = Counter(r["b4"] for r in rows)
    print("B4: " + " / ".join(f"{B4_LABELS[k]} {b4[k]} (+{B4_BONUS[k]})" for k in range(4)))

    stars = Counter(r["stars"] for r in rows)
    base = Counter(r["baseStars"] for r in rows)
    print("素点の分布（B2×A1 のみ）: "
          + " / ".join(f"{'★' * s} {base[s]}" for s in (1, 2, 3)))
    print("★ の分布（全 {} 件・B4 加算後）: ".format(len(rows))
          + " / ".join(f"{'★' * s} {stars[s]} ({stars[s] / len(rows):.0%})" for s in (1, 2, 3)))
    moved = sum(1 for r in rows if r["stars"] != r["baseStars"])
    print(f"  B4 で ★ が上がった: {moved} 件")

    cross = Counter((r["b2"], r["a1"]) for r in rows)
    print("クロス集計（B2 × A1。括弧内は B4 加算前の素点）:")
    print("            " + "".join(f"{b:>10}" for b in FAME_LABELS))
    for k in "abc":
        cells = "".join(f"{cross[(k, b)]:>6} (★{STAR_TABLE[k][b]})" for b in FAME_LABELS)
        print(f"  ({k}) {B2_LABELS[k]:<5}{cells}")

    cube = Counter((r["b2"], r["a1"], r["b4"]) for r in rows)
    print("B2 × A1 × B4 の各升（件数／確定する ★）:")
    for rank in range(4):
        print(f"  B4={B4_LABELS[rank]}(+{B4_BONUS[rank]})"
              + "".join(f"{b:>12}" for b in FAME_LABELS))
        for k in "abc":
            cells = ""
            for b in FAME_LABELS:
                n = cube[(k, b, rank)]
                cells += f"{n:>7} (★{combine(k, b, rank)[0]})"
            print(f"    ({k}) {B2_LABELS[k]:<5}{cells}")

    hit = 0
    print("アンカーの検算:")
    for lg, want in ANCHORS.items():
        r = by_lg.get(lg)
        if r is None:
            print(f"  -- {lg}: easy.json に無い")
            continue
        ok = r["stars"] == want
        hit += ok
        print(f"  {'OK' if ok else 'NG'} {r['display']}{r['suffix']}: 期待★{want} / 判定★{r['stars']}"
              f" [{r['a1']} / ({r['b2']}) {r['b2detail']} / B4 {r['b4detail']} +{r['b4Bonus']}"
              f" → 素点★{r['baseStars']}]")
    print(f"  一致 {hit}/{len(ANCHORS)}")

    # KANJIDIC2 に無い字（JIS 外字などの取りこぼしの検出）
    missing = Counter()
    for r in rows:
        for ch in r["display"]:
            if ch in kd or ch == REPEAT_MARK or ch in EXTRA_KANA_READINGS:
                continue
            if to_hira(ch) != ch or "ぁ" <= ch <= "ん":
                continue
            missing[ch] += 1
    print("KANJIDIC2 に無い字: "
          + (" ".join(f"{c}×{n}" for c, n in missing.most_common()) if missing else "なし"))

    if args.json:
        args.json.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8"
        )
        print(f"書き出し {args.json}")

    if args.sample:
        rng = random.Random(args.seed)
        anchors = [by_lg[lg] for lg in ANCHORS if lg in by_lg]
        anchor_lg = {r["lgCode"] for r in anchors}
        pool = sorted((r for r in rows if r["lgCode"] not in anchor_lg), key=lambda r: r["id"])
        n_random = max(args.sample - len(anchors), 0)
        picked = rng.sample(pool, min(n_random, len(pool))) + anchors
        picked.sort(key=lambda r: (-r["stars"], r["prefCode"], r["lgCode"]))
        sstars = Counter(r["stars"] for r in picked)
        print(f"サンプル {len(picked)} 件（無作為 {n_random} + アンカー {len(anchors)}・"
              f"seed={args.seed}）: "
              + " / ".join(f"{'★' * s} {sstars[s]}" for s in (1, 2, 3)))
        table = markdown_table(picked)
        if args.markdown:
            args.markdown.write_text(table + "\n", encoding="utf-8")
            print(f"書き出し {args.markdown}")
        else:
            print(table)
    return 0


if __name__ == "__main__":
    sys.exit(main())
