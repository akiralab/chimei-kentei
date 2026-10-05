#!/usr/bin/env python3
"""build_questions.py の前処理ルールの単体テスト（標準ライブラリのみ）。

実行: python3 -m unittest discover -s data -p 'test_*.py'
      python3 -m unittest data/test_build_questions.py   （下の sys.path 追加で単体でも動く）
"""

import sys
import unittest
from pathlib import Path

# attach_stars() は隣の build_stars を遅延 import する。ファイル直指定で呼ばれたとき
# （unittest が data/ を sys.path に入れないとき）にも見えるようにしておく。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_questions import (  # noqa: E402
    KANJI_ONLY,
    askable,
    attach_skips,
    attach_stars,
    load_stars_inputs,
    check_digit,
    city_code_from_ward,
    has_kanji,
    skip_reason,
    stars_triple,
    to_hira,
)
from build_stars import kun_forms  # noqa: E402


class TestHasKanji(unittest.TestCase):
    """ルール e（easy）: 幹に漢字が 1 字も無いものを除外する判定。"""

    def test_かなだけの幹は漢字なし(self):
        # Issue #14 で easy から除外した 41 件のうちの代表例
        for stem in ("せたな", "ニセコ", "つくばみらい", "さいたま", "いの", "うるま"):
            with self.subTest(stem=stem):
                self.assertFalse(has_kanji(stem))

    def test_漢字が混ざる幹は残す(self):
        # 漢字 1 字でも含めば読みとして成立するので easy に残す
        for stem in ("鎌ケ谷", "ふじみ野", "南アルプス", "匝瑳", "十和田"):
            with self.subTest(stem=stem):
                self.assertTrue(has_kanji(stem))

    def test_々_と_〆_も漢字として扱う(self):
        for stem in ("佐々", "〆野", "〆"):
            with self.subTest(stem=stem):
                self.assertTrue(has_kanji(stem))

    def test_かな以外でも漢字でなければ漢字なし(self):
        for stem in ("", "ー", "・", "123", "ＡＢ"):
            with self.subTest(stem=stem):
                self.assertFalse(has_kanji(stem))

    def test_difficult_のルール_e_は漢字のみを要求する(self):
        # easy（1 字以上）と difficult（すべて漢字）の違いを固定する
        self.assertTrue(has_kanji("鎌ケ谷"))
        self.assertIsNone(KANJI_ONLY.match("鎌ケ谷"))
        self.assertIsNotNone(KANJI_ONLY.match("佐々"))
        self.assertIsNotNone(KANJI_ONLY.match("〆野"))


class TestToHira(unittest.TestCase):
    def test_カタカナをひらがなに直す(self):
        self.assertEqual(to_hira("ソウサ"), "そうさ")
        self.assertEqual(to_hira("ニセコ"), "にせこ")

    def test_長音符はそのまま(self):
        self.assertEqual(to_hira("トーキョー"), "とーきょー")


class TestCityCode(unittest.TestCase):
    def test_検査数字(self):
        self.assertEqual(check_digit("01100"), "2")
        self.assertEqual(check_digit("27100"), "4")

    def test_政令市の市コードは区コードの先頭_4_桁から導く(self):
        self.assertEqual(city_code_from_ward(["011012", "011021"]), "011002")
        self.assertEqual(city_code_from_ward(["141305", "141313"]), "141305")


# --- 難易度 ★（attach_stars） ---------------------------------------------
# KANJIDIC2（約 15 MB）をダウンロードしなくても動くよう、下の 5 字だけのダミーを使う。
# 読みと <grade> は KANJIDIC2 2026-09 版の写し（訓の送り仮名「.」も残す）。
# ★ の軸そのもののテストは data/test_build_stars.py の担当で、ここは
# **easy の全問に 1〜3 が付くこと**と、分位点・B4 加算・上限が通っていることだけを見る。
DUMMY_READINGS = {
    # 字: (音, 訓, 名乗り, grade)   grade: 1〜6 教育 / 8 常用 / 9・10 人名用 / None 表外
    "青": (("せい",), ("あお", "あお-"), (), 1),
    "森": (("しん",), ("もり",), (), 1),
    "田": (("でん",), ("た",), ("で",), 1),
    "匝": (("きょう", "そう"), ("めぐ.る",), (), None),
    "瑳": (("さ",), ("みが.く",), (), 9),
}


