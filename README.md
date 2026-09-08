# Study Hub Bot — Unified Monorepo

> One codebase. Two (or more) deployable instances. Each with its own branding, bot token, and Render service — all driven by environment variables.

## 📁 Project Structure

```
pw-both/
│
├── server/                    ← Node.js Backend (Express + GramJS + Supabase + WebSocket)
│   ├── index.js               ← Main server (API + Bot + WebSocket + Admin commands)
│   ├── dumper.js              ← Autonomous batch dumper (crawl & archive entire batches)
│   ├── ai.js                  ← Guru AI Doubt Solver (Gemini + STEM fallback)
│   ├── vip.js                 ← VIP & Referral System (Supabase-backed)
│   ├── package.json
│   ├── .env.example           ← ALL required env vars (copy → .env)
│   └── .gitignore
│
├── webapp/                    ← Telegram Mini App Frontend
│   ├── index.html             ← App shell (brand-agnostic, data-brand-* attributes)
│   ├── style.css              ← Premium editorial dark mode design system
│   ├── app.js                 ← Full app logic (WSBridge + Security + AI + Platform grid)
│   ├── lecture_player.js      ← In-app HLS/DASH video player
│   ├── manifest.json          ← PWA manifest
│   └── sw.js                  ← Service Worker
│
├── _legacy_python/            ← Archived reference (not deployed)
│   ├── bot.py
│   ├── bridge.py
│   ├── vault.py
│   └── guru_ai.py
│
├── render.yaml                ← Render.com deployment config
└── .gitignore
```

## ⚡ Features

| Feature | Status |
|---|---|
| 🤖 Guru AI Doubt Solver (Gemini + STEM fallback) | ✅ |
| ⚡ WebSocket Real-Time RPC (`/ws`) | ✅ |
| 🎬 In-App HLS/DASH Video Player | ✅ |
| 👥 VIP & Referral System (Supabase) | ✅ |
| 🤖 Autonomous Batch Dumper | ✅ |
| ☁️ Supabase Cloud Database | ✅ |
| 💬 2-Way Support Group Live Relay | ✅ |
| 🔑 Dynamic MadX HMAC Signer | ✅ |
| 📅 PW Thor Schedule API | ✅ |
| 🛡️ DevTools Anti-Inspect Shield | ✅ |
| 🌐 Multi-Platform Grid (PW, Khazana, etc.) | ✅ |
| 🎨 5-Theme Premium Design System | ✅ |
| 🏷️ Zero Hardcoded Branding (ENV-driven) | ✅ |

## 🚀 Deploy Your Own Instance

### 1. Setup Server

```bash
cd server
cp .env.example .env
# Edit .env with YOUR values
npm install
npm start
```

### 2. Key Environment Variables

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Your Telegram bot token |
| `BOT_NAME` | Your bot's brand name (e.g. `StudyHub`) |
| `BOT_USERNAME` | Your bot's username (e.g. `YourStudyBot`) |
| `BOT_LINK` | Full bot link (e.g. `https://t.me/YourStudyBot`) |
| `POWERED_BY` | Attribution text (e.g. `@YourStudyBot`) |
| `ACCENT_COLOR` | Hex accent color (e.g. `#ff6b4a`) |
| `BANNER` | Banner image selector: `1` for `banner.jpg`, `2` for `banner2.jpg` |
| `SUPER_ADMIN_ID` | Your Telegram User ID |
| `WEBAPP_URL` | Your Render service URL |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `SESSION_STRING` | GramJS userbot session string |

See `server/.env.example` for the full list.

### 3. Deploy to Render

1. Push to GitHub
2. Connect repo on [render.com](https://render.com)
3. Render auto-detects `render.yaml`
4. Set all env vars in Render dashboard (never commit `.env`!)
5. Set Telegram webhook:
   ```
   https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url=https://YOUR-SERVICE.onrender.com/webhook
   ```
6. Register Mini App with BotFather → `/newapp`

### 4. Multiple Deployments (Same Repo)

Both collaborators create separate Render services from the same GitHub repo, each with their own env vars:

- **Instance A**: `BOT_TOKEN=...`, `BOT_NAME=BrandA`, `ACCENT_COLOR=#ff6b4a`, etc.
- **Instance B**: `BOT_TOKEN=...`, `BOT_NAME=BrandB`, `ACCENT_COLOR=#38bdf8`, etc.

Zero code changes required between deployments.

## 🎨 Branding System

All brand strings are served by the server via `/api/config` and applied to the frontend at startup:
- Page title, meta description
- Navbar logo, player badge
- Bot links, referral links
- Accent color (CSS `--accent-primary` variable)
- Toast messages, Guru AI name

## 🧠 Guru AI Usage

Users can send `/guru <question>` in the bot, or use the Guru tab in the Mini App.  
Uses **Gemini 2.5 Flash** (multimodal — supports photo doubts).  
Falls back to built-in STEM solver if API is unavailable.

## 📦 Supabase Tables Required

Create these tables in your Supabase project:

- `bot_users` — user tracking
- `bot_stats` — global stats
- `lecture_index` — cached lecture metadata
- `pdf_index` — cached PDF metadata
- `referrals` — referral records
- `vip_users` — VIP status
