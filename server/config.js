require('dotenv').config();

// ══════════════════════════════════════════════════════════════════════════════════
// 🛡️ TELEGRAM SESSION & BACKUP CONFIGURATION (Single Source of Truth)
// ══════════════════════════════════════════════════════════════════════════════════

// 1. TELEGRAM USERBOT SESSION STRING
const HARDCODED_SESSION_STRING = '';

// 2. BACKUP / STORAGE CHANNEL ID (Default)
const HARDCODED_BACKUP_CHANNEL_ID = '-1004483802270';

// 3. TELEGRAM API CREDENTIALS (Env takes priority, falls back to defaults)
const TG_API_ID = parseInt(process.env.TG_API_ID || '39381974', 10);
const TG_API_HASH = (process.env.TG_API_HASH || '966567ba55e48502b1ed766404c12c64').trim().replace(/^["']|["']$/g, '');

// ─── RESOLVED CONSTANTS ────────────────────────────────────────────────────────────

// Telegram Session String (Accepts SESSION_STRING or TELETHON_SESSION with automatic quote stripping)
const SESSION_STRING = (
  process.env.SESSION_STRING ||
  process.env.TELETHON_SESSION ||
  HARDCODED_SESSION_STRING ||
  ''
).trim().replace(/^["']|["']$/g, '');

// Single Backup Channel ID (Env Var takes priority: STORAGE_CHANNEL_ID / DUMP_CHANNEL_ID / BACKUP_CHANNEL_ID)
const BACKUP_CHANNEL_ID = (
  process.env.STORAGE_CHANNEL_ID ||
  process.env.DUMP_CHANNEL_ID ||
  process.env.BACKUP_CHANNEL_ID ||
  HARDCODED_BACKUP_CHANNEL_ID ||
  ''
).trim().replace(/^["']|["']$/g, '');

const TARGET_BOT = (
  process.env.TARGET_BOT ||
  process.env.DELIVERY_BOT ||
  'AS_MultiverseRoBot'
).trim().replace(/^["']|["']$/g, '');

module.exports = {
  TG_API_ID,
  TG_API_HASH,
  SESSION_STRING,
  HARDCODED_SESSION_STRING,
  BACKUP_CHANNEL_ID,
  DUMP_CHANNEL_ID: BACKUP_CHANNEL_ID,
  STORAGE_CHANNEL_ID: BACKUP_CHANNEL_ID,
  TARGET_BOT,
  DELIVERY_BOT: TARGET_BOT
};
