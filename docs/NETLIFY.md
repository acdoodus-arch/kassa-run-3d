# Netlify + backend

Netlify hosts **static files only** (and short serverless functions). Kassa Run 3D also needs a **long-running server** (WebSockets for live multiplayer + SQLite for profiles/leaderboards), which Netlify cannot run. So the game is split in two:

| Part | Where | What |
|---|---|---|
| Front-end (pages, 3D game code, maps) | **Netlify** (your account) | built by `tools/make_netlify.py` |
| Backend (`server/app.py`) | any small server (VPS / Fly.io / Render / Railway; see `docs/DEPLOY.md`) | API + WebSocket + admin |

## Steps
1. Get the backend running somewhere with HTTPS, e.g. `https://kassa-api.ceylongames.com` (deploy folder + `deploy/install.sh`). Start it with `KASSA_ALLOW_ORIGIN=https://kassa.ceylongames.com` (your Netlify site address; comma-separate several). In `deploy/docker-compose.yml` add it under `environment:`.
2. Build the front-end for that backend: `python tools/make_netlify.py https://kassa-api.ceylongames.com`  -> creates `netlify-site/`.
3. Netlify: **drag the `netlify-site` folder** onto https://app.netlify.com/drop (or `netlify deploy --dir netlify-site --prod`). In Site settings -> Domain management add `kassa.ceylongames.com` (GoDaddy: CNAME `kassa` -> your `*.netlify.app` address).
4. Done: players open the Netlify address; the page talks to the backend over `https`/`wss`.

Tested locally: front-end on one port, backend on another (cross-origin) -> name creation and the live WebSocket both work.
Admin page stays on the backend address (`https://kassa-api.../admin`), not on Netlify.

## Live deployment (current)
* Front-end: https://ceylongames-kassa.netlify.app  (Netlify project `ceylongames-kassa`, public)
* Backend: temporary tunnel from the owner's PC (`localhost.run`) -> the address in `config.js` of the deployed site. The tunnel address changes whenever it restarts; then rebuild + redeploy:
  `python tools/make_netlify.py https://NEW-TUNNEL-ADDRESS` then `npx netlify-cli deploy --dir netlify-site --prod --site c12bb098-fff3-4f2f-9999-50aba1dab90b`
* Start the backend with `KASSA_ALLOW_ORIGIN=https://ceylongames-kassa.netlify.app python server/app.py`.
* Permanent fix: move the backend to a VPS (docs/DEPLOY.md) and redeploy once with its address.

## Custom domain (live)
`https://kassa.ceylongames.com` → GoDaddy DNS CNAME `kassa` → `ceylongames-kassa.netlify.app`, attached to the Netlify site, HTTPS issued.
Backend must allow both origins:
`KASSA_ALLOW_ORIGIN=https://ceylongames-kassa.netlify.app,https://kassa.ceylongames.com python server/app.py`

## Ceylon My Bus login (live)
Start the backend with `CEYLON_FIREBASE_PROJECT=kayal-super-line` (plus the CORS origins above). The name screen has a "Ceylon My Bus" box: it signs in through Firebase (`username@drivers.ceylonbus.app`) and sends the ID token to `/api/identify`; the server verifies it and links the account. Requires `pip install "PyJWT[crypto]"` (in requirements.txt).
