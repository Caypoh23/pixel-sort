"""Daily Pixel Sort test report from PostHog.

Pulls the play funnel by traffic source and by ad creative, writes reports/latest.md,
reports/<date>.md and docs/data/report.json. Runs from GitHub Actions every morning.

Needs secrets POSTHOG_PERSONAL_API_KEY (scope: query read) and POSTHOG_PROJECT_ID.
Optional POSTHOG_API_HOST (default https://us.posthog.com; EU cloud: https://eu.posthog.com).
Without them the script explains what is missing and exits 0.
"""
import datetime as dt
import json
import os
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Working targets for a browser prototype; revisit after the first 300 players.
TARGETS = {"play_rate": 0.70, "l1_rate": 0.60, "l3_rate": 0.30, "yes_rate": 0.40}

NOT_DEMO = "toString(properties.watched_solution) != 'true'"
FUNNEL = f"""
SELECT {{group}} AS grp,
  uniqIf(distinct_id, event = 'level_start') AS visitors,
  uniqIf(distinct_id, event = 'first_move') AS played,
  uniqIf(distinct_id, event = 'level_complete' AND {NOT_DEMO} AND toFloat(properties.level) >= 1) AS done_l1,
  uniqIf(distinct_id, event = 'level_complete' AND {NOT_DEMO} AND toFloat(properties.level) >= 3) AS done_l3,
  uniqIf(distinct_id, event = 'install_intent') AS answered,
  uniqIf(distinct_id, event = 'install_intent' AND toString(properties.answer) = 'yes') AS said_yes,
  uniqIf(distinct_id, event = 'share_click') AS shared
FROM events
WHERE timestamp > now() - INTERVAL {{days}} DAY {{where}}
GROUP BY grp ORDER BY visitors DESC LIMIT 40
"""
SOURCE = "coalesce(nullIf(toString(properties.utm_source), ''), 'direct')"
CREATIVE = "coalesce(nullIf(toString(properties.utm_content), ''), '(none)')"
ADS_WHERE = "AND toString(properties.utm_medium) IN ('paid', 'cpc', 'ads')"
LEVELS = f"""
SELECT toInt(toFloat(properties.level)) AS level, count() AS completions,
  round(avg(toFloat(properties.seconds)), 1) AS avg_seconds,
  round(avg(toFloat(properties.moves)), 1) AS avg_moves,
  round(avg(toFloat(properties.undos)), 2) AS avg_undos,
  round(avg(if(toString(properties.booster) = 'true', 1, 0)), 2) AS booster_share
FROM events
WHERE event = 'level_complete' AND {NOT_DEMO} AND timestamp > now() - INTERVAL 7 DAY
GROUP BY level ORDER BY level
"""
DAILY = """
SELECT toDate(timestamp) AS day,
  uniqIf(distinct_id, event = 'level_start') AS visitors,
  uniqIf(distinct_id, event = 'first_move') AS played,
  uniqIf(distinct_id, event = 'level_complete' AND toFloat(properties.level) >= 1) AS done_l1
FROM events WHERE timestamp > now() - INTERVAL 14 DAY
GROUP BY day ORDER BY day
"""


def query(host, project, key, sql):
    body = json.dumps({"query": {"kind": "HogQLQuery", "query": sql}}).encode()
    req = urllib.request.Request(f"{host}/api/projects/{project}/query/", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"PostHog HTTP {e.code}: {e.read().decode()[:600]}")
    cols = out.get("columns") or []
    return [dict(zip(cols, row)) for row in out.get("results") or []]


def rate(a, b):
    return (a / b) if b else None


def pct(x):
    return "–" if x is None else f"{x * 100:.0f}%"


def flag(x, target):
    if x is None:
        return ""
    return " ✅" if x >= target else " ⚠️"


def funnel_table(rows, label):
    head = f"| {label} | Visitors | Played | Finished L1 | Finished L3 | Said yes | Shared |\n|---|---:|---:|---:|---:|---:|---:|\n"
    lines = []
    for r in rows:
        pr, l1, l3, yes = rate(r["played"], r["visitors"]), rate(r["done_l1"], r["played"]), rate(r["done_l3"], r["played"]), rate(r["said_yes"], r["answered"])
        lines.append(f"| {r['grp']} | {r['visitors']} | {r['played']} ({pct(pr)}) | {r['done_l1']} ({pct(l1)}) | "
                     f"{r['done_l3']} ({pct(l3)}) | {r['said_yes']}/{r['answered']} ({pct(yes)}) | {r['shared']} |")
    return head + ("\n".join(lines) if lines else "| no data yet | | | | | | |") + "\n"