def dummy_kanjidic() -> dict:
    """load_kanjidic() と同じ形（訓は kun_forms で展開済み）のダミー辞書。"""
    kd = {}
    for ch, (on, kun, nanori, grade) in DUMMY_READINGS.items():
        forms = []
        for k in kun:
            forms.extend(kun_forms(k))
        kd[ch] = {"on": list(on), "kun": forms, "nanori": list(nanori), "grade": grade}
    return kd


# display, answer, population, 期待する ★（理由はコメント）。
# 人口は A1 の分位点が狙った位置に来るよう等間隔に置く。5 件・最近傍順位法なので
# 有名 ≥ 4,000 人（p80）／無名 < 3,000 人（p40）になる。★1・★2・★3 を 1 件以上含める
FIXTURE_ROWS = (
    ("青森", "あおもり", 5000, 1),  # 有名 ×(a) 素直 × 教育(+0)
    ("青田", "あおだ", 4000, 1),  # 有名 ×(b) 変化あり（田 た→だ 連濁）× 教育(+0)
    ("森田", "もりた", 2000, 2),  # 無名 ×(a) 素直 × 教育(+0)
    ("田森", "あべ", 3000, 3),  # ふつう ×(c) 読めない × 教育(+0)
    ("匝瑳", "そうさ", 1000, 3),  # 無名 ×(a) 素直 × 表外(+2) → 上限 ★3
)


def easy_fixture() -> list:
    """easy.json 相当の 5 問（FIXTURE_ROWS から組む）。"""
    out = []
    for i, (display, answer, _pop, _want) in enumerate(FIXTURE_ROWS, start=1):
        lg_code = f"12{i:04d}"
        out.append(
            {
                "id": f"c:{lg_code}:{display}",
                "prefCode": "12",
                "pref": "千葉県",
                "lgCode": lg_code,
                "display": display,
                "suffix": "市",
                "answer": answer,
            }
        )
    return out


def geo_fixture(questions: list) -> dict:
    pops = tuple(pop for _d, _a, pop, _w in FIXTURE_ROWS)
    return {
        q["lgCode"]: {"lgCode": q["lgCode"], "prefCode": "12", "population": pop}
        for q, pop in zip(questions, pops)
    }


class TestAttachStars(unittest.TestCase):
    def setUp(self):
        self.questions = easy_fixture()
        self.geo = geo_fixture(self.questions)
        self.kd = dummy_kanjidic()
        self.report = {}

    def test_easy_の全問に_1から3_の_stars_が付く(self):
        attach_stars(self.questions, self.geo, self.kd, self.report)
        self.assertEqual(len(self.questions), 5)
        for q in self.questions:
            with self.subTest(display=q["display"]):
                self.assertIn("stars", q)
                self.assertIn(q["stars"], (1, 2, 3))

    def test_stars_は最後のキーとして足す(self):
        # easy.json の差分が「stars の追加」だけに収まるよう、キー順は崩さない
        attach_stars(self.questions, self.geo, self.kd, self.report)
        for q in self.questions:
            self.assertEqual(list(q)[-1], "stars")
            self.assertEqual(
                list(q)[:-1],
                ["id", "prefCode", "pref", "lgCode", "display", "suffix", "answer"],
            )

    def test_分位点と_B4_加算と上限が通っている(self):
        # 判定そのものは build_stars.py のテストが見る。ここは配線（人口 → 帯、
        # 表外 → +2、★3 で打ち切り）が生きていることを 1 件ずつ押さえる
        attach_stars(self.questions, self.geo, self.kd, self.report)
        got = {q["display"]: q["stars"] for q in self.questions}
        want = {display: stars for display, _a, _p, stars in FIXTURE_ROWS}
        self.assertEqual(got, want)
        # ★1・★2・★3 がそろっていること（配線が片側に寄っていたら気づけるように）
        self.assertEqual(set(got.values()), {1, 2, 3})

    def test_人口が取れない問も_stars_が付く(self):
        # 安全側に「無名」へ寄せる（build_stars.fame_band）。欠測で落ちないことを確かめる
        del self.geo[self.questions[0]["lgCode"]]
        attach_stars(self.questions, self.geo, self.kd, self.report)
        self.assertIn(self.questions[0]["stars"], (1, 2, 3))

    def test_report_に分布と帯の境界が入る(self):
        attach_stars(self.questions, self.geo, self.kd, self.report)
        self.assertEqual(sum(self.report["stars"].values()), 5)
        upper, lower = self.report["stars_bands"]
        self.assertEqual((upper, lower), (4000, 3000))


