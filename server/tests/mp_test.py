"""End-to-end multiplayer protocol test: two independent WebSocket clients against a running server.
Run: python server/tests/mp_test.py [base_url]
"""
import asyncio, json, sys, time, random, aiohttp

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
WS = BASE.replace("http", "ws") + "/ws"
ok_count = 0


def check(cond, msg):
    global ok_count
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        raise SystemExit(1)
    ok_count += 1


class Bot:
    def __init__(self, name):
        self.name = name; self.q = asyncio.Queue(); self.msgs = []; self.ws = None; self.token = None; self.id = None

    async def register(self, s):
        async with s.post(BASE + "/api/identify", json={"name": self.name + str(random.randint(100, 999))}) as r:
            j = await r.json(); self.token = j["token"]; self.id = j["profile"]["id"]; self.pname = j["profile"]["name"]

    async def connect(self, s):
        self.ws = await s.ws_connect(WS)
        self.reader = asyncio.ensure_future(self._read())
        await self.send("hello", token=self.token)
        w = await self.wait("welcome"); return w

    async def _read(self):
        try:
            async for m in self.ws:
                if m.type == aiohttp.WSMsgType.TEXT:
                    d = json.loads(m.data); self.msgs.append(d); await self.q.put(d)
        except Exception:
            pass

    async def send(self, t, **kw):
        await self.ws.send_str(json.dumps({"t": t, **kw}))

    async def wait(self, t, timeout=8, pred=None):
        end = time.time() + timeout
        while time.time() < end:
            try:
                m = await asyncio.wait_for(self.q.get(), timeout=max(0.05, end - time.time()))
            except asyncio.TimeoutError:
                break
            if m.get("t") == t and (pred is None or pred(m)):
                return m
        raise AssertionError(f"{self.name}: timeout waiting for {t}")

    def drain(self):
        while not self.q.empty():
            self.q.get_nowait()

    def last(self, t):
        for m in reversed(self.msgs):
            if m.get("t") == t:
                return m


