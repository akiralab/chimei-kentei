#!/usr/bin/env python3
"""build_questions.py の前処理ルールの単体テスト（標準ライブラリのみ）。

実行: python3 -m unittest discover -s data -p 'test_*.py'
"""

import unittest

from build_questions import KANJI_ONLY, check_digit, city_code_from_ward, has_kanji, to_hira


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


if __name__ == "__main__":
    unittest.main()
