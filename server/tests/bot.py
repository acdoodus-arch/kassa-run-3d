"""Scripted second player for manual / browser testing.
python server/tests/bot.py ROOMCODE [raja|kassa] [base_url]
Joins a room, readies up, and plays: as Raja it runs at Kassa's spawn and tags; as Kassa it walks to the hotel closet and hides.
"""
import asyncio, json, sys, time, math, random, aiohttp

CODE = sys.argv[1].upper(); PREF = sys.argv[2] if len(sys.argv) > 2 else "raja"
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8080"
MAP = json.load(open("static/content/maps/colombo.json", encoding="utf-8"))


async def main():
    async with aiohttp.ClientSession() as s:
        async with s.post(BASE + "/api/identify", json={"name": "Bot" + str(random.randint(100, 999))}) as r:
            j = await r.json()
        tok, me = j["token"], j["profile"]["id"]
        ws = await s.ws_connect(BASE.replace("http", "ws") + "/ws")
        send = lambda t, **k: ws.send_str(json.dumps({"t": t, **k}))
        await send("hello", token=tok); await send("join", code=CODE); await send("pref", v=PREF); await send("ready", v=True)
        print("bot joined", CODE, "as", PREF, flush=True)
        pos = [0, 0]; rd = None; tgt = None; task = None
        async def drive():
            nonlocal pos
            t0 = rd["startAt"] / 1000
            role = rd["roles"][me]["role"]
            if role == "raja":
                pos = list(MAP["rajaSpawns"][rd["rspawn"]]); tgt = MAP["kassaSpawn"]
                wait = t0 + rd["head"] - time.time()
            else:
                pos = list(MAP["kassaSpawn"]); tgt = MAP["hotel"]["closets"][rd["closet"]]; wait = t0 - time.time()
            while time.time() < t0 + rd["head"] + 0.2 and role == "raja":
                await send("state", x=pos[0], z=pos[1], y=0, ry=0, an="idle", hid=0, sp=0); await asyncio.sleep(0.1)
            await asyncio.sleep(max(0, wait))
            last = time.time(); stop = False
            while not stop:
                await asyncio.sleep(0.05); now = time.time(); dt = now - last; last = now
                dx, dz = tgt[0] - pos[0], tgt[1] - pos[1]; d = math.hypot(dx, dz); sp = 6.0 * dt
                if d > 2.0 or (role == "kassa" and d > 0.3):
                    pos[0] += dx / d * min(sp, d); pos[1] += dz / d * min(sp, d)   # ignores buildings: this is a protocol-level bot
                    await send("state", x=pos[0], z=pos[1], y=0, ry=math.atan2(dx, dz), an="run", hid=0, sp=0, ho=0)
                else:
                    if role == "raja":
                        await send("state", x=pos[0], z=pos[1], y=0, ry=0, an="swing", hid=0, sp=0); await send("catch")
                    else:
                        await send("state", x=pos[0], z=pos[1], y=0, ry=0, an="hide", hid=1, sp=0, ho=1)
        async for m in ws:
            if m.type != aiohttp.WSMsgType.TEXT: continue
            d = json.loads(m.data)
            if d["t"] == "start":
                rd = d
                if task: task.cancel()
                task = asyncio.ensure_future(drive()); print("round", d["round"], "role", d["roles"][me]["role"], flush=True)
            elif d["t"] == "result":
                if task: task.cancel()
                print("result:", d["winner"], d["reason"], flush=True)
                await asyncio.sleep(1.0); await send("ready", v=True)
            elif d["t"] == "err":
                print("err", d, flush=True)
asyncio.run(main())
