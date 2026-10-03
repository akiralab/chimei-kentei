#!/usr/bin/env python3
"""build_stars.py（Issue #33 の難易度 ★ 試作）の単体テスト（標準ライブラリのみ）。

KANJIDIC2（約 15 MB）をダウンロードしなくても動くよう、必要な漢字の読みだけを
下の READINGS に埋め込んでいる。値は KANJIDIC2 2026-09 版の ja_on / ja_kun / nanori を
**そのまま**写したもの（訓読みの送り仮名「.」と接辞マーク「-」も残す）。

実行: python3 -m unittest discover -s data -p 'test_*.py'
      python3 -m unittest data/test_build_stars.py   （下の sys.path 追加で単体でも動く）
"""

import sys
import unittest
from pathlib import Path

# `python3 -m unittest data/test_build_stars.py` のようにファイルを直指定すると、
# unittest は data/ を sys.path に入れないので隣の build_stars が見えない。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_stars import (  # noqa: E402
    FAME_LABELS,
    STAR_TABLE,
    classify_b2,
    decompose,
    fame_band,
    format_segments,
    kun_forms,
    nanori_candidates,
    plain_candidates,
    quantile,
    strip_okurigana,
    variant_candidates,
    _with_repeat,
)

# 漢字 → (音読み, 訓読み, 名乗り)。KANJIDIC2 の表記のまま。
READINGS = {
    "松": (("しょう",), ("まつ",), ("おお", "しょ", "ま", "まっ")),
    "本": (("ほん",), ("もと",), ("まと", "ごう")),
    "坂": (("はん",), ("さか",), ("か", "ざ")),
    "横": (("おう",), ("よこ",), ()),
    "浜": (("ひん",), ("はま",), ()),
    "高": (("こう",), ("たか.い", "たか", "-だか", "たか.まる", "たか.める"),
          ("か", "こ", "じょい", "た", "はか")),
    "槻": (("き",), ("つき",), ()),
    "匝": (("きょう", "そう"), ("めぐ.る",), ()),
    "瑳": (("さ",), ("みが.く",), ()),
    "八": (("はち", "はつ"), ("や", "や.つ", "やっ.つ", "よう"), ("な", "は", "はっ", "やち", "やつ")),
    "重": (("じゅう", "ちょう"), ("え", "おも.い", "おも.り", "おも.なう", "かさ.ねる",
                                "かさ.なる", "おも"), ("さね", "しげ", "しげる")),
    "瀬": (("らい",), ("せ",), ("いわた", "がせ", "しげ", "せい", "せっ")),
    "立": (("りつ", "りゅう", "りっとる"),
          ("た.つ", "-た.つ", "た.ち-", "た.てる", "-た.てる", "た.て-", "たて-", "-た.て",
           "-だ.て", "-だ.てる"), ("たち", "たっ", "たつ", "だて", "つい")),
    "川": (("せん",), ("かわ",), ("か", "こ", "さわ")),
    "越": (("えつ", "おつ"), ("こ.す", "-こ.す", "-ご.し", "こ.える", "-ご.え"),
          ("えち", "えっ", "お", "こえ", "こし", "ごえ", "ごし", "ごや")),
    "野": (("や", "しょ"), ("の", "の-"), ("ずけ", "つけ", "ぬ")),
    "市": (("し",), ("いち",), ("い", "ち")),
    "札": (("さつ",), ("ふだ",), ("さっ",)),
    "幌": (("こう",), ("ほろ", "とばり"), ()),
    "新": (("しん",), ("あたら.しい", "あら.た", "あら-", "にい-"),
          ("あせ", "あたらし", "し", "に", "にっ", "につ", "よし")),
    "宿": (("しゅく",), ("やど", "やど.る", "やど.す"), ("すく", "ぶすき", "やけ")),
    "名": (("めい", "みょう"), ("な", "-な"), ("と",)),
    "古": (("こ",), ("ふる.い", "ふる-", "-ふる.す"), ("ふゆ",)),
    "屋": (("おく",), ("や",), ("た",)),
    "金": (("きん", "こん", "ごん"), ("かね", "かな-", "-がね"),
          ("かん", "きむ", "こ", "この", "ん")),
    "崎": (("き",), ("さき", "さい", "みさき"), ()),
    "佐": (("さ",), (), ("すけ",)),
    "池": (("ち",), ("いけ",), ()),
    "田": (("でん",), ("た",), ("いなか", "おか", "たん", "で", "とう", "や")),
    "毛": (("もう",), ("け",), ("めん", "も")),
    "南": (("なん", "な"), ("みなみ",), ("なみ", "は", "みな", "みまみ")),
    "風": (("ふう", "ふ"), ("かぜ", "かざ-"), ("い", "え")),
    "原": (("げん",), ("はら",), ("た", "ばる", "ら", "わた", "わら")),
    "我": (("が",), ("われ", "わ", "わ.が-", "わが-"), ("あ", "あが", "か")),
    "孫": (("そん",), ("まご",), ("ひ",)),
    "子": (("し", "す", "つ"), ("こ", "-こ", "ね"), ("い", "き", "ぎ", "く", "け", "ねっ")),
    "渋": (("じゅう", "しゅう"), ("しぶ", "しぶ.い", "しぶ.る"), ()),
    "谷": (("こく",), ("たに", "きわ.まる"),
          ("がい", "がえ", "がや", "せ", "たり", "たん", "や")),
    "東": (("とう",), ("ひがし",), ("あい", "あがり", "あずま", "あづま", "こち", "さき",
                                  "しの", "とお", "はる", "ひが", "もと")),
    "平": (("へい", "びょう", "ひょう"), ("たい.ら", "たい.らげる", "ひら"),
          ("たいら", "たら", "はち", "ひ", "ひとし", "へ", "へん")),
    "戸": (("こ",), ("と",), ("え", "へ")),
    "大": (("だい", "たい"), ("おお-", "おお.きい", "-おお.いに"),
          ("うふ", "お", "おう", "た", "たかし", "とも", "はじめ", "ひろ", "ひろし",
           "まさ", "まさる", "もと", "わ")),
    "和": (("わ", "お", "か"), ("やわ.らぐ", "やわ.らげる", "なご.む", "なご.やか", "あ.える"),
          ("あい", "いず", "かず", "かつ", "かつり", "かづ", "たけ", "ち", "とも", "な",
           "にぎ", "まさ", "やす", "よし", "より", "わだこ", "わっ")),
}


