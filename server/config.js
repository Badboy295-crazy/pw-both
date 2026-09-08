require('dotenv').config();

// ══════════════════════════════════════════════════════════════════════════════════
// 🛡️ TELEGRAM SESSION & BACKUP CONFIGURATION (Single Source of Truth)
// ══════════════════════════════════════════════════════════════════════════════════

// 1. TELEGRAM USERBOT SESSION STRING
// Leave blank so each deployment uses its OWN unique SESSION_STRING from Environment Variables (.env / Render)
const HARDCODED_SESSION_STRING = '';

// 2. BACKUP / STORAGE CHANNEL ID (Hardcoded Default)
const HARDCODED_BACKUP_CHANNEL_ID = '-1004483802270';

// 3. TELEGRAM API CREDENTIALS (Hardcoded Safe Defaults)
const TG_API_ID = 39381974;
const TG_API_HASH = '966567ba55e48502b1ed766404c12c64';

// ─── RESOLVED CONSTANTS ────────────────────────────────────────────────────────────

// Telegram Session String (Per-Deployment Environment Variable)
const SESSION_STRING = (
  process.env.SESSION_STRING ||
  HARDCODED_SESSION_STRING ||
  ''
).trim();

// Single Backup Channel ID (Env Var takes priority, falls back to hardcoded default)
const BACKUP_CHANNEL_ID = (
  process.env.BACKUP_CHANNEL_ID ||
  process.env.DUMP_CHANNEL_ID ||
  process.env.STORAGE_CHANNEL_ID ||
  HARDCODED_BACKUP_CHANNEL_ID ||
  ''
).trim();

module.exports = {
  TG_API_ID,
  TG_API_HASH,
  SESSION_STRING,
  HARDCODED_SESSION_STRING,
  BACKUP_CHANNEL_ID,
  DUMP_CHANNEL_ID: BACKUP_CHANNEL_ID,
  STORAGE_CHANNEL_ID: BACKUP_CHANNEL_ID,
};
