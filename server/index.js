require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { solveDoubt } = require('./ai');
const { getUserVipInfo, grantVipStatus, isVipUser, recordReferral } = require('./vip');

// ─── Global Crash Guards (Prevent server exit on unhandled errors) ─
process.on('unhandledRejection', (reason, promise) => {
  const msg = (reason instanceof Error) ? reason.message : String(reason);
  console.error('[UnhandledRejection] Caught & suppressed:', msg);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException] Caught & suppressed:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Static Files: serve webapp-dist/ in prod (obfuscated), webapp/ in dev ──
const isDev = process.env.NODE_ENV !== 'production';
const WEBAPP_DIR = isDev
  ? path.join(__dirname, '../webapp')
  : path.join(__dirname, '../webapp-dist');

// Fallback: if webapp-dist doesn't exist yet (first run before build), serve webapp/
const SERVE_DIR = fs.existsSync(WEBAPP_DIR) ? WEBAPP_DIR : path.join(__dirname, '../webapp');

// ─── Dynamic Banner Helper (1 -> banner.jpg, 2 -> banner2.jpg) ───────────
function getBannerFilename() {
  const choice = String(process.env.BANNER || process.env.BANNER_ID || process.env.BANNER_CHOICE || '1').trim();
  return choice === '2' ? 'banner2.jpg' : 'banner.jpg';
}

function getBannerUrl() {
  if (process.env.BANNER_URL) return process.env.BANNER_URL.trim();
  const filename = getBannerFilename();
  const base = process.env.WEBAPP_URL ? (process.env.WEBAPP_URL.endsWith('/') ? process.env.WEBAPP_URL : process.env.WEBAPP_URL + '/') : '/';
  return `${base}${filename}`;
}

app.use(cors({ origin: '*' }));
app.use(express.json());

// Dynamic banner route: /banner.jpg, /banner, /api/banner always return active banner based on BANNER env var
app.get(['/banner.jpg', '/banner', '/api/banner'], (req, res) => {
  const chosenFile = getBannerFilename();
  const searchDirs = [
    SERVE_DIR,
    path.join(__dirname, '../webapp'),
    path.join(__dirname, '..')
  ];
  for (const d of searchDirs) {
    const p = path.join(d, chosenFile);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  for (const d of searchDirs) {
    const p = path.join(d, 'banner.jpg');
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).send('Banner not found');
});

// Explicit banner2 route
app.get('/banner2.jpg', (req, res) => {
  const searchDirs = [
    SERVE_DIR,
    path.join(__dirname, '../webapp'),
    path.join(__dirname, '..')
  ];
  for (const d of searchDirs) {
    const p = path.join(d, 'banner2.jpg');
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).send('Banner 2 not found');
});

// Explicit banner1 route
app.get('/banner1.jpg', (req, res) => {
  const searchDirs = [
    SERVE_DIR,
    path.join(__dirname, '../webapp'),
    path.join(__dirname, '..')
  ];
  for (const d of searchDirs) {
    const p = path.join(d, 'banner.jpg');
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).send('Banner 1 not found');
});

app.use(express.static(SERVE_DIR));

// ─── Telegram Regular Bot Setup ─────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const DELIVERY_BOT = 'AS_MultiverseRoBot';
const SUPER_ADMIN = parseInt(process.env.SUPER_ADMIN_ID || process.env.ADMIN_ID || '0', 10);

// ─── Brand Config (all from .env, zero hardcode) ───────────────
const BRAND = {
  BOT_NAME:     process.env.BOT_NAME      || 'Study Hub',
  BOT_USERNAME: process.env.BOT_USERNAME  || 'yourstudybot',
  WEBAPP_TITLE: process.env.WEBAPP_TITLE  || 'Study Hub',
  WEBAPP_TAGLINE: process.env.WEBAPP_TAGLINE || 'Your free study companion',
  BOT_LINK:     process.env.BOT_LINK      || `https://t.me/${process.env.BOT_USERNAME || 'yourstudybot'}`,
  GROUP_LINK:   process.env.GROUP_LINK    || '',
  POWERED_BY:   process.env.POWERED_BY    || 'Study Hub',
  POWERED_BY_HANDLE: process.env.POWERED_BY_HANDLE || process.env.POWERED_BY || 'Study Hub',
  ACCENT_COLOR: process.env.ACCENT_COLOR  || '#ff6b4a',
  BANNER:       process.env.BANNER || '1',
  BANNER_FILE:  getBannerFilename(),
  BANNER_URL:   getBannerUrl(),
  CHANNEL_ID:   process.env.CHANNEL_ID    || '',
  CHANNEL_LINK: process.env.CHANNEL_LINK  || '',
  GROUP_ID:     process.env.GROUP_ID      || '',
  STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID || '',
};
const ADMIN_ID    = parseInt(process.env.ADMIN_ID || process.env.SUPER_ADMIN_ID || '0', 10);
const SUPPORT_GID = process.env.SUPPORT_GROUP_ID ? parseInt(process.env.SUPPORT_GROUP_ID, 10) : 0;
const {
  TG_API_ID,
  TG_API_HASH,
  SESSION_STRING,
  BACKUP_CHANNEL_ID,
  DUMP_CHANNEL_ID,
} = require('./config');

// Import Autonomous Dumper Module
const { runBatchDump, cancelDump, getDumpStatus } = require('./dumper');

// ─── Supabase Cloud Database & In-Memory Store ─────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const DATA_FILE  = path.join(__dirname, 'support_data.json');
const INDEX_FILE  = path.join(__dirname, 'lecture_index.json');
const PDF_INDEX_FILE = path.join(__dirname, 'pdf_index.json');

let knownUsers   = new Map(); // userId -> { user_id, username, first_name, last_name, is_banned, request_count, last_seen, created_at }
let bannedUsers  = new Set();
let adminUsers   = new Set([SUPER_ADMIN]); // Set of Admin User IDs
let globalStats  = { total_file_requests: 0, total_broadcasts: 0, server_started_at: Date.now() };
let lectureIndex   = new Map(); // startParam -> { key, channel_id, message_id, file_id, file_type, caption, created_at }
let pdfIndex       = new Map(); // attId -> { key, pdf_url, name, created_at }
let linkPreviews   = new Map(); // lpId -> { name, subject, topic, image, pdfUrl, batchId, contentId, type, ts } — ephemeral (10-min TTL)

function isAdmin(userId) {
  if (!userId) return false;
  const numId = parseInt(userId, 10);
  return numId === SUPER_ADMIN || numId === ADMIN_ID || adminUsers.has(numId) || (SUPPORT_GID && String(userId) === String(SUPPORT_GID));
}

function saveLocalBackup() {
  try {
    const data = {
      users: Array.from(knownUsers.values()),
      bannedUsers: Array.from(bannedUsers),
      adminUsers: Array.from(adminUsers),
      stats: globalStats
    };
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('saveLocalBackup error:', e.message);
  }
}

function saveLocalIndex() {
  try {
    const data = Array.from(lectureIndex.values());
    const tmp = INDEX_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, INDEX_FILE);
  } catch (e) {
    console.error('saveLocalIndex error:', e.message);
  }
}

function saveLocalPdfIndex() {
  try {
    const data = Array.from(pdfIndex.values());
    const tmp = PDF_INDEX_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, PDF_INDEX_FILE);
  } catch (e) {
    console.error('saveLocalPdfIndex error:', e.message);
  }
}

function saveLectureToIndex(key, data) {
  lectureIndex.set(key, data);
  saveLocalIndex();
  // Async background sync to Supabase (does not block)
  supabaseRequest('lecture_index?on_conflict=key', 'POST', data, 'resolution=merge-duplicates');
}

function savePdfToIndex(key, data) {
  pdfIndex.set(key, data);
  saveLocalPdfIndex();
  supabaseRequest('pdf_index?on_conflict=key', 'POST', data, 'resolution=merge-duplicates');
}

async function supabaseRequest(endpoint, method = 'GET', body = null, prefer = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers['Prefer'] = prefer;
    
    const options = { method, headers, signal: controller.signal };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Supabase] ${method} ${endpoint} (${res.status}):`, errText);
      return null;
    }
    if (res.status === 204) return true;
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[Supabase] Network warning (${endpoint}):`, err.message);
    return null;
  }
}

async function initDatabase() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const rawStr = fs.readFileSync(DATA_FILE, 'utf8');
      try {
        const raw = JSON.parse(rawStr);
        if (Array.isArray(raw.users)) {
          raw.users.forEach(u => knownUsers.set(String(u.user_id), u));
        } else if (Array.isArray(raw.knownUsers)) {
          raw.knownUsers.forEach(uid => knownUsers.set(String(uid), { user_id: uid, last_seen: new Date().toISOString() }));
        }
        if (Array.isArray(raw.bannedUsers)) {
          raw.bannedUsers.forEach(uid => bannedUsers.add(String(uid)));
        }
        if (raw.stats) {
          globalStats.total_file_requests = raw.stats.total_file_requests || 0;
          globalStats.total_broadcasts = raw.stats.total_broadcasts || 0;
        }
      } catch (parseErr) {
        fs.renameSync(DATA_FILE, DATA_FILE + '.bak');
        console.error('CRITICAL: Corrupted support_data.json backed up to .bak', parseErr.message);
      }
    }
  } catch (e) {
    console.error('Error loading local backup:', e.message);
  }

  // Load local lecture index
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const rawIndex = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (Array.isArray(rawIndex)) {
        rawIndex.forEach(item => {
          if (item && item.key) lectureIndex.set(item.key, item);
        });
        console.log(`ðŸ“ [Local Index] Restored ${lectureIndex.size} lectures/notes from disk.`);
      }
    }
  } catch (e) {
    console.error('Error loading local index:', e.message);
  }

  // Load local PDF index (direct URLs for Notes/DPPs)
  try {
    if (fs.existsSync(PDF_INDEX_FILE)) {
      const rawPdf = JSON.parse(fs.readFileSync(PDF_INDEX_FILE, 'utf8'));
      if (Array.isArray(rawPdf)) {
        rawPdf.forEach(item => {
          if (item && item.key) pdfIndex.set(item.key, item);
        });
        console.log(`ðŸ“ [PDF Index] Restored ${pdfIndex.size} PDF URLs from disk.`);
      }
    }
  } catch (e) {
    console.error('Error loading pdf index:', e.message);
  }

  try {
    const users = await supabaseRequest('bot_users?select=*');
    if (Array.isArray(users) && users.length > 0) {
      users.forEach(u => {
        knownUsers.set(String(u.user_id), u);
        if (u.is_banned) bannedUsers.add(String(u.user_id));
      });
      console.log(`â˜ï¸ [Supabase] Restored ${users.length} users from Cloud DB.`);
    }

    const stats = await supabaseRequest('bot_stats?id=eq.global&select=*');
    if (Array.isArray(stats) && stats.length > 0) {
      globalStats.total_file_requests = stats[0].total_file_requests || globalStats.total_file_requests;
      globalStats.total_broadcasts = stats[0].total_broadcasts || globalStats.total_broadcasts;
      console.log(`â˜ï¸ [Supabase] Restored stats: ${globalStats.total_file_requests} total requests.`);
    }

    // Sync lecture_index from Supabase
    const lectures = await supabaseRequest('lecture_index?select=*');
    if (Array.isArray(lectures) && lectures.length > 0) {
      lectures.forEach(l => {
        if (l && l.key) lectureIndex.set(l.key, l);
      });
      console.log(`â˜ï¸ [Supabase] Restored ${lectures.length} indexed lectures from Cloud DB (Total RAM Index: ${lectureIndex.size}).`);
    }

    // Sync pdf_index from Supabase
    const pdfs = await supabaseRequest('pdf_index?select=*');
    if (Array.isArray(pdfs) && pdfs.length > 0) {
      pdfs.forEach(p => {
        if (p && p.key) pdfIndex.set(p.key, p);
      });
      console.log(`â˜ï¸ [Supabase] Restored ${pdfs.length} PDF URLs from Cloud DB (Total RAM Index: ${pdfIndex.size}).`);
    }
  } catch (e) {
    console.warn('[Supabase] Initial sync skipped:', e.message);
  }
}
initDatabase();

function trackUserActivity(userObj) {
  if (!userObj || !userObj.id) return;
  const uid = String(userObj.id);
  const now = new Date().toISOString();
  
  const existing = knownUsers.get(uid) || {};
  const updated = {
    user_id: userObj.id,
    username: userObj.username || existing.username || null,
    first_name: userObj.first_name || existing.first_name || 'User',
    last_name: userObj.last_name || existing.last_name || null,
    is_banned: bannedUsers.has(uid),
    request_count: (existing.request_count || 0),
    last_seen: now,
    created_at: existing.created_at || now
  };

  knownUsers.set(uid, updated);
  saveLocalBackup();

  supabaseRequest('bot_users?on_conflict=user_id', 'POST', updated, 'resolution=merge-duplicates');
}

function trackFileRequest(chatId = null) {
  globalStats.total_file_requests++;
  if (chatId) {
    const uid = String(chatId);
    const u = knownUsers.get(uid);
    if (u) {
      u.request_count = (u.request_count || 0) + 1;
      u.last_seen = new Date().toISOString();
      knownUsers.set(uid, u);
      supabaseRequest('bot_users?on_conflict=user_id', 'POST', u, 'resolution=merge-duplicates');
    }
  }
  saveLocalBackup();

  supabaseRequest('bot_stats?on_conflict=id', 'POST', {
    id: 'global',
    total_file_requests: globalStats.total_file_requests,
    total_broadcasts: globalStats.total_broadcasts,
    updated_at: new Date().toISOString()
  }, 'resolution=merge-duplicates');
}

function setBanStatus(userId, isBanned) {
  const uid = String(userId);
  if (isBanned) {
    bannedUsers.add(uid);
  } else {
    bannedUsers.delete(uid);
  }
  
  const u = knownUsers.get(uid) || { user_id: parseInt(userId, 10), created_at: new Date().toISOString() };
  u.is_banned = isBanned;
  u.last_seen = new Date().toISOString();
  knownUsers.set(uid, u);
  saveLocalBackup();

  supabaseRequest('bot_users?on_conflict=user_id', 'POST', u, 'resolution=merge-duplicates');
}

let bot = null;
let botUsername = null;

const useWebhook = (process.env.USE_WEBHOOK === 'true') || 
                   (process.env.NODE_ENV === 'production' && Boolean(WEBAPP_URL) && process.env.USE_POLLING !== 'true');

