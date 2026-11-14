"""3-player smoke test: public quick-match, team roles (Raja + catcher), head start scaling, shared scoring."""
import asyncio, json, sys, time, random, aiohttp
sys.path.insert(0, "server/tests")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
MAP = json.load(open("static/content/maps/colombo.json", encoding="utf-8"))


def check(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c:
        raise SystemExit(1)


class Bot:
    def __init__(self, n): self.n = n; self.q = asyncio.Queue()
    async def up(self, s):
        async with s.post(BASE + "/api/identify", json={"name": self.n + str(random.randint(100, 999))}) as r:
            j = await r.json()
        self.tok, self.id = j["token"], j["profile"]["id"]
        self.ws = await s.ws_connect(BASE.replace("http", "ws") + "/ws")
        self.task = asyncio.ensure_future(self.rd())
        await self.send("hello", token=self.tok); await self.wait("welcome")
    async def rd(self):
        async for m in self.ws:
            if m.type == aiohttp.WSMsgType.TEXT: await self.q.put(json.loads(m.data))
    async def send(self, t, **k): await self.ws.send_str(json.dumps({"t": t, **k}))
    async def wait(self, t, pred=None, timeout=8):
        end = time.time() + timeout
        while time.time() < end:
            try: m = await asyncio.wait_for(self.q.get(), max(0.05, end - time.time()))
            except asyncio.TimeoutError: break
            if m["t"] == t and (pred is None or pred(m)): return m
        raise AssertionError(self.n + " timeout " + t)


async def main():
    async with aiohttp.ClientSession() as s:
        A, B, C = Bot("A"), Bot("B"), Bot("C")
        for b in (A, B, C): await b.up(s)
        await A.send("create", pub=True); await A.wait("room")
        async with s.get(BASE + "/api/rooms") as r: lst = (await r.json())["rooms"]
        check(any(x["host"].startswith("A") for x in lst), "public room is listed")
        await B.send("quick"); await B.wait("room", lambda m: len(m["players"]) == 2)
        await C.send("quick"); room = await C.wait("room", lambda m: len(m["players"]) == 3)
        check(room["code"] and len(room["players"]) == 3, "quick match fills the same public room (3 players)")
        await B.send("ready", v=True); await C.send("ready", v=True); await asyncio.sleep(0.3)
        await A.send("start")
        st = {b.n: await b.wait("start") for b in (A, B, C)}
        s0 = st["A"]
        roles = s0["roles"]
        check(sum(1 for r in roles.values() if r["role"] == "kassa") == 1, "exactly one Kassa")
        kinds = sorted(r["kind"] for r in roles.values() if r["role"] == "raja")
        check(len(kinds) == 2 and "raja" in kinds and any(k in ("sprinter", "scout", "bruiser") for k in kinds), f"Raja + supporting catcher {kinds}")
        check(s0["head"] == 10 and s0["roundTime"] == 270, "head start / timer scale with team size")
        bots = {b.id: b for b in (A, B, C)}
        kassa = bots[s0["kassa"]]; catcher = next(bots[i] for i, r in roles.items() if r["kind"] not in (None, "raja"))
        main_raja = next(bots[i] for i, r in roles.items() if r["kind"] == "raja")
        await asyncio.sleep(max(0, s0["startAt"] / 1000 - time.time()) + 0.2)
        sp = MAP["rajaSpawns"][s0["rspawn"]]
        for b in (main_raja, catcher):
            await b.send("state", x=sp[0], z=sp[1], y=0, ry=0, an="idle", hid=0, sp=0)
        await kassa.send("state", x=-20, z=58, y=0, ry=0, an="idle", hid=0, sp=0)
        await asyncio.sleep(max(0, s0["startAt"] / 1000 + s0["head"] + 0.3 - time.time()))
        # catcher walks to Kassa (legal speed), main raja stays; catcher tags
        x, z = sp
        for i in range(400):
            dx, dz = -20 - x, 57 - z; d = max(0.1, (dx * dx + dz * dz) ** .5); step = min(d, 0.55)
            x += dx / d * step; z += dz / d * step
            await catcher.send("state", x=x, z=z, y=0, ry=0, an="run", hid=0, sp=0)
            await kassa.send("state", x=-20, z=58, y=0, ry=0, an="idle", hid=0, sp=0)
            if d < 1.5: break
            await asyncio.sleep(0.07)
        await asyncio.sleep(0.2)
        await catcher.send("catch")
        res = await main_raja.wait("result")
        check(res["winner"] == "raja" and res["catcher"] == catcher.id, "supporting catcher can tag Kassa")
        g = res["gains"]
        check(g[catcher.id]["score"] > g[main_raja.id]["score"] > 0, f"catcher gets full score, teammate partial ({g[catcher.id]['score']} vs {g[main_raja.id]['score']})")
        await A.send("leave"); await B.send("leave"); await C.send("leave")
        print("TEAM TEST PASSED")
asyncio.run(main())
