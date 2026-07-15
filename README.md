# Akira MD v4 — Railway Deployment Guide

## Quick Deploy to Railway

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial Akira MD v4"
git remote add origin https://github.com/YOUR_USERNAME/akira-md.git
git push -u origin main
```

### 2. Create a Railway project
1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo** → select your repo
3. Railway auto-detects Node.js and builds with nixpacks

### 3. Set Environment Variables
In Railway → your service → **Variables** tab, add:

| Variable | Value |
|---|---|
| `BOT_TOKEN` | Your Telegram bot token from @BotFather |
| `STARTUP_PASSWORD` | Your desired startup password (default: `empire`) |

Optional (if you use MongoDB or MySQL):
- `MONGODB_URI`
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASS`, `MYSQL_DB`

### 4. Add a Volume for Persistence (do this so users never have to re-pair)

**Why this matters:** every time you push to GitHub, Railway rebuilds the container from
scratch. Anything not on a volume — paired WhatsApp sessions, bot stats, admin lists — is
wiped and starts empty again. A volume is a disk that survives rebuilds, so as long as your
code writes to a path *inside* the volume, that data carries over automatically on every
deploy with zero action from you or your users.

All of the bot's persistent data has been consolidated into one folder, `storage/`, so a
single volume covers everything:
- `storage/database.json` — bot-wide stats, warns, groups, premium users, etc.
- `storage/session-data/` — WhatsApp pairing/session creds, admin list, users, welcome
  settings — **this is what lets a paired number stay paired across deploys.**

Nothing else in the repo needs to persist — `core/`, `utils/`, `lib/`, `config/`, `session/`
(the code, not the data) are all rebuilt from GitHub every deploy, which is exactly what you
want.

**Steps:**
1. Railway → your service → **Volumes** tab → **New Volume**
2. Set the mount path to **`/app/storage`**
   (Railway builds your app into `/app`, and the code writes to `./storage`, so the volume
   must be mounted at `/app/storage` to line up — see [Railway's volume docs](https://docs.railway.com/volumes) for background.)
3. Deploy once. Railway will note "small downtime while attaching a volume" on this deploy —
   that's normal and only happens the first time.
4. Pair your WhatsApp number as usual. From now on, every `git push` redeploy will keep that
   session — no re-pairing needed.

**Important:** volumes are *not* overlays — whatever is baked into the image at that path
gets replaced by the volume's contents at runtime. That's why `storage/` in this repo
contains **only data, no code** (the actual bot logic files that used to live alongside the
session data, like `token.js` and `utils.js`, now live in `session/` instead, which stays
in the image/git as normal code). Don't move any `.js` files into `storage/`.

A `.gitignore` entry keeps `storage/database.json` and `storage/session-data/*` out of git,
so an old committed copy can never accidentally overwrite live volume data on deploy.

### 5. Deploy
Railway auto-deploys on every git push. First deploy may take ~3 minutes for `npm install`.

---

## Key Changes for Railway Compatibility
- **No password prompt** — the interactive readline prompt is removed. The bot auto-authenticates on server environments.
- **Environment variables** — `BOT_TOKEN` and `STARTUP_PASSWORD` read from env vars (see `.env.example`).
- **`railway.json`** — tells Railway to run `node core/index.js` and restart on failure.
- **Reorganized layout** — code lives in `core/`, `utils/`, `lib/`, `config/`, `session/`;
  all persistent runtime data lives in `storage/` for easy volume mounting (see above).

## Local Development
```bash
cp .env.example .env
# fill in your .env values
npm install
npm start
```
