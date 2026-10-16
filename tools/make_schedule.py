"""Write content/schedule.json: 14 days of organic posts with per-network captions.

{LINK} is replaced by the demo link with UTM tags when a post is queued.
Days 12-14 are left open on purpose: they get the three best clips from week 1."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CLIPS = {
    "A": ("pixelsort_A_guess_cat.mp4", "Guess the picture before it’s finished \U0001F440",
          "Every color you sort reveals more pixels. Drop your guess below!", "#pixelart #puzzlegame #satisfying #ballsort #brainteaser"),
    "D": ("pixelsort_D_halloween_pumpkin.mp4", "Guess this Halloween picture at 50% \U0001F383",
          "Comment your guess before the reveal!", "#halloween #pixelart #puzzlegame #satisfying #spookyseason"),
    "B": ("pixelsort_B_paint_cupcake.mp4", "Every color you sort paints the picture \U0001F9C1",
          "Would you play this?", "#pixelart #satisfyingvideo #sortpuzzle #cozygames #mobilegame"),
    "E": ("pixelsort_E_spooky_ghost.mp4", "Spooky or cute? \U0001F47B",
          "Sort the colors to find out.", "#halloween #pixelart #cute #puzzlegame #satisfying"),
    "G": ("pixelsort_G_four_colors_panda.mp4", "4 colors. 1 picture. \U0001F43C",
          "Too easy? The next level is harder.", "#pixelart #panda #puzzlegame #satisfying #cozygames"),
    "F": ("pixelsort_F_guess_frog.mp4", "Guess the picture before it’s finished \U0001F438",
          "Got it right? Tell me below.", "#pixelart #puzzlegame #satisfying #frog #brainteaser"),
    "C": ("pixelsort_C_album_speedrun.mp4", "Every level is a new picture \U0001F344\U0001F680",
          "Which one is your favorite?", "#pixelart #puzzlegame #satisfying #indiegame #gamedev"),
    "H": ("pixelsort_H_paint_icecream.mp4", "Every color you sort paints the picture \U0001F366",
          "Would you play this?", "#pixelart #satisfyingvideo #icecream #puzzlegame #cozygames"),
    "K": ("pixelsort_K_halloween_album.mp4", "Halloween pictures unlocked \U0001F383\U0001F47B",
          "Which one should be next?", "#halloween #pixelart #puzzlegame #indiegame #satisfying"),
    "I": ("pixelsort_I_hidden_duck.mp4", "What’s hiding in the picture? \U0001F986",
          "Comment your guess!", "#pixelart #puzzlegame #satisfying #rubberduck #brainteaser"),
    "J": ("pixelsort_J_satisfying_watermelon.mp4", "Sort the colors, watch it appear \U0001F349",
          "How satisfying is it, 1 to 10?", "#satisfyingvideo #pixelart #puzzlegame #asmr #cozygames"),
}
ORDER = ["A", "D", "B", "E", "G", "F", "C", "H", "K", "I", "J"]


def captions(cid):
    file, hook, line, tags = CLIPS[cid]
    first_two = " ".join(tags.split()[:2])
    return {
        "instagram": f"{hook}\n{line}\n\nFree demo: link in bio\n\n{tags}",
        "threads": f"{hook} {line}\n\nPlay the free demo: {{LINK}}",
        "x": f"{hook}\n\nPlay free in your browser: {{LINK}} {first_two}",
        "youtube_title": f"{hook} #shorts",
        "youtube": f"{hook} {line}\nFree browser demo: link on the channel page.\n{tags} #shorts",
    }


def main():
    days = []
    for n, cid in enumerate(ORDER, start=1):
        days.append({"day": n, "clip": cid, "file": CLIPS[cid][0], "captions": captions(cid)})
    for n in range(len(ORDER) + 1, 15):
        days.append({"day": n, "clip": None, "file": None, "note": "Best clip from week 1 goes here"})
    path = os.path.join(ROOT, "content", "schedule.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = json.load(open(path)) if os.path.exists(path) else {}
    out = {
        "start_date": old.get("start_date"),
        "post_time_utc": old.get("post_time_utc", "22:30"),
        "site_url": old.get("site_url", "https://example.github.io/pixel-sort/"),
        "channels": old.get("channels", ["instagram", "youtube", "threads", "x"]),
        "days": days,
    }
    json.dump(out, open(path, "w"), indent=1, ensure_ascii=False)
    print("wrote", path)


if __name__ == "__main__":
    main()
