"""SQLite persistence for Kassa Run 3D: players, results, sessions, analytics, errors."""
import os, sqlite3, json, time, hashlib, secrets, re, unicodedata

DB_PATH = os.environ.get("KASSA_DB", os.path.join(os.path.dirname(__file__), "..", "data", "kassa.db"))
SL_OFFSET = 5.5 * 3600  # Sri Lanka local day boundaries

ACHIEVEMENTS = {
    "first_escape": ("පළමු පැනීම", "Escape to the hotel for the first time", "🏨"),
    "ten_escapes": ("පැනීම් 10ක්", "Escape 10 times", "🔟"),
    "speedrunner": ("සුපිරි වේගය", "Escape in under 90 seconds", "⚡"),
    "first_catch": ("පළමු අල්ලීම", "Catch Kassa as Raja", "🪤"),
    "ten_catches": ("කස්සා දඩයක්කාරයා", "Catch Kassa 10 times", "🎯"),
    "mp_win": ("මල්ටිප්ලේයර් ජයග්‍රහණය", "Win an online round", "🌐"),
    "hide_master": ("හැංගුම් ශූරයා", "Hide 5 times in a single round", "🌿"),
    "daily_done": ("දෛනික අභියෝගය", "Finish a daily challenge", "📅"),
}
SKIN_REQ = {"classic": None, "cool": "first_escape", "tuk": "ten_escapes", "gold": "speedrunner"}


def day_str(ts=None):
    return time.strftime("%Y-%m-%d", time.gmtime((ts or time.time()) + SL_OFFSET))


_db = None


def conn():
    global _db
    if _db is None:
        os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
        _db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        _db.row_factory = sqlite3.Row
        _db.execute("PRAGMA journal_mode=WAL")
        init(_db)
    return _db


