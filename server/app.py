"""Kassa Run 3D server: static files + REST API + WebSocket multiplayer.

Run:  python server/app.py          (PORT=8080 by default)
"""
import asyncio, hashlib, hmac, json, os, secrets, sys, time
from aiohttp import web, WSMsgType

sys.path.insert(0, os.path.dirname(__file__))
import db, rooms, ceylon_auth

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATIC = os.path.join(ROOT, "static")
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)


def load_secret():
    p = os.path.join(DATA, "secret.key")
    if not os.path.exists(p):
        open(p, "w").write(secrets.token_hex(32))
    return open(p).read().strip().encode()


SECRET = load_secret()
ADMIN_USER = os.environ.get("KASSA_ADMIN_USER", "admin").strip() or "admin"
ADMIN_PW = os.environ.get("KASSA_ADMIN_PASSWORD")
if not ADMIN_PW:
    pwf = os.path.join(DATA, "admin_password.txt")
    if not os.path.exists(pwf):
        open(pwf, "w").write(secrets.token_urlsafe(9))
    ADMIN_PW = open(pwf).read().strip()


def admin_token():
    return hmac.new(SECRET, b"admin:" + ADMIN_PW.encode(), hashlib.sha256).hexdigest()


TRUST_PROXY = os.environ.get("KASSA_TRUST_PROXY") == "1"


def client_ip(req):
    if TRUST_PROXY:
        fwd = req.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return req.remote or "?"


def j(data, status=200):
    return web.json_response(data, status=status)


def config():
    try:
        return json.load(open(os.path.join(STATIC, "content", "config.json"), encoding="utf-8"))
    except Exception:
        return {}


