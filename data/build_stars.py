#!/usr/bin/env python3
"""地名の難易度 ★（1〜3）を機械的に付ける（Issue #33・#46・外部ライブラリ不使用）。

科目ごとに軸が違う（**どちらも判定のコードは同じ** classify_b2 / b4_rank を使う）。

市区町村名（mode e・judge_all）
    Issue #33 の軸のうち **A1（人口による知名度）**・**B2（漢字の音訓辞書で公式読みを
    分解できるか）**・**B4（漢字の難しさ）** の 3 軸。B2×A1 の表で素点を出して B4 で加算する。

町名（mode d・judge_towns）
    Issue #46 の案 C。**A1 は使わない**（町名に人口は無く、所属市区町村の人口は
    「町名の有名さ」を表さない）。B2 の素点（a=1／b=2／c=3）に B4 を加算し、
    **B5**（同じ表記が全国の町名で 2 通り以上に読まれる）を **B2 が a のときだけ** +1 する。
    さらに町名だけ、(b) 変化あり の候補を 2 つ広げる（Issue #54）。
      ① 五段動詞の訓読みの**連用形**（ふ.す → ふし・す.む → すみ）＝ 規則（renyokei_forms）
      ② 地名で定着した名乗り読みの**人手の上書き表**（data/stars_manual.tsv）
    どちらも **judge_towns だけ**が使う（judge_all ＝ 市区町村名は従来どおり名乗りを (c) に
    置く。規則を当てると登別・盛岡・成田 などの ★ が動いて「今日の10問」の過去の
    セットが別の 10 問になるため。Issue #54 の「やらないこと」）。

**この判定が問題バンクの `stars` の正本。** `build_questions.py` が judge_all() /
judge_towns_with_rules() を呼んで各問に書き込む（＝ここを直すと問題バンクの難易度が変わるので、
変更後は `npm run build:questions` で作り直す）。このスクリプト単体では JSON を
書き換えず、分布・クロス集計・アンカーの検算だけを出す。

入力
    public/questions/{DATA_VERSION}/easy.json          … display / answer / lgCode / pref
    public/questions/{DATA_VERSION}/difficult/*.json   … --towns のときの町名 107,681 件
    public/geo/municipalities.json                     … lgCode → population（国勢調査 2020）
    KANJIDIC2                                          … 漢字の音読み・訓読み・名乗りと配当学年
    data/stars_manual.tsv                              … 町名だけに当てる人手の上書き表（Issue #54）

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
    python3 data/build_stars.py --towns                           # 町名（B2×B4×B5・A1 なし）
    python3 data/build_stars.py --towns --sample 100 --seed 20261005 \
        --markdown /tmp/towns100.md                               # Issue #46 のサンプル表
    python3 data/build_stars.py --towns --manual /dev/null        # 上書き表なしで町名を判定する
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
from collections import Counter, defaultdict
from functools import partial
from pathlib import Path

from build_questions import DATA_VERSION, to_hira

REPO = Path(__file__).resolve().parent.parent
KANJIDIC2_URL = "https://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
KANJIDIC2_CACHE = Path.home() / "workspace" / "abr-data" / "raw" / "kanjidic2" / "kanjidic2.xml.gz"
# 町名だけに当てる人手の上書き表（Issue #54）。judge_towns が読む。
STARS_MANUAL = Path(__file__).resolve().parent / "stars_manual.tsv"

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

# --- 町名の総合: B2 の素点 ＋ B4 ＋ B5（Issue #46 の案 C）-------------------
# 町名に人口は無いので A1 を使わず、B2 の段階そのものを素点にする。
# 市区町村名の STAR_TABLE で言えば「A1 を『ふつう』に固定した列」と同じ並び。
TOWN_B2_BASE = {"a": 1, "b": 2, "c": 3}
# B5（同表記異読み）の加算。**B2 が a のときだけ** 足す。b・c にも足すと
# 中島（なかじま・連濁）や 新橋（しんばし・連濁）が ★3 に上がって ★3 が水で薄まる。
TOWN_B5_BONUS = 1

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

# --- 連用形（五段動詞）と人手の上書き表の種別ラベル（Issue #54）---------------
# ウ段 → イ段。送り仮名の末尾を変えて連用形を作る（す.む → すみ・ふ.す → ふし）。
U_TO_I = {"う": "い", "く": "き", "ぐ": "ぎ", "す": "し", "つ": "ち",
          "ぬ": "に", "ぶ": "び", "む": "み", "る": "り"}
# 末尾が「る」で直前がエ段なら下一段（あ.ける・こ.える）。接頭辞 あけ・こえ は
# kun_forms が既に出すので、連用形は作らない（あけり のような形を混ぜない）。
E_ROW = "えけげせぜてでねへべぺめれ"
VERB_KIND = "連用"  # 連用形で読んだ印。format_segments に「住=すみ(連用)」と出る
MANUAL_KIND = "定着"  # 上書き表で読んだ印。「長谷=はせ(定着)」


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


def renyokei_forms(kun: str) -> list:
    """五段動詞の訓読み（送り仮名付き）から連用形を作る（Issue #54）。
    'ふ.す' → ['ふし']、'す.む' → ['すみ']、'あ.る' → ['あり']、'と.まる' → ['とまり']。

    地名では動詞の連用形がそのまま使われる（住吉＝すみよし・伏見＝ふしみ・成田＝なりた）。
    送り仮名の末尾がウ段なら、そこをイ段に変えた形を 1 つ返す。
    返さないのは次の場合:
      - 送り仮名が無い（'はら'・'まつ' のような名詞の訓。松＝まち を作らないため）
      - 送り仮名の末尾がウ段でない（'ちい.さい'・'たか.い'）
      - 末尾が「る」で直前がエ段 ＝ 下一段（'あ.ける' → あけり は作らない）
    """
    if "." not in kun:
        return []
    stem, okuri = kun.split(".", 1)
    stem = stem.replace("-", "")
    okuri = okuri.replace("-", "")
    if not stem or not okuri or okuri[-1] not in U_TO_I:
        return []
    full = stem + okuri
    if okuri[-1] == "る" and len(full) >= 2 and full[-2] in E_ROW:
        return []
    return [full[:-1] + U_TO_I[okuri[-1]]]


def load_kanjidic(path: Path = KANJIDIC2_CACHE, download: bool = False) -> dict:
    """KANJIDIC2 を読み、{漢字: {'on', 'kun', 'verb_stem', 'nanori', 'grade'}} を返す。
    読みはすべてひらがな。'kun' は kun_forms() で展開済み（先頭が幹）。
    'verb_stem' は renyokei_forms() で作った五段動詞の連用形（Issue #54）。
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
        on, kun, verb_stem = [], [], []
        for r in ch.iter("reading"):
            if not r.text:
                continue
            if r.get("r_type") == "ja_on":
                on.append(to_hira(r.text).replace("-", "").split(".")[0])
            elif r.get("r_type") == "ja_kun":
                raw = to_hira(r.text)
                kun.extend(kun_forms(raw))
                verb_stem.extend(renyokei_forms(raw))
        nanori = [to_hira(n.text) for n in ch.iter("nanori") if n.text]
        grade = ch.findtext("misc/grade")
        table[lit] = {
            "on": on,
            "kun": kun,
            "verb_stem": list(dict.fromkeys(verb_stem)),
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


def load_manual(path: Path = STARS_MANUAL) -> dict:
    """人手の上書き表（data/stars_manual.tsv）を読む（Issue #54）。

    1 行 1 読み・タブ区切りで `kind`（kanji / word）・`key`・`reading`・`note` の 4 列。
    `#` 始まりの行と空行はコメント。返す形は

        {"kanji": {字: [(読み, 種別), ...]},        … variant_candidates に足す
         "word":  {語: [(読み, 種別), ...]},        … decompose が 1 セグメントとして試す
         "rows":  [{"kind", "key", "reading", "note", "readings"}, ...]}

    `rows` は表に書いた順で、`readings` はその行の読みと音便のゆれ（連濁など）の集合。
    `--towns` が「表のどの行が何件に効いたか」を数えるのに使う。
    """
    manual = {"kanji": defaultdict(list), "word": {}, "rows": []}
    if not path.exists():
        raise SystemExit(f"上書き表が無い: {path}\n  --manual で場所を渡すか、表を作る。")
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            raise SystemExit(f"{path}:{lineno} 列が足りない（kind/key/reading/note）: {line!r}")
        kind, key, reading = (p.strip() for p in parts[:3])
        note = parts[3].strip() if len(parts) > 3 else ""
        if kind not in ("kanji", "word"):
            raise SystemExit(f"{path}:{lineno} kind は kanji か word: {kind!r}")
        if kind == "kanji" and len(key) != 1:
            raise SystemExit(f"{path}:{lineno} kanji の key は 1 字（語は word 行で）: {key!r}")
        pairs = _dedup([(reading, MANUAL_KIND), *_sound_changes(reading, MANUAL_KIND)])
        if kind == "kanji":
            # 音便のゆれは variant_candidates がまとめて足すので、ここは読みそのものだけ
            manual["kanji"][key].append((reading, MANUAL_KIND))
        else:
            # 語は decompose に直接渡る（variant_candidates を通らない）ので、ここで足す
            manual["word"].setdefault(key, []).extend(pairs)
        manual["rows"].append(
            {"kind": kind, "key": key, "reading": reading, "note": note,
             "readings": {r for r, _k in pairs}}
        )
    # 語は長い方から試す（短い語が長い語を食わないように）
    manual["word"] = dict(sorted(manual["word"].items(), key=lambda kv: -len(kv[0])))
    manual["kanji"] = dict(manual["kanji"])
    return manual


def variant_candidates(char: str, kd: dict, manual: dict | None = None,
                       verb_stem: bool = False) -> list:
    """(b) 変化あり: (a) に音便のゆれを足す。連濁・半濁音化・促音化・長音のゆれ・
    末尾の母音の脱落と、漢字以外の字の追加読み（ケ→か など）。
    **名乗り読みは含めない**（nanori_candidates を参照）。

    町名だけ（Issue #54）、呼び出し側が次の 2 つを足せる。どちらも音便のゆれを通す。
      verb_stem=True … 五段動詞の連用形（種別「連用」）
      manual         … 人手の上書き表の kanji 行（種別「定着」）
    """
    out = list(plain_candidates(char, kd))
    for r in EXTRA_KANA_READINGS.get(char, ()):
        out.append((r, "字"))
    entry = kd.get(char)
    if verb_stem and entry:
        for r in entry.get("verb_stem", ()):
            out.append((r, VERB_KIND))
    if manual:
        out.extend(manual["kanji"].get(char, ()))
    for r, kind in list(out):
        out.extend(_sound_changes(r, kind))
    return _dedup(out)


def nanori_candidates(char: str, kd: dict, manual: dict | None = None,
                      verb_stem: bool = False) -> list:
    """(b) に名乗り読み（とその音便）を足した候補。

    既定ではこれを **(c) の内訳を人が読めるようにするためだけ**に使い、★ の判定では
    (b) に昇格させない（`--nanori b` で切り替えられる）。KANJIDIC2 の <nanori> には
    「その地名があるからこそ載っている読み」が入っているため: 宿=すく ← 宿毛、
    南=は・風=え・原=ばる ← 南風原。名乗りを (b) に入れると ★3 にしたい当て字が
    そのまま ★2 に落ち、アンカーの一致が 7/11 → 4/11 に下がる。

    「どの名乗りを地名として認めるか」を 1 行ずつ選ぶのが人手の上書き表（Issue #54）で、
    そちらは種別「定着」で (b) に入る。"""
    out = list(variant_candidates(char, kd, manual, verb_stem))
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


def decompose(display: str, answer: str, candidates, words: dict | None = None) -> list:
    """`display` を 1 字ずつ読みに割り当てて `answer` を左から消費できるかを DP で判定する。
    割り当てられたら [(字, 読み, 種別), ...]、できなければ None。
    `candidates(char, prev_reading)` が候補を返す。「々」は直前の字の読みを引き継ぐ。

    `words`（{語: [(読み, 種別), ...]}）を渡すと、**語をまとめて 1 セグメント**としても
    試す（長谷＝はせ のような熟字訓。Issue #54 の上書き表の word 行）。語を先に試し、
    その先で行き詰まったら 1 字ずつの候補に戻るので、渡しても分解できる範囲は狭まらない。"""
    memo = {}

    def options(i: int, prev: str) -> list:
        out = []
        if words:
            for word, readings in words.items():  # 長い語から（load_manual が並べる）
                if display.startswith(word, i):
                    out.extend((len(word), r, k) for r, k in readings)
        out.extend((1, r, k) for r, k in candidates(display[i], prev))
        return out

    def rec(i: int, j: int, prev: str):
        if i == len(display):
            return [] if j == len(answer) else None
        key = (i, j, prev)
        if key in memo:
            return memo[key]
        memo[key] = None  # 同じ状態を 2 度展開しない
        for width, reading, kind in options(i, prev):
            if answer.startswith(reading, j):
                tail = rec(i + width, j + len(reading), reading)
                if tail is not None:
                    memo[key] = [(display[i : i + width], reading, kind)] + tail
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


def classify_b2(display: str, answer: str, kd: dict, nanori_level: str = "c",
                manual: dict | None = None, verb_stem: bool = False) -> tuple:
    """B2 の段階と、人が検算できる割り当てを返す → (level, 内訳).
    level は 'a' 素直 / 'b' 変化あり / 'c' 読めない。
    nanori_level='b' にすると名乗り読みでの分解を (b) として認める。

    `manual`（人手の上書き表）と `verb_stem`（五段動詞の連用形）は **町名だけ**で有効に
    する軸なので既定は無効。judge_towns が渡し、judge_all（市区町村名）は渡さない
    （Issue #54 の「やらないこと」）。"""
    level, detail, _segs = classify_b2_segments(
        display, answer, kd, nanori_level, manual, verb_stem)
    return level, detail


def classify_b2_segments(display: str, answer: str, kd: dict, nanori_level: str = "c",
                         manual: dict | None = None, verb_stem: bool = False) -> tuple:
    """classify_b2 の中身。→ (level, 内訳, 割り当て).
    割り当て [(字または語, 読み, 種別), ...] は「連用形・上書き表が効いたか」を
    呼び出し側（judge_towns・--towns の検算）が数えるために返す。分解不能なら []。"""
    words = manual["word"] if manual else None
    variant = partial(variant_candidates, manual=manual, verb_stem=verb_stem)
    nanori = partial(nanori_candidates, manual=manual, verb_stem=verb_stem)
    # (a) 素直 には上書き表も連用形も入れない（素直な音訓だけ）
    segs = decompose(display, answer, _with_repeat(plain_candidates, kd, False))
    if segs is not None:
        return "a", format_segments(segs), segs
    segs = decompose(display, answer, _with_repeat(variant, kd, True), words)
    if segs is not None:
        return "b", format_segments(segs), segs
    segs = decompose(display, answer, _with_repeat(nanori, kd, True), words)
    if segs is not None:
        if nanori_level == "b":
            return "b", format_segments(segs), segs
        return "c", "名乗り: " + format_segments(segs), segs
    return "c", "分解不能", []


def used_verb_stem(segs: list) -> bool:
    """割り当ての中で五段動詞の連用形を使ったか（Issue #54 の規則が効いた印）。"""
    return any(kind.startswith(VERB_KIND) for _c, _r, kind in segs)


def manual_hits(segs: list, manual: dict | None) -> list:
    """割り当ての中で使った上書き表の行番号（表の順）。効いた行を数えるのに使う。"""
    if not manual:
        return []
    hits = []
    for i, row in enumerate(manual["rows"]):
        for seg, reading, kind in segs:
            if seg == row["key"] and kind.startswith(MANUAL_KIND) and reading in row["readings"]:
                hits.append(i)
                break
    return hits


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


def town_reading_counts(questions: list) -> dict:
    """B5 の材料。{display: 読みの種類数}。**渡した町名全体で数える**ので、
    「本町 ＝ ほんちょう／ほんまち／もとまち で 3 通り」を出すには
    **全国 107,681 件をまとめて渡す**こと（都道府県ごとに呼ぶと数が減る）。"""
    readings = defaultdict(set)
    for q in questions:
        readings[q["display"]].add(q["answer"])
    return {display: len(answers) for display, answers in readings.items()}


def judge_towns(questions: list, kd: dict, nanori_level: str = "c",
                manual: dict | None = None, verb_stem: bool = False) -> list:
    """町名（mode d）の ★ を B2 × B4 × B5 で判定する（Issue #46 の案 C。A1 は使わない）。

    `questions` は difficult/{prefCode}.json の要素（id / prefCode / pref / lgCode /
    city / display / answer）。**B5 は渡した全体で数える**ので全国分をまとめて渡す。

    `manual`（人手の上書き表）・`verb_stem`（五段動詞の連用形）は町名だけの軸（Issue #54）。
    **問題バンクに書く値は judge_towns_with_rules が正本**で、ここは両方を渡さない
    「規則なし」の判定も取れるようにしてある（--towns の before → after の検算用）。

    返す行には判定の根拠（b2detail・b4detail・readings・b5・verbStem・manual）も入れて、
    ★ がその値になった理由を人が 1 件ずつ検算できるようにする。
    """
    counts = town_reading_counts(questions)
    rows = []
    for q in questions:
        level, detail, segs = classify_b2_segments(
            q["display"], q["answer"], kd, nanori_level, manual, verb_stem)
        rank, rank_detail = b4_rank(q["display"], kd)
        n_readings = counts[q["display"]]
        b5 = level == "a" and n_readings >= 2
        base = TOWN_B2_BASE[level]
        bonus = B4_BONUS[rank] + (TOWN_B5_BONUS if b5 else 0)
        rows.append(
            {
                "id": q["id"],
                "prefCode": q["prefCode"],
                "pref": q["pref"],
                "lgCode": q["lgCode"],
                "city": q.get("city", ""),
                "display": q["display"],
                "answer": q["answer"],
                "b2": level,
                "b2detail": detail,
                "b4": rank,
                "b4detail": rank_detail,
                "readings": n_readings,
                "b5": b5,
                "verbStem": used_verb_stem(segs),
                "manual": manual_hits(segs, manual),
                "baseStars": base,
                "stars": min(3, base + bonus),
            }
        )
    return rows


def judge_towns_with_rules(questions: list, kd: dict, manual: dict | None = None,
                           manual_path: Path = STARS_MANUAL, nanori_level: str = "c") -> list:
    """**問題バンクの町名の `stars` の正本**（Issue #54）。judge_towns に町名だけの軸
    （五段動詞の連用形 ＋ 人手の上書き表）を両方当てて判定する。
    build_questions.attach_town_stars と --towns の「after」はどちらもこれを呼ぶので、
    **問題バンクの値と検算の値がずれない**。`manual` を渡さなければ表を読み込む。"""
    return judge_towns(questions, kd, nanori_level,
                       manual=manual if manual is not None else load_manual(manual_path),
                       verb_stem=True)


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

# 町名のアンカー（表記 → 期待する ★）。市区町村をまたいで同じ表記があるので lgCode では
# 縛らず、**表記で引いて lgCode 順に TOWN_ANCHOR_MAX 件まで**出す（放出東・舎人 のような
# 1 件しか無いものと、本町・中央 のような全国に散っているものを同じ表で見るため）。
# 期待値の根拠は Issue #46 のコメント（案 C の 100 件サンプルと一緒に本人が確認した）。
TOWN_ANCHORS = (
    ("放出東", 3),    # 名乗り（出=てん）でしか分解できない
    ("舎人", 3),      # 熟字訓・分解不能
    ("御器所", 3),    # 分解不能
    ("東雲町", 3),    # 名乗り（東=しの）。上書き表に入れなかった読み（Issue #54）
    ("雑餉隈町", 3),  # 分解不能 ＋ 表外（餉）
    ("立売堀", 3),    # 分解不能
    ("太秦", 3),      # 分解不能 ＋ 人名用（秦）
    ("等々力", 3),    # 分解不能（世田谷区・川崎市中原区の 2 件）
    ("馬喰町", 3),    # 分解不能 ＋ 人名用（喰）。読みは 3 通り
    ("中島", 2),      # b 連濁。読み 2 通りでも b には B5 を足さない
    ("新橋", 2),      # b 連濁。読み 3 通りでも同じ
    ("本町", 2),      # a ＋ B5（ほんちょう／ほんまち／もとまち）
    ("栄町", 2),      # a ＋ B5
    ("中央", 1),      # a ＋ 読み 1 通り ＝ B5 なし
    ("山田", 2),      # b 連濁
    ("大平", 2),      # おおひら（a ＋ B5）と おおびら（b）がどちらも ★2
    ("白金", 2),      # a ＋ B5（しろがね／しろかね）
    ("十三", 1),      # a ＋ 読み 1 通り
    # 以下は Issue #54 で ★3 から落ちたもの（規則＝連用形／上書き表＝定着した名乗り）
    ("伏見", 2),      # b 伏=ふし（連用。ふ.す）
    ("成田町", 2),    # b 成=なり（連用。な.る）
    ("住吉町", 2),    # b 住=すみ（連用。す.む）
    ("有明", 2),      # b 有=あり（連用。あ.る）
    ("清水", 2),      # b 清=し（上書き表）
    ("春日", 2),      # b 春=かす（上書き表）＋ 日=が（連濁）
    ("常盤町", 2),    # b 常=とき・盤=わ（上書き表の 2 行）
    ("長谷", 2),      # b 長谷=はせ（上書き表の word 行）
)
TOWN_ANCHOR_MAX = 2

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


def readings_cell(row: dict) -> str:
    """町名の表の「全国の読み方」。（+1）は B5 が効いた印。"""
    return f"{row['readings']} 通り" + ("（+1）" if row["b5"] else "")


def markdown_table_towns(rows: list) -> str:
    """町名のサンプル表（Issue #46 のコメントと同じ列・同じ並び）。"""
    lines = [
        "| # | 都道府県 | 市区町村 | 町名 | 読み | B2 | B4 | 全国の読み方 | ★ |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(rows, start=1):
        lines.append(
            f"| {i} | {r['pref']} | {r['city']} | {r['display']} | {r['answer']} "
            f"| {r['b2']} {r['b2detail']} | {r['b4detail']} | {readings_cell(r)} "
            f"| {'★' * r['stars']} |"
        )
    return "\n".join(lines)


def markdown_table_town_anchors(rows: list) -> str:
    """既知の町名での検算表。列は Issue #46 のコメントと同じ。"""
    lines = [
        "| 町名 | 読み | 市区町村 | B2 | B4 | 全国の読み方 | ★ |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['display']} | {r['answer']} | {r['city']} "
            f"| {r['b2']} {r['b2detail']} | {r['b4detail']} | {readings_cell(r)} "
            f"| {'★' * r['stars']} |"
        )
    return "\n".join(lines)


def load_town_questions(difficult_dir: Path) -> list:
    """difficult/{prefCode}.json を全部読んで id 順に並べる（＝全国 1 本の母集団）。
    B5 を全国で数えるため、都道府県ごとに分けずにまとめて返す。"""
    files = sorted(difficult_dir.glob("*.json"))
    if not files:
        raise SystemExit(
            f"町名の問題バンクが無い: {difficult_dir}/*.json\n"
            f"  npm run build:questions で生成するか、--difficult-dir で場所を渡す。"
        )
    questions = []
    for path in files:
        questions.extend(json.loads(path.read_text(encoding="utf-8")))
    questions.sort(key=lambda q: q["id"])
    return questions


def town_anchor_rows(rows: list) -> list:
    """TOWN_ANCHORS の表記に当たる行を、表記の並び → lgCode 順に集める。"""
    by_display = defaultdict(list)
    for r in rows:
        by_display[r["display"]].append(r)
    picked = []
    for display, _want in TOWN_ANCHORS:
        hits = sorted(by_display.get(display, []), key=lambda r: r["lgCode"])
        picked.extend(hits[:TOWN_ANCHOR_MAX])
    return picked


def star_distribution(rows: list) -> str:
    """★ の分布を 1 行で（件数と割合）。`rows` は judge_towns / judge_all の返り値。"""
    stars = Counter(r["stars"] for r in rows)
    return " / ".join(f"{'★' * s} {stars[s]:,} ({stars[s] / len(rows):.0%})" for s in (1, 2, 3))


def askable_rows(rows: list, questions: list) -> list:
    """出題できる問だけ（ルール h の `skip` が付いていないもの）。README の分布はこちら。"""
    skipped = {q["id"] for q in questions if "skip" in q}
    return [r for r in rows if r["id"] not in skipped]


def print_rule_effects(rows: list, base_rows: list, manual: dict) -> None:
    """規則（連用形）と上書き表が「(c) 読めない」から何件を動かしたかを出す（Issue #54）。
    表の行ごとの件数も出して、1 件も効いていない行（＝消してよい行）を見つけられるようにする。"""
    was_c = {r["id"] for r in base_rows if r["b2"] == "c"}
    base_stars = {r["id"]: r["stars"] for r in base_rows}
    moved = [r for r in rows if r["id"] in was_c and r["b2"] == "b"]
    by_rule = [r for r in moved if r["verbStem"] and not r["manual"]]
    by_manual = [r for r in moved if r["manual"] and not r["verbStem"]]
    by_both = [r for r in moved if r["manual"] and r["verbStem"]]
    print(f"(c) 読めない → (b) 変化あり に動いた町名: {len(moved):,} 件"
          f"（規則（連用形）だけ {len(by_rule):,} ／ 上書き表だけ {len(by_manual):,} ／"
          f" 両方 {len(by_both):,}）")
    for label, group in (("規則（連用形）", by_rule), ("上書き表", by_manual), ("両方", by_both)):
        dropped = [r for r in group if r["stars"] < base_stars[r["id"]]]
        print(f"  {label}: {len(group):,} 件のうち ★ が下がったのは {len(dropped):,} 件"
              f"（残りは B4 ＝ 人名用・表外の加算で ★★★ のまま）")
    changed = [r for r in rows if r["stars"] != base_stars[r["id"]]]
    moves = Counter((base_stars[r["id"]], r["stars"]) for r in changed)
    print(f"★ が変わった町名: {len(changed):,} 件"
          + ("（" + " / ".join(f"{'★' * a}→{'★' * b} {n:,}" for (a, b), n in sorted(moves.items()))
             + "）" if changed else ""))

    hits = Counter()
    for r in moved:
        for i in r["manual"]:
            hits[i] += 1
    print(f"上書き表の行ごとの効き（全 {len(manual['rows'])} 行・data/stars_manual.tsv）:")
    for i, row in enumerate(manual["rows"]):
        n = hits[i]
        mark = "  ⚠ 0 件（この行は消してよい）" if not n else ""
        print(f"  {row['kind']:<5} {row['key']}={row['reading']:<4} {n:>6,} 件{mark}"
              f"  … {row['note']}")
    zero = [row for i, row in enumerate(manual["rows"]) if not hits[i]]
    print(f"  0 件の行: {len(zero)} 行"
          + ("（" + "・".join(f"{r['key']}={r['reading']}" for r in zero) + "）" if zero else ""))


def main_towns(args: argparse.Namespace) -> int:
    """--towns: 町名（mode d）の ★ を B2×B4×B5 で判定して分布とサンプルを出す。"""
    questions = load_town_questions(args.difficult_dir)
    kd = load_kanjidic(args.kanjidic, download=args.download)
    manual = load_manual(args.manual)
    # before: 町名だけの軸（連用形・上書き表）を当てない判定。after との差が Issue #54 の効果
    base_rows = judge_towns(questions, kd, args.nanori)
    rows = judge_towns_with_rules(questions, kd, manual, nanori_level=args.nanori)

    print(f"町名 {len(rows)} 件 / KANJIDIC2 {len(kd)} 字 / 名乗りの扱い=({args.nanori})"
          f" / 上書き表 {len(manual['rows'])} 行（{args.manual}）")
    print("軸: B2（音訓分解）の素点 ＋ B4（漢字の難しさ）＋ B5（同表記異読み・a のみ +1）"
          "／ A1（人口）は使わない")
    print("町名だけの軸（Issue #54）: 五段動詞の連用形（種別「連用」）と"
          "人手の上書き表（種別「定着」）を (b) に入れる")

    b2 = Counter(r["b2"] for r in rows)
    print("B2: " + " / ".join(
        f"({k}) {B2_LABELS[k]} {b2[k]} ({b2[k] / len(rows):.0%})" for k in "abc"))
    undecomposable = sum(1 for r in rows if r["b2detail"] == "分解不能")
    nanori_only = sum(1 for r in rows if r["b2detail"].startswith("名乗り: "))
    print(f"  うち名乗りでしか分解できない: {nanori_only} 件 "
          f"／ 名乗りを使っても分解できない: {undecomposable} 件")

    b4 = Counter(r["b4"] for r in rows)
    print("B4: " + " / ".join(
        f"{B4_LABELS[k]} {b4[k]} (+{B4_BONUS[k]})" for k in range(4)))
    b5 = sum(1 for r in rows if r["b5"])
    multi = sum(1 for r in rows if r["readings"] >= 2)
    print(f"B5: 同じ表記が 2 通り以上に読まれる町名 {multi} 件 "
          f"／ そのうち B2 が (a) で +1 が効いた {b5} 件")

    print(f"★ の分布（全 {len(rows):,} 件）")
    print(f"  before（町名だけの軸なし）: {star_distribution(base_rows)}")
    print(f"  after （連用形 ＋ 上書き表）: {star_distribution(rows)}")
    askable_base = askable_rows(base_rows, questions)
    askable_after = askable_rows(rows, questions)
    print(f"★ の分布（出題できる {len(askable_after):,} 件・ルール h の skip を除く。"
          f"README の表と同じ母集団）")
    print(f"  before: {star_distribution(askable_base)}")
    print(f"  after : {star_distribution(askable_after)}")
    print_rule_effects(rows, base_rows, manual)

    cube = Counter((r["b2"], r["b4"], r["b5"]) for r in rows)
    print("B2 × B4 × B5 の各升（件数／確定する ★）:")
    for k in "abc":
        for rank in range(4):
            for flag in (False, True):
                n = cube[(k, rank, flag)]
                if not n:
                    continue
                star = min(3, TOWN_B2_BASE[k] + B4_BONUS[rank] + (TOWN_B5_BONUS if flag else 0))
                mark = "あり" if flag else "—"
                print(f"  ({k}) {B2_LABELS[k]:<5} / {B4_LABELS[rank]:<4} / B5 {mark:<4}"
                      f" → {'★' * star}  {n:>7} 件")

    # 都道府県ごと・地域ごとの最小値（★ で絞って 10 問を組めるかの目安）
    by_pref = defaultdict(Counter)
    for r in rows:
        by_pref[r["prefCode"]][r["stars"]] += 1
    print("都道府県ごとの ★ 別件数の最小値: "
          + " / ".join(f"{'★' * s} {min(c[s] for c in by_pref.values())}" for s in (1, 2, 3)))

    anchors = town_anchor_rows(rows)
    hit = sum(1 for r in anchors if r["stars"] == dict(TOWN_ANCHORS)[r["display"]])
    print(f"既知の町名での検算（同じ表記は {TOWN_ANCHOR_MAX} 件まで）: "
          f"一致 {hit}/{len(anchors)}")
    print(markdown_table_town_anchors(anchors))

    if args.json:
        args.json.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8"
        )
        print(f"書き出し {args.json}")

    if args.sample:
        rng = random.Random(args.seed)
        picked = rng.sample(rows, min(args.sample, len(rows)))
        picked.sort(key=lambda r: (r["stars"], r["prefCode"], r["lgCode"], r["display"]))
        sstars = Counter(r["stars"] for r in picked)
        print(f"サンプル {len(picked)} 件（seed={args.seed}）: "
              + " / ".join(f"{'★' * s} {sstars[s]}" for s in (1, 2, 3)))
        table = markdown_table_towns(picked)
        if args.markdown:
            args.markdown.write_text(table + "\n", encoding="utf-8")
            print(f"書き出し {args.markdown}")
        else:
            print(table)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="地名に難易度 ★ を付ける（Issue #33・#46）")
    ap.add_argument("--questions", type=Path,
                    default=REPO / "public" / "questions" / DATA_VERSION / "easy.json")
    ap.add_argument("--difficult-dir", type=Path,
                    default=REPO / "public" / "questions" / DATA_VERSION / "difficult",
                    help="--towns のときに読む町名の問題バンク")
    ap.add_argument("--geo", type=Path, default=REPO / "public" / "geo" / "municipalities.json")
    ap.add_argument("--kanjidic", type=Path, default=KANJIDIC2_CACHE)
    ap.add_argument("--manual", type=Path, default=STARS_MANUAL,
                    help="町名に当てる人手の上書き表（Issue #54。--towns のときだけ読む）")
    ap.add_argument("--download", action="store_true", help="KANJIDIC2 が無ければ取得する")
    ap.add_argument("--towns", action="store_true",
                    help="市区町村名のかわりに町名（mode d）を判定する（B2×B4×B5・A1 なし）")
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

    if args.towns:
        if args.major_exempt:
            ap.error("--major-exempt は市区町村名だけの軸（A2）なので --towns と併用できない")
        return main_towns(args)

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