def init(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS players(
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, name TEXT, name_lc TEXT UNIQUE, avatar TEXT DEFAULT '',
      created REAL, last_seen REAL, games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
      escapes INTEGER DEFAULT 0, catches INTEGER DEFAULT 0, best_time REAL, mp_wins INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0, ach TEXT DEFAULT '[]', skin TEXT DEFAULT 'classic', ceylon_id TEXT);
    CREATE TABLE IF NOT EXISTS results(
      id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT, ts REAL, day TEXT, mode TEXT, role TEXT,
      won INTEGER, time REAL, score INTEGER, hides INTEGER DEFAULT 0, forfeit INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_res_day ON results(day, role, won);
    CREATE INDEX IF NOT EXISTS ix_res_pid ON results(pid);
    CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT, start REAL, last REAL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, day TEXT, type TEXT, pid TEXT);
    CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, pid TEXT, msg TEXT, ctx TEXT);
    """)


def hash_token(t):
    return hashlib.sha256(t.encode()).hexdigest()


BAD = set('<>&"\'\\/`')


def clean_name(n):
    n = re.sub(r"\s+", " ", (n or "")).strip()
    if not (2 <= len(n) <= 16):
        return None
    for ch in n:
        if ch in BAD or unicodedata.category(ch)[0] == "C":
            return None
    low = n.lower()
    if any(b in low for b in ("admin", "ceylon games", "moderator")):
        return None
    return n


def player_by_token(token):
    if not token or len(token) > 100:
        return None
    r = conn().execute("SELECT * FROM players WHERE token_hash=?", (hash_token(token),)).fetchone()
    if r:
        conn().execute("UPDATE players SET last_seen=? WHERE id=?", (time.time(), r["id"]))
    return r


def player_by_id(pid):
    return conn().execute("SELECT * FROM players WHERE id=?", (pid,)).fetchone()


def create_player(name):
    """Returns (row, token) or (None, error)."""
    n = clean_name(name)
    if not n:
        return None, "bad_name"
    if conn().execute("SELECT 1 FROM players WHERE name_lc=?", (n.lower(),)).fetchone():
        return None, "name_taken"
    pid = secrets.token_hex(6)
    token = secrets.token_hex(24)
    now = time.time()
    conn().execute(
        "INSERT INTO players(id,token_hash,name,name_lc,created,last_seen) VALUES(?,?,?,?,?,?)",
        (pid, hash_token(token), n, n.lower(), now, now))
    return player_by_id(pid), token


def link_ceylon(uid, name, avatar="", existing_pid=None):
    """Attach a verified Ceylon Games account id to a player (creating one if needed). Returns (row, token|None)."""
    c = conn()
    r = c.execute("SELECT * FROM players WHERE ceylon_id=?", (uid,)).fetchone()
    if r:
        if existing_pid == r["id"]:
            return r, None
        tok = secrets.token_hex(24)   # new device: issue a fresh game token (older device sessions are signed out)
        c.execute("UPDATE players SET token_hash=? WHERE id=?", (hash_token(tok), r["id"]))
        return player_by_id(r["id"]), tok
    if existing_pid:
        c.execute("UPDATE players SET ceylon_id=?, avatar=? WHERE id=?", (uid, avatar, existing_pid))
        return player_by_id(existing_pid), None
    base = clean_name(name) or "Driver"
    for i in range(50):
        row, tok = create_player(base if i == 0 else (base[:12] + str(i + 1)))
        if row:
            c.execute("UPDATE players SET ceylon_id=?, avatar=? WHERE id=?", (uid, avatar, row["id"]))
            return player_by_id(row["id"]), tok
    return None, None


def rename(pid, name):
    n = clean_name(name)
    if not n:
        return "bad_name"
    ex = conn().execute("SELECT id FROM players WHERE name_lc=?", (n.lower(),)).fetchone()
    if ex and ex["id"] != pid:
        return "name_taken"
    conn().execute("UPDATE players SET name=?, name_lc=? WHERE id=?", (n, n.lower(), pid))
    return None


def set_skin(pid, skin):
    r = player_by_id(pid)
    if skin not in SKIN_REQ:
        return False
    req = SKIN_REQ[skin]
    if req and req not in json.loads(r["ach"]):
        return False
    conn().execute("UPDATE players SET skin=? WHERE id=?", (skin, pid))
    return True


def public_profile(r, full=True):
    d = {"id": r["id"], "name": r["name"], "avatar": r["avatar"], "skin": r["skin"],
         "games": r["games"], "wins": r["wins"], "escapes": r["escapes"], "catches": r["catches"],
         "best_time": r["best_time"], "mp_wins": r["mp_wins"], "score": r["score"],
         "ach": json.loads(r["ach"])}
    if full:
        d["achievements"] = {k: {"name": v[0], "desc": v[1], "icon": v[2]} for k, v in ACHIEVEMENTS.items()}
        d["unlockedSkins"] = [s for s, rq in SKIN_REQ.items() if rq is None or rq in d["ach"]]
    return d


def calc_score(role, won, t):
    if role == "kassa":
        return 100 + max(0, int(180 - t)) if won else 10
    return 100 + max(0, int(120 - t)) if won else 10


DIFF_MULT = {"easy": 0.8, "normal": 1.0, "hard": 1.3, "insane": 1.6}


def solo_score(won, t, hp, hits, tricks, hides, frags, diff):
    """Server-side scoring for solo/daily runs (client values are clamped). Returns (total, breakdown)."""
    m = DIFF_MULT.get(diff, 1.0)
    t = max(0.0, min(float(t), 3600)); hp = max(0, min(int(hp), 100)); hits = max(0, min(int(hits), 60))
    tricks = max(0, min(int(tricks), 60)); hides = max(0, min(int(hides), 60)); frags = max(0, min(int(frags), 3))
    if not won:
        v = int(min(300, t * 1.5) * m)
        return v, [["⏱ දිවි ගලවාගත් කාලය", v]]
    parts = [["🏆 ජයග්‍රහණය", 1000], ["⏱ කාලය", int(max(0, 420 - t) * 4)], ["❤️ ඉතිරි ජීවිතය", hp * 10], ["🌿 හැංගුම්", min(6, hides) * 40],
             ["🎯 උපක්‍රම", min(8, tricks) * 30], ["🛡️ ගැහුම් නැති", max(0, 250 - hits * 60)], ["🧩 පාස් කොටස්", frags * 100]]
    sub = sum(p[1] for p in parts)
    total = int(sub * m)
    parts.append(["✖ දුෂ්කරතාව ×%.1f" % m, total - sub])
    return total, parts


def add_result(pid, mode, role, won, t, hides=0, forfeit=False, score=None, catch=True):
    """Store a result and update totals. Returns (score, newly_unlocked_achievements)."""
    c = conn()
    r = player_by_id(pid)
    if not r:
        return 0, []
    sc = calc_score(role, won, t) if score is None else score
    if forfeit:
        sc = 0
    now = time.time()
    c.execute("INSERT INTO results(pid,ts,day,mode,role,won,time,score,hides,forfeit) VALUES(?,?,?,?,?,?,?,?,?,?)",
              (pid, now, day_str(now), mode, role, int(won), t, sc, hides, int(forfeit)))
    if forfeit:
        return 0, []
    esc = int(won and role == "kassa")
    cat = int(won and role == "raja" and catch)
    best = r["best_time"]
    if esc and (best is None or t < best):
        best = t
    mpw = int(won and mode == "mp")
    c.execute("UPDATE players SET games=games+1, wins=wins+?, escapes=escapes+?, catches=catches+?, best_time=?, "
              "mp_wins=mp_wins+?, score=score+? WHERE id=?", (int(won), esc, cat, best, mpw, sc, pid))
    r = player_by_id(pid)
    have = set(json.loads(r["ach"]))
    new = []

    def grant(k):
        if k not in have:
            have.add(k)
            new.append(k)
    if r["escapes"] >= 1: grant("first_escape")
    if r["escapes"] >= 10: grant("ten_escapes")
    if esc and t < 90: grant("speedrunner")
    if r["catches"] >= 1: grant("first_catch")
    if r["catches"] >= 10: grant("ten_catches")
    if mpw: grant("mp_win")
    if hides >= 5: grant("hide_master")
    if mode == "daily" and won: grant("daily_done")
    if new:
        c.execute("UPDATE players SET ach=? WHERE id=?", (json.dumps(sorted(have)), pid))
    return sc, new


def leaderboard(kind, limit=10):
    c = conn()
    today = day_str()
    wk = time.time() - 7 * 86400
    q, a = None, ()
    base = "SELECT p.name, p.avatar, p.id, {v} AS val, {s} AS sub FROM results r JOIN players p ON p.id=r.pid WHERE r.forfeit=0 AND {w} GROUP BY r.pid ORDER BY {o} LIMIT ?"
    if kind == "kassa_today":
        q = base.format(v="COUNT(*)", s="MIN(r.time)", w="r.role='kassa' AND r.won=1 AND r.day=?", o="val DESC, sub ASC"); a = (today, limit)
    elif kind == "raja_today":
        q = base.format(v="COUNT(*)", s="MIN(r.time)", w="r.role='raja' AND r.won=1 AND r.day=?", o="val DESC, sub ASC"); a = (today, limit)
    elif kind == "weekly":
        q = base.format(v="SUM(r.score)", s="COUNT(*)", w="r.ts>=?", o="val DESC"); a = (wk, limit)
    elif kind == "alltime":
        q = base.format(v="SUM(r.score)", s="COUNT(*)", w="1=1", o="val DESC"); a = (limit,)
    elif kind == "fastest":
        q = base.format(v="MIN(r.time)", s="COUNT(*)", w="r.role='kassa' AND r.won=1 AND r.mode!='race'", o="val ASC"); a = (limit,)
    elif kind == "bestrun":
        q = base.format(v="MAX(r.score)", s="COUNT(*)", w="r.mode IN ('solo','daily') AND r.won=1", o="val DESC"); a = (limit,)
    elif kind == "race":
        q = base.format(v="MIN(r.time)", s="COUNT(*)", w="r.mode='race' AND r.won=1", o="val ASC"); a = (limit,)
    elif kind == "mpwins":
        q = base.format(v="COUNT(*)", s="SUM(r.score)", w="r.mode='mp' AND r.won=1", o="val DESC, sub DESC"); a = (limit,)
    elif kind == "daily":
        q = base.format(v="MIN(r.time)", s="COUNT(*)", w="r.mode='daily' AND r.won=1 AND r.day=?", o="val ASC"); a = (today, limit)
    else:
        return []
    return [dict(x) for x in c.execute(q, a).fetchall()]


def log_event(typ, pid=None):
    now = time.time()
    conn().execute("INSERT INTO events(ts,day,type,pid) VALUES(?,?,?,?)", (now, day_str(now), typ, pid))


def log_error(pid, msg, ctx=""):
    conn().execute("INSERT INTO errors(ts,pid,msg,ctx) VALUES(?,?,?,?)", (time.time(), pid, str(msg)[:400], str(ctx)[:600]))
    conn().execute("DELETE FROM errors WHERE id < (SELECT MAX(id) FROM errors) - 500")


def session_start(pid):
    cur = conn().execute("INSERT INTO sessions(pid,start,last) VALUES(?,?,?)", (pid, time.time(), time.time()))
    return cur.lastrowid


def session_ping(sid):
    conn().execute("UPDATE sessions SET last=? WHERE id=?", (time.time(), sid))


def admin_stats():
    c = conn()
    g = lambda q, a=(): c.execute(q, a).fetchone()[0]
    today = day_str()
    now = time.time()
    daily = []
    for i in range(13, -1, -1):
        d = day_str(now - i * 86400)
        daily.append({"day": d,
                      "players": g("SELECT COUNT(DISTINCT pid) FROM results WHERE day=?", (d,)),
                      "games": g("SELECT COUNT(*) FROM results WHERE day=?", (d,)),
                      "sessions": g("SELECT COUNT(*) FROM events WHERE day=? AND type='visit'", (d,))})
    modes = {m: g("SELECT COUNT(*) FROM events WHERE type=?", (m,)) for m in ("solo_start", "daily_start", "race_start", "mp_round_start", "mp_match_start")}
    returning = g("SELECT COUNT(*) FROM (SELECT pid FROM results GROUP BY pid HAVING COUNT(DISTINCT day)>=2)")
    avg = g("SELECT AVG(last-start) FROM sessions WHERE last-start>5") or 0
    return {
        "total_players": g("SELECT COUNT(*) FROM players"),
        "players_today": g("SELECT COUNT(DISTINCT pid) FROM results WHERE day=?", (today,)),
        "players_week": g("SELECT COUNT(DISTINCT pid) FROM results WHERE ts>=?", (now - 7 * 86400,)),
        "solo_games": modes["solo_start"] + modes["daily_start"] + modes["race_start"],
        "mp_matches": modes["mp_match_start"],
        "mp_rounds": modes["mp_round_start"],
        "avg_session_sec": avg,
        "returning_players": returning,
        "popular_mode": "solo" if (modes["solo_start"] + modes["daily_start"]) >= modes["mp_round_start"] else "multiplayer",
        "modes": modes,
        "daily": daily,
        "errors": [dict(r) for r in c.execute("SELECT ts,pid,msg,ctx FROM errors ORDER BY id DESC LIMIT 30")],
        "errors_today": g("SELECT COUNT(*) FROM errors WHERE ts>=?", (now - 86400,)),
        "failed_sessions": g("SELECT COUNT(*) FROM events WHERE type='mp_forfeit' AND day=?", (today,)),
    }


def admin_players(q="", sort="last_seen", limit=200):
    """Player table for the admin dashboard: totals plus 7-day activity."""
    cols = {"last_seen": "p.last_seen", "created": "p.created", "games": "p.games", "wins": "p.wins",
            "score": "p.score", "mp_wins": "p.mp_wins", "name": "p.name_lc"}
    order = cols.get(sort, "p.last_seen")
    where, args = "", []
    if q:
        where, args = "WHERE p.name_lc LIKE ?", ["%" + q.lower().replace("%", "") + "%"]
    rows = conn().execute(
        f"""SELECT p.id, p.name, p.created, p.last_seen, p.games, p.wins, p.escapes, p.catches, p.mp_wins,
                   p.score, p.best_time, p.skin, (p.ceylon_id IS NOT NULL) AS bus_account,
                   (SELECT COUNT(*) FROM results r WHERE r.pid = p.id AND r.ts >= ?) AS games_7d
            FROM players p {where} ORDER BY {order} DESC LIMIT ?""",
        [time.time() - 7 * 86400, *args, limit]).fetchall()
    return [dict(r) for r in rows]


def admin_player(pid):
    c = conn()
    p = c.execute("SELECT id, name, created, last_seen, games, wins, escapes, catches, mp_wins, score, best_time, skin, (ceylon_id IS NOT NULL) AS bus_account FROM players WHERE id=?", (pid,)).fetchone()
    if not p:
        return None
    recent = [dict(r) for r in c.execute("SELECT ts, mode, role, won, time, score, hides, forfeit FROM results WHERE pid=? ORDER BY id DESC LIMIT 25", (pid,))]
    return {"player": dict(p), "recent": recent}