def build_kd() -> dict:
    """READINGS を load_kanjidic() と同じ形（訓は kun_forms で展開済み）に直す。"""
    kd = {}
    for ch, (on, kun, nanori) in READINGS.items():
        forms = []
        for k in kun:
            forms.extend(kun_forms(k))
        kd[ch] = {"on": list(on), "kun": forms, "nanori": list(nanori), "grade": None}
    return kd


KD = build_kd()


class TestStripOkurigana(unittest.TestCase):
    def test_送り仮名と接辞マークを落とす(self):
        self.assertEqual(strip_okurigana("やど.る"), "やど")
        self.assertEqual(strip_okurigana("お-"), "お")
        self.assertEqual(strip_okurigana("ちい.さい"), "ちい")
        self.assertEqual(strip_okurigana("はら"), "はら")


class TestKunForms(unittest.TestCase):
    def test_送り仮名をどこまで読むかのゆれに展開する(self):
        self.assertEqual(kun_forms("こ.える"), ["こ", "こえ", "こえる"])
        self.assertEqual(kun_forms("た.ち-"), ["た", "たち"])
        self.assertEqual(kun_forms("-ご.え"), ["ご", "ごえ"])

    def test_送り仮名が無ければ_1_つだけ(self):
        self.assertEqual(kun_forms("はら"), ["はら"])
        self.assertEqual(kun_forms("の-"), ["の"])


