"""Inline fonts, level data and the engine into one artifact page and one local render harness."""
import base64, json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS = [
    ("Fredoka", 600, "node_modules/@fontsource/fredoka/files/fredoka-latin-600-normal.woff2"),
    ("Fredoka", 700, "node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2"),
    ("Lilita One", 400, "node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2"),
]


def font_css():
    out = []
    for fam, wt, path in FONTS:
        b64 = base64.b64encode(open(os.path.join(ROOT, path), "rb").read()).decode()
        out.append(f"@font-face {{ font-family: '{fam}'; font-style: normal; font-weight: {wt}; font-display: block; src: url(data:font/woff2;base64,{b64}) format('woff2'); }}")
    return "\n".join(out)


def main():
    shell = open(os.path.join(ROOT, "shell.html"), encoding="utf-8").read()
    game = open(os.path.join(ROOT, "game.js"), encoding="utf-8").read()
    data = json.dumps(json.load(open(os.path.join(ROOT, "levels.json"))), separators=(",", ":"))
    page = shell.replace("/*@@FONTS@@*/", font_css()).replace("/*@@DATA@@*/", data).replace("/*@@GAME@@*/", game)
    assert "@@" not in page
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    open(os.path.join(ROOT, "dist", "pixel-sort.html"), "w", encoding="utf-8").write(page)
    dev = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">"
           "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>"
           "</head><body>" + ("<script>window.PS_VIDEO = true;</script>" if "--video" in sys.argv else "") + page + "</body></html>")
    name = "video.html" if "--video" in sys.argv else "dev.html"
    open(os.path.join(ROOT, "dist", name), "w", encoding="utf-8").write(dev)
    print("built", len(page) // 1024, "KB")


if __name__ == "__main__":
    main()
