"""Build the public web version of Pixel Sort into <repo>/docs (served by GitHub Pages).

Usage: python3 build_site.py <repo_dir> [site_url]"""
import json, os, re, shutil, sys
from build import font_css

ROOT = os.path.dirname(os.path.abspath(__file__))


def main():
    repo = sys.argv[1]
    site_url = sys.argv[2] if len(sys.argv) > 2 else "https://example.github.io/pixel-sort/"
    if not site_url.endswith("/"):
        site_url += "/"
    docs = os.path.join(repo, "docs")
    os.makedirs(docs, exist_ok=True)

    shell = open(os.path.join(ROOT, "shell.html"), encoding="utf-8").read()
    css = shell[shell.index("<style>") + len("<style>"): shell.index("</style>")].replace("/*@@FONTS@@*/", font_css())
    stage = shell[shell.index('<div id="app">'): shell.index("<script>window.PS_DATA")].rstrip()

    # extra UI for the web build
    stage = stage.replace(
        '<button id="btn-album2" class="ghost">Album</button>',
        '<button id="btn-album2" class="ghost">Album</button>\n      <button id="btn-share" class="ghost">Share</button>')
    intent = '''<div class="card" id="intent" hidden role="dialog" aria-labelledby="intent-title">
      <div id="intent-q">
        <h2 id="intent-title">Would you install it?</h2>
        <p>Pixel Sort is a prototype. Would you install the full game on your phone?</p>
        <div class="answers">
          <button class="cta" data-answer="yes">Yes</button>
          <button class="ghost" data-answer="maybe">Maybe</button>
          <button class="ghost" data-answer="no">No</button>
        </div>
      </div>
      <div id="intent-thanks" hidden>
        <h2>Thank you!</h2>
        <p>Your answer helps us decide what to build next.</p>
        <div class="follow" id="intent-follow" hidden></div>
        <div class="row" style="margin-top: calc(28px * var(--u))"><button id="intent-close" class="ghost">Keep playing</button></div>
      </div>
    </div>

    <div id="footer">Prototype · <a href="privacy.html">Privacy</a></div>

    '''
    stage = stage.replace('<div id="toast"', intent + '<div id="toast"')
    stage = stage.replace('<p class="note">', '<div class="follow" id="album-follow" hidden></div>\n      <p class="note">')
    assert 'id="btn-share"' in stage and 'id="intent"' in stage and 'id="album-follow"' in stage

    head = open(os.path.join(ROOT, "site", "head.html"), encoding="utf-8").read()
    head = head.replace("/*@@SHELL_CSS@@*/", css).replace("__SITE_URL__", site_url)
    data = json.dumps(json.load(open(os.path.join(ROOT, "levels.json"))), separators=(",", ":"))
    game = open(os.path.join(ROOT, "game.js"), encoding="utf-8").read()
    web = open(os.path.join(ROOT, "site", "web.js"), encoding="utf-8").read()
    page = (head + stage + "\n\n<script>window.PS_DATA = " + data + ";</script>\n<script>\n" + game +
            "\n</script>\n<script>\n" + web + "\n</script>\n</body>\n</html>\n")
    assert "@@" not in page and "__SITE_URL__" not in page
    open(os.path.join(docs, "index.html"), "w", encoding="utf-8").write(page)

    for name in ["privacy.html", "manifest.webmanifest"]:
        shutil.copy(os.path.join(ROOT, "site", name), os.path.join(docs, name))
    if not os.path.exists(os.path.join(docs, "config.js")):  # never overwrite live settings
        shutil.copy(os.path.join(ROOT, "site", "config.js"), os.path.join(docs, "config.js"))
    open(os.path.join(docs, ".nojekyll"), "w").close()
    print("site built:", os.path.join(docs, "index.html"), len(page) // 1024, "KB")


if __name__ == "__main__":
    main()