class TestCandidates(unittest.TestCase):
    def test_素直な候補は音訓だけ(self):
        got = dict(plain_candidates("本", KD))
        self.assertEqual(got, {"もと": "訓", "ほん": "音"})
        self.assertNotIn("まと", got)  # 名乗りは入らない

    def test_変化ありは連濁や促音を足す(self):
        got = dict(variant_candidates("札", KD))
        self.assertEqual(got["さつ"], "音")
        self.assertEqual(got["さっ"], "音→促音")
        self.assertEqual(got["ざつ"], "音→連濁")
        self.assertNotIn("さ", got)  # 「つ」は母音ではないので脱落させない

    def test_ケ_と_ヶ_は助詞の_が_として読める(self):
        for ch in ("ケ", "ヶ"):
            got = dict(variant_candidates(ch, KD))
            self.assertEqual(got["か"], "字")
            self.assertEqual(got["が"], "字→連濁")

    def test_名乗りの候補は_nanori_側にだけ入る(self):
        self.assertNotIn("ばる", dict(variant_candidates("原", KD)))
        self.assertEqual(dict(nanori_candidates("原", KD))["ばる"], "名")

    def test_カタカナはひらがなで読む(self):
        self.assertEqual(dict(plain_candidates("ノ", KD)), {"の": "字"})
        self.assertIn("あ", dict(plain_candidates("あ", KD)))


class TestDecompose(unittest.TestCase):
    def test_素直に割り当てられる(self):
        segs = decompose("松本", "まつもと", _with_repeat(plain_candidates, KD, False))
        self.assertEqual(format_segments(segs), "松=まつ(訓)＋本=もと(訓)")

    def test_読みが余っても足りなくても失敗する(self):
        cand = _with_repeat(plain_candidates, KD, False)
        self.assertIsNone(decompose("松本", "まつもとじょう", cand))
        self.assertIsNone(decompose("松本", "まつ", cand))

    def test_々_は直前の字の読みを引き継ぐ(self):
        segs = decompose("野々市", "ののいち", _with_repeat(plain_candidates, KD, False))
        self.assertEqual(format_segments(segs), "野=の(訓)＋々=の(々)＋市=いち(訓)")

    def test_々_の連濁は変化ありのときだけ許す(self):
        self.assertIsNone(decompose("佐々", "さざ", _with_repeat(plain_candidates, KD, False)))
        segs = decompose("佐々", "さざ", _with_repeat(variant_candidates, KD, True))
        self.assertEqual(format_segments(segs), "佐=さ(音)＋々=ざ(々→連濁)")