# --- ルール h（skip: reading・Issue #50） ---------------------------------
class TestSkipReason(unittest.TestCase):
    """読みにひらがな・ー 以外が混ざる問を出題から外す判定。"""

    def test_ひらがなと長音符だけなら出題できる(self):
        for answer in ("そうさ", "はなてんひがし", "とーきょー", "ほんちょう", "ー"):
            with self.subTest(answer=answer):
                self.assertIsNone(skip_reason(answer))

    def test_全角数字が混ざる読みは_reading(self):
        # 実データで外れる 345 件の代表例（デジタル庁のカナが漢数字を数字で書いているもの）
        for answer in ("にし１１じょうきた", "ふじちょうひがし１せん", "たんのちょう１く", "がろちょう４じょう"):
            with self.subTest(answer=answer):
                self.assertEqual(skip_reason(answer), "reading")

    def test_半角数字やカタカナや記号も_reading(self):
        for answer in ("にし11じょう", "ニセコ", "ほん・ちょう", "", "ほんちょうA"):
            with self.subTest(answer=answer):
                self.assertEqual(skip_reason(answer), "reading")


class TestAttachSkips(unittest.TestCase):
    def setUp(self):
        self.questions = [
            {"id": "o:012211:西十一条北", "answer": "にし１１じょうきた", "stars": 3},
            {"id": "o:122351:堀川", "answer": "ほりかわ", "stars": 2},
            {"id": "o:012084:端野町一区", "answer": "たんのちょう１く", "stars": 3},
        ]

    def test_該当する問だけに_skip_が付く(self):
        self.assertEqual(attach_skips(self.questions), 2)
        self.assertEqual([q.get("skip") for q in self.questions], ["reading", None, "reading"])

    def test_skip_は最後のキーとして足す(self):
        # difficult/*.json の差分が「skip の追加」だけに収まるよう、キー順は崩さない
        # （src/engine/types.ts の Question は stars の次に skip を宣言している）
        attach_skips(self.questions)
        self.assertEqual(list(self.questions[0]), ["id", "answer", "stars", "skip"])

    def test_stars_も_id_も並びも残す(self):
        # JSON から消さない（母集団の並びが変わると既存セットの 10 問が再現できない）
        before = [q["id"] for q in self.questions]
        attach_skips(self.questions)
        self.assertEqual([q["id"] for q in self.questions], before)
        self.assertEqual([q["stars"] for q in self.questions], [3, 2, 3])

    def test_askable_は_skip_を除いた問だけを返す(self):
        attach_skips(self.questions)
        self.assertEqual([q["id"] for q in askable(self.questions)], ["o:122351:堀川"])
        # meta の件数（towns / townStars / difficultCount）はこちらで数える
        self.assertEqual(stars_triple(askable(self.questions)), [0, 1, 0])
        self.assertEqual(stars_triple(self.questions), [0, 1, 2])

    def test_二度通しても件数は増えない(self):
        self.assertEqual(attach_skips(self.questions), 2)
        self.assertEqual(attach_skips(self.questions), 2)
        self.assertEqual(len(askable(self.questions)), 1)


class TestLoadStarsInputs(unittest.TestCase):
    """入力が無いときは「何が無くてどうすれば直るか」を言って止まる（黙って ★ を落とさない）。"""

    def test_人口データが無ければ止まる(self):
        missing = Path("/nonexistent/municipalities.json")
        with self.assertRaises(SystemExit) as cm:
            load_stars_inputs(missing, Path("/nonexistent/kanjidic2.xml.gz"), download=False)
        self.assertIn("build_geo.py", str(cm.exception))

    def test_KANJIDIC2_が無ければ取得コマンドを添えて止まる(self):
        geo = Path(__file__).resolve().parent.parent / "public" / "geo" / "municipalities.json"
        if not geo.exists():
            self.skipTest("public/geo/municipalities.json が無い")
        with self.assertRaises(SystemExit) as cm:
            load_stars_inputs(geo, Path("/nonexistent/kanjidic2.xml.gz"), download=False)
        self.assertIn("kanjidic", str(cm.exception).lower())


if __name__ == "__main__":
    unittest.main()
