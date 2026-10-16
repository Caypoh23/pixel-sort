"""Queue the day's Pixel Sort clip on every connected Buffer channel.

Runs from GitHub Actions. Reads content/schedule.json, remembers what it queued in
content/posted.json, and schedules each post for its exact time with Buffer's GraphQL API.

  python3 scripts/autopost.py               # queue posts due in the next 30 hours
  python3 scripts/autopost.py --dry-run     # print the plan, call nothing
  python3 scripts/autopost.py --introspect  # print Buffer's post input types (needs the key)

Needs the BUFFER_API_KEY secret. Without it the script explains what is missing and exits 0.
"""
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE = os.path.join(ROOT, "content", "schedule.json")
STATE = os.path.join(ROOT, "content", "posted.json")
API = "https://api.buffer.com"
LOOKAHEAD_H = 30
SERVICE_KEYS = {"instagram": "instagram", "youtube": "youtube", "threads": "threads", "twitter": "x", "x": "x"}


def gql(key, query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "pixel-sort-autopost"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Buffer API HTTP {e.code}: {e.read().decode()[:500]}")
    if out.get("errors"):
        raise RuntimeError(json.dumps(out["errors"])[:800])
    return out["data"]


TYPE_Q = """query($n: String!) { __type(name: $n) { name kind enumValues { name }
  inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }"""


def unwrap(t):
    required = False
    while t and t.get("kind") in ("NON_NULL", "LIST"):
        if t["kind"] == "NON_NULL":
            required = True
        t = t.get("ofType")
    return (t or {}).get("name"), (t or {}).get("kind"), required


class Schema:
    def __init__(self, key):
        self.key, self.cache = key, {}

    def t(self, name):
        if name not in self.cache:
            self.cache[name] = gql(self.key, TYPE_Q, {"n": name})["__type"] or {}
        return self.cache[name]

    def fields(self, name):
        return {f["name"]: unwrap(f["type"]) for f in (self.t(name).get("inputFields") or [])}

    def enum(self, name):
        return [v["name"] for v in (self.t(name).get("enumValues") or [])]


def pick_enum(values, *wanted):
    low = {v.lower(): v for v in values}
    for w in wanted:
        for lv, v in low.items():
            if lv == w or w in lv:
                return v
    return values[0] if values else None


def network_metadata(schema, meta_type, network, day):
    """Fill the per-network metadata input by inspecting its schema, so field drift does not break posting."""
    if network not in ("instagram", "youtube"):
        return None
    fields = schema.fields(meta_type)
    slot = next((f for f in fields if network in f.lower()), None)
    if not slot:
        return None
    tname, kind, _ = fields[slot]
    sub = schema.fields(tname)
    out = {}
    for fname, (ftype, fkind, req) in sub.items():
        lf = fname.lower()
        if network == "instagram":
            if lf == "type" and fkind == "ENUM":
                out[fname] = pick_enum(schema.enum(ftype), "reel")
            elif lf == "shouldsharetofeed":
                out[fname] = True
        if network == "youtube":
            if lf == "title":
                out[fname] = day["captions"]["youtube_title"][:100]
            elif "privacy" in lf and fkind == "ENUM":
                out[fname] = pick_enum(schema.enum(ftype), "public")
            elif "category" in lf:
                out[fname] = pick_enum(schema.enum(ftype), "gaming", "20") if fkind == "ENUM" else "20"
            elif "madeforkids" in lf:
                out[fname] = False
            elif "notify" in lf:
                out[fname] = True
            elif "license" in lf and fkind == "ENUM":
                out[fname] = pick_enum(schema.enum(ftype), "youtube", "standard")
            elif "embeddable" in lf:
                out[fname] = True
        if req and fname not in out:
            if fkind == "ENUM":
                out[fname] = schema.enum(ftype)[0]
            elif ftype == "Boolean":
                out[fname] = False
            else:
                print(f"  ! {network}.{fname} is required and unknown to this script", file=sys.stderr)
    return {slot: out} if out else None


def channels(key):
    orgs = gql(key, "{ account { organizations { id name } } }")["account"]["organizations"]
    found = {}
    for org in orgs:
        q = "query($i: ChannelsInput!) { channels(input: $i) { id name service isDisconnected } }"
        for ch in gql(key, q, {"i": {"organizationId": org["id"]}})["channels"]:
            net = SERVICE_KEYS.get(str(ch.get("service", "")).lower())
            if net and not ch.get("isDisconnected") and net not in found:
                found[net] = ch
    return found


def due_posts(schedule, now):
    if not schedule.get("start_date"):
        return []
    start = dt.date.fromisoformat(schedule["start_date"])
    hh, mm = map(int, schedule.get("post_time_utc", "22:30").split(":"))
    out = []
    for day in schedule["days"]:
        if not day.get("file"):
            continue
        when = dt.datetime.combine(start + dt.timedelta(days=day["day"] - 1), dt.time(hh, mm), tzinfo=dt.timezone.utc)
        if now + dt.timedelta(minutes=10) <= when <= now + dt.timedelta(hours=LOOKAHEAD_H):
            out.append((when, day))
    return out


def text_for(day, net, schedule):
    link = schedule["site_url"] + f"?utm_source={net}&utm_medium=organic&utm_campaign=launch&utm_content={day['clip']}"
    caps = day["captions"]
    if net == "youtube":
        return caps["youtube"]
    return caps[net].replace("{LINK}", link)


def main():
    args = set(sys.argv[1:])
    schedule = json.load(open(SCHEDULE))
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    now = dt.datetime.now(dt.timezone.utc)
    plan = due_posts(schedule, now)
    key = os.environ.get("BUFFER_API_KEY", "").strip()

    if "--introspect" in args:
        if not key:
            raise SystemExit("BUFFER_API_KEY is not set")
        s = Schema(key)
        print(json.dumps({"CreatePostInput": s.fields("CreatePostInput")}, indent=1))
        meta = s.fields("CreatePostInput").get("metadata", (None,))[0]
        if meta:
            print(json.dumps({meta: s.fields(meta)}, indent=1))
            for f, (tn, _, _) in s.fields(meta).items():
                print(json.dumps({tn: s.fields(tn)}, indent=1))
        print(json.dumps({k: v["id"] for k, v in channels(key).items()}, indent=1))
        return

    if not schedule.get("start_date"):
        print("Posting is paused: set start_date in content/schedule.json to begin.")
        return
    if not plan:
        print("Nothing due in the next", LOOKAHEAD_H, "hours.")
        return
    if "--dry-run" in args or not key:
        if not key:
            print("BUFFER_API_KEY is not set, showing the plan only.")
        for when, day in plan:
            for net in schedule["channels"]:
                print(when.isoformat(), net, day["file"], "|", text_for(day, net, schedule)[:90])
        return

    s = Schema(key)
    input_fields = s.fields("CreatePostInput")
    meta_type = input_fields.get("metadata", (None,))[0]
    mode_field = "mode" if "mode" in input_fields else ("shareMode" if "shareMode" in input_fields else None)
    chans = channels(key)
    print("Connected channels:", ", ".join(sorted(chans)) or "none")
    mutation = """mutation($input: CreatePostInput!) { createPost(input: $input) {
      __typename ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }"""
    failures = 0
    for when, day in plan:
        for net in schedule["channels"]:
            tag = f"day{day['day']}:{net}"
            if tag in state:
                continue
            ch = chans.get(net)
            if not ch:
                print("skip", tag, "- channel not connected in Buffer")
                continue
            video_url = schedule["site_url"] + "clips/" + day["file"]
            inp = {"text": text_for(day, net, schedule), "channelId": ch["id"], "schedulingType": "automatic",
                   "dueAt": when.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                   "assets": [{"video": {"url": video_url, "metadata": {"thumbnailOffset": 300}}}]}
            if mode_field:
                inp[mode_field] = "customScheduled"
            if meta_type:
                md = network_metadata(s, meta_type, net, day)
                if md:
                    inp["metadata"] = md
            try:
                res = gql(key, mutation, {"input": inp})["createPost"]
            except RuntimeError as e:
                print("error", tag, e); failures += 1
                continue
            if res.get("__typename") == "PostActionSuccess":
                state[tag] = {"id": res["post"]["id"], "dueAt": res["post"]["dueAt"], "file": day["file"]}
                print("queued", tag, res["post"]["dueAt"])
            else:
                print("rejected", tag, res.get("message")); failures += 1
    json.dump(state, open(STATE, "w"), indent=1, sort_keys=True)
    if failures and not state:
        raise SystemExit(f"{failures} posts failed and none were queued")


if __name__ == "__main__":
    main()