# ---------------------------------------------------------------- daily / seasonal
def daily_info():
    cfg = config()
    day = db.day_str()
    h = int(hashlib.sha256(("kassa-daily-" + day).encode()).hexdigest(), 16)
    mods = list(cfg.get("modifiers", {}).keys())
    chosen = []
    if mods:
        chosen.append(mods[h % len(mods)])
        second = mods[(h // 7 + 1) % len(mods)]
        if second not in chosen:
            chosen.append(second)
    md = day[5:]
    season = None
    for s in cfg.get("seasons", []):
        if s["from"] <= md <= s["to"]:
            season = s
            for m in s.get("modifiers", []):
                if m not in chosen:
                    chosen.append(m)
    return {"day": day, "seed": h % (2 ** 31), "mods": chosen, "season": season}


# ---------------------------------------------------------------- middleware
ALLOW = [o.strip() for o in os.environ.get("KASSA_ALLOW_ORIGIN", "").split(",") if o.strip()]


@web.middleware
async def nocache(request, handler):
    origin = request.headers.get("Origin", "")
    cors = origin if (origin and (origin in ALLOW or "*" in ALLOW)) else None
    if request.method == "OPTIONS" and cors:
        return web.Response(status=204, headers={"Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                                                  "Access-Control-Allow-Headers": "content-type,x-admin-token", "Access-Control-Max-Age": "86400"})
    try:
        resp = await handler(request)
    except web.HTTPException as e:
        resp = e
    if isinstance(resp, web.WebSocketResponse):
        return resp
    if request.path.endswith((".html", ".js", ".json", ".css")) or request.path == "/":
        resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    if cors:
        resp.headers["Access-Control-Allow-Origin"] = cors
        resp.headers["Vary"] = "Origin"
    return resp


# ---------------------------------------------------------------- REST
new_acct = {}


async def api_identify(req):
    try:
        b = await req.json()
    except Exception:
        return j({"error": "bad_json"}, 400)
    row = db.player_by_token(b.get("token"))
    name = b.get("name")
    if b.get("ceylon_token") and ceylon_auth.enabled():   # optional SSO (disabled by default)
        acct = ceylon_auth.verify_id_token(b["ceylon_token"])
        if not acct:
            return j({"error": "bad_ceylon_token"}, 401)
        prow, tok = db.link_ceylon(acct["uid"], acct["name"], acct["picture"], row["id"] if row else None)
        if prow:
            return j({"profile": db.public_profile(prow), "token": tok or b.get("token"), "new": tok is not None})
    if row:
        if name and name != row["name"]:
            err = db.rename(row["id"], name)
            if err:
                return j({"error": err}, 409)
            row = db.player_by_id(row["id"])
        if b.get("skin"):
            db.set_skin(row["id"], b["skin"])
            row = db.player_by_id(row["id"])
        return j({"profile": db.public_profile(row), "token": b.get("token"), "new": False})
    ip = client_ip(req)
    now = time.time()
    recent = [t for t in new_acct.get(ip, []) if now - t < 3600]
    if len(recent) >= 30:
        return j({"error": "rate_limited"}, 429)
    row, tok = db.create_player(name)
    if row is not None:
        recent.append(now)
        new_acct[ip] = recent
    if row is None:
        return j({"error": tok}, 409 if tok == "name_taken" else 400)
    return j({"profile": db.public_profile(row), "token": tok, "new": True})


async def api_profile(req):
    row = db.player_by_id(req.query.get("id", ""))
    if not row:
        return j({"error": "not_found"}, 404)
    return j({"profile": db.public_profile(row)})


async def api_leaderboard(req):
    kinds = ["kassa_today", "raja_today", "weekly", "alltime", "fastest", "mpwins", "daily", "race", "bestrun"]
    kind = req.query.get("type")
    if kind == "all":
        return j({k: db.leaderboard(k, 10) for k in kinds})
    return j({"rows": db.leaderboard(kind, 20)})


async def api_daily(req):
    d = daily_info()
    d["board"] = db.leaderboard("daily", 10)
    return j(d)


async def api_rooms(req):
    return j({"rooms": rooms.public_list()})


runs = {}  # solo run id -> dict


async def api_solo_start(req):
    b = await req.json()
    row = db.player_by_token(b.get("token"))
    daily = bool(b.get("daily"))
    race = bool(b.get("race")) and not daily
    d = daily_info()
    seed = d["seed"] if daily else secrets.randbelow(2 ** 31)
    rid = secrets.token_hex(8)
    now = time.time()
    for k in [k for k, v in runs.items() if now - v["t"] > 3600]:
        runs.pop(k, None)
    runs[rid] = {"pid": row["id"] if row else None, "t": now, "daily": daily, "race": race, "used": False}
    db.log_event("daily_start" if daily else ("race_start" if race else "solo_start"), row["id"] if row else None)
    return j({"run": rid, "seed": seed, "mods": d["mods"] if daily else (d["season"]["modifiers"] if d["season"] else []), "daily": daily, "race": race})


async def api_solo_finish(req):
    b = await req.json()
    row = db.player_by_token(b.get("token"))
    run = runs.get(b.get("run"))
    if not row or not run or run["pid"] != row["id"] or run["used"]:
        return j({"ok": False, "error": "invalid_run"}, 400)
    run["used"] = True
    elapsed = time.time() - run["t"]
    try:
        t = float(b.get("time", 0))
    except Exception:
        t = 0
    won = bool(b.get("won"))
    hides = max(0, min(50, int(b.get("hides", 0) or 0)))
    sc_total, breakdown = db.solo_score(won, t if won else min(t, elapsed), b.get("hp", 0) or 0, b.get("hits", 0) or 0, b.get("tricks", 0) or 0, hides, b.get("frags", 0) or 0, str(b.get("diff", "hard")), b.get("coins", 0))
    # plausibility: cannot be faster than the shortest route, cannot claim more time than elapsed
    if won and (t < (14 if run.get("race") else 45) or t > elapsed + 2 or elapsed - t > 900):
        return j({"ok": False, "error": "implausible_time"}, 400)
    mode = "daily" if run["daily"] else ("race" if run.get("race") else "solo")
    sc, new = db.add_result(row["id"], mode, "kassa", won, t if won else min(t, elapsed), hides=hides, score=sc_total)
    row = db.player_by_id(row["id"])
    return j({"ok": True, "score": sc, "ach": new, "breakdown": breakdown, "profile": db.public_profile(row)})


async def api_session(req):
    b = await req.json()
    row = db.player_by_token(b.get("token"))
    pid = row["id"] if row else None
    if b.get("sid"):
        db.session_ping(int(b["sid"]))
        return j({"sid": b["sid"]})
    sid = db.session_start(pid)
    db.log_event("visit", pid)
    return j({"sid": sid})


err_rate = {}


async def api_error(req):
    ip = client_ip(req)
    now = time.time()
    n, t0 = err_rate.get(ip, (0, now))
    if now - t0 > 60:
        n, t0 = 0, now
    err_rate[ip] = (n + 1, t0)
    if n > 20:
        return j({"ok": False}, 429)
    try:
        b = await req.json()
    except Exception:
        return j({"ok": False}, 400)
    row = db.player_by_token(b.get("token"))
    db.log_error(row["id"] if row else None, b.get("msg", ""), b.get("ctx", ""))
    return j({"ok": True})


# ---------------------------------------------------------------- admin
login_fail = {}


async def api_admin_login(req):
    ip = client_ip(req)
    n, t0 = login_fail.get(ip, (0, time.time()))
    if time.time() - t0 > 600:
        n, t0 = 0, time.time()
    if n >= 8:
        return j({"error": "locked"}, 429)
    b = await req.json()
    ok_user = hmac.compare_digest(str(b.get("username", "")).strip(), ADMIN_USER)
    ok_pw = hmac.compare_digest(str(b.get("password", "")), ADMIN_PW)
    if ok_user and ok_pw:
        login_fail.pop(ip, None)
        return j({"token": admin_token()})
    login_fail[ip] = (n + 1, t0)
    await asyncio.sleep(0.8)
    return j({"error": "wrong"}, 401)


def admin_ok(req):
    return hmac.compare_digest(req.headers.get("X-Admin-Token", ""), admin_token())


async def api_admin_players(req):
    if not admin_ok(req):
        return j({"error": "auth"}, 401)
    q = req.query.get("q", "")[:24]
    sort = req.query.get("sort", "last_seen")
    return j({"players": db.admin_players(q, sort, 300)})


async def api_admin_player(req):
    if not admin_ok(req):
        return j({"error": "auth"}, 401)
    d = db.admin_player(req.query.get("id", ""))
    return j(d) if d else j({"error": "not_found"}, 404)


async def api_admin_stats(req):
    if not admin_ok(req):
        return j({"error": "auth"}, 401)
    s = db.admin_stats()
    live = [r for r in rooms.rooms.values()]
    s["active_games"] = sum(1 for r in live if r.state == "playing")
    s["open_rooms"] = len(live)
    s["connected_players"] = sum(len(r.connected()) for r in live)
    s["solo_in_progress"] = sum(1 for v in runs.values() if not v["used"] and time.time() - v["t"] < 900)
    s["boards"] = {k: db.leaderboard(k, 10) for k in ("kassa_today", "raja_today", "weekly", "alltime", "fastest", "mpwins")}
    s["daily_challenge"] = daily_info()
    return j(s)


# ---------------------------------------------------------------- websocket
async def ws_handler(req):
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=4096)
    await ws.prepare(req)
    ctx = {"pid": None, "win": time.time(), "n": 0}
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            now = time.time()
            if now - ctx["win"] > 1:
                ctx["win"], ctx["n"] = now, 0
            ctx["n"] += 1
            if ctx["n"] > 80:
                continue
            try:
                m = json.loads(msg.data)
                await handle(ws, ctx, m)
            except Exception as e:
                db.log_error(ctx["pid"], "ws " + repr(e), msg.data[:200])
    finally:
        pid = ctx["pid"]
        room = rooms.player_room.get(pid) if pid else None
        if room and pid in room.players:
            room.detach(room.players[pid], ws)
    return ws


async def jsend(ws, obj):
    if not ws.closed:
        await ws.send_str(json.dumps(obj, separators=(",", ":")))


async def handle(ws, ctx, m):
    t = m.get("t")
    if t == "ping":
        return await jsend(ws, {"t": "pong", "c": m.get("c"), "s": time.time() * 1000})
    if t == "hello":
        row = db.player_by_token(m.get("token"))
        if not row:
            return await jsend(ws, {"t": "err", "m": "auth"})
        ctx["pid"] = row["id"]
        room = rooms.player_room.get(row["id"])
        code = None
        if room and row["id"] in room.players and not room.players[row["id"]].left:
            rp = room.players[row["id"]]
            room.attach(rp, ws)
            code = room.code
        await jsend(ws, {"t": "welcome", "id": row["id"], "name": row["name"], "room": code, "profile": db.public_profile(row)})
        if code:
            await jsend(ws, room.info())
            if room.state == "playing" and room.rd:
                await jsend(ws, room.start_msg(resume_for=rp))
            elif room.state in ("between", "over") and room.last_result:
                await jsend(ws, room.last_result)
        return
    pid = ctx["pid"]
    if not pid:
        return
    row = db.player_by_id(pid)
    room = rooms.player_room.get(pid)
    rp = room.players.get(pid) if room else None

    if t == "list":
        return await jsend(ws, {"t": "list", "rooms": rooms.public_list()})
    if t in ("create", "join", "quick"):
        if room and rp:
            room.remove(rp)
            room = rp = None
        if t == "create":
            code = rooms.new_code()
            room = rooms.Room(code, bool(m.get("pub")))
            rooms.rooms[code] = room
        elif t == "join":
            room = rooms.rooms.get(str(m.get("code", "")).upper().strip())
            if not room:
                return await jsend(ws, {"t": "err", "m": "notfound"})
        else:
            cands = [r for r in rooms.rooms.values() if r.public and r.state == "lobby" and len(r.connected()) < rooms.MAXP]
            if cands:
                room = cands[0]
            else:
                code = rooms.new_code()
                room = rooms.Room(code, True)
                rooms.rooms[code] = room
        if room.state != "lobby" and pid not in room.players:
            return await jsend(ws, {"t": "err", "m": "started"})
        if len(room.players) >= rooms.MAXP and pid not in room.players:
            return await jsend(ws, {"t": "err", "m": "full"})
        rp = room.add(row)
        room.attach(rp, ws)
        room.push_info()
        return
    if not room or not rp:
        return
    if t == "leave":
        room.remove(rp)
        return await jsend(ws, {"t": "left"})
    if t == "ready" and room.state == "lobby":
        rp.ready = bool(m.get("v"))
        return room.push_info()
    if t == "pref" and room.state == "lobby" and m.get("v") in ("any", "kassa", "raja"):
        rp.pref = m["v"]
        return room.push_info()
    if t == "rounds" and room.host == pid and room.state == "lobby" and m.get("v") in (2, 4, 6):
        room.rounds = m["v"]
        return room.push_info()
    if t == "mode" and room.host == pid and room.state == "lobby" and m.get("v") in ("chase",):
        room.mode = m["v"]
        return room.push_info()
    if t == "map" and room.host == pid and room.state == "lobby" and m.get("v") in ("hillcountry", "riverside", "colombo"):
        room.map_id = m["v"]
        return room.push_info()
    if t == "env" and room.host == pid and room.state == "lobby":
        if m.get("time") in ("day", "dusk", "night"):
            room.env["time"] = m["time"]
        if m.get("weather") in ("clear", "rain", "fog"):
            room.env["weather"] = m["weather"]
        return room.push_info()
    if t == "public" and room.host == pid and room.state == "lobby":
        room.public = bool(m.get("v"))
        return room.push_info()
    if t == "start" and room.host == pid and room.state == "lobby":
        if room.can_start():
            room.start_round()
        else:
            await jsend(ws, {"t": "err", "m": "notready"})
        return
    if t == "next" and room.host == pid and room.state == "between":
        return room.next_round()
    if t == "rematch" and room.host == pid and room.state == "over":
        return room.to_lobby()
    if t == "state":
        return room.on_state(rp, m)
    if t == "catch":
        return room.on_catch(rp)
    if t == "ab":
        return room.on_raja_ability(rp, m.get("n"))
    if t == "fx" and room.state == "playing" and room.rd:
        return room.on_fx(rp, m)
    if t == "emote":
        now = time.time()
        if now - rp.emote_t > 0.8 and isinstance(m.get("id"), int) and 0 <= m["id"] < 12:
            rp.emote_t = now
            room.broadcast({"t": "emote", "id": rp.id, "e": m["id"]})
        return


# ---------------------------------------------------------------- app
async def index(req):
    return web.FileResponse(os.path.join(STATIC, "index.html"))


async def admin_page(req):
    return web.FileResponse(os.path.join(STATIC, "admin.html"))


async def on_start(app):
    db.conn()
    app["ticker"] = asyncio.ensure_future(rooms.ticker())


def make_app():
    app = web.Application(middlewares=[nocache])
    r = app.router
    r.add_get("/", index)
    r.add_get("/admin", admin_page)
    r.add_get("/ws", ws_handler)
    r.add_post("/api/identify", api_identify)
    r.add_get("/api/profile", api_profile)
    r.add_get("/api/leaderboard", api_leaderboard)
    r.add_get("/api/daily", api_daily)
    r.add_get("/api/rooms", api_rooms)
    r.add_post("/api/solo/start", api_solo_start)
    r.add_post("/api/solo/finish", api_solo_finish)
    r.add_post("/api/session", api_session)
    r.add_post("/api/error", api_error)
    r.add_post("/api/admin/login", api_admin_login)
    r.add_get("/api/admin/stats", api_admin_stats)
    r.add_get("/api/admin/players", api_admin_players)
    r.add_get("/api/admin/player", api_admin_player)
    r.add_static("/", STATIC, show_index=False)
    app.on_startup.append(on_start)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"Kassa Run 3D  ->  http://localhost:{port}   admin: /admin  (password in data/admin_password.txt or KASSA_ADMIN_PASSWORD)")
    try:
        web.run_app(make_app(), host=os.environ.get("HOST", "0.0.0.0"), port=port, print=None)
    except OSError as e:
        print("Could not start on port %s: %s" % (port, e))
        print("Is the game already running in another window? Try:  set PORT=8081  and run again.")
        sys.exit(1)