async def main():
    async with aiohttp.ClientSession() as s:
        A, B = Bot("Alice"), Bot("Bob")
        await A.register(s); await B.register(s)
        await A.connect(s); await B.connect(s)
        # --- room
        await A.send("create", pub=False)
        r = await A.wait("room"); code = r["code"]
        check(len(code) == 4 and r["host"] == A.id, f"room {code} created by host")
        await B.send("join", code="ZZZZ"); e = await B.wait("err"); check(e["m"] == "notfound", "joining unknown room is rejected")
        await B.send("join", code=code.lower()); r = await B.wait("room", pred=lambda m: len(m["players"]) == 2)
        check(len(r["players"]) == 2, "second player joined")
        await A.send("start"); e = await A.wait("err"); check(e["m"] == "notready", "start blocked until ready")
        await A.send("pref", v="kassa"); await B.send("pref", v="raja")
        await B.send("ready", v=True); await B.wait("room", pred=lambda m: any(p["ready"] for p in m["players"]))
        A.drain(); B.drain()
        await A.send("start")
        sa = await A.wait("start"); sb = await B.wait("start")
        check(sa["kassa"] == A.id and sa["roles"][B.id]["role"] == "raja", "roles honour preferences (A=Kassa, B=Raja)")
        check(sa["seed"] == sb["seed"], "both receive the same seed")
        start_at = sa["startAt"] / 1000
        await asyncio.sleep(max(0, start_at - time.time()) + 0.2)
        head = sa["head"]
        # --- positions: Kassa far from Raja
        A.drain(); B.drain()
        rs = json.load(open("static/content/maps/colombo.json", encoding="utf-8"))["rajaSpawns"][sa["rspawn"]]
        for i in range(10):
            await A.send("state", x=0, z=50, y=0, ry=0, an="run", hid=0, sp=0)
            await B.send("state", x=rs[0], z=rs[1], y=0, ry=0, an="idle", hid=0, sp=0)
            await asyncio.sleep(0.07)
        snapB = B.last("snap"); snapA = A.last("snap")
        check(snapB is not None and all(p["i"] != A.id for p in snapB["p"]), "Raja is NOT sent Kassa's position when far away (fair play)")
        # speed validation
        await B.send("state", x=-300, z=300, y=0, ry=0, an="run", hid=0, sp=0)
        c = await B.wait("corr", timeout=3); check(c is not None, "teleport cheat / early move is rejected with a correction")
        # catch during head start / far away must fail
        await B.send("catch"); m = await B.wait("ev", pred=lambda m: m["k"] == "miss", timeout=3) if time.time() > start_at + head else None
        # Kassa and Raja next to each other
        await asyncio.sleep(max(0, start_at + head + 0.3 - time.time()))
        # walk raja toward kassa in legal steps
        for i in range(40):
            bx = rs[0] + (0 - rs[0]) * (i + 1) / 40; bz = rs[1] + (50 - rs[1]) * (i + 1) / 40 - (1 if i == 39 else 0)
            await B.send("state", x=bx, z=bz, y=0, ry=0, an="run", hid=0, sp=0); await A.send("state", x=0, z=50, y=0, ry=0, an="run", hid=0, sp=0); await asyncio.sleep(0.07)
        await B.send("state", x=1.0, z=49.0, y=0, ry=0, an="run", hid=0, sp=0)
        await A.send("state", x=0, z=50, y=0, ry=0, an="idle", hid=0, sp=0); await asyncio.sleep(0.2)
        snapB = B.last("snap")
        check(any(p["i"] == A.id for p in snapB["p"]), "Raja sees Kassa when within vision radius")
        A.drain(); B.drain()
        await B.send("catch")
        ra = await A.wait("result"); rb = await B.wait("result")
        check(ra["winner"] == "raja" and ra["reason"] == "caught", "close-range catch -> Raja wins (caught)")
        check(rb["gains"][B.id]["won"] and not rb["gains"][A.id]["won"], "gains reported per player")
        # --- round 2: roles swap
        await asyncio.sleep(0.3); A.drain(); B.drain()
        await B.send("next"); e = None
        await A.send("next")  # non-host? A is host
        s2a = await A.wait("start"); s2b = await B.wait("start")
        check(s2a["kassa"] == B.id, "round 2: roles swapped (B is now Kassa)")
        # Kassa B hides in hotel closet for 10s -> escaped
        cl = json.load(open("static/content/maps/colombo.json", encoding="utf-8"))["hotel"]["closets"][s2a["closet"]]
        await asyncio.sleep(max(0, s2a["startAt"] / 1000 - time.time()) + 0.2)
        await B.send("state", x=0, z=-48, y=0, ry=0, an="run", hid=0, sp=0)
        for k in range(6):  # walk into lobby in legal steps
            await B.send("state", x=cl[0] * (k + 1) / 6, z=-48 + (cl[1] + 2 + 48) * (k + 1) / 6, y=0, ry=0, an="run", hid=0, sp=0); await asyncio.sleep(0.3)
        t0 = time.time()
        got_in_hotel = False
        while time.time() - t0 < 13:
            await B.send("state", x=cl[0], z=cl[1] + 0.3, y=0, ry=0, an="hide", hid=1, sp=0, ho=1)
            await asyncio.sleep(0.1)
            if A.last("result") and A.last("result")["round"] == 2:
                break
        res = A.last("result")
        check(res and res["round"] == 2 and res["winner"] == "kassa" and res["reason"] == "escaped", f"Kassa wins after hiding in hotel closet ({time.time()-t0:.1f}s)")
        check(res["over"] and res["champion"] is not None, "match over after 2 rounds, champion announced")
        evs = [m["k"] for m in A.msgs if m.get("t") == "ev"]
        check("hotel_hide" in evs, "hotel hide timer announced to players")
        # --- rematch -> lobby
        A.drain(); await A.send("rematch"); r = await A.wait("room", pred=lambda m: m["state"] == "lobby")
        check(r["state"] == "lobby", "rematch returns room to lobby")
        # --- reconnect / disconnect handling
        await B.send("ready", v=True); await A.send("pref", v="raja"); await B.send("pref", v="kassa"); await asyncio.sleep(0.3)
        A.drain(); B.drain(); await A.send("start")
        s3 = await A.wait("start"); await B.wait("start")
        await asyncio.sleep(max(0, s3["startAt"] / 1000 - time.time()) + 0.3)
        kassa_bot, raja_bot = (A, B) if s3["kassa"] == A.id else (B, A)
        await kassa_bot.send("state", x=-20, z=58, y=0, ry=0, an="idle", hid=0, sp=0)
        # raja refreshes the browser: connection drops and returns within grace
        await raja_bot.ws.close(); await asyncio.sleep(1.0)
        ev = await kassa_bot.wait("ev", pred=lambda m: m["k"] == "peer_disc", timeout=3)
        check(ev is not None, "other player is told about the disconnect")
        raja_bot.msgs.clear(); raja_bot.q = asyncio.Queue()
        w = await raja_bot.connect(s)
        check(w["room"] == code, "reconnecting player is re-attached to its room")
        st = await raja_bot.wait("start", timeout=4)
        check(st.get("resume") and st["seed"] == s3["seed"], "resume message restores the round (same seed)")
        ev = await kassa_bot.wait("ev", pred=lambda m: m["k"] == "peer_back", timeout=3)
        check(ev is not None, "other player is told the player is back")
        # kassa disconnects permanently -> forfeit after grace
        await kassa_bot.ws.close()
        t0 = time.time()
        r = await raja_bot.wait("result", timeout=40)
        check(r["winner"] == "raja" and r["reason"] == "disconnect" and r["forfeit"], f"Kassa disconnect -> fair forfeit after {time.time()-t0:.0f}s grace (no score)")
        await raja_bot.send("leave")
        print(f"\nALL {ok_count} CHECKS PASSED")

asyncio.run(main())
