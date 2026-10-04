"""1 フェイスぶんのサブセットを作る（scripts/build-fonts.mjs から呼ばれる）。

    python3 scripts/subset-font.py <src.ttf> <chars.txt> <out.woff2> "<内部名>"

pyftsubset と同じことをしたうえで、name テーブル（ID 1/3/4/6/16）を書き換えて
**別名**で名乗らせる。原本は SIL OFL 1.1 で、Reserved Font Name を宣言していない書体でも
「元の書体そのもの」と誤認されないようにしておく（CSS の font-family 名は
src/styles/fonts.css 側で元のまま使うので、見た目には影響しない）。

fontTools が入っていない環境では build-fonts.mjs が uv 経由で呼ぶ:
    uv run --with "fonttools[woff]" python3 scripts/subset-font.py ...
"""

import sys

from fontTools import subset
from fontTools.ttLib import TTFont

WINDOWS_ENGLISH = (3, 1, 0x409)
MAC_ENGLISH = (1, 0, 0)


def rename(font: TTFont, full_name: str) -> None:
    """family / subfamily 由来の name レコードを別名に差し替える。

    1 = Family、3 = Unique ID、4 = Full name、6 = PostScript name、16 = Typographic family。
    PostScript 名は空白を許さないので詰める。
    """
    ps_name = full_name.replace(" ", "")
    for record in font["name"].names:
        if record.nameID in (1, 4, 16):
            record.string = full_name
        elif record.nameID == 3:
            record.string = f"{full_name};subset"
        elif record.nameID == 6:
            record.string = ps_name


def main() -> int:
    src, chars_file, out, full_name = sys.argv[1:5]
    with open(chars_file, encoding="utf-8") as fh:
        text = fh.read()

    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.notdef_outline = False
    options.name_IDs = [1, 2, 3, 4, 5, 6, 16, 17]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.drop_tables += ["DSIG"]

    font = subset.load_font(src, options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    rename(font, full_name)
    subset.save_font(font, out, options)
    font.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
