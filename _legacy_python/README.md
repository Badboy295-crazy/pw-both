# Legacy Python Archive

These files are the **original Python implementation** of the Study Hub bot (`bot.py`, `bridge.py`, `vault.py`, `guru_ai.py`).

They have been **archived here for reference only** — the active codebase has been migrated to Node.js (`server/`).

Key features ported to Node.js:
- `guru_ai.py` → `server/ai.js` (Guru AI Doubt Solver)
- `vault.py` → `server/vip.js` (VIP & Referral System, now Supabase-backed)
- `bridge.py` → Replaced by `server/index.js` GramJS integration
- `bot.py` → Merged into `server/index.js`

> **Do not deploy these files.** They are kept for reference and rollback purposes only.