def main():
    key = os.environ.get("POSTHOG_PERSONAL_API_KEY", "").strip()
    project = os.environ.get("POSTHOG_PROJECT_ID", "").strip()
    host = (os.environ.get("POSTHOG_API_HOST") or "https://us.posthog.com").rstrip("/")
    if not key or not project:
        print("Report skipped: add POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID as repository secrets.")
        return
    q = lambda sql: query(host, project, key, sql)
    by_source_7d = q(FUNNEL.format(group=SOURCE, days=7, where=""))
    by_source_1d = q(FUNNEL.format(group=SOURCE, days=1, where=""))
    by_creative = q(FUNNEL.format(group=CREATIVE, days=7, where=ADS_WHERE))
    levels = q(LEVELS)
    daily = q(DAILY)

    tot = {k: sum(r[k] for r in by_source_7d) for k in ("visitors", "played", "done_l1", "done_l3", "answered", "said_yes", "shared")}
    rates = {"play_rate": rate(tot["played"], tot["visitors"]), "l1_rate": rate(tot["done_l1"], tot["played"]),
             "l3_rate": rate(tot["done_l3"], tot["played"]), "yes_rate": rate(tot["said_yes"], tot["answered"])}
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    md = [f"# Pixel Sort test report · {today}\n",
          "Last 7 days, unique browsers. Demo plays (Watch button) are excluded from level counts.\n",
          "## Summary\n",
          f"- Visitors: **{tot['visitors']}**, played at least one move: **{tot['played']}** ({pct(rates['play_rate'])}{flag(rates['play_rate'], TARGETS['play_rate'])}; target {pct(TARGETS['play_rate'])})",
          f"- Finished level 1: **{tot['done_l1']}** of players ({pct(rates['l1_rate'])}{flag(rates['l1_rate'], TARGETS['l1_rate'])}; target {pct(TARGETS['l1_rate'])})",
          f"- Finished level 3: **{tot['done_l3']}** of players ({pct(rates['l3_rate'])}{flag(rates['l3_rate'], TARGETS['l3_rate'])}; target {pct(TARGETS['l3_rate'])})",
          f"- Would install: **{tot['said_yes']} of {tot['answered']}** answers ({pct(rates['yes_rate'])}{flag(rates['yes_rate'], TARGETS['yes_rate'])}; target {pct(TARGETS['yes_rate'])})",
          f"- Shared the game: **{tot['shared']}**\n",
          "## By traffic source, 7 days\n", funnel_table(by_source_7d, "Source"),
          "## By traffic source, last 24 hours\n", funnel_table(by_source_1d, "Source"),
          "## Paid ads by creative, 7 days (utm_medium=paid)\n", funnel_table(by_creative, "Creative"),
          "## Levels, 7 days\n",
          "| Level | Completions | Avg seconds | Avg moves | Avg undos | Used +1 tube |\n|---:|---:|---:|---:|---:|---:|\n" +
          ("\n".join(f"| {r['level']} | {r['completions']} | {r['avg_seconds']} | {r['avg_moves']} | {r['avg_undos']} | {pct(r['booster_share'])} |" for r in levels) or "| – | | | | | |") + "\n",
          "## Daily, 14 days\n",
          "| Day | Visitors | Played | Finished L1 |\n|---|---:|---:|---:|\n" +
          ("\n".join(f"| {r['day']} | {r['visitors']} | {r['played']} | {r['done_l1']} |" for r in daily) or "| – | | | |") + "\n"]
    text = "\n".join(md)
    os.makedirs(os.path.join(ROOT, "reports"), exist_ok=True)
    open(os.path.join(ROOT, "reports", "latest.md"), "w").write(text)
    open(os.path.join(ROOT, "reports", f"{today}.md"), "w").write(text)
    os.makedirs(os.path.join(ROOT, "docs", "data"), exist_ok=True)
    json.dump({"date": today, "totals": tot, "rates": rates, "targets": TARGETS, "by_source_7d": by_source_7d,
               "by_source_24h": by_source_1d, "by_creative_7d": by_creative, "levels": levels, "daily": daily},
              open(os.path.join(ROOT, "docs", "data", "report.json"), "w"), indent=1, default=str)
    print(text)


if __name__ == "__main__":
    main()