class TestClassifyB2(unittest.TestCase):
    """既知例のサニティチェック。(a) 素直 / (b) 音便で説明できる / (c) 読めない。"""

    CASES_A = (
        ("松本", "まつもと", "松=まつ(訓)＋本=もと(訓)"),
        ("坂本", "さかもと", "坂=さか(訓)＋本=もと(訓)"),
        ("横浜", "よこはま", "横=よこ(訓)＋浜=はま(訓)"),
        ("高槻", "たかつき", "高=たか(訓)＋槻=つき(訓)"),
        ("匝瑳", "そうさ", "匝=そう(音)＋瑳=さ(音)"),
        ("八重瀬", "やえせ", "八=や(訓)＋重=え(訓)＋瀬=せ(訓)"),
        ("立川", "たちかわ", "立=たち(訓)＋川=かわ(訓)"),
        ("川越", "かわごえ", "川=かわ(訓)＋越=ごえ(訓)"),
        ("野々市", "ののいち", "野=の(訓)＋々=の(々)＋市=いち(訓)"),
    )
    CASES_B = (
        ("札幌", "さっぽろ", "札=さっ(音→促音)＋幌=ぽろ(訓→半濁)"),
        ("新宿", "しんじゅく", "新=しん(音)＋宿=じゅく(音→連濁)"),
        ("名古屋", "なごや", "名=な(訓)＋古=ご(音→連濁)＋屋=や(訓)"),
        ("金ケ崎", "かねがさき", "金=かね(訓)＋ケ=が(字→連濁)＋崎=さき(訓)"),
        ("池田", "いけだ", "池=いけ(訓)＋田=だ(訓→連濁)"),
        ("佐々", "さざ", "佐=さ(音)＋々=ざ(々→連濁)"),
    )
    # (c) のうち、名乗り読みを使えば分解できるもの（内訳を残して人が検算できるようにする）
    CASES_C_NANORI = (
        ("宿毛", "すくも", "名乗り: 宿=すく(名)＋毛=も(音→母音脱落)"),
        ("南風原", "はえばる", "名乗り: 南=は(名)＋風=え(名)＋原=ばる(名)"),
        ("我孫子", "あびこ", "名乗り: 我=あ(名)＋孫=び(名→連濁)＋子=こ(訓)"),
        ("渋谷", "しぶや", "名乗り: 渋=しぶ(訓)＋谷=や(名)"),
    )
    # (c) のうち、名乗りを使っても割り当てられないもの（熟字訓・助詞「の」の挿入）
    CASES_C_NONE = (
        ("東風平", "こちんだ"),
        ("八戸", "はちのへ"),
        ("大和", "やまと"),
    )

    def test_a_素直(self):
        for display, answer, detail in self.CASES_A:
            with self.subTest(display=display):
                self.assertEqual(classify_b2(display, answer, KD), ("a", detail))

    def test_b_音便で説明できる(self):
        for display, answer, detail in self.CASES_B:
            with self.subTest(display=display):
                self.assertEqual(classify_b2(display, answer, KD), ("b", detail))

    def test_c_名乗り読みが必要なものは読めない扱い(self):
        for display, answer, detail in self.CASES_C_NANORI:
            with self.subTest(display=display):
                self.assertEqual(classify_b2(display, answer, KD), ("c", detail))

    def test_c_分解不能(self):
        for display, answer in self.CASES_C_NONE:
            with self.subTest(display=display):
                self.assertEqual(classify_b2(display, answer, KD), ("c", "分解不能"))

    def test_nanori_b_に切り替えると名乗りが_b_に昇格する(self):
        # Issue #33 のたたき台どおり名乗りを (b) に入れた場合。宿毛・南風原が ★3 から
        # 落ちるので既定にはしていない（build_stars.py の nanori_candidates の docstring）。
        level, detail = classify_b2("南風原", "はえばる", KD, nanori_level="b")
        self.assertEqual(level, "b")
        self.assertEqual(detail, "南=は(名)＋風=え(名)＋原=ばる(名)")

    def test_判定は呼ぶ順に依存しない(self):
        # DP のメモ化が呼び出しをまたいで漏れていないこと
        first = classify_b2("札幌", "さっぽろ", KD)
        classify_b2("南風原", "はえばる", KD)
        self.assertEqual(classify_b2("札幌", "さっぽろ", KD), first)


class TestFameBand(unittest.TestCase):
    def test_分位点は補間しない(self):
        values = list(range(1, 11))  # 1..10
        self.assertEqual(quantile(values, 0.0), 1)
        self.assertEqual(quantile(values, 1.0), 10)
        self.assertEqual(quantile(values, 0.4), 5)

    def test_境界は上を含み下を含まない(self):
        self.assertEqual(fame_band(79_306, 79_306, 14_959), "有名")
        self.assertEqual(fame_band(79_305, 79_306, 14_959), "ふつう")
        self.assertEqual(fame_band(14_959, 79_306, 14_959), "ふつう")
        self.assertEqual(fame_band(14_958, 79_306, 14_959), "無名")

    def test_人口不明は無名に寄せる(self):
        self.assertEqual(fame_band(None, 79_306, 14_959), "無名")


class TestStarTable(unittest.TestCase):
    def test_表は_3x3_で_1_から_3(self):
        self.assertEqual(set(STAR_TABLE), {"a", "b", "c"})
        for level, row in STAR_TABLE.items():
            self.assertEqual(tuple(row), FAME_LABELS)
            for band, star in row.items():
                self.assertIn(star, (1, 2, 3), f"{level}×{band}")

    def test_読みにくいほど_知名度が低いほど_星は減らない(self):
        for band in FAME_LABELS:
            self.assertLessEqual(STAR_TABLE["a"][band], STAR_TABLE["b"][band])
            self.assertLessEqual(STAR_TABLE["b"][band], STAR_TABLE["c"][band])
        for level in "abc":
            row = STAR_TABLE[level]
            self.assertLessEqual(row["有名"], row["ふつう"])
            self.assertLessEqual(row["ふつう"], row["無名"])


if __name__ == "__main__":
    unittest.main()
