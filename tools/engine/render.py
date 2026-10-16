"""Render Pixel Sort gameplay clips (1080x1920, 30 fps, H.264 + AAC) from the real game engine.

Usage: python3 render.py A B C   (clip ids, default all)"""
import base64, json, os, re, subprocess, sys, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
FPS = 30
RATE = 48000
ALBUM_HOOK = ["Every level", "is a new picture"]
GUESS = ["Guess the picture", "before it\u2019s finished"]
PAINT = ["Every color you sort", "paints the picture"]
TELL = ["Would you play this?", "Tell me below"]
AD_CTA = ["Play it free", "right in your browser"]


def level(pic, seed, hook, cta, **kw):
    d = {"type": "level", "pic": pic, "seed": seed, "hook": hook, "cta": cta}
    d.update(kw)
    return d


CLIPS = {
    # organic clips: comment-driving end cards
    "A": {"file": "pixelsort_A_guess_cat.mp4", "segments": [level("cat", 5, GUESS, ["What should we", "pixel next?"])]},
    "B": {"file": "pixelsort_B_paint_cupcake.mp4", "segments": [level("cupcake", 9, PAINT, TELL)]},
    "C": {"file": "pixelsort_C_album_speedrun.mp4", "segments": [
        level("mushroom", 3, ALBUM_HOOK, None, intro=0.45, p0=0.34, p1=0.27, outro=1.3),
        level("rocket", 4, ALBUM_HOOK, None, intro=0.3, p0=0.32, p1=0.27, outro=1.3),
        {"type": "album", "hook": ALBUM_HOOK, "cta": ["Which one is", "your favorite?"], "ctaT": 1.3, "duration": 3.6,
         "slots": ["cat", "cupcake", "heart", "mushroom", "rocket", None], "fresh": ["mushroom", "rocket"]}]},
    "D": {"file": "pixelsort_D_halloween_pumpkin.mp4", "segments": [
        level("pumpkin", 13, ["Guess this Halloween", "picture at 50%"], ["Did you guess it?", "Tell me below"])]},
    "E": {"file": "pixelsort_E_spooky_ghost.mp4", "segments": [
        level("ghost", 17, ["Spooky or cute?", "Sort to find out"], ["Spooky or cute?", "Comment below"])]},
    "F": {"file": "pixelsort_F_guess_frog.mp4", "segments": [level("frog", 19, GUESS, ["Got it right?", "Tell me below"])]},
    "G": {"file": "pixelsort_G_four_colors_panda.mp4", "segments": [
        level("panda", 23, ["4 colors.", "1 picture."], ["Too easy?", "The next one is harder"])]},
    "H": {"file": "pixelsort_H_paint_icecream.mp4", "segments": [level("icecream", 29, PAINT, TELL)]},
    "I": {"file": "pixelsort_I_hidden_duck.mp4", "segments": [
        level("duck", 31, ["What\u2019s hiding", "in the picture?"], ["Did you guess it?", "Tell me below"])]},
    "J": {"file": "pixelsort_J_satisfying_watermelon.mp4", "segments": [
        level("watermelon", 37, ["Sort the colors,", "watch it appear"], ["How satisfying?", "Rate it 1 to 10"])]},
    "K": {"file": "pixelsort_K_halloween_album.mp4", "segments": [
        level("pumpkin", 41, ["Halloween pictures", "unlocked"], None, intro=0.45, p0=0.34, p1=0.27, outro=1.3),
        level("ghost", 43, ["Halloween pictures", "unlocked"], None, intro=0.3, p0=0.32, p1=0.27, outro=1.3),
        {"type": "album", "hook": ["Halloween pictures", "unlocked"], "cta": ["Which one", "should be next?"], "ctaT": 1.3, "duration": 3.6,
         "slots": ["cat", "panda", "heart", "pumpkin", "ghost", None], "fresh": ["pumpkin", "ghost"]}]},
    # ad cuts: same gameplay, end card points to the free browser demo
    "AD1": {"file": "pixelsort_AD1_guess_cat.mp4", "segments": [level("cat", 5, GUESS, AD_CTA, ctaDelay=1.5)]},
    "AD2": {"file": "pixelsort_AD2_paint_cupcake.mp4", "segments": [level("cupcake", 9, PAINT, AD_CTA, ctaDelay=1.5)]},
    "AD3": {"file": "pixelsort_AD3_halloween_pumpkin.mp4", "segments": [
        level("pumpkin", 13, ["Guess this Halloween", "picture at 50%"], AD_CTA, ctaDelay=1.5)]},
}


