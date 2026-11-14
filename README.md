# කස්සා Run 3D — Ceylon Games

Online 3D comedy chase in a cartoon Colombo. Run to the luxury hotel as **Kassa**, or hunt him down as **Raja** — solo against an AI Raja or live online with friends. Runs in the browser (desktop + mobile), no install.

## Run it

```
pip install -r requirements.txt
python server/app.py            # http://localhost:8080   (Windows: run.bat)
```

* `PORT`, `HOST`, `KASSA_DB`, `KASSA_ADMIN_PASSWORD` environment variables are supported.
* Admin dashboard: `/admin` (password in `data/admin_password.txt` unless you set `KASSA_ADMIN_PASSWORD`).
* Friends join with the 4-letter room code or the invite link `/?room=ABCD` (WhatsApp / Facebook buttons in the lobby).
* **Not deployed anywhere.** Nothing here touches ceylonmybus.com. For production put it behind HTTPS (the client automatically uses `wss://`), run a single process (rooms are in memory) and back up `data/kassa.db`.

## Game summary

| | |
|---|---|
| Solo Escape | AI Raja patrols, hears sprinting/noise, sees with a vision cone + line of sight, chases, searches your last position and peeks into hiding places. Gets faster/more alert near the hotel; his younger brother guards the plaza. |
| Online Chase | 2–6 players. Server decides everything that matters (catch range, hotel timer, winner). Head start for Kassa (longer with more catchers), round timer, role swap each round, scores, champion at the end. |
| Win (Kassa) | Reach the hotel, get past the lobby guard (sweeping vision cone — time it, sneak, or use the disguise), hide in the glowing closet for 10 s. |
| Win (Raja) | Tag Kassa at close range (SPACE/E — seeing him is not enough) before the timer ends. |
| Fairness | Raja is never sent Kassa's position beyond 30 m (+ line-of-sight on the client); instead he gets noise pings, periodic approximate hints, Search Mode (recent trail) and Loud Warning. Hiding spots time out after 7 s and are blown when Raja stands next to them. Server rejects teleporting/speed cheats. |
| Shortcuts | Alley gates with a 1.3 m gap: Kassa fits, Raja (and the AI's nav grid) cannot. Which alleys are gated changes every round. |
| Events | Traffic jams and crowds block one road segment at a time (seeded, never the hotel front, always alternatives), reporter that follows Kassa and tips off Raja, hotel-side watchers with whistles, "Raja appears!" ambush, bananas, vada boost, disguise. |
| Daily challenge | Same seed + modifiers for everybody that day (rain, rush hour, angry Raja, dusk, festival); own leaderboard. Seasonal modifiers come from `static/content/config.json`. |
| Meta | Profiles, achievements, skins unlocked by achievements, 7 leaderboards, share image (canvas → Web Share / download), WhatsApp / Facebook links. |

Controls: WASD/arrows, mouse (click to capture), Shift run, C sneak, E hide/catch, Space item/catch, Q/F/R abilities, 1–8 emotes, M map, Esc pause. Mobile: joystick + drag camera + buttons.

## v2 additions

* **Bigger city** — 6×6 blocks, about 230 × 234 m (was 150 m); Kassa now starts ~190 m from the hotel. The map is still data (`static/content/maps/colombo.json`: road lines, block grid, spawns, bounds).
* **Harder solo** — difficulty Easy / Normal / **Hard (default)** / Insane (Settings). Hard adds a second hunting Raja from the start, faster and sharper-eyed Rajas, shorter hide time (6 s) and more stamina drain; Insane adds a third. Rajas also tire after a long chase (a window to escape).
* **Sudden Raja** — every ~15–45 s a Raja can leap out of a hiding spot just ahead of you. It is telegraphed (a rustle, "‼" and a warning, ~1.2 s) so you can react. In online Chase the human Raja can do the same: press **E** at a hiding spot, wait, **SPACE** to pounce (Kassa never sees a hidden Raja unless right next to him).
* **Escape tricks** (pickups + one random starter item, **SPACE**): 🥥 coconut (stuns Raja), 💨 smoke bomb (blocks sight), 🎭 decoy Kassa (Raja chases it), 🍌 banana, 🍩 vada boost, ⭐ lucky reset. Walking among pedestrians/crowds also blends you in (👥).
* **Hunters only** — Raja (the AI) never heads for the hotel: he prowls the streets around you, and if he reaches you he hits you and it's game over (contact = caught). The earlier Hotel Rush race idea was removed (the server still contains dormant race code but the lobby refuses it).
* **Graphics & options** — day / dusk / **night** (glowing windows, lamp halos, headlights, stars, moon), clear / rain / **fog**, Low / High / **Ultra (real-time shadows)**, FOV kick + speed lines + dust while sprinting, FOV / mouse sensitivity / camera distance sliders, screen-shake toggle. Online: the host chooses the environment for the room.
* Draw calls are about 440 (static geometry merged); measured on a desktop browser only.

## Layout

```
server/app.py        aiohttp: static files, REST API, WebSocket, admin
server/rooms.py      authoritative room/round logic (roles, relay filtering, catches, hotel timer, forfeits)
server/db.py         SQLite (players, results, sessions, events, errors) + leaderboards + achievements
server/ceylon_auth.py optional Firebase SSO (disabled)   docs/INTEGRATION.md
server/tests/        mp_test.py (2 WebSocket clients, 21 checks), bot.py (scripted opponent)
static/js/           world (city gen), chars (characters/animation), game (core), ai (Raja AI), net, audio, main (UI)
static/content/      config.json (skins, modifiers, seasons, dialogue) + maps/colombo.json  — edit without rebuilding
```

New map/season/skin/dialogue = edit the JSON in `static/content/` (hotel geometry, spawns, block grid, palette, signs are all data). New obstacle or character types need a small addition in `world.js` / `chars.js`.

## Tests

```
python server/app.py                       # in one terminal
python server/tests/mp_test.py             # joins, ready/start, fairness filter, anti-teleport, catch, role swap,
                                           # hotel win, rematch, disconnect/reconnect/resume, forfeit
python server/tests/team_test.py           # 3 players: public quick-match, Raja + supporting catcher, scoring
python server/tests/bot.py ROOMCODE raja   # let a scripted opponent join a room you made in the browser
```

## Known limits (honest list)

* Verified in a desktop browser (solo win + catch flows, lobby, two-player rounds against a scripted second client, the protocol test above). **Not yet verified:** two real devices over the internet, real phones/tablets (touch layout is built but only reviewed in a desktop browser), Safari/Firefox, low-end GPUs. Static city geometry, props, vehicles and character parts are merged per material (about 400 draw calls and 60 fps in my desktop browser, down from ~730); "Low" in Settings reduces pedestrians and pixel ratio. Not measured on phones.
* Audio is fully synthesised (no recorded Sinhala voice lines). The optional voice toggle uses the device's Sinhala text-to-speech if one exists.
* Sinhala copy was written for natural tone but should be proofread by a native speaker.
* Account sharing with Ceylon My Bus is prepared, not enabled (see `docs/INTEGRATION.md`).
* Room state is in memory: a server restart ends active matches (profiles/scores persist).
* Public Match quick-join and the room list are in; "invite a Ceylon friend" needs the shared account system.


## v3 additions

* **Map patterns, not just rectangles** — a diagonal boulevard cuts across the whole city; two circular plazas (ring road, fountain, radial trees); buildings come as tiered "wedding cakes", round towers, L-shapes and twin towers on shop podiums.
* **Many more hiding places** — bushes, dumpsters, tuk-tuks, stalls, bus shelters plus barrels, carts, phone booths, manholes, parked cars, depot buses and shop doors you can slip into. Each has its own hide time (manhole 1.25×, shop 1.4×, phone booth 0.8× …).
* **Other people's vehicles** — hop onto a passing bus / tuk-tuk / car (E next to it) and ride along hidden; hop off at the kerb.
* **Searchers** — ordinary people (3–8 by difficulty) roam looking for Kassa. If one sees you he shouts and keeps tipping Raja off until you lose him (hide, smoke, disguise, crowds, distance).

## v4 additions

* **Three maps, chosen in Settings (and by the host in an online lobby)** — default **Hill Country** (all new: real 3D hills with slopes and summit lookouts, two lakes with a jetty and island hut, terraced paddy fields, red-tile roofs, warm colonial palette), **River Town** (a winding river with five bridges; the water blocks movement except on bridges) and **Colombo Coast** (the earlier city, now with a sand beach, diagonal boulevard and plazas).
* **Terrain matters** — paddy mud slows everyone to 72 %, beach sand to 82 % (Raja included). Hills change the walking height and camera.
* **More hiding places on the new terrain** — rocks, summit lookouts, haystacks, watch-huts, beach huts, boats, lake-house.
* **More 3D** — floor ledges on towers, pitched tile roofs, vertex-coloured terrain, animated flowing water (sea, lakes, river).
* **Harder** — Hard/Insane Rajas are faster with sharper eyes and quicker alerts, hiding time shortened, ambushes more frequent, and more searchers (Normal 5, Hard 7, Insane 9).

## v5 additions

* **Life bar (solo)** — Kassa has 100 ❤️. Raja hits for 20, **Maha Raja for 32**, searchers for 8, a vehicle for 10; each hit knocks you back and gives ~2 s of protection. 0 = game over. Hiding heals 4/s, ❤️ pickups give +35, vada +15. (Online Chase against a human Raja is unchanged: one tag ends the round.)
* **Hunters never idle** — every Raja (Maha Raja every ~6 s, the others every ~12 s) picks up Kassa's scent and heads for his area, so none of them stands around; contact or a swing now hits instead of ending the run at once.

## v6 changes

* WhatsApp / Facebook buttons removed (lobby invite keeps *copy link*; the result screen keeps the share-image button).
* **More realistic people** — human proportions (small head, neck, tapered torso, separate thigh/shin/upper-arm/forearm, hands, shoes), faces with eyes/brows/nose/ears, hair styles, women with long hair or dresses, varied heights, skin tones and clothes. Kassa, Raja, guards, reporter and searchers use the same body.
* **More realistic vehicles** — extruded body profiles with bevels and glossy paint, glass bands and windscreens, tyres with rims, bumpers, grilles, headlights/tail-lights, mirrors; Sri Lankan-style bus with door and destination board, Bajaj-style tuk-tuk with a driver, sedan cars.

## v7 changes

* **Much harder (solo)** — Normal 2 Rajas, **Hard 3 (default)**, Insane 4 (always incl. Maha Raja), plus 6 / 9 / 12 searchers. Rajas are faster (chase 7.0 × difficulty), see further, alert sooner and **share what they spot** (one sighting alerts the pack). Hit damage: Raja 25, **Maha Raja 40**, searcher 10, vehicle 15, all × difficulty (Hard ×1.2, Insane ×1.4). Protection after a hit is only ~1 s; hide time 4.5 s (Hard) / 3.5 s (Insane); hearts heal +25 (one per map); hiding heals 2 HP/s.
* **SPACE** — with an item it uses it; with **no item it is now a dodge-dash** (3.5 s cooldown, brief invulnerability). Key detection also accepts `code === "Space"` and stale input focus is cleared when a run starts.
* Verified with real keyboard events: SPACE (all 6 items + dash), Q/F/R, E hide/unhide, 1–8 emotes, M, Shift; and the life bar dropping from vehicles, searchers, Raja and Maha Raja, death at 0 HP, and heart pickups.

## v8 changes

* *(The hotel-pass quest from v8 was removed: the hotel gate is always open. You still have to survive the hunters, the guard and the 10 s closet hide.)*
* **Points** (shown live in the HUD, scored by the server): 1000 for winning + time bonus + remaining life ×10 + hides + tricks used + "no hits" bonus + 100 per fragment, × difficulty (0.8 / 1 / 1.3 / 1.6). A loss still scores for survival time. New leaderboard tab "⭐ best score"; the result screen shows the breakdown.
* **Overlap fixes** — props, trees, palms, lamps, bushes, rocks, pickups and parked vehicles are placed only on free ground (never inside buildings or each other); kerb parking no longer pokes into traffic lanes; moving vehicles keep spacing and never share an intersection at the same moment; shop doors no longer collide with their windows; signs/ledges/roof clutter no longer clash; the HUD panels no longer overlap each other.

* **Hunters hunt harder** — they re-acquire Kassa's scent every 3–4 s, prowl within 8–36 m of him, give up after 9 s, hear sprinting from 20 m, and the HUD shows the nearest Raja's distance (🔨 Nm).
