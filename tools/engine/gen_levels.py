"""Generate solvable Pixel Sort levels with an A* solver and export them as JSON.

Each level: the picture, the tube layout (bottom -> top, colour indexes) and an optimal
solution used by the "watch solve" demo and by the video renderer."""
import heapq, itertools, json, random, sys
from art import PICTURES, QMARK

CAP = 4


def is_goal(s):
    return all(len(t) == 0 or (len(t) == CAP and t.count(t[0]) == CAP) for t in s)


def h(s):
    cost = 0
    base = {}
    for t in s:
        if not t:
            continue
        run = 1
        while run < len(t) and t[run] == t[0]:
            run += 1
        cost += len(t) - run
        base.setdefault(t[0], []).append(run)
    for runs in base.values():
        if len(runs) > 1:
            runs.sort(reverse=True)
            cost += sum(runs[1:])
    return cost


def moves(s):
    first_empty_done = False
    for j, tj in enumerate(s):
        if len(tj) >= CAP:
            continue
        if not tj:
            if first_empty_done:
                continue
            first_empty_done = True
        for i, ti in enumerate(s):
            if i == j or not ti:
                continue
            if tj and tj[-1] != ti[-1]:
                continue
            if not tj and ti.count(ti[0]) == len(ti):
                continue  # moving a pure stack into an empty tube is pointless
            yield i, j


def apply(s, i, j):
    s = list(s)
    ti, tj = s[i], s[j]
    s[j] = tj + (ti[-1],)
    s[i] = ti[:-1]
    return tuple(s)


def solve(start, limit=400000):
    start = tuple(tuple(t) for t in start)
    key = lambda s: tuple(sorted(s))
    cnt = itertools.count()
    openq = [(h(start), 0, next(cnt), start)]
    parent = {key(start): (None, None)}
    gbest = {key(start): 0}
    states = {key(start): start}
    expanded = 0
    while openq:
        f, g, _, s = heapq.heappop(openq)
        k = key(s)
        if gbest.get(k, 1e9) < g:
            continue
        if is_goal(s):
            path = []
            while True:
                pk, mv = parent[key(s)]
                if pk is None:
                    break
                path.append(mv)
                s = pk
            return path[::-1], expanded
        expanded += 1
        if expanded > limit:
            return None, expanded
        for i, j in moves(s):
            n = apply(s, i, j)
            nk = key(n)
            ng = g + 1
            if ng < gbest.get(nk, 1e9):
                gbest[nk] = ng
                parent[nk] = (s, (i, j))
                heapq.heappush(openq, (ng + h(n), ng, next(cnt), n))
    return None, expanded


def check(start, path):
    s = [list(t) for t in start]
    for i, j in path:
        assert s[i], (i, j)
        assert len(s[j]) < CAP
        assert not s[j] or s[j][-1] == s[i][-1]
        s[j].append(s[i].pop())
    assert is_goal(tuple(tuple(t) for t in s))


def random_start(n, rng):
    balls = [c for c in range(n) for _ in range(CAP)]
    while True:
        rng.shuffle(balls)
        tubes = [balls[i * CAP:(i + 1) * CAP] for i in range(n)]
        if any(t.count(t[0]) == CAP for t in tubes):
            continue
        # no long runs: at most two equal neighbours in a tube
        bad = False
        for t in tubes:
            for a in range(CAP - 2):
                if t[a] == t[a + 1] == t[a + 2]:
                    bad = True
        if bad:
            continue
        return tubes + [[], []]


def completion_order(start, path):
    s = [list(t) for t in start]
    order = []
    for i, j in path:
        s[j].append(s[i].pop())
        t = s[j]
        if len(t) == CAP and t.count(t[0]) == CAP:
            order.append(t[0])
    return order


def build(pic_index, seed, want):
    pic = PICTURES[pic_index]
    keys = list(pic["palette"].keys())
    n = len(keys)
    rng = random.Random(seed)
    tried = 0
    while True:
        tried += 1
        start = random_start(n, rng)
        path, exp = solve(start)
        if path is None:
            continue
        if want(path, start):
            check(start, path)
            return start, path, tried


def pixel_orders(pic, seed):
    keys = list(pic["palette"].keys())
    rng = random.Random(seed)
    orders = []
    for ch in keys:
        idx = [y * 16 + x for y, r in enumerate(pic["rows"]) for x, c in enumerate(r) if c == ch]
        rng.shuffle(idx)
        orders.append(idx)
    return orders


if __name__ == "__main__":
    from art_new import NEW_PICTURES
    PICTURES.extend(NEW_PICTURES)
    BY_ID = {p["id"]: i for i, p in enumerate(PICTURES)}
    out = []
    last_is = lambda *cols: (lambda p, s: completion_order(s, p)[-1] in cols)
    specs = [
        # picture id, seed, accept(path, start) -- playable order = list order
        ("heart", 11, lambda p, s: 7 <= len(p) <= 9),
        ("panda", 61, lambda p, s: 11 <= len(p) <= 14),
        ("cat", 21, lambda p, s: 17 <= len(p) <= 20 and completion_order(s, p)[-1] in (3, 2)),
        ("pumpkin", 71, lambda p, s: 17 <= len(p) <= 20 and last_is(4)(p, s)),
        ("cupcake", 31, lambda p, s: 17 <= len(p) <= 20 and completion_order(s, p)[-1] in (2,)),
        ("ghost", 81, lambda p, s: 17 <= len(p) <= 20 and last_is(3)(p, s)),
        ("frog", 91, lambda p, s: 18 <= len(p) <= 21 and last_is(3, 4)(p, s)),
        ("rocket", 41, lambda p, s: 17 <= len(p) <= 21 and completion_order(s, p)[-1] in (4, 3)),
        ("duck", 101, lambda p, s: 19 <= len(p) <= 22),
        ("icecream", 111, lambda p, s: 19 <= len(p) <= 23 and last_is(2)(p, s)),
        ("watermelon", 121, lambda p, s: 20 <= len(p) <= 24),
        ("mushroom", 51, lambda p, s: 18 <= len(p) <= 22),
    ]
    for pid, seed, want in specs:
        pi = BY_ID[pid]
        pic = PICTURES[pi]
        start, path, tried = build(pi, seed, want)
        keys = list(pic["palette"].keys())
        order = completion_order(start, path)
        print(pic["id"], "moves", len(path), "tried", tried, "completion", [keys[c] for c in order], file=sys.stderr)
        out.append({
            "id": pic["id"],
            "name": pic["name"],
            "colors": [pic["palette"][k] for k in keys],
            "grid": [[keys.index(ch) for ch in row] for row in pic["rows"]],
            "tubes": start,
            "solution": path,
            "order": pixel_orders(pic, seed + 7),
        })
    qmark = [[1 if ch == "X" else 0 for ch in row] for row in QMARK]
    json.dump({"levels": out, "qmark": qmark}, open("levels.json", "w"), separators=(",", ":"))
    print("ok", file=sys.stderr)
