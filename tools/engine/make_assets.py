"""Render the web icons and the social preview image (og.png) with the game's own art.

Usage: python3 make_assets.py <docs_dir>"""
import base64, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))

JS = r"""
async () => {
  await PS.init(document.getElementById('game'), {video: true});
  const ids = PS.levels.map(L => L.id);
  const L = PS.levels[ids.indexOf('cat')];
  const out = {};
  function icon(px, pad) {
    const size = 16 * px + pad * 2, c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = L.colors[0]; x.fillRect(0, 0, size, size);
    for (let p = 0; p < 256; p++) { const gx = p % 16, gy = (p / 16) | 0; x.fillStyle = L.colors[L.grid[gy][gx]]; x.fillRect(pad + gx * px, pad + gy * px, px, px); }
    return c.toDataURL('image/png');
  }
  out['icon-512.png'] = icon(32, 0);
  out['icon-192.png'] = icon(12, 0);
  out['apple-touch-icon.png'] = icon(11, 2);
  out['favicon-32.png'] = icon(2, 0);

  // social preview 1200x630
  const W = 1200, H = 630, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = PS.art.bg();
  x.drawImage(bg, 0, 520, 1080, 1080 * H / W, 0, 0, W, H);
  x.fillStyle = 'rgba(9,30,46,0.35)'; x.fillRect(0, 0, W, H);
  function card(id, cx, cy, size, rot) {
    const t = PS.art.thumb(ids.indexOf(id), size), pad = Math.round(size * 0.06);
    x.save(); x.translate(cx, cy); x.rotate(rot);
    x.shadowColor = 'rgba(0,10,20,0.5)'; x.shadowBlur = 40; x.shadowOffsetY = 16;
    x.fillStyle = '#FFFFFF';
    const s = size + pad * 2, r = 26;
    x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, r); x.fill();
    x.shadowColor = 'transparent';
    x.drawImage(t, -size / 2, -size / 2);
    x.restore();
  }
  card('ghost', 752, 300, 250, -0.16);
  card('pumpkin', 1018, 330, 250, 0.15);
  card('cat', 885, 330, 300, 0.02);
  x.textBaseline = 'alphabetic';
  x.font = '400 112px "Lilita One"';
  x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = 'rgba(0,16,28,0.55)';
  x.strokeText('PIXEL', 72, 228); x.fillStyle = '#FFFFFF'; x.fillText('PIXEL', 72, 228);
  x.strokeText('SORT', 72, 338); x.fillStyle = '#FFC83D'; x.fillText('SORT', 72, 338);
  x.font = '600 44px Fredoka'; x.fillStyle = '#FFFFFF';
  x.fillText('Sort the colors.', 76, 420); x.fillText('Reveal the picture.', 76, 474);
  x.font = '600 30px Fredoka'; x.fillStyle = 'rgba(232,246,255,0.75)';
  x.fillText('Free · plays in your browser', 78, 540);
  out['og.png'] = c.toDataURL('image/png');
  return out;
}
"""


def main():
    docs = sys.argv[1]
    os.makedirs(os.path.join(docs, "icons"), exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1080, "height": 1920})
        pg.goto("file://" + os.path.join(ROOT, "dist", "video.html"))
        files = pg.evaluate(JS)
        b.close()
    for name, url in files.items():
        dest = os.path.join(docs, name if name == "og.png" else os.path.join("icons", name))
        open(dest, "wb").write(base64.b64decode(url.split(",", 1)[1]))
        print("wrote", dest)


if __name__ == "__main__":
    main()
