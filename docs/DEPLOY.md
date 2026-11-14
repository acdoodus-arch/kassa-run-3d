# Putting Kassa Run 3D online (kassa.ceylongames.com)

**Status: nothing is deployed.** I have no access to your GoDaddy account, a server, or the bus game's Firebase project, and I did not buy or create anything. Everything below is prepared so it takes about 30 minutes once you pick a server.

## 1. Domain: use a sub-domain of ceylongames.com

Use `kassa.ceylongames.com` (or `kasun.…`). A sub-domain costs nothing extra, and every weekly game can get its own (`bus.`, `kassa.`, `next-game.`). Only the DNS record is needed from GoDaddy.

## 2. Server: GoDaddy shared hosting will NOT work

The game needs a long-running Python process with WebSockets (live multiplayer). Shared "cPanel/WordPress" hosting cannot run that. You need a small **VPS** (1 vCPU / 1–2 GB RAM is plenty for hundreds of players), e.g. GoDaddy VPS, DigitalOcean, Hetzner, AWS Lightsail, Azure — pick whichever you already use. Ubuntu 22.04/24.04 + Docker.

Also fine: Fly.io / Render / Railway (they run the Dockerfile; use a persistent volume for `/app/data`).

## 3. Steps (VPS + Docker + automatic HTTPS)

1. In GoDaddy → DNS → add an **A record**: name `kassa`, value = the VPS public IP.
2. On the VPS: `git clone`/copy this folder, then
   ```
   cd deploy
   cp .env.example .env        # edit DOMAIN and KASSA_ADMIN_PASSWORD
   docker compose up -d --build
   ```
   Caddy fetches the HTTPS certificate automatically; the game is then at `https://kassa.ceylongames.com` (the client switches to `wss://` by itself). Admin: `/admin`.
3. Backups: the database lives in the `kassa-data` Docker volume (`/app/data/kassa.db`). Copy that file nightly (cron + `docker cp`, or your provider's snapshots).
4. Updates: pull the new code, `docker compose up -d --build`. Active matches end during a restart (profiles and scores persist).

Keep a single instance (rooms are in memory). Security notes: the admin password comes from `.env`; players are token-bound; nothing from the bus game is touched.

## 4. Using the bus-game accounts ("sign up once")

What I found: Ceylon My Bus signs people in with **Firebase Authentication** (username → e-mail-style id + password) and keeps scores in Firestore. To let those same people play Kassa without registering again I need three things from you / your bus-game code:

1. the **Firebase project id** and **web config** (apiKey, authDomain, projectId — these are not secret);
2. the bus game's **username → e-mail mapping function** (the `mail(u)` helper in its page source — I can read it if you give me the file/repo);
3. in Firebase console → Authentication → Settings → **Authorized domains**: add `kassa.ceylongames.com`.

With those I will add a "Log in with your Ceylon account" box to Kassa (same username/password as the bus game); the server verifies the Firebase token (`server/ceylon_auth.py`, already written, switched on with `CEYLON_FIREBASE_PROJECT`) and links it to the player profile. Existing bus accounts, scores and progress are never modified — Kassa keeps its own tables and only stores the Firebase uid.

Honest limit: browsers do not share logins between different domains. People will type their bus username/password **once on this site** (then it is remembered on that device), but they will not need to create a new account. Truly automatic cross-site login needs both games under one parent domain (e.g. `bus.ceylongames.com` + `kassa.ceylongames.com`) with a shared auth cookie — worth doing if you move the bus game onto the same domain later.

## 5. What I need to go further

* Which server/provider you want to use (or SSH access / a provider account you are happy for me to prepare a deploy script for) — I will not log in to GoDaddy or buy anything without you doing that step or explicitly handing it over.
* The three Firebase items above.