def setup(page, seg):
    ids = page.evaluate("PS.levels.map(L => L.id)")
    seg = dict(seg)
    if seg["type"] == "album":
        seg["slots"] = [ids.index(x) if x else -1 for x in seg["slots"]]
        seg["fresh"] = [ids.index(x) for x in seg["fresh"]]
        return page.evaluate("cfg => PS.video.album(cfg)", seg)
    seg["level"] = ids.index(seg.pop("pic"))
    return page.evaluate("cfg => PS.video.setup(cfg)", seg)


def get_audio(page, **opts):
    b64 = page.evaluate("o => PS.video.audio(o)", opts)
    a = np.frombuffer(base64.b64decode(b64), dtype=np.float32).reshape(-1, 2)
    assert np.isfinite(a).all()
    return a


def write_wav(path, a):
    a = np.clip(a, -1, 1)
    pcm = (a * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())


def loudnorm_args(wav):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = json.loads(re.search(r"\{[\s\S]*?\}", r.stderr[r.stderr.rfind("[Parsed_loudnorm"):]).group(0))
    return ("loudnorm=I=-14:TP=-1.5:LRA=11:linear=true:"
            f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
            f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}"), m


def render_clip(page, cid):
    clip = CLIPS[cid]
    segs = clip["segments"]
    # pass 1: durations and sound effects
    infos, nframes, sfx = [], [], []
    for seg in segs:
        info = setup(page, seg)
        n = int(round(info["duration"] * FPS))
        infos.append(info); nframes.append(n)
        sfx.append(get_audio(page, music=False, duration=n / FPS))
    total_frames = sum(nframes)
    total = total_frames / FPS
    music = get_audio(page, sfx=False, duration=total)
    mixa = music.copy()
    off = 0
    for n, a in zip(nframes, sfx):
        s = int(round(off / FPS * RATE))
        mixa[s:s + len(a)] += a[: max(0, len(mixa) - s)]
        off += n
    peak = float(np.abs(mixa).max())
    if peak > 0.97:
        mixa *= 0.97 / peak
    wav = os.path.join(OUT, cid + "_audio.wav")
    write_wav(wav, mixa)
    af, meas = loudnorm_args(wav)
    # pass 2: frames piped into the encoder
    mp4 = os.path.join(OUT, clip["file"])
    enc = subprocess.Popen([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png", "-i", "-",
        "-i", wav, "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-r", str(FPS), "-g", str(FPS * 2),
        "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", str(RATE),
        "-movflags", "+faststart", "-shortest", mp4], stdin=subprocess.PIPE)
    cover = None
    for seg, n in zip(segs, nframes):
        setup(page, seg)
        for f in range(n):
            d = page.evaluate("t => PS.video.frame(t)", f / FPS)
            png = base64.b64decode(d.split(",", 1)[1])
            if cover is None:
                cover = png
            enc.stdin.write(png)
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit("ffmpeg failed for " + cid)
    open(os.path.join(OUT, clip["file"].replace(".mp4", "_cover.png")), "wb").write(cover)
    return {"clip": cid, "file": mp4, "seconds": round(total, 2), "frames": total_frames,
            "moves": [i.get("moves") for i in infos], "input_lufs": meas["input_i"]}


def main():
    ids = sys.argv[1:] or list(CLIPS)
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("file://" + os.path.join(ROOT, "dist", "video.html"))
        page.evaluate("async () => { await PS.init(document.getElementById('game'), {video: true}); }")
        for cid in ids:
            print(json.dumps(render_clip(page, cid)), flush=True)
        if errs:
            print("page errors:", errs)
        b.close()


if __name__ == "__main__":
    main()
