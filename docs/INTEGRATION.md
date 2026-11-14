# Ceylon Games account integration

## What I found

I only had access to the **public** Ceylon My Bus web page (https://ceylonmybus.com/) — not its source repository, Firebase console or database.
From the public page:

* Accounts are **Firebase Authentication** (username + password; the bus game maps the username to an e-mail-style id internally).
* Scores/profiles live in **Cloud Firestore** (`drivers/{uid}` documents), written by the bus client.
* The Firebase *web config* (apiKey / projectId) is injected at deploy time and is **not** in the public HTML.

Because of that I did **not** guess keys, call the bus game's database or change anything in it. Kassa Run 3D therefore runs **standalone** today, and the SSO path below is prepared but switched off.

## How Kassa Run 3D identifies players today (standalone)

* First visit: the player chooses a nickname (2–16 chars). The server creates a profile and returns a random 192-bit **token**, stored in the browser (`localStorage`). Only a SHA-256 hash is kept server-side.
* Every WebSocket/API call is bound to that token, so nobody can impersonate a nickname or submit scores for another player. Nicknames are unique (case-insensitive); names containing `admin` / `ceylon games` are refused.
* Solo scores are submitted against a **server-issued run id** and rejected if the claimed time is implausible. Multiplayer results are decided by the server.
* Profiles/leaderboards are stored in `data/kassa.db` (SQLite). The `players.ceylon_id` column is reserved for linking.

## Turning on shared Ceylon accounts (needs your OK + three things from you)

1. **Firebase project id** used by Ceylon My Bus (`CEYLON_FIREBASE_PROJECT`).
2. The Firebase **web config** (apiKey, authDomain, projectId) so the game page can show the same login box, or a link to the bus game's login page that returns an ID token.
3. Permission to add the game's domain to Firebase *Authorized domains*.

Then:

```
pip install "PyJWT[crypto]"
set CEYLON_FIREBASE_PROJECT=<project-id>       # Windows   (export ... on Linux)
python server/app.py
```

The client signs in with Firebase, obtains `user.getIdToken()` and posts it to `/api/identify` as `ceylon_token`.
`server/ceylon_auth.py` verifies the RS256 signature against Google's public certs (audience + issuer checked) — **read-only, no secrets, nothing written to the bus game's data** — and `db.link_ceylon()` attaches the Firebase `uid` to the player (merging the current guest profile if there is one).
Existing bus accounts, scores and progress are never touched: Kassa Run keeps its own tables and only stores the uid.

> Status: the verification/link code is written but **untested against real Firebase tokens** (I had none), and the client login UI is not wired. Expect ~half a day of work once the three items above are available. If you prefer to keep the two games' data in one Firestore database, that is a bigger change and should be agreed first.

## Admin

`/admin` is separate from player accounts. Password: `KASSA_ADMIN_PASSWORD` env var, otherwise a random one is generated in `data/admin_password.txt` on first run. After 8 wrong attempts per IP it locks for 10 minutes. To reuse the bus game's admin, put this service behind the same reverse-proxy auth and set `KASSA_ADMIN_PASSWORD` from the same secret store.