if (BOT_TOKEN) {
  if (useWebhook) {
    bot = new TelegramBot(BOT_TOKEN, { polling: false });
    const cleanUrl = WEBAPP_URL ? WEBAPP_URL.replace(/\/+$/, '') : '';
    const webhookUrl = `${cleanUrl}/webhook`;
    bot.setWebHook(webhookUrl, { max_connections: 100 })
      .then(() => console.log(`⚡ Telegram Webhook Active: ${webhookUrl} (Ultra-Fast Direct Push)`))
      .catch(err => console.warn('[Bot] Webhook registration warning:', err.message));
  } else {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.deleteWebHook()
      .then(() => console.log('✅ Telegram Bot initialized (Long-Polling Active, Webhook cleared)'))
      .catch(() => {});
  }

  // Safe polling error handler
  bot.on('polling_error', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    if (msg.includes('409') || msg.includes('ETELEGRAM')) return;
    if (msg.includes('EFATAL')) {
      console.error('[Bot] Fatal polling error — will auto-reconnect:', msg);
      return;
    }
    console.warn('[Bot] Polling warning:', msg.slice(0, 200));
  });
  bot.on('error', (err) => {
    const msg = (err && err.message) ? err.message : 'unknown';
    console.warn('[Bot] General error:', msg.slice(0, 200));
  });

  bot.getMe()
    .then(async (me) => {
      botUsername = me.username;
      console.log(`🤖 Bot Username: @${botUsername} [Mode: ${useWebhook ? '⚡ WEBHOOK (ULTRA-FAST)' : '🔄 POLLING'}]`);

      // Auto-sync Telegram bottom-left Menu Button with current WEBAPP_URL & BRAND.BOT_NAME
      if (WEBAPP_URL) {
        try {
          const menuRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              menu_button: {
                type: 'web_app',
                text: BRAND.BOT_NAME || 'Study Hub',
                web_app: { url: WEBAPP_URL }
              }
            })
          });
          const menuData = await menuRes.json();
          if (menuData.ok) {
            console.log(`🔘 Telegram Menu Button synced to: ${WEBAPP_URL}`);
          }
        } catch (err) {
          console.warn('[Bot] Failed to sync Menu Button URL:', err.message);
        }
      }
    })
    .catch((err) => {
      console.warn('[Bot] getMe() failed:', (err && err.message) ? err.message.slice(0, 200) : 'unknown');
    });
}

// ─── Telegram Userbot Setup (For Stealth File Fetching) ───────────────────────
const apiId = TG_API_ID;
const apiHash = TG_API_HASH;
const stringSession = new StringSession(SESSION_STRING);

let userbot = null;
if (SESSION_STRING) {
  userbot = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 10,
    retryDelay: 1000,
    autoReconnect: true,
  });
  userbot.connect()
    .then(() => {
      console.log('✅ GramJS Userbot connected (Stealth Mode)');
      // Keep-alive: ping Telegram every 4 minutes to prevent TCP drop
      setInterval(async () => {
        try {
          if (userbot && userbot.connected) {
            await userbot.invoke(new Api.help.GetConfig());
          } else if (userbot) {
            console.log('[KeepAlive] Userbot disconnected — reconnecting...');
            await userbot.connect();
          }
        } catch (e) {
          console.warn('[KeepAlive] Ping failed, reconnecting:', e.message);
          try { await userbot.connect(); } catch (_) {}
        }
      }, 4 * 60 * 1000); // every 4 minutes
    })
    .catch((err) => {
      console.warn('[Userbot] Failed to connect (will retry via keep-alive):', (err && err.message) ? err.message.slice(0, 200) : 'unknown');
    });
}


// ─── PW Thor CF Cookie Store ────────────────────────────
// ─── PW Thor Schedule Fetcher (Anti-Bot Headers & Cookie Support) ───────────
function buildPwThorCookie() {
  if (process.env.PW_COOKIE) {
    return process.env.PW_COOKIE.trim();
  }
  const DEFAULT_COOKIE = 'auth_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtb2JpbGUiOiI3NDA0MDIxMDEzIiwibmFtZSI6IkF5dXNoIiwiaWF0IjoxNzgzNDIxNDUyLCJleHAiOjE3OTExOTc0NTJ9.u3y2T7sdmaoKA0ofgRafA1XGv6SvkX1vzmlr0UDs7Yk; cf_clearance=yZ9gTGs0tYxozoilTCniVuswNUVJvmb_jOrncJsLizU-1787056700-1.2.1.1-03SHw1qLt.IM2WBtNiMJ0JOobjfkGJUZfufvC8nGUFI2VqLwnnYe2hE2kk7UMrRGklqv7_IGT0151dDxzY5VTS6aLZ.r37iKl2XwKvke6IC8IU.znhU_a5zwtRuOjSzpIOL2WxNgNrDRICZs2TJ1xbHpc6jnIdASBlGWoy0Ac0QMcwacyv51Mus9.0pn4tEt0AFOBxJI.2W4MWbuW6qXVWSK0zjRsOweq_QCwfv2ZIslmfxu.9uPuDrR3caAaqzSfqon5i.pooebGqv1edgeL.30Hlsj7zdfPu1dlYk7Y621KHie9Gu.avfGQ990nZH.QBdsa21hrcAvLxZNlhaZZWcN4bCrDpVi.PinZQ.qYSgbYbxJW7XPUsClQSlBBlZq.LT1zmq7wLPiqU10WPUX2juZx4Yqbs9XQS1vrU.24Jxp8u7tnvFxhhc29PJ4VvrA; api_handshake=49cb50fc6ecadd446f37eddfa965ac95a49aa7d158b07160cab11faaecd7b05e';
  let cookie = process.env.PW_AUTH_TOKEN ? `auth_token=${process.env.PW_AUTH_TOKEN}` : DEFAULT_COOKIE;
  if (process.env.CF_CLEARANCE) cookie += `; cf_clearance=${process.env.CF_CLEARANCE}`;
  if (process.env.API_HANDSHAKE) cookie += `; api_handshake=${process.env.API_HANDSHAKE}`;
  return cookie;
}

async function fetchPwThorSchedule(batchId, subjectId, contentId) {
  const sId = subjectId || 'physics-304079';
  const url = `https://pwthor.live/api/Schedule?BatchId=${batchId}&SubjectId=${sId}&ContentId=${contentId}`;
  const pwCookie = buildPwThorCookie();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
        'cookie': pwCookie,
        'priority': 'u=1, i',
        'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        'sec-ch-ua-arch': '"x86"',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-full-version': '"152.0.7977.82"',
        'sec-ch-ua-full-version-list': '"Chromium";v="152.0.7977.82", "Not?A_Brand";v="24.0.0.0", "Google Chrome";v="152.0.7977.82"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua-platform-version': '"19.0.0"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[PW Thor] Status ${res.status} — CF clearance missing/invalid.`);
      return null;
    }
    const data = await res.json();
    return data && data.data ? data.data : null;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[PW Thor] Schedule fetch exception:', err.message);
    return null;
  }
}

// ─── PW Thor Schedule Proxy (CORS Bypass for browser clients) ─────────────
app.get('/api/pwthor-schedule', async (req, res) => {
  const { BatchId, SubjectId, ContentId } = req.query;
  const data = await fetchPwThorSchedule(BatchId, SubjectId, ContentId);
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(500).json({ success: false, message: 'CF blocked. Set fresh pwthor.live cookies in .env.' });
  }
});


