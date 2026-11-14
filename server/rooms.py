"""Authoritative multiplayer room logic for Kassa Run 3D.

Clients simulate their own movement (the map is generated from a shared seed); the server
relays positions with fairness filtering (Raja never receives Kassa's exact position unless
he is close), validates speed, catches, the hotel hide timer and decides who wins.
"""
import asyncio, json, math, os, random, time, string
from collections import deque
import db

MAP = json.load(open(os.path.join(os.path.dirname(__file__), "..", "static", "content", "maps", "colombo.json"), encoding="utf-8"))
CLOSETS = MAP["hotel"]["closets"]
LOBBY = MAP["hotel"]["lobby"]
DOOR = MAP["hotel"]["door"]

MAXP = 6
HEAD_START = 8
ROUND_TIME = 240
HOTEL_HIDE = 10.0
RACE_TIME = 150
GRACE = 25.0
LOBBY_GRACE = 30.0
SEE_RADIUS = 30.0     # Raja team sees Kassa only inside this radius (client adds line-of-sight)
KASSA_SEE = 50.0
MAX_SPEED = 15.0
CATCH_REACH = {"raja": 2.9, "sprinter": 2.5, "scout": 2.7, "bruiser": 3.4}
KINDS = ["sprinter", "scout", "bruiser", "sprinter", "scout"]
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

rooms = {}        # code -> Room
player_room = {}  # pid -> Room


def now():
    return time.time()


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class RP:
    def __init__(self, row):
        self.id = row["id"]
        self.name = row["name"]
        self.skin = row["skin"]
        self.avatar = row["avatar"]
        self.ws = None
        self.ready = False
        self.pref = "any"
        self.role = None
        self.kind = None
        self.connected = False
        self.disc_at = None
        self.left = False
        self.st = None
        self.st_t = 0.0
        self.stats = {"score": 0, "escapes": 0, "catches": 0, "wins": 0, "kassa_rounds": 0}
        self.hides = 0
        self.catch_cd = 0.0
        self.search_cd = 0.0
        self.loud_cd = 0.0
        self.sprint_since = None
        self.last_noise = 0.0
        self.emote_t = 0.0