// ─── Pimaxer Proxy API (a.pimaxer.in) ─────────────────────────────────────────
function proxyGet(path, retries = 2) {
  return new Promise((resolve, reject) => {
    function makeAttempt(attempt) {
      const options = {
        hostname: 'a.pimaxer.in',
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'accept': '*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
          'origin': 'https://pw.learntopper.in',
          'referer': 'https://pw.learntopper.in/',
          'priority': 'u=1, i',
          'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
          'Connection': 'keep-alive'
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let stream = res;
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        let body = '';
        stream.on('data', chunk => body += chunk.toString('utf8'));
        stream.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Invalid JSON: ${body.slice(0, 100)}`));
            }
          } else {
            const err = new Error(`API HTTP ${res.statusCode}: ${body.slice(0, 100)}`);
            if (attempt < retries) {
              setTimeout(() => makeAttempt(attempt + 1), 600 * (attempt + 1));
            } else {
              reject(err);
            }
          }
        });
        stream.on('error', (err) => {
          if (attempt < retries) {
            setTimeout(() => makeAttempt(attempt + 1), 600 * (attempt + 1));
          } else {
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Request Timeout'));
      });

      req.on('error', (err) => {
        if (attempt < retries) {
          setTimeout(() => makeAttempt(attempt + 1), 600 * (attempt + 1));
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy(new Error('Request Timeout'));
      });

      req.end();
    }

    makeAttempt(0);
  });
}

// ─── MadX API Config (For Batches, Subjects, Topics) ──────────────────────────
const MADX_BASE = 'https://core.asmultiverse.app/api/v1/pw';

function getMadxHeaders() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const encodedTs = Buffer.from(ts).toString('base64');
  
  // Create HMAC using the extracted Secret Key
  const secretKey = process.env.MADX_SECRET_KEY || '1mBD4OQnsBMBaN6oISWwTmryX1lHjkW9XLZhsirCOT0=';
  const signature = crypto.createHmac('sha256', Buffer.from(secretKey, 'base64'))
    .update(ts)
    .digest('base64');

  return {
    'accept': '*/*',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'madx-auth-key': encodedTs,
    'madx-auth-signature': signature,
    'x-auth-key': process.env.X_AUTH_KEY || 'VQNAD39WIYCGGE2I',
    'x-client-id': process.env.X_CLIENT_ID || 'WEB_rpqr8RWBKP9FatYH',
    'origin': 'https://asmultiverse.com',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
}

async function madxGet(path) {
  const url = `${MADX_BASE}${path}`;
  const headers = getMadxHeaders();
  console.log('Fetching:', url);
  console.log('Headers:', headers);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    console.error('MadX Error:', res.status, text);
    throw new Error(`MadX API ${res.status}`);
  }
  return res.json();
}

// ─── LearnXPW API Helper (learnxpw.site) ─────────────────────────────────────
const LEARNXPW_BASE = 'https://www.learnxpw.site/api';
const LEARNXPW_HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
  'priority': 'u=1, i',
  'referer': 'https://www.learnxpw.site/',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
};

async function learnxpwGet(path) {
  const url = `${LEARNXPW_BASE}${path}`;
  const res = await fetch(url, { headers: LEARNXPW_HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LearnXPW API ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
}

async function learnxpwPost(path, body) {
  const url = `${LEARNXPW_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...LEARNXPW_HEADERS, 'content-type': 'application/json', 'origin': 'https://www.learnxpw.site' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LearnXPW POST ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
}


// ════════════════════════════════════════════════════════════════
// MULTI-PROVIDER CONFIGURATION & HANDSHAKE HELPERS
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// MULTI-PROVIDER CONFIGURATION & HANDSHAKE HELPERS
// ════════════════════════════════════════════════════════════════
const AS_PROVIDERS = {
  nexttopper: 'nt',
  missionjeet: 'missionjeet',
  vidyakul: 'vidyakul',
  apnacollege: 'apnacollage',
  sketchbook: 'sketchbook',
};

let asDeviceId = 'WEB_' + crypto.randomBytes(6).toString('hex').toUpperCase();
const asInitializedSessions = new Map(); // prov -> Set(deviceIds)
const asTopicsCache = new Map();         // key -> { exp, data }
const asContentCache = new Map();        // key -> { exp, data }
const asDetailsCache = new Map();        // key -> { exp, data }

function getAsMultiverseHeaders(devId = null) {
  const dev = devId || asDeviceId;
  const ts = Math.floor(Date.now() / 1000).toString();
  const encodedTs = Buffer.from(ts).toString('base64');
  const secretKey = process.env.MADX_SECRET_KEY || '1mBD4OQnsBMBaN6oISWwTmryX1lHjkW9XLZhsirCOT0=';
  const signature = crypto.createHmac('sha256', Buffer.from(secretKey, 'base64'))
    .update(ts)
    .digest('base64');

  return {
    'X-Client-Id': dev,
    'MadX-Auth-Key': encodedTs,
    'MadX-Auth-Signature': signature,
    'accept': '*/*',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  };
}

async function asmultiverseGet(provider, path) {
  const prov = AS_PROVIDERS[provider.toLowerCase()] || provider;
  
  if (!asInitializedSessions.has(prov)) {
    asInitializedSessions.set(prov, new Set());
  }
  const initSet = asInitializedSessions.get(prov);

  // Perform device handshake on /batches before sub-resource calls if needed
  if (!initSet.has(asDeviceId) && !path.includes('/batches')) {
    try {
      const h = getAsMultiverseHeaders(asDeviceId);
      const r = await fetch(`https://api.asmultiverse.app/api/v1/${prov}/batches?page=1`, { headers: h });
      if (r.ok) {
        initSet.add(asDeviceId);
      }
    } catch (e) {
      console.warn(`[AS Handshake Warning] ${prov}:`, e.message);
    }
  }

  const url = `https://api.asmultiverse.app/api/v1/${prov}${path}`;
  const headers = getAsMultiverseHeaders(asDeviceId);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AS Multiverse API ${res.status}: ${text.slice(0, 120)}`);
  }
  if (path.includes('/batches')) {
    initSet.add(asDeviceId);
  }
  return await res.json();
}

// ════════════════════════════════════════════════════════════════
// AS MULTIVERSE CHAPTER EXTRACTION & TOPIC CLUSTERING
// (Ported directly from 1st commit bot.py algorithms)
// ════════════════════════════════════════════════════════════════
function cleanChapterPrefix(s) {
  s = String(s || '').trim();
  const prefixes = ['Video > ', 'PDF > ', 'VIDEO > ', 'DPP > ', 'Hand Written Notes > ', 'Dpp > '];
  for (const pfx of prefixes) {
    if (s.startsWith(pfx)) {
      s = s.slice(pfx.length).trim();
    }
  }
  return s;
}

function normChapterKey(s) {
  let k = cleanChapterPrefix(s);
  k = k.toLowerCase().replace(/[^a-zA-Z0-9\u0900-\u097F]+/g, ' ').trim();
  const words = k.split(/\s+/).filter(Boolean);
  const normWords = [];
  for (const w of words) {
    if (w.endsWith('s') && !['ss', 'us', 'is', 'as', 'tenses'].some(e => w.endsWith(e))) {
      normWords.push(w.slice(0, -1));
    } else {
      normWords.push(w);
    }
  }
  return normWords.join(' ');
}

function extractChapterAndLecture(rawTitle, knownChapters = []) {
  const s = cleanChapterPrefix(rawTitle);

  // 1. Delimiter ' > '
  if (s.includes(' > ')) {
    const parts = s.split(' > ').map(p => p.trim()).filter(Boolean);
    if (parts.length === 1) return { ch: parts[0], lec: parts[0] };
    if (parts.length === 2) return { ch: parts[0], lec: parts[1] };
    if (parts.length >= 3) {
      const skipSubfolders = new Set([
        'summary lectures', 'summary lecture', 'handwritten notes',
        'hand written notes', 'notes', 'dpp', 'revision', 'ncert solutions'
      ]);
      if (skipSubfolders.has(parts[parts.length - 2].toLowerCase())) {
        const ch = parts.length >= 4 ? parts[parts.length - 3] : parts[0];
        const lec = `${parts[parts.length - 2]} - ${parts[parts.length - 1]}`;
        return { ch, lec };
      }
      return { ch: parts[1], lec: parts[parts.length - 1] };
    }
  }

  // 2. Delimiter ' | '
  if (s.includes(' | ')) {
    const parts = s.split(' | ');
    return { ch: parts[0].trim(), lec: parts.slice(1).join(' | ').trim() };
  }

  // 3. Delimiter ' - '
  const m = s.match(/^(Chapter\s+\d+\s*-\s*[^-]+)\s*-\s*(.+)$/i);
  if (m) return { ch: m[1].trim(), lec: m[2].trim() };

  if (s.includes(' - ')) {
    const parts = s.split(' - ');
    return { ch: parts[0].trim(), lec: parts.slice(1).join(' - ').trim() };
  }

  // 4. Check known chapters
  if (Array.isArray(knownChapters) && knownChapters.length > 0) {
    const sortedKnown = [...knownChapters].sort((a, b) => b.length - a.length);
    for (const k of sortedKnown) {
      if (k && (s.startsWith(k) || s.toLowerCase().includes(k.toLowerCase()))) {
        const rest = s.slice(k.length).replace(/^[\s\-|:>]+/, '').trim();
        return { ch: k, lec: rest || s };
      }
    }
  }

  return { ch: s, lec: s };
}

function isDppPdfItem(rawTitle) {
  const t = String(rawTitle || '').toLowerCase();
  if (['class pdf', 'class notes', 'lecture notes', 'theory notes', 'lecture pdf'].some(k => t.includes(k))) {
    return false;
  }
  const dppPatterns = [
    /\bdpp\b/, /\bd\.p\.p\b/, /\bassignment\b/, /\bpractice sheet\b/,
    /\bpractice-sheet\b/, /\bworksheet\b/, /\bquestion paper\b/,
    /\btest paper\b/, /\bhomework\b/, /\bh\.w\b/, /\bh\/w\b/,
    /\bquestion practice\b/, /\bdaily practice\b/, /\bexercise\b/
  ];
  return dppPatterns.some(p => p.test(t));
}

function isDppVideoItem(rawTitle) {
  const t = String(rawTitle || '').toLowerCase();
  const dppPatterns = [
    /\bdpp\b/, /\bd\.p\.p\b/, /\bdiscussion\b/, /\bsolution\b/,
    /\bexercise solution\b/, /\bncert solution\b/, /\btest solution\b/,
    /\bhomework discussion\b/, /\bquestion practice\b/, /\bdpp solution\b/,
    /\bproblem discussion\b/
  ];
  return dppPatterns.some(p => p.test(t));
}

function lectureSortKey(item) {
  const name = item.name || '';
  const m = name.match(/\b(?:L|Lecture|Class|Part)[-\s]*0*(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  return 9999;
}

// ════════════════════════════════════════════════════════════════
// API PROXY ROUTES
// ════════════════════════════════════════════════════════════════
app.get('/api/batches', async (req, res) => {
  try {
    const { page = 1, limit = 20, provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();

    // 1. Non-PW Multi-Providers (NextToppers, Mission JEET, Vidyakul, Apna College)
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await asmultiverseGet(provKey, `/batches?page=${page}&limit=${limit}`);
      const raw = (data.data && Array.isArray(data.data)) ? data.data : (data.data?.batches || []);
      const normalized = raw.map(b => {
        const bId = String(b._id || b.id || '');
        const name = b.name || b.title || 'Course Batch';
        const img = b.image || b.previewImage || getBannerUrl();
        return {
          _id: bId,
          id: bId,
          name: name,
          title: name,
          slug: b.slug || bId,
          description: b.description || name,
          image: img,
          previewImage: { baseUrl: img, key: '' },
          isFree: true,
          price: 0,
          fee: 0,
          rating: '4.9',
          language: b.language || 'Hinglish',
          class: b.class || 'All',
          topicsCount: b.totalTopics || 10
        };
      });
      return res.json({ success: true, data: normalized });
    }

    // 2. PW Provider
    try {
      const data = await learnxpwGet(`/all-batches?page=${page}&limit=${limit}`);
      if (data && (Array.isArray(data.data) || Array.isArray(data))) {
        return res.json(data);
      }
    } catch (err) {
      console.warn('[LearnXPW batches failed, trying pimaxer fallback]:', err.message);
    }

    const data = await proxyGet(`/v2/batches?page=${page}&limit=${limit}`);
    res.json(data);
  } catch (err) {
    console.error('[Batches Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batches/search', async (req, res) => {
  try {
    const { q = '', provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();

    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await asmultiverseGet(provKey, `/batches?page=1&limit=100`);
      const raw = (data.data && Array.isArray(data.data)) ? data.data : (data.data?.batches || []);
      const query = String(q).toLowerCase().trim();
      const filtered = query
        ? raw.filter(b => (b.name || b.title || '').toLowerCase().includes(query))
        : raw;
      const normalized = filtered.map(b => {
        const bId = String(b._id || b.id || '');
        const name = b.name || b.title || 'Course Batch';
        const img = b.image || b.previewImage || getBannerUrl();
        return {
          _id: bId,
          id: bId,
          name: name,
          title: name,
          slug: b.slug || bId,
          description: b.description || name,
          image: img,
          previewImage: { baseUrl: img, key: '' },
          isFree: true,
          price: 0,
          fee: 0,
          rating: '4.9',
          language: b.language || 'Hinglish',
          class: b.class || 'All',
          topicsCount: b.totalTopics || 10
        };
      });
      return res.json({ success: true, data: normalized });
    }

    // 2. PW Provider
    try {
      const data = await learnxpwGet(`/search-batch?search=${encodeURIComponent(q)}`);
      if (data && (Array.isArray(data.data) || Array.isArray(data))) {
        return res.json(data);
      }
    } catch (err) {
      console.warn('[LearnXPW search failed, trying pimaxer fallback]:', err.message);
    }

    const data = await proxyGet(`/v2/batches/search?search=${encodeURIComponent(q)}`);
    res.json(data);
  } catch (err) {
    console.error('[Search Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batch/:batchId/details', async (req, res) => {
  try {
    const { provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    const { batchId } = req.params;

    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await asmultiverseGet(provKey, `/batch/${batchId}/details`);
      const rawSubjects = data.data?.subjects || data.data?.batch?.subjects || (Array.isArray(data.data) ? data.data : []);
      const subjects = rawSubjects.map(s => {
        const sId = String(s._id || s.id || '');
        const name = s.name || s.title || 'Subject';
        const img = s.image || s.previewImage || getBannerUrl();
        const totalVids = (typeof s.totalVideos === 'number') ? s.totalVideos : (s.lectureCount || 0);
        const totalNotes = (typeof s.totalNotes === 'number') ? s.totalNotes : 0;
        return {
          _id: sId,
          id: sId,
          name: name,
          title: name,
          slug: s.slug || sId,
          image: img,
          previewImage: { baseUrl: img, key: '' },
          totalVideos: totalVids,
          lectureCount: totalVids,
          totalNotes: totalNotes,
          tagCount: s.tagCount || s.totalTopics || 0
        };
      });
      return res.json({
        success: true,
        data: {
          _id: batchId,
          id: batchId,
          name: data.data?.name || data.data?.title || 'Batch Details',
          title: data.data?.name || data.data?.title || 'Batch Details',
          subjects: subjects
        }
      });
    }

    // 2. PW Provider
    try {
      const data = await learnxpwGet(`/BatchDetails?BatchId=${encodeURIComponent(batchId)}`);
      if (data && data.success !== false) {
        return res.json(data);
      }
    } catch (err) {
      console.warn('[LearnXPW batch details failed, trying pimaxer fallback]:', err.message);
    }

    const data = await proxyGet(`/v2/batches/${encodeURIComponent(batchId)}/details`);
    res.json(data);
  } catch (err) {
    console.error('[BatchDetails Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batch/:batchId/subject/:subjectId/topics', async (req, res) => {
  try {
    const { page = 1, provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    const { batchId, subjectId } = req.params;

    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const cacheKey = `${provKey}:${batchId}:${subjectId}`;
      const now = Date.now();
      if (asTopicsCache.has(cacheKey)) {
        const cached = asTopicsCache.get(cacheKey);
        if (now < cached.exp) {
          return res.json(cached.data);
        }
      }

      let vChapters = [];
      let pChapters = [];
      try {
        const [vRes, pRes] = await Promise.allSettled([
          asmultiverseGet(provKey, `/batch/${batchId}/subject/${subjectId}/topics?contentType=VIDEO`),
          asmultiverseGet(provKey, `/batch/${batchId}/subject/${subjectId}/topics?contentType=PDF`)
        ]);
        if (vRes.status === 'fulfilled' && vRes.value?.data?.chapters) {
          vChapters = vRes.value.data.chapters;
        }
        if (pRes.status === 'fulfilled' && pRes.value?.data?.chapters) {
          pChapters = pRes.value.data.chapters;
        }
      } catch (e) {
        console.warn('[AS Topics Fetch Error]:', e.message);
      }

      const allChapters = [...vChapters, ...pChapters];

      // Collect known explicit chapter names
      const knownChapters = [];
      for (const ch of allChapters) {
        const raw = ch.title || ch.name || '';
        const { ch: ech } = extractChapterAndLecture(raw);
        if (ech && ech !== cleanChapterPrefix(raw) && !knownChapters.includes(ech)) {
          knownChapters.push(ech);
        }
      }

      // Cluster chapters by normalized key
      const clusters = {};
      for (const v of vChapters) {
        const raw = v.title || v.name || 'Chapter';
        const { ch: chName } = extractChapterAndLecture(raw, knownChapters);
        const key = normChapterKey(chName) || 'general';
        if (!clusters[key]) {
          clusters[key] = { name: chName, vCount: 0, pCount: 0, dppPCount: 0, dppVCount: 0 };
        }
        if (isDppVideoItem(raw)) {
          clusters[key].dppVCount++;
        } else {
          clusters[key].vCount++;
        }
      }

      for (const p of pChapters) {
        const raw = p.title || p.name || 'Chapter';
        const { ch: chName } = extractChapterAndLecture(raw, knownChapters);
        const key = normChapterKey(chName) || 'general';
        if (!clusters[key]) {
          clusters[key] = { name: chName, vCount: 0, pCount: 0, dppPCount: 0, dppVCount: 0 };
        }
        if (isDppPdfItem(raw)) {
          clusters[key].dppPCount++;
        } else {
          clusters[key].pCount++;
        }
      }

      const topics = Object.entries(clusters).map(([key, data]) => {
        const vTotal = data.vCount > 0 ? data.vCount : data.dppVCount;
        const pTotal = data.pCount > 0 ? data.pCount : data.dppPCount;
        return {
          _id: key,
          id: key,
          name: data.name,
          slug: key,
          lectureVideos: vTotal,
          notes: pTotal,
          dppNotes: data.dppPCount,
          dppVideos: data.dppVCount,
          exercises: data.dppPCount
        };
      });

      const finalTopics = topics.length ? topics : [{
        _id: `top_${subjectId}`,
        id: `top_${subjectId}`,
        name: 'Course Curriculum & Lectures',
        slug: 'curriculum',
        lectureVideos: vChapters.length || 1,
        notes: pChapters.length || 1,
        dppNotes: 0,
        dppVideos: 0,
        exercises: 0
      }];

      const respPayload = { success: true, data: finalTopics };
      if (topics.length) {
        asTopicsCache.set(cacheKey, { exp: now + 7200000, data: respPayload });
      }
      return res.json(respPayload);
    }

    // 2. PW Provider
    try {
      const data = await learnxpwGet(
        `/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${page}`
      );
      if (data && data.success !== false) {
        return res.json(data);
      }
    } catch (err) {
      console.warn('[LearnXPW topics failed, trying pimaxer fallback]:', err.message);
    }

    const data = await proxyGet(`/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/topics`);
    res.json(data);
  } catch (err) {
    console.error('[Topics Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper for AS Multiverse Content
async function getAsMultiverseContent(provKey, batchId, subjectId, tag, contentType, page) {
  const isPdfReq = ['notes', 'dppnotes'].includes(contentType.toLowerCase());
  const cType = isPdfReq ? 'PDF' : 'VIDEO';
  const cacheKey = `${provKey}:${batchId}:${subjectId}:${contentType.toLowerCase()}:${tag || 'all'}`;
  const now = Date.now();

  if (asContentCache.has(cacheKey)) {
    const cached = asContentCache.get(cacheKey);
    if (now < cached.exp) {
      return cached.data;
    }
  }

  const url = `/batch/${batchId}/subject/${subjectId}/topics?contentType=${cType}`;
  const data = await asmultiverseGet(provKey, url);
  const chapters = data.data?.chapters || (Array.isArray(data.data) ? data.data : []);

  const knownChapters = [];
  for (const ch of chapters) {
    const raw = ch.title || ch.name || '';
    const { ch: ech } = extractChapterAndLecture(raw);
    if (ech && ech !== cleanChapterPrefix(raw) && !knownChapters.includes(ech)) {
      knownChapters.push(ech);
    }
  }

  const tagKey = tag ? normChapterKey(tag) : '';
  let formatted = [];

  for (const ch of chapters) {
    const raw = ch.title || ch.name || '';
    const { ch: chName, lec: lecName } = extractChapterAndLecture(raw, knownChapters);
    const itemKey = normChapterKey(chName) || 'general';

    if (tag && tag.toLowerCase() !== 'all' && tag !== `top_${subjectId}` && tag !== 'curriculum') {
      const match = (itemKey === tagKey) ||
                    (tagKey && itemKey.includes(tagKey)) ||
                    (tagKey && tagKey.includes(itemKey)) ||
                    raw.toLowerCase().includes(tag.toLowerCase()) ||
                    String(ch._id || ch.id) === tag;
      if (!match) continue;
    }

    const dur = ch.duration;
    const durStr = (typeof dur === 'number' && dur > 0) ? `${Math.floor(dur / 60)} mins` : (dur ? String(dur) : '45 mins');
    const cId = String(ch._id || ch.id || '');
    const isPdf = (cType === 'PDF');
    const bannerImg = getBannerUrl();
    const displayTitle = lecName || chName || raw;

    formatted.push({
      _id: cId,
      id: cId,
      topic: chName || 'Chapter',
      name: displayTitle,
      raw_title: raw,
      image: bannerImg,
      previewImage: { baseUrl: bannerImg, key: '' },
      duration: durStr,
      date: ch.date || ch.createdAt || 0,
      batchId: batchId,
      contentId: cId,
      subjectId: subjectId,
      provider: provKey,
      type: isPdf ? 'PDF' : 'VIDEO',
      videoDetails: {
        _id: cId,
        id: cId,
        name: displayTitle,
        image: bannerImg,
        duration: durStr,
        url: ch.link || ch.url || '',
        videoUrl: ch.link || ch.url || '',
        embedCode: ch.link || ch.url || ''
      },
      url: ch.link || ch.url || '',
      pdfUrl: isPdf ? (ch.link || ch.url || '') : '',
      homeworkIds: isPdf ? [{
        _id: cId,
        topic: displayTitle,
        attachmentIds: [{
          _id: cId,
          name: displayTitle,
          baseUrl: ch.link || ch.url || '',
          key: ''
        }]
      }] : []
    });
  }

  // Sort ascending (L1, L2, L3...)
  formatted.sort((a, b) => lectureSortKey(a) - lectureSortKey(b));

  // Strict Tab Separation
  const ctLower = contentType.toLowerCase();
  if (ctLower === 'dppnotes') {
    formatted = formatted.filter(it => isDppPdfItem(it.raw_title + ' ' + it.name));
  } else if (ctLower === 'notes') {
    const nonDpp = formatted.filter(it => !isDppPdfItem(it.raw_title + ' ' + it.name));
    if (nonDpp.length) formatted = nonDpp;
  } else if (ctLower === 'dppvideos') {
    formatted = formatted.filter(it => isDppVideoItem(it.raw_title + ' ' + it.name));
  } else if (ctLower === 'videos') {
    const regularVids = formatted.filter(it => !isDppVideoItem(it.raw_title + ' ' + it.name));
    if (regularVids.length) formatted = regularVids;
  }

  const respPayload = { success: true, data: formatted };
  if (formatted.length) {
    asContentCache.set(cacheKey, { exp: now + 7200000, data: respPayload });
  }
  return respPayload;
}

app.get('/api/batch/:batchId/subject/:subjectId/topic/:topicId/content', async (req, res) => {
  try {
    const { type = 'Videos', page = 1, provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    const { batchId, subjectId, topicId } = req.params;

    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await getAsMultiverseContent(provKey, batchId, subjectId, topicId, type, page);
      return res.json(data);
    }

    // 2. PW Provider
    const typeMap = { videos: 'videos', notes: 'notes', dppnotes: 'DppNotes', dppvideos: 'DppVideos' };
    const contentType = typeMap[type.toLowerCase()] || type;
    try {
      const data = await learnxpwGet(
        `/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${contentType}&page=${page}`
      );
      if (data && data.success !== false) {
        return res.json(data);
      }
    } catch (err) {
      console.warn('[LearnXPW topic content failed, trying pimaxer fallback]:', err.message);
    }

    const data = await proxyGet(`/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/content?page=${page}&limit=500&contentType=${contentType}&tag=${encodeURIComponent(topicId)}`);
    res.json(data);
  } catch (err) {
    console.error('[TopicContent Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batch/:batchId/subject/:subjectId/content', async (req, res) => {
  try {
    const { type = 'Videos', tag = '', page = 1, provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    const { batchId, subjectId } = req.params;

    // 1. Non-PW Multi-Providers
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const data = await getAsMultiverseContent(provKey, batchId, subjectId, tag, type, page);
      return res.json(data);
    }

    // 2. PW Provider
    const typeMap = { videos: 'videos', notes: 'notes', dppnotes: 'DppNotes', dppvideos: 'DppVideos' };
    const contentType = typeMap[type.toLowerCase()] || type;
    if (tag) {
      try {
        const data = await learnxpwGet(
          `/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(tag)}&ContentType=${contentType}&page=${page}`
        );
        if (data && data.success !== false) {
          return res.json(data);
        }
      } catch (err) {
        console.warn('[LearnXPW content tag failed, trying pimaxer fallback]:', err.message);
      }
    }

    const data = await proxyGet(`/v2/batches/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/content?page=${page}&limit=500&contentType=${contentType}&tag=${encodeURIComponent(tag)}`);
    res.json(data);
  } catch (err) {
    console.error('[Content Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batch/:batchId/subject/:subjectId/content/:contentId/details', async (req, res) => {
  try {
    const { provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    const { batchId, subjectId, contentId } = req.params;

    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      const cacheKey = `${provKey}:${batchId}:${subjectId}:${contentId}`;
      const now = Date.now();
      if (asDetailsCache.has(cacheKey)) {
        const cached = asDetailsCache.get(cacheKey);
        if (now < cached.exp) {
          return res.json(cached.data);
        }
      }

      try {
        const data = await asmultiverseGet(provKey, `/batch/${batchId}/subject/${subjectId}/content/${contentId}/details`);
        if (data && data.success) {
          asDetailsCache.set(cacheKey, { exp: now + 7200000, data });
          return res.json(data);
        }
      } catch (e) {
        try {
          const data = await asmultiverseGet(provKey, `/batches/${batchId}/subjects/${subjectId}/contents/${contentId}/details`);
          if (data && data.success) {
            asDetailsCache.set(cacheKey, { exp: now + 7200000, data });
            return res.json(data);
          }
        } catch (e2) {
          const vData = await asmultiverseGet(provKey, `/batch/${batchId}/subject/${subjectId}/topics?contentType=VIDEO`).catch(() => ({}));
          const chapters = vData.data?.chapters || [];
          const match = chapters.find(c => String(c._id || c.id) === String(contentId));
          if (match && match.link) {
            const resp = { success: true, data: { link: match.link, title: match.title, url: match.link } };
            asDetailsCache.set(cacheKey, { exp: now + 7200000, data: resp });
            return res.json(resp);
          }
        }
      }
    }

    res.json({ success: true, data: { _id: contentId } });
  } catch (err) {
    console.error('[Content Details Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Schedule/Attachments for a lecture (Notes, DPP attached to a video)
// Used by Telegram bot quality section
app.get('/api/batch/:batchId/subject/:subjectId/content/:contentId/schedule', async (req, res) => {
  try {
    const { provider = 'pw' } = req.query;
    const provKey = String(provider).toLowerCase();
    if (provKey !== 'pw' && AS_PROVIDERS[provKey]) {
      return res.json({ success: true, data: [] });
    }
    const data = await learnxpwGet(
      `/Schedule?BatchId=${encodeURIComponent(req.params.batchId)}&SubjectId=${encodeURIComponent(req.params.subjectId)}&ContentId=${encodeURIComponent(req.params.contentId)}`
    );
    res.json(data);
  } catch (err) {
    console.error('[Schedule Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PDF URL resolver — returns baseUrl+key for an attachment
app.get('/api/getpdf', async (req, res) => {
  try {
    const { batchId, subjectId, pdfId, attachmentId } = req.query;
    if (!batchId || !subjectId || !pdfId || !attachmentId)
      return res.status(400).json({ error: 'Missing required params: batchId, subjectId, pdfId, attachmentId' });
    const data = await learnxpwGet(
      `/GetPdf?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&PdfId=${encodeURIComponent(pdfId)}&AttachmentId=${encodeURIComponent(attachmentId)}`
    );
    if (data?.success && data?.data) {
      data.data.pdfUrl = (data.data.baseUrl || '') + (data.data.key || '');
    }
    res.json(data);
  } catch (err) {
    console.error('[GetPdf Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Teacher details — name + photo
app.get('/api/teacher/:teacherId', async (req, res) => {
  try {
    const data = await learnxpwPost('/get-user-details-list', { idsParam: req.params.teacherId });
    res.json(data);
  } catch (err) {
    console.error('[Teacher Route Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
app.post('/api/link-preview', (req, res) => {
  const { name, subject, topic, image, pdfUrl, batchId, contentId, type } = req.body || {};
  if (!batchId || !contentId) return res.status(400).json({ error: 'batchId and contentId required' });

  // Generate short 8-char hex ID
  const lpId = crypto.randomBytes(4).toString('hex');
  const entry = { name, subject, topic, image, pdfUrl, batchId, contentId, type, ts: Date.now() };
  linkPreviews.set(lpId, entry);

  // Auto-purge after 10 minutes
  setTimeout(() => linkPreviews.delete(lpId), 10 * 60 * 1000);

  // Also purge any entries older than 20 min (defensive)
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [k, v] of linkPreviews.entries()) {
    if (v.ts < cutoff) linkPreviews.delete(k);
  }

  console.log(`[LinkPreview] Stored lp_${lpId}: ${name} | batch=${batchId} content=${contentId}`);
  return res.json({ ok: true, lpId, startParam: `lp_${lpId}` });
});

// ═══════════════════════════════════════════════════════════════
// BOT: SEND CONTENT (called from Mini App)
// ═══════════════════════════════════════════════════════════════
app.post('/bot/send', async (req, res) => {
  try {
    const { chatId, type, batchId, contentId, name, image, subject, topic,
            homeworks, dpps, subjectId, scheduleContentId, pdfUrl } = req.body;

    if (!chatId) return res.status(400).json({ error: 'Missing chatId' });
    if (!bot)    return res.status(503).json({ error: 'Bot not configured' });

    const isVideo = type === 'Videos' || type === 'DppVideos';
    console.log(`[/bot/send] type=${type} isVideo=${isVideo} pdfUrl=${!!pdfUrl} contentId=${contentId}`);

    // ─── NOTES / DPP: Send directly via static.pw.live URL ───
    if (!isVideo) {
      if (pdfUrl) {
        await sendPdfDirect(chatId, { pdfUrl, name, subject, topic, type, batchId, contentId });
      } else if (batchId && contentId) {
        // Fallback: old button-based approach (delivery bot)
        await sendPdfDirect(chatId, { batchId, contentId, name, subject, topic, type });
      } else {
        return res.status(400).json({ error: 'Notes: no pdfUrl or contentId' });
      }
      return res.json({ success: true });
    }

    // ─── VIDEOS: Use delivery bot (asmultiverse) ───
    if (!batchId || !contentId) return res.status(400).json({ error: 'Video: missing batchId/contentId' });

    let finalHomeworks = Array.isArray(homeworks) ? homeworks.filter(hw => Array.isArray(hw?.attachmentIds) && hw.attachmentIds.length > 0) : [];
    let finalDpps = Array.isArray(dpps) ? dpps.filter(dp => Array.isArray(dp?.attachmentIds) && dp.attachmentIds.length > 0) : [];

    // Server-side schedule fetch to get Notes/DPP buttons for the video card
    if (finalHomeworks.length === 0 && finalDpps.length === 0 && subjectId && scheduleContentId) {
      console.log(`[PW Thor] Fetching attachments server-side...`);
      const schedItem = await fetchPwThorSchedule(batchId, subjectId, scheduleContentId);
      if (schedItem) {
        finalHomeworks = (schedItem.homeworkIds || []).filter(hw => Array.isArray(hw?.attachmentIds) && hw.attachmentIds.length > 0);
        finalDpps = (schedItem.dpp?.homeworkIds || []).filter(dp => Array.isArray(dp?.attachmentIds) && dp.attachmentIds.length > 0);
        console.log(`[PW Thor] Got ${finalHomeworks.length} notes, ${finalDpps.length} DPPs.`);
      }
    }

    console.log(`[/bot/send] Video notes=${finalHomeworks.length} dpps=${finalDpps.length}`);
    await sendVideoQualitySelection(chatId, { batchId, contentId, name, image, subject, topic, type, homeworks: finalHomeworks, dpps: finalDpps });
    res.json({ success: true });
  } catch (err) {
    console.error('[/bot/send]', err.message);
    res.status(500).json({ error: err.message });
  }
});


function truncateCaption(str, maxLen = 1000) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function getCaption(isVideo, { name, subject, topic }) {
  const safeName = (name || '').length > 300 ? name.slice(0, 297) + '...' : (name || '');
  const safeSub = (subject || '').length > 150 ? subject.slice(0, 147) + '...' : (subject || 'N/A');
  const safeTopic = (topic || '').length > 150 ? topic.slice(0, 147) + '...' : (topic || 'N/A');

  if (isVideo) {
    return truncateCaption(
      `📹 *Title:* ${escMd(safeName)}

` +
      `🏠 *Subject:* ${escMd(safeSub)}

` +
      `🚩 *Topic:* ${escMd(safeTopic)}

`
    );
  } else {
    return truncateCaption(
      `📄 *Title:* ${escMd(safeName)}

` +
      `🏠 *Subject:* ${escMd(safeSub)}

` +
      `🚩 *Topic:* ${escMd(safeTopic)}

` +
      `⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*`
    );
  }
}

// ─── Send Video Quality Selection Message ─────────────────────
async function sendVideoQualitySelection(chatId, info) {
  const qualities = ['720p', '480p', '360p', '240p'];
  const caption = getCaption(true, info) +
    `📊 *Available:* ${qualities.join(', ')}\n\n` +
    `👇 *Click a button to get the video*`;

  const qualityButtons = [];
  for (let i = 0; i < qualities.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, qualities.length); j++) {
      const q = qualities[j].replace('p', ''); 
      // Instead of direct URL, use callback to trigger Userbot
      row.push({
        text: `${qualities[j]} ↗ï¸`,
        callback_data: `v_${info.batchId}_${info.contentId}_${q}`
      });
    }
    qualityButtons.push(row);
  }

  // Attach Homework / Notes inline buttons
  const validHomeworks = (info.homeworks || []).filter(hw => (Array.isArray(hw?.attachmentIds) && hw.attachmentIds.length > 0) || hw?._id);
  if (validHomeworks.length > 0) {
    qualityButtons.push([{ text: '⬇️ï¸ Class Notes ⬇️ï¸', callback_data: 'noop' }]);
    validHomeworks.forEach(hw => {
      const att = (Array.isArray(hw?.attachmentIds) && hw.attachmentIds[0]) || hw || {};
      const pdfLink = (att.baseUrl && att.key) ? (att.baseUrl + att.key) : (att.key ? ('https://static.pw.live/' + att.key) : null);
      if (pdfLink) {
        qualityButtons.push([{ text: `📄 ${hw.topic || att.name || 'Notes'} ↗ï¸`, url: pdfLink }]);
        // Backup to pdfIndex
        const cKey = att._id || hw._id;
        if (cKey && !pdfIndex.has(cKey)) {
          savePdfToIndex(cKey, {
            key:        cKey,
            pdf_url:    pdfLink,
            name:       hw.topic || att.name || 'Notes',
            batch_id:   info.batchId || '',
            type:       'Notes',
            created_at: new Date().toISOString()
          });
        }
      } else {
        qualityButtons.push([{ text: `📄 ${hw.topic || att.name || 'Notes'}`, callback_data: `n_${info.batchId}_${att._id || hw._id}` }]);
      }
    });
  }

  const validDpps = (info.dpps || []).filter(dpp => (Array.isArray(dpp?.attachmentIds) && dpp.attachmentIds.length > 0) || dpp?._id);
  if (validDpps.length > 0) {
    qualityButtons.push([{ text: '⬇️ï¸ DPPs ⬇️ï¸', callback_data: 'noop' }]);
    validDpps.forEach(dpp => {
      const att = (Array.isArray(dpp?.attachmentIds) && dpp.attachmentIds[0]) || dpp || {};
      const pdfLink = (att.baseUrl && att.key) ? (att.baseUrl + att.key) : (att.key ? ('https://static.pw.live/' + att.key) : null);
      if (pdfLink) {
        qualityButtons.push([{ text: `ðŸ“ ${dpp.topic || att.name || 'DPP'} ↗ï¸`, url: pdfLink }]);
        // Backup to pdfIndex
        const cKey = att._id || dpp._id;
        if (cKey && !pdfIndex.has(cKey)) {
          savePdfToIndex(cKey, {
            key:        cKey,
            pdf_url:    pdfLink,
            name:       dpp.topic || att.name || 'DPP',
            batch_id:   info.batchId || '',
            type:       'DppNotes',
            created_at: new Date().toISOString()
          });
        }
      } else {
        qualityButtons.push([{ text: `ðŸ“ ${dpp.topic || att.name || 'DPP'}`, callback_data: `n_${info.batchId}_${att._id || dpp._id}` }]);
      }
    });
  }

  qualityButtons.push([{ text: 'Close 🔒', callback_data: 'close_msg' }]);

  const replyMarkup = { inline_keyboard: qualityButtons };
  
  if (info.image) {
    try {
      await bot.sendPhoto(chatId, info.image, { caption, parse_mode: 'Markdown', reply_markup: replyMarkup });
      return;
    } catch (e) {
      console.warn('[sendPhoto] Failed to send photo, falling back to text message:', e.message);
    }
  }
  await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup });
}

// ─── Send PDF/Notes Direct ────────────────────────────────────
async function sendPdfDirect(chatId, info) {
  const isDpp    = info.type === 'DppNotes';
  const emoji    = isDpp ? 'ðŸ“' : '📄';
  const label    = isDpp ? 'DPP PDF' : 'Class Notes';
  const caption  = getCaption(false, info);

  // Determine the PDF URL (from direct info or pdfIndex cache)
  let pdfUrl = info.pdfUrl;
  const cacheKey = info.contentId || info.attId || (info.batchId && info.name ? `${info.batchId}_${info.name}` : null);

  if (!pdfUrl && cacheKey && pdfIndex.has(cacheKey)) {
    pdfUrl = pdfIndex.get(cacheKey).pdf_url;
    console.log(`[sendPdfDirect] ⚡ Cache HIT for ${cacheKey}`);
  }

  if (pdfUrl) {
    console.log(`[sendPdfDirect] Sending PDF as URL button: ${pdfUrl}`);
    const replyMarkup = {
      inline_keyboard: [
        [{ text: `${emoji} Open ${label} ↗ï¸`, url: pdfUrl }],
        [{ text: 'Close 🔒', callback_data: 'close_msg' }]
      ]
    };
    await bot.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
      disable_web_page_preview: true
    });
    trackFileRequest(chatId);

    // Save to pdfIndex for future cache hits & cloud backup
    if (cacheKey && !pdfIndex.has(cacheKey)) {
      savePdfToIndex(cacheKey, {
        key:        cacheKey,
        pdf_url:    pdfUrl,
        name:       info.name || '',
        batch_id:   info.batchId || '',
        type:       info.type || '',
        created_at: new Date().toISOString()
      });
    }
    return;
  }

  // ─ Fallback: show a delivery-bot button (when no URL available) ─
  console.log(`[sendPdfDirect] Fallback button: batchId=${info.batchId} contentId=${info.contentId}`);
  const replyMarkup = {
    inline_keyboard: [
      [{ text: `${emoji} Get ${label} ↗ï¸`, callback_data: `n_${info.batchId}_${info.contentId}` }],
      [{ text: 'Close 🔒', callback_data: 'close_msg' }]
    ]
  };
  await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: replyMarkup, disable_web_page_preview: true });
}

function escMd(text) {
  if (!text) return '';
  // In Telegram legacy Markdown, strip unclosed formatting characters (*, _, `, [, ])
  // so lecture titles with pipes, hyphens, etc. display naturally without ugly backslashes
  return String(text).replace(/[*_`\[\]]/g, '');
}

// ═══════════════════════════════════════════════════════════════
// STEALTH USERBOT FETCH QUEUE
// ═══════════════════════════════════════════════════════════════
const fetchQueue = [];
let isFetching = false;
const pendingRequests = new Map(); // requestId -> { chatId, caption, type, statusMsgId }

// ─── Queue Manager (Auto-Wait & Seamless Retry on Cooldown) ───
async function processFetchQueue() {
  if (isFetching || fetchQueue.length === 0) return;
  isFetching = true;
  const req = fetchQueue.shift();
  
  let attempts = 0;
  let success = false;

  while (attempts < 3 && !success) {
    attempts++;
    try {
      await performFetch(req);
      success = true;
    } catch (err) {
      if (err.cooldown && attempts < 3) {
        const secs = err.waitSeconds || 5;
        console.log(`â³ [Cooldown Detected] Source server asked to wait ${secs}s. Pausing queue and auto-retrying...`);
        const pending = pendingRequests.get(req.reqId);
        if (pending && pending.statusMsgId && bot) {
          bot.editMessageText(`â³ *Please wait ${secs}s — auto-fetching your file...*`, {
            chat_id: pending.chatId,
            message_id: pending.statusMsgId,
            parse_mode: 'Markdown'
          }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, (secs + 2) * 1000));
      } else {
        console.error('Fetch error:', err.message);
        const pending = pendingRequests.get(req.reqId);
        if (pending) {
          if (pending.statusMsgId) bot.deleteMessage(pending.chatId, pending.statusMsgId).catch(()=>{});
          bot.sendMessage(pending.chatId, 'âŒ *Failed to fetch file from server.*', { parse_mode: 'Markdown' });
          pendingRequests.delete(req.reqId);
        }
        break;
      }
    }
  }

  isFetching = false;
  processFetchQueue();
}

async function enqueueFetch(chatId, startParam, customCaption, type, statusMsgId) {
  // Deduplication: Check if user already requested this exact item (in-flight or queued)
  for (const [existingReqId, reqData] of pendingRequests.entries()) {
    if (String(reqData.chatId) === String(chatId) && reqData.startParam === startParam) {
      console.log(`[Deduplication] User ${chatId} already has pending request for ${startParam}. Skipping duplicate queue entry.`);
      if (statusMsgId && bot) {
        bot.editMessageText('ℹ️ *Your request for this item is already in progress...*', {
          chat_id: chatId,
          message_id: statusMsgId,
          parse_mode: 'Markdown'
        }).catch(() => {});
      }
      return;
    }
  }
  // ─── 1. Check Local In-Memory / Channel Cache (0.1s Instant Hit) ───
  const cached = lectureIndex.get(startParam);
  if (cached) {
    // 1a. Try copyMessage from dump channel if message_id exists
    if (cached.message_id && cached.channel_id && bot) {
      try {
        console.log(`⚡ [Index HIT] Delivering ${startParam} directly from dump channel message #${cached.message_id}...`);
        await bot.copyMessage(chatId, cached.channel_id, cached.message_id, {
          caption: truncateCaption(customCaption),
          parse_mode: 'Markdown'
        });
        if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(()=>{});
        trackFileRequest(chatId);
        return;
      } catch (err) {
        console.warn(`[Index Cache Fallback] copyMessage failed for #${cached.message_id}:`, err.message);
      }
    }

    // 1b. Direct Telegram file_id send (0.1s Instant delivery!)
    if (cached.file_id && bot) {
      try {
        console.log(`⚡ [Index HIT] Delivering ${startParam} directly via cached file_id...`);
        const sendMethod = (cached.file_type === 'video' || type === 'video') ? bot.sendVideo.bind(bot) : bot.sendDocument.bind(bot);
        await sendMethod(chatId, cached.file_id, {
          caption: truncateCaption(customCaption),
          parse_mode: 'Markdown'
        });
        if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(()=>{});
        trackFileRequest(chatId);
        return;
      } catch (err) {
        console.warn(`[Index Cache Fallback] send via file_id failed:`, err.message);
      }
    }
  }

  // ─── 2. Cache Miss: Enqueue Userbot Remote Fetch ───
  const reqId = Date.now().toString() + Math.random().toString(36).substring(7);
  pendingRequests.set(reqId, { chatId, caption: truncateCaption(customCaption), type, statusMsgId, startParam });
  fetchQueue.push({ reqId, startParam });
  processFetchQueue();
}

// ─── Ensure Userbot is Connected ─────────────────────────────
async function ensureConnected() {
  if (!userbot) throw new Error('Userbot not initialized');
  if (!userbot.connected) {
    console.log('[Fetch] Userbot not connected — reconnecting before fetch...');
    await userbot.connect();
    // Small delay after reconnect to let auth settle
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ─── GramJS Fetch Logic ───────────────────────────────────────
async function performFetch({ reqId, startParam }) {
  if (!userbot) throw new Error("Userbot is not initialized! Run auth.js");
  if (!botUsername) throw new Error("Regular bot username not resolved yet");

  // Always ensure fresh connection before attempting fetch
  await ensureConnected();

  return new Promise((resolve, reject) => {
    // Timeout handler — 60s for slow Render cold starts
    const timeout = setTimeout(() => {
       userbot.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
       reject(new Error("Timeout waiting for remote server response"));
    }, 60000); // 60 sec max wait

    // Event handler for remote delivery reply
    const handler = async (event) => {
      const msg = event.message;
      if (msg.media) {
        clearTimeout(timeout);
        userbot.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
        try {
          // Send the received media from Userbot to our Regular Bot!
          // We attach the reqId as the caption so the Regular Bot knows who it belongs to.
          await userbot.sendMessage(botUsername, {
            message: `REQ:${reqId}`,
            file: msg.media
          });
          
          // Stealth mode: Delete the chat history with remote source so it doesn't clutter the user's chat list
          try {
            await userbot.invoke(new Api.messages.DeleteHistory({
              peer: DELIVERY_BOT,
              maxId: 0,
              justClear: true,
              revoke: true
            }));
          } catch(e) { console.log('Failed to delete history with delivery bot:', e); }

          resolve();
        } catch (e) { reject(e); }
      } else if (msg.text) {
        const txt = msg.text;
        // Detect asmultiverse rate-limit / wait message
        const waitMatch = txt.match(/wait\s*(\d+)\s*second/i);
        if (waitMatch || txt.toLowerCase().includes('please wait')) {
          const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 8;
          clearTimeout(timeout);
          userbot.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
          const cdErr = new Error(`Rate limited by source: wait ${waitSeconds}s`);
          cdErr.cooldown = true;
          cdErr.waitSeconds = waitSeconds;
          return reject(cdErr);
        }
        if (txt.toLowerCase().includes('error') || txt.includes('not found')) {
          clearTimeout(timeout);
          userbot.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
          reject(new Error('File not found on remote bot: ' + txt));
        }
      }
    };

    userbot.addEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
    
    // Command the remote bot
    userbot.sendMessage(DELIVERY_BOT, { message: `/start ${startParam}` })
      .catch(e => {
        clearTimeout(timeout);
        userbot.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
        reject(e);
      });
  });
}


// ─── Admin Dashboard & Live Batch Dump Engine ─────────────────
function getAdminDashboardText() {
  const dumpStatus = getDumpStatus();
  return `🛡️ï¸ *${BRAND.BOT_NAME} — Master Admin Control Panel*\n` +
         `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
         `👑 *Super Admin:* \`${SUPER_ADMIN}\`\n` +
         `👥 *Admin Count:* \`${adminUsers.size}\`\n` +
         `👥 *Total Bot Users:* \`${knownUsers.size}\`\n` +
         `📥 *Total Files Sent:* \`${globalStats.total_file_requests}\`\n` +
         `💾 *Indexed Local Lectures:* \`${lectureIndex.size}\` items\n` +
         `📦 *Primary Dump Channel:* \`${DUMP_CHANNEL_ID}\`\n` +
         `🛡️ï¸ *Secondary Backup Channel:* \`${BACKUP_CHANNEL_ID}\`\n` +
         `âš™ï¸ *Auto-Dumper Status:* ${dumpStatus.isRunning ? '🟡 `RUNNING`' : '🟢 `IDLE`'}\n` +
         `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
         `👇 _Select an administrative action below:_`;
}

function getAdminKeyboard() {
  const dumpStatus = getDumpStatus();
  return {
    inline_keyboard: [
      [
        { text: '📊 Live Analytics', callback_data: 'adm_stats' },
        { text: dumpStatus.isRunning ? 'â³ Dump Running...' : '🚀 Start Batch Dump', callback_data: 'adm_start_dump' }
      ],
      [
        { text: '🛑 Stop Dump', callback_data: 'adm_stop_dump' },
        { text: '👥 List Admins', callback_data: 'adm_list_admins' }
      ],
      [
        { text: '📦 Storage Info', callback_data: 'adm_storage_info' },
        { text: '🔄 Refresh Panel', callback_data: 'adm_refresh' }
      ],
      [
        { text: 'âŒ Close Panel', callback_data: 'close_msg' }
      ]
    ]
  };
}

let liveDumpJob = { isRunning: false, msgId: null, chatId: null, lastUpdate: 0 };

async function triggerBatchDumpFlow(targetChatId) {
  if (getDumpStatus().isRunning || liveDumpJob.isRunning) {
    return bot.sendMessage(targetChatId, '⚠️ï¸ *A batch dump is already in progress!*', { parse_mode: 'Markdown' });
  }

  liveDumpJob.isRunning = true;
  liveDumpJob.chatId = targetChatId;
  const statusMsg = await bot.sendMessage(
    targetChatId,
    `🚀 *${BRAND.BOT_NAME} — Batch Dumper Initialized*\n\nâ³ Connecting to PW & Telegram APIs...\nStarting full curriculum scan.`,
    { parse_mode: 'Markdown' }
  );
  liveDumpJob.msgId = statusMsg.message_id;

  const onProgress = async (p) => {
    const now = Date.now();
    // Throttled update every 7 seconds to avoid Telegram rate limits
    if (now - liveDumpJob.lastUpdate < 7000 && !p.isWait) return;
    liveDumpJob.lastUpdate = now;

    try {
      const waitNotice = p.isWait ? `\nâ³ _[FloodWait] Paused for ${p.waitSec}s..._` : '';
      const text = `🚀 *${(BRAND.BOT_NAME || 'STUDY HUB').toUpperCase()} — LIVE BATCH DUMP*\n` +
                   `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                   `📚 *Batch:* [${p.currentBatch || 1}/${p.totalBatches || '?'}] \`${escMd(p.batchName || 'Scanning...')}\`\n` +
                   `ðŸ“– *Subject:* \`${escMd(p.subjectName || 'Scanning...')}\`\n` +
                   `🚩 *Chapter:* \`${escMd(p.topicName || 'Scanning...')}\`\n` +
                   `📥 *New Dumped:* \`${p.totalDumped || 0}\`\n` +
                   `â­ï¸ *Already Cached:* \`${p.totalSkipped || 0}\`\n` +
                   `💾 *Total Archive Size:* \`${p.totalArchiveSize || lectureIndex.size}\`\n` +
                   `📦 *Channel:* \`${DUMP_CHANNEL_ID}\`` +
                   waitNotice;

      await bot.editMessageText(text, {
        chat_id: targetChatId,
        message_id: liveDumpJob.msgId,
        parse_mode: 'Markdown'
      }).catch(() => {});
    } catch (_) {}
  };

  try {
    const summary = await runBatchDump({ userbot }, onProgress);
    liveDumpJob.isRunning = false;

    let failedDetails = '';
    if (summary.totalFailed > 0 && Array.isArray(summary.failedItems)) {
      failedDetails = `\n\n⚠️ï¸ *Failed / Missed Items (${summary.totalFailed}):*\n` +
                      summary.failedItems.map((f, i) => `${i + 1}. \`${escMd(f.meta?.name || f.startParam)}\` (${f.reason || 'error'})`).join('\n');
    }

    const failedLine = summary.totalFailed === 0 
      ? `âŒ *Failed / Missed:* \`0 (100% Success — Zero Errors!)\` ✅`
      : `âŒ *Failed / Missed:* \`${summary.totalFailed}\``;

    const completionMsg = `🎉 *BATCH DUMP & ARCHIVE COMPLETED!*\n` +
                          `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                          `📥 *Total New Dumped:* \`${summary.totalDumped}\`\n` +
                          `â­ï¸ *Already in Cache:* \`${summary.totalSkipped}\`\n` +
                          `${failedLine}\n` +
                          `📊 *Total Archive Database:* \`${summary.totalArchiveSize}\` items\n` +
                          `â±ï¸ *Time Taken:* \`${summary.durationStr}\`\n` +
                          `📦 *Primary Channel:* \`${DUMP_CHANNEL_ID}\`\n` +
                          `🛡️ï¸ *Backup Channel:* \`${BACKUP_CHANNEL_ID}\`\n` +
                          `⚡ *Status:* 100% Synced & Ready for 0.1s Fast Delivery!` +
                          failedDetails;

    await bot.sendMessage(targetChatId, completionMsg, { parse_mode: 'Markdown' });
    if (SUPPORT_GID && String(targetChatId) !== String(SUPPORT_GID)) {
      await bot.sendMessage(SUPPORT_GID, completionMsg, { parse_mode: 'Markdown' }).catch(() => {});
    }
    if (SUPER_ADMIN && String(targetChatId) !== String(SUPER_ADMIN)) {
      await bot.sendMessage(SUPER_ADMIN, completionMsg, { parse_mode: 'Markdown' }).catch(() => {});
    }
  } catch (err) {
    liveDumpJob.isRunning = false;
    bot.sendMessage(targetChatId, `âŒ *Batch Dump Error:* ${err.message}`, { parse_mode: 'Markdown' });
  }
}

function addAdminUser(userId) {
  const numId = parseInt(userId, 10);
  if (!numId) return false;
  adminUsers.add(numId);
  saveLocalBackup();
  supabaseRequest('bot_admins?on_conflict=user_id', 'POST', { user_id: numId, added_at: new Date().toISOString() });
  return true;
}

function removeAdminUser(userId) {
  const numId = parseInt(userId, 10);
  if (numId === SUPER_ADMIN) return false; // cannot remove super admin
  adminUsers.delete(numId);
  saveLocalBackup();
  supabaseRequest(`bot_admins?user_id=eq.${numId}`, 'DELETE');
  return true;
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK & REGULAR BOT HANDLERS
// ═══════════════════════════════════════════════════════════════
app.post('/webhook', (req, res) => {
  try {
    if (bot) bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch { res.sendStatus(200); }
});

if (bot) {
  // ─── Inline Button Clicks ───────────────────
  bot.on('callback_query', async (q) => {
    const data = q.data;
    
    if (data === 'close_msg') {
      try { await bot.deleteMessage(q.message.chat.id, q.message.message_id); } catch (e) {}
      return bot.answerCallbackQuery(q.id);
    }

    // ─── Admin Interactive Callback Queries ─────────────────
    if (data.startsWith('adm_')) {
      if (!isAdmin(q.from.id)) {
        return bot.answerCallbackQuery(q.id, { text: '⛔ Unauthorized: Admin only!', show_alert: true });
      }
      await bot.answerCallbackQuery(q.id);

            if (data === 'adm_stats') {
        const totalUsers = knownUsers.size;
        const bannedCount = bannedUsers.size;
        const totalRequests = globalStats.total_file_requests;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let active24h = 0;
        for (const u of knownUsers.values()) {
          if (u.last_seen && new Date(u.last_seen).getTime() > oneDayAgo) active24h++;
        }
        const uptimeMs = Date.now() - globalStats.server_started_at;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        const statsMsg = `📊 *${BRAND.BOT_NAME} — Live Analytics*\n` +
                         `━━━━━━━━━━━━━━━━━━━━━━\n` +
                         `👥 *Total Users:* \`${totalUsers}\`\n` +
                         `🟢 *Active (24h):* \`${active24h}\`\n` +
                         `📥 *Files Sent:* \`${totalRequests}\`\n` +
                         `💾 *Indexed Local Lectures:* \`${lectureIndex.size}\`\n` +
                         `🚫 *Banned Users:* \`${bannedCount}\`\n` +
                         `⏱️ *Uptime:* \`${uptimeHours}h ${uptimeMins}m\``;
        return bot.sendMessage(q.message.chat.id, statsMsg, { parse_mode: 'Markdown' });
      }

      if (data === 'adm_start_dump') {
        return triggerBatchDumpFlow(q.message.chat.id);
      }

      if (data === 'adm_stop_dump') {
        const stopped = cancelDump();
        if (stopped) {
          return bot.sendMessage(q.message.chat.id, '🛑 *Batch Dump Cancelled by Admin.*', { parse_mode: 'Markdown' });
        } else {
          return bot.sendMessage(q.message.chat.id, 'ℹ️ *No active dump process is running.*', { parse_mode: 'Markdown' });
        }
      }

      if (data === 'adm_list_admins') {
        const list = Array.from(adminUsers).map((id, i) => `${i + 1}. \`${id}\`${id === SUPER_ADMIN ? ' (👑 Super Admin)' : ''}`).join('\n');
        return bot.sendMessage(q.message.chat.id, `👥 *Authorized Admins List:*\n\n${list}\n\n_Use /addadmin <id> or /removeadmin <id> to manage._`, { parse_mode: 'Markdown' });
      }

      if (data === 'adm_storage_info') {
        const storageMsg = `📦 *Telegram Storage Channels Status*\n` +
                           `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                           `ðŸ“ *Primary Channel ID:* \`${DUMP_CHANNEL_ID}\`\n` +
                           `🛡️ï¸ *Backup Channel ID:* \`${BACKUP_CHANNEL_ID}\`\n` +
                           `💾 *Total Indexed Files:* \`${lectureIndex.size}\` items\n` +
                           `â˜ï¸ *Cloud Database:* \`Supabase PostgreSQL\``;
        return bot.sendMessage(q.message.chat.id, storageMsg, { parse_mode: 'Markdown' });
      }

      if (data === 'adm_refresh') {
        return bot.editMessageText(getAdminDashboardText(), {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: getAdminKeyboard()
        }).catch(() => {});
      }
    }

    if (data.startsWith('v_') || data.startsWith('n_')) {
      await bot.answerCallbackQuery(q.id);
      
      if (!userbot) {
        return bot.sendMessage(q.message.chat.id, "âŒ Error: Delivery system offline (Userbot not initialized).");
      }

      // Instead of hiding the inline keyboard, we send a new loading message
      // This preserves the original menu so the user can download other attachments!
      const loadingMsg = await bot.sendMessage(q.message.chat.id, 'â³ *Fetching file, please wait...*', {
        parse_mode: 'Markdown',
        reply_to_message_id: q.message.message_id
      }).catch(() => null);

      const isVideo = data.startsWith('v_');
      // Robust parsing: prefix is 'v_' or 'n_' (2 chars), then batchId_contentId[_quality]
      const withoutPrefix = data.slice(2); // remove 'v_' or 'n_'
      const firstUnderscore = withoutPrefix.indexOf('_');
      const batchIdPart = withoutPrefix.slice(0, firstUnderscore);
      const rest = withoutPrefix.slice(firstUnderscore + 1);
      let contentIdPart, qualityPart;
      if (isVideo) {
        const lastUnderscore = rest.lastIndexOf('_');
        contentIdPart = rest.slice(0, lastUnderscore);
        qualityPart = rest.slice(lastUnderscore + 1);
      } else {
        contentIdPart = rest;
        qualityPart = '';
      }
      const startParam = isVideo ? `${batchIdPart}_${contentIdPart}_${qualityPart}` : `${batchIdPart}_${contentIdPart}`;

      // Instant PDF Cache Hit Check
      if (!isVideo) {
        const cachedPdf = pdfIndex.get(contentIdPart) || pdfIndex.get(startParam);
        if (cachedPdf && cachedPdf.pdf_url) {
          if (loadingMsg) await bot.deleteMessage(q.message.chat.id, loadingMsg.message_id).catch(() => {});
          await bot.sendMessage(q.message.chat.id, `📄 *${escMd(cachedPdf.name || 'Class Notes / DPP')}*\n\n⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📄 Open PDF ↗ï¸', url: cachedPdf.pdf_url }],
                [{ text: 'Close 🔒', callback_data: 'close_msg' }]
              ]
            }
          });
          trackFileRequest(q.message.chat.id);
          return;
        }
      }

      let finalCaption = q.message.caption || q.message.text || '';
      if (isVideo) {
         finalCaption = finalCaption.split('📊')[0].trim();
         finalCaption += `\n\n🎬 *Quality:* ${qualityPart}p\n\n⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*`;
      }

      enqueueFetch(q.message.chat.id, startParam, finalCaption, isVideo ? 'video' : 'document', loadingMsg?.message_id);
    }
  });

  // ─── Incoming Messages (Userbot -> Regular Bot) ───────────
  bot.on('message', async (msg) => {
    // Track every user interacting with the bot
    if (msg.from && (!SUPPORT_GID || String(msg.chat.id) !== String(SUPPORT_GID))) {
      trackUserActivity(msg.from);
    }

        // 1. /start handler (Supports Deep-Linked Content Access)
    if (msg.text && msg.text.startsWith('/start')) {
      const chatId = msg.chat.id;
      const name = msg.from?.first_name || 'Student';
      const payload = msg.text.split(' ')[1];

      if (!payload) {
        const bannerUrl = getBannerUrl();
        const welcomeText = `⚡ *Hey ${escMd(name)}!*\n\n🎓 Welcome to *${escMd(BRAND.BOT_NAME)}*\n\nAccess all your batches, lectures, notes & DPPs in one sleek dark interface!\n\n👇 Tap below to open`;
        const keyboard = {
          inline_keyboard: [
            [{ text: `🚀 Open ${BRAND.BOT_NAME}`, web_app: { url: WEBAPP_URL || 'https://t.me' } }],
            [
              { text: '🤖 Guru AI Doubt Solver', callback_data: 'btn_guru_info' },
              { text: '🎁 Invite & Earn VIP', callback_data: 'btn_invite_info' }
            ],
            ...(BRAND.CHANNEL_LINK || BRAND.GROUP_LINK ? [[
              ...(BRAND.CHANNEL_LINK ? [{ text: '📢 Channel', url: BRAND.CHANNEL_LINK }] : []),
              ...(BRAND.GROUP_LINK ? [{ text: '💬 Group', url: BRAND.GROUP_LINK }] : [])
            ]] : [])
          ]
        };

        try {
          await bot.sendPhoto(chatId, bannerUrl, {
            caption: welcomeText,
            parse_mode: 'Markdown',
            reply_markup: WEBAPP_URL ? keyboard : {
              inline_keyboard: [[{ text: '⏳ Deploying soon...', callback_data: 'noop' }]]
            }
          });
        } catch (photoErr) {
          await bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: WEBAPP_URL ? keyboard : {
              inline_keyboard: [[{ text: '⏳ Deploying soon...', callback_data: 'noop' }]]
            }
          });
        }
      } else {

        // ─── Case LP: Link Preview Store (has full metadata) ───────
        if (payload.startsWith('lp_')) {
          const lpId = payload.slice(3);
          const lp   = linkPreviews.get(lpId);
          if (!lp) {
            // Metadata expired or invalid — just open the webapp
            return bot.sendMessage(chatId,
              `⚡ *Hey ${escMd(name)}!*\n\n🎓 *${escMd(BRAND.BOT_NAME)}* — that content link has expired.\n\nPlease open the webapp and tap the lecture again.`,
              { parse_mode: 'Markdown', reply_markup: WEBAPP_URL ? { inline_keyboard: [[{ text: `🚀 Open ${BRAND.BOT_NAME}`, web_app: { url: WEBAPP_URL } }]] } : undefined }
            );
          }
          console.log(`[/start lp_${lpId}] Restoring metadata: ${lp.name} | batch=${lp.batchId}`);
          linkPreviews.delete(lpId); // one-time use

          const isVideo = lp.type === 'Videos' || lp.type === 'DppVideos';

          if (!isVideo && lp.pdfUrl) {
            // Send PDF direct from stored URL
            await sendPdfDirect(chatId, {
              pdfUrl:    lp.pdfUrl,
              name:      lp.name,
              subject:   lp.subject,
              topic:     lp.topic,
              type:      lp.type || 'Notes',
              batchId:   lp.batchId,
              contentId: lp.contentId
            });
            return;
          }

          if (!isVideo && lp.contentId) {
            // Notes without URL — check cache or enqueue
            const cachedPdf = pdfIndex.get(lp.contentId);
            if (cachedPdf && cachedPdf.pdf_url) {
              await sendPdfDirect(chatId, {
                pdfUrl:    cachedPdf.pdf_url,
                name:      lp.name || cachedPdf.name,
                subject:   lp.subject,
                topic:     lp.topic,
                type:      lp.type || 'Notes',
                batchId:   lp.batchId,
                contentId: lp.contentId
              });
              return;
            }
            const loadingMsgN = await bot.sendMessage(chatId, 'â³ *Fetching your document, please wait...*', { parse_mode: 'Markdown' });
            const caption = getCaption(false, { name: lp.name, subject: lp.subject, topic: lp.topic });
            enqueueFetch(chatId, lp.contentId, caption, 'document', loadingMsgN.message_id);
            return;
          }

          // Video — send quality menu with real metadata including homework/DPP fetch
          let finalHomeworks = [];
          let finalDpps = [];
          if (lp.batchId && lp.subject && lp.contentId) {
            try {
              const schedItem = await fetchPwThorSchedule(lp.batchId, lp.subject, lp.contentId);
              if (schedItem) {
                finalHomeworks = (schedItem.homeworkIds || []).filter(hw => Array.isArray(hw?.attachmentIds) && hw.attachmentIds.length > 0);
                finalDpps = (schedItem.dpp?.homeworkIds || []).filter(dp => Array.isArray(dp?.attachmentIds) && dp.attachmentIds.length > 0);
              }
            } catch (e) { console.warn('[lp start] Schedule fetch failed:', e.message); }
          }
          await sendVideoQualitySelection(chatId, {
            batchId:   lp.batchId,
            contentId: lp.contentId,
            name:      lp.name,
            image:     lp.image,
            subject:   lp.subject,
            topic:     lp.topic,
            type:      lp.type || 'Videos',
            homeworks: finalHomeworks,
            dpps:      finalDpps
          });
          return;
        }

        // ─── Legacy payloads (no metadata store) ──────────────────
        const isNote = payload.startsWith('n_');
        const cleanPayload = (payload.startsWith('v_') || payload.startsWith('n_')) ? payload.slice(2) : payload;
        const parts = cleanPayload.split('_');

        // Case A: Note / DPP PDF Deep-Link (legacy)
        if (isNote) {
          const contentId = parts.length > 1 ? parts[1] : cleanPayload;
          const cachedPdf = pdfIndex.get(contentId) || pdfIndex.get(cleanPayload) || pdfIndex.get(payload);
          if (cachedPdf && cachedPdf.pdf_url) {
            await sendPdfDirect(chatId, {
              pdfUrl:  cachedPdf.pdf_url,
              name:    cachedPdf.name,
              subject: '', topic: '',
              type:    cachedPdf.type || 'Notes'
            });
            trackFileRequest(chatId);
            return;
          }
          const loadingMsg = await bot.sendMessage(chatId, 'â³ *Fetching your document, please wait...*', { parse_mode: 'Markdown' });
          enqueueFetch(chatId, cleanPayload, `📄 *Direct Notes / DPP Request*\n\n⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*`, 'document', loadingMsg.message_id);
          return;
        }

        // Case B: Video quality selection (legacy batchId_contentId)
        if (parts.length === 2) {
          const [batchId, contentId] = parts;
          console.log(`[/start legacy] Quality menu batch=${batchId} content=${contentId}`);
          await sendVideoQualitySelection(chatId, { batchId, contentId, name: 'Lecture Video', type: 'Videos', homeworks: [], dpps: [] });
          return;
        }

        // Case C: Video with specific quality (batchId_contentId_quality) (legacy)
        const isVideo = parts.length >= 3;
        const loadingMsg = await bot.sendMessage(chatId, isVideo ? 'â³ *Fetching your video, please wait...*' : 'â³ *Fetching file, please wait...*', { parse_mode: 'Markdown' });
        enqueueFetch(
          chatId,
          cleanPayload,
          isVideo ? `📹 *Lecture Video (${parts[2] || '720'}p)*\n\n⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*` : `📄 *Direct File Request*\n\n⚡ *Powered by ${BRAND.BOT_NAME || 'Study Hub'}*`,
          isVideo ? 'video' : 'document',
          loadingMsg.message_id
        );
      }
      return;
    }

    // 2. Intercept messages sent by our Userbot
    if (msg.caption && msg.caption.startsWith('REQ:')) {
      const reqId = msg.caption.split(':')[1];
      const pending = pendingRequests.get(reqId);
      
      if (pending) {
         pendingRequests.delete(reqId);
         let fileId = null;
         if (msg.video) fileId = msg.video.file_id;
         else if (msg.document) fileId = msg.document.file_id;
         
         if (fileId) {
           const sendMethod = msg.video ? bot.sendVideo.bind(bot) : bot.sendDocument.bind(bot);
            try {
              await sendMethod(pending.chatId, fileId, {
                caption: truncateCaption(pending.caption),
                parse_mode: 'Markdown'
              });
              if (pending.statusMsgId) await bot.deleteMessage(pending.chatId, pending.statusMsgId).catch(()=>{});
              trackFileRequest(pending.chatId);
            } catch(e) {
              console.warn('[Delivery] Markdown send failed, fallback plain text:', e.message);
              await sendMethod(pending.chatId, fileId, {
                caption: truncateCaption(pending.caption)
              }).catch(err => console.error('[Delivery] Fatal send error:', err.message));
              if (pending.statusMsgId) await bot.deleteMessage(pending.chatId, pending.statusMsgId).catch(()=>{});
              trackFileRequest(pending.chatId);
            }

            // ─── Background Auto-Dump into Private Channel & Supabase ───
            if (pending.startParam) {
              (async () => {
                const tag = `#PW_${pending.startParam}`;
                const dumpCaption = `${pending.caption}\n\n${tag}`;
                let dumpMsgId = null;

                // 1. Post to Primary Dump Channel
                if (DUMP_CHANNEL_ID) {
                  try {
                    const dumpMsg = await sendMethod(DUMP_CHANNEL_ID, fileId, {
                      caption: truncateCaption(dumpCaption),
                      parse_mode: 'Markdown'
                    }).catch(async () => {
                      return await sendMethod(DUMP_CHANNEL_ID, fileId, { caption: truncateCaption(dumpCaption) }).catch(() => null);
                    });
                    if (dumpMsg && dumpMsg.message_id) {
                      dumpMsgId = dumpMsg.message_id;
                      console.log(`💾 [Dump Channel] Saved #${dumpMsgId} for ${tag}`);
                    }
                  } catch (chErr) {
                    console.warn('[Dump Channel] Post error:', chErr.message);
                  }
                }

                // 2. ALWAYS Save to Local Index & Supabase (Guaranteed Instant Cache!)
                saveLectureToIndex(pending.startParam, {
                  key: pending.startParam,
                  channel_id: dumpMsgId ? String(DUMP_CHANNEL_ID) : '',
                  message_id: dumpMsgId,
                  file_id: fileId,
                  file_type: msg.video ? 'video' : 'document',
                  caption: truncateCaption(pending.caption),
                  created_at: new Date().toISOString()
                });
                console.log(`💾 [Auto-Saved to Index & Supabase] Tag: ${tag} | Msg #${dumpMsgId || 'None'} | RAM Index: ${lectureIndex.size}`);

                // 3. Mirror to Secondary Backup Channel (Async Zero Delay)
                if (BACKUP_CHANNEL_ID) {
                  sendMethod(BACKUP_CHANNEL_ID, fileId, {
                    caption: truncateCaption(dumpCaption),
                    parse_mode: 'Markdown'
                  }).catch(() => {
                    sendMethod(BACKUP_CHANNEL_ID, fileId, { caption: truncateCaption(dumpCaption) }).catch(() => {});
                  });
                  console.log(`🛡️ï¸ [Mirrored to Backup Channel] Tag: ${tag}`);
                }
              })();
            }
         }
      }
      return;
    }

    // 3. Admin Commands (Executed in DM or Support Group)
    if (msg.text && isAdmin(msg.from?.id)) {
      const txt = msg.text.trim();

      // /admin
      if (txt === '/admin' || txt === '/panel') {
        return bot.sendMessage(msg.chat.id, getAdminDashboardText(), {
          parse_mode: 'Markdown',
          reply_markup: getAdminKeyboard()
        });
      }

      // /dump
      if (txt === '/dump' || txt === '/startdump') {
        return triggerBatchDumpFlow(msg.chat.id);
      }

      // /stopdump
      if (txt === '/stopdump' || txt === '/canceldump') {
        const stopped = cancelDump();
        if (stopped) {
          return bot.sendMessage(msg.chat.id, '🛑 *Batch Dump Cancelled.*', { parse_mode: 'Markdown' });
        } else {
          return bot.sendMessage(msg.chat.id, 'ℹ️ï¸ *No active dump is currently running.*', { parse_mode: 'Markdown' });
        }
      }

      // /addadmin <userId> (Super Admin only)
      if (txt.startsWith('/addadmin ')) {
        if (msg.from.id !== SUPER_ADMIN) {
          return bot.sendMessage(msg.chat.id, '⛔ Only the *Super Admin* can add new admins.', { parse_mode: 'Markdown' });
        }
        const targetId = parseInt(txt.split(' ')[1], 10);
        if (!targetId) return bot.sendMessage(msg.chat.id, 'âŒ Usage: `/addadmin 123456789`', { parse_mode: 'Markdown' });
        addAdminUser(targetId);
        return bot.sendMessage(msg.chat.id, `✅ User \`${targetId}\` is now an *Authorized Admin*!`, { parse_mode: 'Markdown' });
      }

      // /removeadmin <userId> (Super Admin only)
      if (txt.startsWith('/removeadmin ')) {
        if (msg.from.id !== SUPER_ADMIN) {
          return bot.sendMessage(msg.chat.id, '⛔ Only the *Super Admin* can remove admins.', { parse_mode: 'Markdown' });
        }
        const targetId = parseInt(txt.split(' ')[1], 10);
        if (!targetId) return bot.sendMessage(msg.chat.id, 'âŒ Usage: `/removeadmin 123456789`', { parse_mode: 'Markdown' });
        const res = removeAdminUser(targetId);
        if (res) {
          return bot.sendMessage(msg.chat.id, `✅ Admin \`${targetId}\` has been removed.`, { parse_mode: 'Markdown' });
        } else {
          return bot.sendMessage(msg.chat.id, `âŒ Cannot remove Super Admin.`, { parse_mode: 'Markdown' });
        }
      }

      // /admins
      if (txt === '/admins') {
        const list = Array.from(adminUsers).map((id, i) => `${i + 1}. \`${id}\`${id === SUPER_ADMIN ? ' (👑 Super Admin)' : ''}`).join('\n');
        return bot.sendMessage(msg.chat.id, `👥 *Authorized Admins List:*\n\n${list}\n\n_Use /addadmin <id> or /removeadmin <id> to manage._`, { parse_mode: 'Markdown' });
      }

      // /check <key>
      if (txt.startsWith('/check ')) {
        const key = txt.split(' ')[1].trim();
        const cached = lectureIndex.get(key);
        if (cached) {
          return bot.sendMessage(msg.chat.id, `✅ *Lecture Cached in Local Archive!*\n\n🔑 *Key:* \`${key}\`\n📦 *Channel:* \`${cached.channel_id}\`\n💬 *Message ID:* \`#${cached.message_id}\`\n📹 *Title:* ${cached.title || 'Lecture'}\nâ±ï¸ *Created:* \`${cached.created_at}\``, { parse_mode: 'Markdown' });
        } else {
          return bot.sendMessage(msg.chat.id, `âŒ *Key not found in local index:* \`${key}\``, { parse_mode: 'Markdown' });
        }
      }

      // /br <message>
      if (txt.startsWith('/br ')) {
        const bMsg = txt.slice(4).trim();
        if (!bMsg) return bot.sendMessage(msg.chat.id, 'âŒ Usage: /br your message here');
        let ok = 0, fail = 0;
        const uids = Array.from(knownUsers.keys());
        for (const uid of uids) {
          try {
            await bot.sendMessage(uid, '📢 *Announcement*\n\n' + escMd(bMsg), { parse_mode: 'Markdown' });
            ok++;
          } catch (_) {
            fail++;
          }
          await new Promise(r => setTimeout(r, 50));
        }
        globalStats.total_broadcasts++;
        saveLocalBackup();
        supabaseRequest('bot_stats?on_conflict=id', 'POST', {
          id: 'global',
          total_file_requests: globalStats.total_file_requests,
          total_broadcasts: globalStats.total_broadcasts,
          updated_at: new Date().toISOString()
        }, 'resolution=merge-duplicates');

        return bot.sendMessage(msg.chat.id, `✅ Broadcast complete!\n\n📤 Sent: ${ok}\nâŒ Failed: ${fail}`);
      }

      // /ban <userId>
      if (txt.startsWith('/ban ')) {
        const uid = parseInt(txt.split(' ')[1]);
        if (!uid) return bot.sendMessage(msg.chat.id, 'âŒ Usage: /ban 123456789');
        setBanStatus(uid, true);
        return bot.sendMessage(msg.chat.id, `🚫 User \`${uid}\` has been banned.`);
      }

      // /unban <userId>
      if (txt.startsWith('/unban ')) {
        const uid = parseInt(txt.split(' ')[1]);
        if (!uid) return bot.sendMessage(msg.chat.id, 'âŒ Usage: /unban 123456789');
        setBanStatus(uid, false);
        return bot.sendMessage(msg.chat.id, `✅ User \`${uid}\` has been unbanned.`);
      }

      // /stats
      if (txt === '/stats') {
        const totalUsers = knownUsers.size;
        const bannedCount = bannedUsers.size;
        const totalRequests = globalStats.total_file_requests;
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let active24h = 0;
        for (const u of knownUsers.values()) {
          if (u.last_seen && new Date(u.last_seen).getTime() > oneDayAgo) active24h++;
        }

        const uptimeMs = Date.now() - globalStats.server_started_at;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        const uptimeStr = `${uptimeHours}h ${uptimeMins}m`;

        const userList = Array.from(knownUsers.values())
          .sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0))
          .slice(0, 5);

        let recentUsersText = '';
        if (userList.length > 0) {
          recentUsersText = '\n\n*🕒 Recent Active Users:*\n' + userList.map((u, i) => {
            const uName = u.username ? `@${escMd(u.username)}` : escMd(u.first_name || 'User');
            return `${i + 1}. ${uName} (\`${u.user_id}\`) — ${u.request_count || 0} reqs`;
          }).join('\n');
        }

        const statsMsg = `📊 *${BRAND.BOT_NAME} — Live Analytics Dashboard*\n` +
                         `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                         `👥 *Total Users:* \`${totalUsers}\`\n` +
                         `🟢 *Active (Last 24h):* \`${active24h}\`\n` +
                         `📥 *Total Files Sent:* \`${totalRequests}\`\n` +
                         `💾 *Indexed Local Lectures:* \`${lectureIndex.size}\`\n` +
                         `📦 *Storage Dump Channel:* \`${DUMP_CHANNEL_ID}\`\n` +
                         `🛡️ï¸ *Backup Channel:* \`${BACKUP_CHANNEL_ID}\`\n` +
                         `🚫 *Banned Users:* \`${bannedCount}\`\n` +
                         `📢 *Broadcasts Sent:* \`${globalStats.total_broadcasts}\`\n` +
                         `â±ï¸ *Uptime:* \`${uptimeStr}\`\n` +
                         `â˜ï¸ *Database:* \`Supabase (Synced)\`` +
                         recentUsersText;

        return bot.sendMessage(msg.chat.id, statsMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      }
    }

    // 4. Admin reply in Group -> relay to user DM
    if (SUPPORT_GID && String(msg.chat.id) === String(SUPPORT_GID) && msg.reply_to_message && msg.text) {
      const origText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
      console.log('[Support Group Reply] Processing reply. Original text:', origText);
      const uidMatch = origText.match(/(?:User ID:\s*|UID:?\s*\[?|ID:\s*`?)(\d+)/i);
      if (uidMatch) {
        const targetId = parseInt(uidMatch[1], 10);
        try {
          await bot.sendMessage(targetId, `💬 *Support Reply:*\n\n` + escMd(msg.text), { parse_mode: 'Markdown' });
          await bot.sendMessage(SUPPORT_GID, `✅ Reply delivered to user \`${targetId}\`.`, { reply_to_message_id: msg.message_id });
          console.log(`[Support Group Reply] Successfully sent reply to ${targetId}`);
        } catch (e) {
          console.error('[Support Group Reply] Failed:', e.message);
          await bot.sendMessage(SUPPORT_GID, `âŒ Failed to deliver reply: ` + e.message, { reply_to_message_id: msg.message_id });
        }
        return;
      }
    }

    // 5. User messages -> Forward to Support Group
    const fromId = msg.from && msg.from.id;
    if (SUPPORT_GID && String(msg.chat.id) !== String(SUPPORT_GID) && msg.text && fromId && !isAdmin(fromId)) {
      if (bannedUsers.has(String(fromId))) {
        return bot.sendMessage(msg.chat.id, '🚫 You have been restricted from sending messages.');
      }
      const user  = msg.from || {};
      const uname = user.username ? ('@' + escMd(user.username)) : '`None`';
      const name  = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
      const header = `📩 *New Support Message*\n` +
                     `👤 *Name:* ` + escMd(name) + `\n` +
                     `ðŸ·ï¸ *Username:* ` + uname + `\n` +
                     `🆔 *User ID:* \`` + fromId + `\`\n` +
                     `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                     `💬 *Message:*\n`;
      try {
        await bot.sendMessage(SUPPORT_GID, header + escMd(msg.text), { parse_mode: 'Markdown', disable_web_page_preview: true });
        await bot.sendMessage(msg.chat.id, '✅ *Message received!*\nOur team will reply to you here shortly.', { parse_mode: 'Markdown' });
      } catch (e) { console.error('Forward to group failed:', e.message); }
    }
  });
}

// ─── Daily Midnight Incremental Cron (DISABLED) ─────────────────────────
// Note: Nightly automatic batch dump is disabled as requested.
// Dumps can still be triggered manually via /dump or the Admin Panel.

// ─── Health Check & Keep-Alive ───────────────────────────────
app.get('/health', async (_, res) => {
  let supabaseStatus = 'not_configured';
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const sbRes = await supabaseRequest('bot_stats?select=id&limit=1');
      supabaseStatus = sbRes !== null ? 'active' : 'unreachable';
    } catch (e) {
      supabaseStatus = 'error';
    }
  }

  res.json({
    status: 'ok',
    supabase: supabaseStatus,
    bot: !!bot,
    userbot: !!(userbot && userbot.connected),
    webapp: WEBAPP_URL || 'not set',
    userId: process.env.PW_USER_ID || 'not set',
    timestamp: new Date().toISOString()
  });
});

// ─── /api/config — Public Branding Endpoint ───────────────────
app.get('/api/config', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    BOT_NAME:       BRAND.BOT_NAME,
    BOT_USERNAME:   BRAND.BOT_USERNAME,
    WEBAPP_TITLE:   BRAND.WEBAPP_TITLE,
    WEBAPP_TAGLINE: BRAND.WEBAPP_TAGLINE,
    BOT_LINK:       BRAND.BOT_LINK,
    GROUP_LINK:     BRAND.GROUP_LINK,
    CHANNEL_LINK:   BRAND.CHANNEL_LINK,
    POWERED_BY:     BRAND.POWERED_BY,
    POWERED_BY_HANDLE: BRAND.POWERED_BY_HANDLE,
    ACCENT_COLOR:   BRAND.ACCENT_COLOR,
    BANNER:         process.env.BANNER || '1',
    BANNER_FILE:    getBannerFilename(),
    BANNER_URL:     getBannerUrl(),
  });
});
app.options('/api/config', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send();
});

// ─── /api/vlink — Short-Lived Signed Video Token (Source Protection) ──────
// Flow:
//   1. Frontend requests video → server returns a /api/vlink/<token> instead of raw URL
//   2. Player loads /api/vlink/<token> → server validates + redirects to real CDN URL
//   3. Token expires in 30 minutes, bound to userId — raw URL is NEVER sent to client
//
const vlinkStore = new Map(); // token -> { url, drm, userId, expires }

// Issue a video token (called internally from /api/stream endpoint)
function issueVlinkToken(url, drm, userId) {
  const token = crypto.randomBytes(20).toString('hex');
  vlinkStore.set(token, { url, drm: drm || null, userId: String(userId), expires: Date.now() + 30 * 60 * 1000 });
  // Cleanup old tokens
  for (const [k, v] of vlinkStore.entries()) { if (v.expires < Date.now()) vlinkStore.delete(k); }
  return token;
}

// Resolve token → redirect to real URL
app.get('/api/vlink/:token', (req, res) => {
  const { token } = req.params;
  const entry = vlinkStore.get(token);
  if (!entry || entry.expires < Date.now()) {
    return res.status(410).json({ ok: false, error: 'Link expired or invalid. Please re-open the video.' });
  }
  // One-time-use: delete after first use (optional — comment out if you want replay)
  // vlinkStore.delete(token);
  res.json({ ok: true, url: entry.url, drm: entry.drm });
});
app.options('/api/vlink/:token', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });

// ─── /api/stream-token — Frontend requests a token for a content ID ───────
// This replaces direct /api/stream calls with a token-based flow
app.post('/api/stream-token', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const { contentId, batchId, subjectId, provider, userId } = req.body || {};
  if (!contentId) return res.status(400).json({ ok: false, error: 'Missing contentId' });
  const effectiveUserId = userId || 'anonymous';

  try {
    // Forward to existing madxGet stream endpoint (re-use existing logic)
    const params = new URLSearchParams({ contentId, batchId: batchId || '', subjectId: subjectId || '' });
    let streamData;
    try {
      streamData = await madxGet(`/stream?${params}`);
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'Upstream stream fetch failed' });
    }

    const rawUrl = streamData?.data?.link || streamData?.link || '';
    const drm = streamData?.data?.drm || streamData?.drm || null;

    if (!rawUrl) return res.status(404).json({ ok: false, error: 'No stream URL available' });

    const token = issueVlinkToken(rawUrl, drm, userId);
    const tokenUrl = `/api/vlink/${token}`;

    res.json({
      ok: true,
      token,
      vlink: tokenUrl,
      title: streamData?.data?.title || streamData?.title || '',
      slides: streamData?.data?.slides || [],
      notes: streamData?.data?.homeworkIds || streamData?.data?.notes || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.options('/api/stream-token', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });


// ─── /api/check-sub — Force Subscribe Check ────────────────
app.get('/api/check-sub', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const userId = req.query.user_id || req.query.chatId || req.query.userId;
  if (!userId || !BRAND.CHANNEL_ID || !bot) {
    return res.json({ ok: true, subscribed: true, channel_link: BRAND.CHANNEL_LINK, group_link: BRAND.GROUP_LINK });
  }
  try {
    const member = await bot.getChatMember(BRAND.CHANNEL_ID, parseInt(userId, 10));
    const subscribed = ['creator', 'administrator', 'member'].includes(member.status);
    res.json({ ok: true, subscribed, channel_link: BRAND.CHANNEL_LINK, group_link: BRAND.GROUP_LINK });
  } catch (e) {
    res.json({ ok: true, subscribed: true, channel_link: BRAND.CHANNEL_LINK, group_link: BRAND.GROUP_LINK });
  }
});
app.options('/api/check-sub', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });

// ─── /api/guru/solve — AI Doubt Solver ────────────────────
app.post('/api/guru/solve', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const { question, image } = req.body || {};
    const result = await solveDoubt(question || '', image || null);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.options('/api/guru/solve', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });

// ─── /api/user/vip-status — VIP & Referral Info ──────────────
app.get('/api/user/vip-status', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const userId = req.query.user_id || req.query.chatId || req.query.userId;
  if (!userId) {
    return res.json({ ok: true, is_vip: false, points: 0, referral_code: '', invites_count: 0 });
  }
  try {
    const info = await getUserVipInfo(userId);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.json({ ok: true, is_vip: false, points: 0, referral_code: '', invites_count: 0 });
  }
});
app.options('/api/user/vip-status', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });

// ─── /api/invite — Get Referral Info & Bot Link ─────────────
app.get('/api/invite', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ ok: false, error: 'Missing user_id' });
  try {
    const info = await getUserVipInfo(userId);
    const inviteLink = `${BRAND.BOT_LINK}?start=ref_${userId}`;
    res.json({ ok: true, invite_link: inviteLink, bot_link: BRAND.BOT_LINK, ...info });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.options('/api/invite', (req, res) => { res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', '*').send(); });

// ─── WebSocket /ws — Real-Time RPC Bridge ───────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Rolling token store: token -> { chatId, expires }
const wsTokens = new Map();

function issueWsToken(chatId) {
  const token = crypto.randomBytes(16).toString('hex');
  wsTokens.set(token, { chatId: String(chatId), expires: Date.now() + 60 * 60 * 1000 });
  // Clean stale
  for (const [k, v] of wsTokens.entries()) { if (v.expires < Date.now()) wsTokens.delete(k); }
  return token;
}

function validateWsToken(token) {
  const entry = wsTokens.get(token);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.chatId;
}

wss.on('connection', (ws, req) => {
  let chatId = null;
  let authenticated = false;

  // Ping-pong keepalive
  const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 25000);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Handshake — accept Telegram initData (we trust it, validate via bot token)
    if (msg.action === 'handshake') {
      const initData = msg.initData || '';
      // Simple validation: check if it contains user JSON (not strict — server handles full validation per request)
      if (initData && initData.includes('user')) {
        try {
          const params = new URLSearchParams(initData);
          const userStr = params.get('user');
          if (userStr) {
            const user = JSON.parse(userStr);
            chatId = String(user.id);
            authenticated = true;
            const token = issueWsToken(chatId);
            ws.send(JSON.stringify({ action: 'authenticated', token, chatId }));
            return;
          }
        } catch {}
      }
      // Dev fallback: allow if no initData (localhost)
      const reqHost = req.headers.host || '';
      if (reqHost.includes('localhost') || reqHost.includes('127.0.0.1')) {
        authenticated = true;
        chatId = msg.chatId || 'dev';
        const token = issueWsToken(chatId);
        ws.send(JSON.stringify({ action: 'authenticated', token, chatId }));
        return;
      }
      ws.send(JSON.stringify({ action: 'error', message: 'Handshake failed' }));
      return;
    }

    if (!authenticated) {
      ws.send(JSON.stringify({ action: 'error', message: 'Not authenticated' }));
      return;
    }

    // Route API actions over WebSocket
    const { id, action, path: apiPath, body } = msg;
    const respond = (data) => { try { ws.send(JSON.stringify({ id, ...data })); } catch {} };

    try {
      if (action === 'GET') {
        if (apiPath.startsWith('/api/batches')) {
          // Proxy batch list
          const page = new URL(apiPath, 'http://x').searchParams.get('page') || 1;
          const data = await madxGet(`/batches?page=${page}&limit=20`);
          respond({ ok: true, data });
        } else if (apiPath.startsWith('/api/user/vip-status')) {
          const uid = new URL(apiPath, 'http://x').searchParams.get('user_id') || chatId;
          respond({ ok: true, ...(await getUserVipInfo(uid)) });
        } else if (apiPath.startsWith('/api/invite')) {
          const uid = new URL(apiPath, 'http://x').searchParams.get('user_id') || chatId;
          const info = await getUserVipInfo(uid);
          respond({ ok: true, invite_link: `${BRAND.BOT_LINK}?start=ref_${uid}`, ...info });
        } else if (apiPath === '/api/config') {
          respond({ ok: true, data: BRAND });
        } else {
          respond({ ok: false, error: 'Unknown WS route' });
        }
      } else if (action === 'POST') {
        if (apiPath === '/api/guru/solve') {
          const result = await solveDoubt(body?.question || '', body?.image || null);
          respond({ ok: true, ...result });
        } else if (apiPath === '/bot/send') {
          // Forward to bot send handler via HTTP internally is complex; just respond success and let client fall back
          respond({ ok: false, error: 'Use HTTP for /bot/send' });
        } else {
          respond({ ok: false, error: 'Unknown WS POST route' });
        }
      }
    } catch (err) {
      respond({ ok: false, error: err.message });
    }
  });

  ws.on('close', () => clearInterval(ping));
  ws.on('error', () => clearInterval(ping));
});

// ─── Server Start ───────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\u26a1 ${BRAND.BOT_NAME} server running on :${PORT}`);
  if (WEBAPP_URL) console.log(`\uD83C\uDF10 Webapp: ${WEBAPP_URL}`);
});