class Room:
    def __init__(self, code, public):
        self.code = code
        self.public = public
        self.host = None
        self.players = {}   # pid -> RP (ordered)
        self.state = "lobby"  # lobby | playing | between | over
        self.rounds = 2
        self.round = 0
        self.rd = None
        self.created = now()
        self.empty_since = None
        self.match_started = False
        self.hint_t = 0.0
        self.last_result = None
        self.mode = "chase"   # chase | race
        self.map_id = "hillcountry"
        self.env = {"time": "day", "weather": "clear"}

    # ---------- plumbing
    def send(self, rp, msg):
        if rp.ws is not None and not rp.ws.closed:
            asyncio.ensure_future(self._send(rp, json.dumps(msg, separators=(",", ":"))))

    async def _send(self, rp, data):
        try:
            await rp.ws.send_str(data)
        except Exception:
            pass

    def broadcast(self, msg, exclude=None):
        data = json.dumps(msg, separators=(",", ":"))
        for rp in self.players.values():
            if rp is not exclude and rp.ws is not None and not rp.ws.closed:
                asyncio.ensure_future(self._send(rp, data))

    def connected(self):
        return [p for p in self.players.values() if p.connected and not p.left]

    def info(self):
        return {"t": "room", "code": self.code, "pub": self.public, "host": self.host, "state": self.state,
                "rounds": self.rounds, "round": self.round, "max": MAXP, "mode": self.mode, "env": self.env, "map": self.map_id,
                "players": [{"id": p.id, "name": p.name, "skin": p.skin, "avatar": p.avatar, "ready": p.ready,
                             "pref": p.pref, "role": p.role, "connected": p.connected,
                             "stats": p.stats} for p in self.players.values() if not p.left]}

    def push_info(self):
        self.broadcast(self.info())

    # ---------- membership
    def add(self, row):
        rp = self.players.get(row["id"])
        if rp is None:
            rp = RP(row)
            self.players[rp.id] = rp
        if self.host is None or self.host not in self.players or self.players[self.host].left:
            self.host = rp.id
        player_room[rp.id] = self
        self.empty_since = None
        return rp

    def attach(self, rp, ws):
        if rp.ws is not None and rp.ws is not ws and not rp.ws.closed:
            asyncio.ensure_future(rp.ws.close(code=4001, message=b"replaced"))
        rp.ws = ws
        rp.connected = True
        rp.disc_at = None
        self.empty_since = None
        if self.state == "playing":
            self.broadcast({"t": "ev", "k": "peer_back", "id": rp.id}, exclude=rp)

    def detach(self, rp, ws):
        if rp.ws is not ws:
            return
        rp.ws = None
        rp.connected = False
        rp.disc_at = now()
        if self.host == rp.id:
            self.pick_host()
        if self.state == "playing":
            self.broadcast({"t": "ev", "k": "peer_disc", "id": rp.id, "grace": GRACE})
        else:
            self.push_info()

    def pick_host(self):
        c = self.connected()
        if c:
            self.host = c[0].id

    def remove(self, rp):
        """Leave permanently."""
        if player_room.get(rp.id) is self:
            player_room.pop(rp.id, None)
        if self.state in ("lobby", "between", "over"):
            self.players.pop(rp.id, None)
        else:
            rp.left = True
            rp.connected = False
            rp.ws = None
        if self.host == rp.id:
            self.pick_host()
        if self.state == "playing":
            self.broadcast({"t": "ev", "k": "peer_left", "id": rp.id})
            self.check_forfeit(immediate=True)
        else:
            if self.state in ("between", "over") and len(self.connected()) < 2:
                self.to_lobby()
            self.push_info()
        if not self.players or all(p.left for p in self.players.values()):
            rooms.pop(self.code, None)

    # ---------- lobby actions
    def can_start(self):
        c = self.connected()
        return len(c) >= 2 and all(p.ready or p.id == self.host for p in c)

    def to_lobby(self):
        self.state = "lobby"
        self.round = 0
        self.rd = None
        self.match_started = False
        for p in list(self.players.values()):
            if not p.connected or p.left:
                self.players.pop(p.id, None)
                if player_room.get(p.id) is self:
                    player_room.pop(p.id, None)
                continue
            p.ready = False
            p.role = None
            p.stats = {"score": 0, "escapes": 0, "catches": 0, "wins": 0, "kassa_rounds": 0}
        self.pick_host_if_missing()
        self.push_info()

    def pick_host_if_missing(self):
        if self.host not in self.players:
            self.pick_host()

    # ---------- round lifecycle
    def assign_roles(self):
        c = self.connected()
        if self.round == 0:
            want = [p for p in c if p.pref == "kassa"]
            if not want:
                want = [p for p in c if p.pref != "raja"] or c
            kassa = random.choice(want)
        else:
            least = min(p.stats["kassa_rounds"] for p in c)
            kassa = next(p for p in c if p.stats["kassa_rounds"] == least and p.role != "kassa") if any(
                p.stats["kassa_rounds"] == least and p.role != "kassa" for p in c) else random.choice(c)
        kassa.stats["kassa_rounds"] += 1
        rest = [p for p in c if p is not kassa]
        rest.sort(key=lambda p: 0 if p.pref == "raja" else 1)
        for p in c:
            p.role = "kassa" if p is kassa else "raja"
            p.kind = None
        rest[0].kind = "raja"
        for i, p in enumerate(rest[1:]):
            p.kind = KINDS[i % len(KINDS)]
        return kassa, rest

    def start_round(self):
        c = self.connected()
        if len(c) < 2:
            return
        kassa, rajas = self.assign_roles()
        self.round += 1
        extra = len(rajas) - 1
        race = self.mode == "race"
        head = 0 if race else HEAD_START + 2 * extra
        rt = RACE_TIME if race else ROUND_TIME + 30 * extra
        start_at = now() + 4.5
        self.rd = {
            "kassa": kassa.id, "seed": random.randrange(1, 2 ** 31), "start": start_at, "head": head,
            "rt": rt, "closet": random.randrange(len(CLOSETS)), "rspawn": random.randrange(len(MAP["rajaSpawns"])),
            "hotel_since": None, "entered": False, "trail": deque(maxlen=12), "trail_t": 0.0,
            "noise": None, "catcher": None, "ended": False, "kassa_hides": 0, "race": race, "winner_id": None,
        }
        for p in c:
            p.st = None
            p.st_t = 0
            p.hides = 0
            p.catch_cd = p.search_cd = p.loud_cd = 0
            p.sprint_since = None
            p.ready = False
        self.state = "playing"
        self.hint_t = start_at + head + 12
        db.log_event("mp_round_start", kassa.id)
        if not self.match_started:
            self.match_started = True
            db.log_event("mp_match_start", self.host)
        self.broadcast(self.start_msg())
        self.push_info()

    def start_msg(self, resume_for=None):
        rd = self.rd
        m = {"t": "start", "round": self.round, "rounds": self.rounds, "seed": rd["seed"], "startAt": rd["start"] * 1000,
             "head": rd["head"], "roundTime": rd["rt"], "kassa": rd["kassa"], "closet": rd["closet"], "rspawn": rd["rspawn"],
             "roles": {p.id: {"role": p.role, "kind": p.kind, "name": p.name, "skin": p.skin} for p in self.players.values() if p.role and not p.left},
             "now": now() * 1000, "race": rd["race"], "mods": self.mods(), "map": self.map_id}
        if resume_for is not None:
            m["resume"] = True
            if resume_for.st:
                m["pos"] = resume_for.st
        return m

    def mods(self):
        m = []
        if self.env.get("time") in ("dusk", "night"):
            m.append(self.env["time"])
        if self.env.get("weather") in ("rain", "fog"):
            m.append(self.env["weather"])
        return m

    def kassa_rp(self):
        return self.players.get(self.rd["kassa"]) if self.rd else None

    def rajas(self):
        return [p for p in self.players.values() if p.role == "raja" and not p.left]

    # ---------- state relay
    def on_state(self, rp, m):
        if self.state != "playing" or not self.rd or now() < self.rd["start"]:
            return
        try:
            x, z = float(m["x"]), float(m["z"])
        except Exception:
            return
        t = now()
        if rp.role == "raja" and t < self.rd["start"] + self.rd["head"]:
            # head-start freeze: Raja must stay at his spawn point
            sp = MAP["rajaSpawns"][self.rd["rspawn"]]
            if dist((x, z), sp) > 4:
                self.send(rp, {"t": "corr", "x": sp[0], "z": sp[1]})
                return
        if rp.st:
            dt = max(0.02, t - rp.st_t)
            d = dist((x, z), (rp.st["x"], rp.st["z"]))
            if d > MAX_SPEED * dt * 1.6 + 2.5:
                tp_ok = m.get("tp") and rp.role == "kassa" and dist((x, z), DOOR) < 9
                if not tp_ok:
                    self.send(rp, {"t": "corr", "x": rp.st["x"], "z": rp.st["z"]})
                    return
        st = {"x": round(x, 2), "z": round(z, 2), "y": round(float(m.get("y", 0)), 2), "ry": round(float(m.get("ry", 0)), 2),
              "an": str(m.get("an", "idle"))[:12], "hid": 1 if m.get("hid") else 0, "sp": 1 if m.get("sp") else 0,
              "dg": 1 if m.get("dg") else 0, "ho": 1 if m.get("ho") else 0}
        if rp.role == "kassa" and isinstance(m.get("rep"), list) and len(m["rep"]) == 3:
            try:
                st["rep"] = [round(float(v), 2) for v in m["rep"]]
            except Exception:
                pass
        rp.st, rp.st_t = st, t
        if self.rd["race"]:
            door = DOOR
            if st["z"] < door[1] - 1 and abs(st["x"]) < 5 and t > self.rd["start"]:
                self.rd["winner_id"] = rp.id
                self.end_round(rp.role, "race")
        elif rp.role == "kassa":
            self.kassa_logic(rp, st, t)

    def kassa_logic(self, k, st, t):
        rd = self.rd
        if t - rd["trail_t"] > 1.5 and not st["hid"]:
            rd["trail_t"] = t
            rd["trail"].append((t, st["x"], st["z"]))
        # sprint noise
        if st["sp"]:
            if k.sprint_since is None:
                k.sprint_since = t
            elif t - k.sprint_since > 1.2 and t - k.last_noise > 2.5:
                k.last_noise = t
                self.noise(st["x"], st["z"], "run")
        else:
            k.sprint_since = None
        # hotel entry + hide timer
        inside = LOBBY["x0"] < st["x"] < LOBBY["x1"] and st["z"] < LOBBY["z1"] and st["z"] > LOBBY["z0"] - 6
        if inside and not rd["entered"]:
            rd["entered"] = True
            self.rajas_msg({"t": "ev", "k": "in_hotel"})
        cx, cz = CLOSETS[rd["closet"]]
        if st["ho"] and math.hypot(st["x"] - cx, st["z"] - cz) < 3.6:
            if rd["hotel_since"] is None:
                rd["hotel_since"] = t
                self.broadcast({"t": "ev", "k": "hotel_hide", "secs": HOTEL_HIDE})
            elif t - rd["hotel_since"] >= HOTEL_HIDE:
                self.end_round("kassa", "escaped")
        elif rd["hotel_since"] is not None:
            rd["hotel_since"] = None
            self.broadcast({"t": "ev", "k": "hotel_hide_stop"})

    def rajas_msg(self, msg):
        for p in self.rajas():
            self.send(p, msg)

    def noise(self, x, z, kind):
        self.rd["noise"] = (now(), x, z)
        for p in self.rajas():
            if p.st and dist((p.st["x"], p.st["z"]), (x, z)) < 26:
                self.send(p, {"t": "ev", "k": "noise", "x": round(x + random.uniform(-3, 3), 1),
                              "z": round(z + random.uniform(-3, 3), 1), "n": kind})

    def on_fx(self, rp, m):
        k = m.get("k")
        if k not in ("boost", "disguise", "distract", "banana", "hide", "bonk", "alert", "slip", "coconut", "smoke", "decoy"):
            return
        x, z = float(m.get("x", 0)), float(m.get("z", 0))
        if rp.role == "kassa":
            if k == "distract":
                self.noise(x, z, "distract")
            if k == "alert":
                # reporter / watcher saw Kassa: give Raja team an approximate hint (rate limited)
                if now() - self.rd.get("alert_t", 0) < 3.0:
                    return
                self.rd["alert_t"] = now()
                self.rajas_msg({"t": "ev", "k": "hint", "x": round(x / 4) * 4, "z": round(z / 4) * 4, "r": 12, "n": str(m.get("n", "alert"))[:10]})
                return
            if k == "hide":
                rp.hides += 1
        self.broadcast({"t": "fx", "k": k, "id": rp.id, "x": round(x, 2), "z": round(z, 2), "d": round(float(m.get("d", 0)), 2)}, exclude=rp)

    def on_catch(self, rp):
        if self.state != "playing" or not self.rd or (rp.role != "raja" and not self.rd["race"]):
            return
        t = now()
        if t < self.rd["start"] + self.rd["head"] or t < rp.catch_cd:
            return
        rp.catch_cd = t + 0.9
        k = self.kassa_rp()
        if not rp.st:
            return
        if not self.rd["race"] and (not k or not k.st):
            return
        reach = CATCH_REACH.get(rp.kind or "raja", 2.9) + 0.9
        d = 0 if self.rd["race"] else dist((rp.st["x"], rp.st["z"]), (k.st["x"], k.st["z"]))   # + latency tolerance
        if self.rd["race"]:
            rp.catch_cd = t + 4.0
            for v in self.players.values():
                if v is not rp and not v.left and v.st and dist((rp.st["x"], rp.st["z"]), (v.st["x"], v.st["z"])) <= reach:
                    self.send(v, {"t": "ev", "k": "stunned", "secs": 2.4})
                    return
            self.send(rp, {"t": "ev", "k": "miss"})
            return
        if k.st["hid"]:
            reach = min(reach, 2.3)
        if d <= reach:
            self.rd["catcher"] = rp.id
            self.end_round("raja", "caught")
        else:
            self.send(rp, {"t": "ev", "k": "miss"})

    def on_raja_ability(self, rp, name):
        if self.state != "playing" or not self.rd or rp.role != "raja" or self.rd["race"]:
            return
        t = now()
        rd = self.rd
        if name == "search" and t >= rp.search_cd:
            rp.search_cd = t + (18 if rp.kind == "scout" else 25)
            pts = [[round(x / 3) * 3, round(z / 3) * 3] for (tt, x, z) in rd["trail"] if t - tt < 14]
            self.send(rp, {"t": "ev", "k": "trail", "pts": pts, "cd": rp.search_cd - t})
        elif name == "loud" and t >= rp.loud_cd:
            nz = rd["noise"]
            if nz and t - nz[0] < 12:
                rp.loud_cd = t + 20
                self.send(rp, {"t": "ev", "k": "hint", "x": round(nz[1] / 4) * 4 + random.choice([-4, 0, 4]),
                               "z": round(nz[2] / 4) * 4 + random.choice([-4, 0, 4]), "r": 14, "n": "loud", "cd": 20})
            else:
                rp.loud_cd = t + 5
                self.send(rp, {"t": "ev", "k": "loud_fail", "cd": 5})

    # ---------- tick
    def tick(self):
        t = now()
        if self.state == "playing" and self.rd and not self.rd["ended"]:
            rd = self.rd
            if t >= rd["start"] + rd["rt"]:
                if rd["race"]:
                    best, bd = None, 1e9
                    for p in self.players.values():
                        if p.left or not p.st:
                            continue
                        d = dist((p.st["x"], p.st["z"]), (DOOR[0], DOOR[1]))
                        if d < bd:
                            best, bd = p, d
                    rd["winner_id"] = best.id if best else None
                    self.end_round(best.role if best else "raja", "timeout")
                else:
                    self.end_round("raja", "timeout")
                return
            self.check_forfeit()
            if self.state != "playing":
                return
            k = self.kassa_rp()
            rj = [p for p in self.rajas() if p.st]
            # periodic approximate hint so Raja is never completely lost
            if not rd["race"] and t > self.hint_t and k and k.st and t > rd["start"] + rd["head"]:
                self.hint_t = t + 16
                self.rajas_msg({"t": "ev", "k": "hint", "x": round(k.st["x"] / 8) * 8 + random.choice([-8, 0, 8]),
                                "z": round(k.st["z"] / 8) * 8 + random.choice([-8, 0, 8]), "r": 22, "n": "ping"})
            # shared Raja-team vision of Kassa (distance only; clients add line of sight)
            kvis = False
            if k and k.st:
                kp = (k.st["x"], k.st["z"])
                for p in rj:
                    d = dist(kp, (p.st["x"], p.st["z"]))
                    if d < (4 if k.st["hid"] else SEE_RADIUS):
                        kvis = True
                        break
            ts = int(t * 1000)
            for p in self.players.values():
                if not p.connected or p.left:
                    continue
                lst = []
                if rd["race"]:
                    for o in self.players.values():
                        if o is not p and not o.left and o.st:
                            lst.append(self.pack(o))
                elif p.role == "kassa":
                    for o in rj:
                        if o.st["hid"] and p.st and dist((p.st["x"], p.st["z"]), (o.st["x"], o.st["z"])) > 2.5:
                            continue   # a Raja lying in ambush is invisible to Kassa
                        if p.st and dist((p.st["x"], p.st["z"]), (o.st["x"], o.st["z"])) < KASSA_SEE or not p.st:
                            lst.append(self.pack(o))
                else:
                    for o in rj:
                        if o is not p:
                            lst.append(self.pack(o))
                    if kvis and k and k.st:
                        lst.append(self.pack(k))
                self.send(p, {"t": "snap", "ts": ts, "p": lst})
        # disconnect housekeeping
        for p in list(self.players.values()):
            if not p.connected and p.disc_at and self.state in ("lobby", "between", "over") and t - p.disc_at > LOBBY_GRACE:
                self.remove(p)
        if not self.connected():
            if self.empty_since is None:
                self.empty_since = t
            elif t - self.empty_since > 60:
                for p in list(self.players.values()):
                    if player_room.get(p.id) is self:
                        player_room.pop(p.id, None)
                rooms.pop(self.code, None)

    def pack(self, p):
        s = p.st
        d = {"i": p.id, "x": s["x"], "y": s["y"], "z": s["z"], "r": s["ry"], "a": s["an"], "h": s["hid"], "s": s["sp"], "g": s["dg"]}
        if "rep" in s:
            d["rp"] = s["rep"]
        return d

    def check_forfeit(self, immediate=False):
        if self.state != "playing" or not self.rd:
            return
        t = now()

        def gone(p):
            return p is None or p.left or (not immediate and not p.connected and p.disc_at is not None and t - p.disc_at >= GRACE)
        k = self.kassa_rp()
        if gone(k):
            self.end_round("raja", "disconnect", forfeit=True)
            return
        rs = self.rajas()
        if not rs or all(gone(p) for p in rs):
            self.end_round("kassa", "disconnect", forfeit=True)

    def end_round(self, winner, reason, forfeit=False):
        rd = self.rd
        if not rd or rd["ended"]:
            return
        rd["ended"] = True
        t = now()
        elapsed = max(0.0, t - rd["start"])
        if reason == "timeout":
            elapsed = rd["rt"]
        self.state = "between"
        k = self.kassa_rp()
        gains = {}
        if forfeit:
            db.log_event("mp_forfeit", k.id if k else None)
        for p in self.players.values():
            if p.left or not p.role:
                continue
            is_k = p.role == "kassa"
            won = (winner == "kassa") == is_k
            base = db.calc_score(p.role, won, elapsed)
            sc = base
            if not is_k and won and rd["catcher"] and p.id != rd["catcher"]:
                sc = int(base * 0.6)
            ach = []
            try:
                sc, ach = db.add_result(p.id, "mp", p.role, won, elapsed, hides=p.hides, forfeit=forfeit, score=sc,
                                        catch=(reason == "caught" and p.id == rd["catcher"]))
            except Exception as e:  # never let DB problems break the match
                db.log_error(p.id, "add_result " + repr(e))
            if not forfeit:
                p.stats["score"] += sc
                p.stats["wins"] += int(won)
                if is_k and won:
                    p.stats["escapes"] += 1
                if (not is_k) and won and reason == "caught" and p.id == rd["catcher"]:
                    p.stats["catches"] += 1
            gains[p.id] = {"score": sc, "won": won, "ach": ach}
        over = self.round >= self.rounds
        if over:
            self.state = "over"
        ranking = sorted([p for p in self.players.values() if not p.left],
                         key=lambda p: (-p.stats["score"], -p.stats["wins"]))
        champ = ranking[0].id if ranking else None
        self.last_result = {"t": "result", "winner": winner, "reason": reason, "round": self.round, "rounds": self.rounds,
                            "time": round(elapsed, 1), "kassa": rd["kassa"], "catcher": rd["catcher"], "forfeit": forfeit, "winnerId": rd.get("winner_id"), "race": rd["race"],
                            "gains": gains, "over": over, "champion": champ if over else None,
                            "scores": [{"id": p.id, "name": p.name, "role": p.role, **p.stats} for p in ranking]}
        self.broadcast(self.last_result)
        for p in self.players.values():
            p.ready = False
        self.push_info()

    def next_round(self):
        if self.state == "between" and len(self.connected()) >= 2:
            self.start_round()
        elif self.state == "between":
            self.to_lobby()


def new_code():
    for _ in range(100):
        c = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if c not in rooms:
            return c
    return "".join(random.choice(CODE_CHARS) for _ in range(5))


def public_list():
    out = []
    for r in rooms.values():
        if r.public and r.state == "lobby" and len(r.connected()) < MAXP:
            h = r.players.get(r.host)
            out.append({"code": r.code, "host": h.name if h else "?", "count": len(r.connected()), "max": MAXP})
    return out[:20]


async def ticker():
    while True:
        await asyncio.sleep(1 / 15)
        for r in list(rooms.values()):
            try:
                r.tick()
            except Exception as e:
                db.log_error(None, "tick " + repr(e), r.code)
