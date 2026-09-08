require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

// â”€â”€â”€ Environment & Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BOT_TOKEN = process.env.BOT_TOKEN;
const PW_USER_ID = process.env.PW_USER_ID || '6a429c85c07e44cc78e146e7';
const {
  TG_API_ID,
  TG_API_HASH,
  SESSION_STRING,
  BACKUP_CHANNEL_ID,
  DUMP_CHANNEL_ID,
} = require('./config');
const DELIVERY_BOT = 'AS_MultiverseRoBot';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ucqvtdhqjracucevkqcp.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjcXZ0ZGhxanJhY3VjZXZrcWNwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE1NzAzMywiZXhwIjoyMTAyNzMzMDMzfQ.MPc0XFtj5qTBdEh19b4cJnfU8kY8ItQoc_V4G0v7Jx0';

const INDEX_FILE = path.join(__dirname, 'lecture_index.json');
let lectureIndex = new Map();
let isDumpRunning = false;
let isDumpCancelled = false;

// â”€â”€â”€ API Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MADX_BASE = 'https://core.asmultiverse.app/api/v1/pw';
const CONTENT_BASE = 'https://proxy.streamvideo.co.in/fetch/api.penpencil.co/v2';

const CONTENT_HEADERS = {
  'accept': 'application/json',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
  'client-id': '5eb393ee95fab7468a79d189',
  'client-type': 'WEB',
  'client-version': '2.2.7',
  'origin': 'https://pwthor.live',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'randomid': crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)),
};

function getMadxHeaders() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const encodedTs = Buffer.from(ts).toString('base64');
  const secretKey = process.env.MADX_SECRET_KEY || '1mBD4OQnsBMBaN6oISWwTmryX1lHjkW9XLZhsirCOT0=';
  const signature = crypto.createHmac('sha256', Buffer.from(secretKey, 'base64')).update(ts).digest('base64');

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

async function madxGet(pathUrl) {
  const res = await fetch(`${MADX_BASE}${pathUrl}`, { headers: getMadxHeaders() });
  if (!res.ok) throw new Error(`MadX ${res.status}`);
  return res.json();
}

async function contentGet(pathUrl) {
  const res = await fetch(`${CONTENT_BASE}${pathUrl}`, { headers: CONTENT_HEADERS });
  if (!res.ok) throw new Error(`Content API ${res.status}`);
  return res.json();
}

async function supabaseRequest(endpoint, method = 'GET', body = null) {
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    if (!res.ok) return null;
    if (res.status === 204) return true;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// â”€â”€â”€ Index Storage Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function loadLocalIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (Array.isArray(raw)) {
        raw.forEach(item => {
          if (item && item.key) lectureIndex.set(item.key, item);
        });
      }
    }
  } catch (e) {
    console.warn('[Dumper] Error loading local index file:', e.message);
  }
}

function saveIndexRecord(key, data) {
  lectureIndex.set(key, data);
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(Array.from(lectureIndex.values()), null, 2));
  } catch (_) {}
  supabaseRequest('lecture_index?on_conflict=key', 'POST', data);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// â”€â”€â”€ Userbot Client Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const apiId = TG_API_ID;
const apiHash = TG_API_HASH;
const stringSession = new StringSession(SESSION_STRING);
let userbot = null;

function getUserbotClient(existingUserbot = null) {
  if (existingUserbot) return existingUserbot;
  if (!userbot) {
    userbot = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 10,
      autoReconnect: true,
    });
  }
  return userbot;
}

// â”€â”€â”€ Single Item Remote Fetcher with Auto-Cooldown & Retries â”€â”€â”€
async function fetchAndDumpSingleItem(activeClient, startParam, metadata, onProgress = null) {
  if (lectureIndex.has(startParam)) {
    return { status: 'skipped', reason: 'already_indexed' };
  }

  let attempts = 0;
  const maxAttempts = 6;
  while (attempts < maxAttempts) {
    if (isDumpCancelled) return { status: 'cancelled' };
    attempts++;
    try {
      const mediaMsg = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          activeClient.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
          reject(new Error('Timeout waiting for remote bot'));
        }, 50000);

        const handler = async (event) => {
          const msg = event.message;
          if (msg.media) {
            clearTimeout(timeout);
            activeClient.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
            resolve(msg);
          } else if (msg.text) {
            const txt = msg.text;
            const waitMatch = txt.match(/(?:wait\s*|wait\s+for\s*)(\d+)\s*(?:sec|second|seconds|s\b)/i);
            if (waitMatch || txt.toLowerCase().includes('please wait') || txt.toLowerCase().includes('wait')) {
              clearTimeout(timeout);
              activeClient.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
              const waitSec = waitMatch ? parseInt(waitMatch[1]) : 5;
              const cdErr = new Error(`FloodWait: wait ${waitSec}s`);
              cdErr.isWait = true;
              cdErr.waitSec = waitSec;
              return reject(cdErr);
            }
            if (txt.toLowerCase().includes('error') || txt.includes('not found')) {
              clearTimeout(timeout);
              activeClient.removeEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
              reject(new Error('Remote bot returned not found'));
            }
          }
        };

        activeClient.addEventHandler(handler, new NewMessage({ fromUsers: [DELIVERY_BOT] }));
        activeClient.sendMessage(DELIVERY_BOT, { message: `/start ${startParam}` }).catch(reject);
      });

      // Format caption with tag
      const tag = `#PW_${startParam}`;
      const dumpCaption = `ðŸ“¹ *Title:* ${metadata.name || 'Lecture'}\n` +
                          `ðŸ¡ *Subject:* ${metadata.subject || ''}\n` +
                          `ðŸš© *Chapter:* ${metadata.topic || ''}\n` +
                          (metadata.quality ? `ðŸŽ¬ *Quality:* ${metadata.quality}p\n` : '') +
                          `\n${tag}\n\nâš¡ *Archived by \*`;

      // Post to Primary Dump Channel
      const dumpMsg = await activeClient.sendMessage(DUMP_CHANNEL_ID, {
        message: dumpCaption,
        file: mediaMsg.media
      });

      // Mirror to Secondary Backup Channel (Async Zero Delay)
      if (BACKUP_CHANNEL_ID) {
        activeClient.sendMessage(BACKUP_CHANNEL_ID, {
          message: dumpCaption,
          file: mediaMsg.media
        }).catch(err => console.warn('  âš ï¸ Backup channel mirror error:', err.message));
      }

      // Cleanup userbot chat with remote bot
      try {
        await activeClient.invoke(new Api.messages.DeleteHistory({
          peer: DELIVERY_BOT,
          maxId: 0,
          justClear: true,
          revoke: true
        }));
      } catch (_) {}

      // Save index
      saveIndexRecord(startParam, {
        key: startParam,
        batch_id: metadata.batchId,
        content_id: metadata.contentId,
        quality: metadata.quality || '',
        channel_id: String(DUMP_CHANNEL_ID),
        message_id: dumpMsg.id,
        file_type: metadata.type || 'video',
        title: metadata.name || '',
        created_at: new Date().toISOString()
      });

      console.log(`  âœ… [DUMPED] Msg #${dumpMsg.id} | ${metadata.name} (${metadata.quality || 'PDF'})`);
      return { status: 'dumped', message_id: dumpMsg.id };

    } catch (err) {
      if (err.isWait) {
        console.log(`  â³ [FloodWait Detected] Sleeping for ${err.waitSec + 3} seconds...`);
        if (onProgress) onProgress({ isWait: true, waitSec: err.waitSec });
        await sleep((err.waitSec + 3) * 1000);
      } else {
        console.warn(`  âš ï¸ Attempt ${attempts}/${maxAttempts} failed (${startParam}):`, err.message);
        if (err.message.includes('not found')) return { status: 'error', reason: 'not_found' };
        await sleep(3500 * attempts); // Progressive backoff
      }
    }
  }

  return { status: 'failed', reason: 'max_retries_exceeded' };
}

// â”€â”€â”€ Main Comprehensive Multi-Page Crawler & Dumper Engine â”€â”€â”€â”€â”€
async function runBatchDump(options = {}, onProgress = null) {
  if (isDumpRunning) {
    throw new Error('A batch dump process is already currently running!');
  }
  isDumpRunning = true;
  isDumpCancelled = false;

  const startTime = Date.now();
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`🚀 ${(process.env.BOT_NAME || 'STUDY HUB').toUpperCase()} — AUTONOMOUS BATCH DUMPER & INDEXER 🚀`);
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`ðŸ“¦ Primary Storage Channel: ${DUMP_CHANNEL_ID}`);
  console.log(`ðŸ›¡ï¸ Secondary Backup Channel: ${BACKUP_CHANNEL_ID}`);
  console.log(`ðŸ‘¤ User ID: ${PW_USER_ID}\n`);

  loadLocalIndex();
  console.log(`ðŸ“ Local Index Loaded: ${lectureIndex.size} items already archived.\n`);

  const activeClient = getUserbotClient(options.userbot);
  if (!activeClient.connected) {
    console.log('ðŸ” Connecting GramJS Userbot...');
    await activeClient.connect();
    console.log('âœ… Userbot Connected Successfully!\n');
  }

  // 1. Fetch ALL enrolled batches across all pages
  console.log('ðŸ“¡ Fetching all enrolled batches (Paging all pages)...');
  let batches = [];
  let batchPage = 1;
  while (!isDumpCancelled) {
    try {
      const batchesRes = await madxGet(`/mybatches/${PW_USER_ID}/details?page=${batchPage}&limit=50`);
      const bList = batchesRes.data || [];
      if (!bList.length) break;
      batches.push(...bList);
      if (bList.length < 50) break;
      batchPage++;
    } catch (e) {
      console.warn(`  âš ï¸ Batch fetch page ${batchPage} error:`, e.message);
      break;
    }
  }
  console.log(`ðŸ“š Found ${batches.length} total enrolled batches across all pages.\n`);

  // â”€â”€â”€ Priority Sorting: Arjuna JEE 2.0 2027 first, then all 2027 batches, then by year â”€â”€â”€
  batches.sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();

    function getPriority(name) {
      // 1. TOP #1: Arjuna JEE 2.0 2027 (and Arjuna JEE 2.0)
      if (name.includes('arjuna') && name.includes('jee') && (name.includes('2.0') || name.includes('2')) && name.includes('2027')) return 1000;
      if (name.includes('arjuna') && name.includes('jee') && (name.includes('2.0') || name.includes('2'))) return 900;
      if (name.includes('arjuna') && name.includes('jee') && name.includes('2027')) return 850;
      
      // 2. All other 2027 Batches (Highest priority year)
      if (name.includes('2027')) return 800;

      // 3. 2026 Batches
      if (name.includes('2026')) return 700;

      // 4. 2025 Batches
      if (name.includes('2025')) return 600;

      // 5. 2024 Batches
      if (name.includes('2024')) return 500;

      // 6. Other remaining batches
      return 100;
    }

    const pA = getPriority(nameA);
    const pB = getPriority(nameB);

    if (pA !== pB) return pB - pA;
    return nameA.localeCompare(nameB);
  });

  console.log('ðŸŽ¯ [Priority Queue Applied] Top 5 batches to be dumped first:');
  batches.slice(0, 5).forEach((b, i) => console.log(`   ${i + 1}. â­ ${b.name} (${b._id})`));
  console.log('');

  let totalDumped = 0;
  let totalSkipped = 0;
  let failedItems = [];

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    if (isDumpCancelled) break;
    const batch = batches[bIdx];
    console.log(`\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);
    console.log(`[Batch ${bIdx + 1}/${batches.length}] ðŸ“š ${batch.name} (ID: ${batch._id})`);
    console.log(`â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);

    if (onProgress) {
      onProgress({
        currentBatch: bIdx + 1,
        totalBatches: batches.length,
        batchName: batch.name,
        totalDumped,
        totalSkipped,
        totalFailed: failedItems.length,
        totalArchiveSize: lectureIndex.size
      });
    }

    let batchDetails;
    try {
      batchDetails = await madxGet(`/batches/${batch._id}/details`);
    } catch (e) {
      console.warn(`  âŒ Failed to fetch batch details: ${e.message}`);
      continue;
    }

    const subjects = batchDetails.data?.subjects || [];
    for (let sIdx = 0; sIdx < subjects.length; sIdx++) {
      if (isDumpCancelled) break;
      const subject = subjects[sIdx];

      // 2. Fetch ALL topics/chapters with pagination
      let topics = [];
      let topicPage = 1;
      while (!isDumpCancelled) {
        try {
          const topicsRes = await madxGet(`/batches/${batch._id}/subject/${subject._id}/topics?page=${topicPage}`);
          const tList = topicsRes.data || [];
          if (!tList.length) break;
          topics.push(...tList);
          if (tList.length < 20) break;
          topicPage++;
        } catch (e) {
          console.warn(`    âš ï¸ Topic page ${topicPage} error:`, e.message);
          break;
        }
      }

      console.log(`  ðŸ“‚ [Subject ${sIdx + 1}/${subjects.length}] ${subject.subject} â€” Found ${topics.length} Chapters`);

      for (let tIdx = 0; tIdx < topics.length; tIdx++) {
        if (isDumpCancelled) break;
        const topic = topics[tIdx];

        // 3. Dump all 4 Content Types: videos, notes, DppNotes, DppVideos
        const contentTypes = ['videos', 'notes', 'DppNotes', 'DppVideos'];
        for (const cType of contentTypes) {
          if (isDumpCancelled) break;
          let page = 1;

          while (!isDumpCancelled) {
            let contentsRes;
            try {
              contentsRes = await contentGet(
                `/batches/${batch._id}/subject/${subject.slug}/contents?tag=${topic.slug}&contentType=${cType}&page=${page}`
              );
            } catch (e) {
              console.warn(`      âš ï¸ Content fetch error (${cType} page ${page}):`, e.message);
              break;
            }

            const items = contentsRes.data || [];
            if (!items.length) break;

            for (const item of items) {
              if (isDumpCancelled) break;
              if (cType === 'videos' || cType === 'DppVideos') {
                const vd = item.videoDetails || {};
                const contentId = vd._id || item._id;
                const lectureName = vd.name || item.topic || 'Lecture';
                if (!contentId) continue;

                // Loop through standard qualities: 720p, 480p, 360p, 240p
                const qualities = ['720', '480', '360', '240'];
                for (const q of qualities) {
                  if (isDumpCancelled) break;
                  const startParam = `${batch._id}_${contentId}_${q}`;
                  const meta = {
                    batchId: batch._id,
                    batchName: batch.name,
                    contentId,
                    quality: q,
                    type: 'video',
                    name: lectureName,
                    subject: subject.subject,
                    topic: topic.name
                  };

                  const res = await fetchAndDumpSingleItem(activeClient, startParam, meta, onProgress);
                  if (res.status === 'dumped') {
                    totalDumped++;
                    if (onProgress) {
                      onProgress({
                        currentBatch: bIdx + 1,
                        totalBatches: batches.length,
                        batchName: batch.name,
                        subjectName: subject.subject,
                        topicName: topic.name,
                        lastItemName: lectureName,
                        totalDumped,
                        totalSkipped,
                        totalFailed: failedItems.length,
                        totalArchiveSize: lectureIndex.size
                      });
                    }
                    await sleep(3000); // Safe cooldown
                  } else if (res.status === 'skipped') {
                    totalSkipped++;
                  } else if (res.status === 'failed') {
                    failedItems.push({ startParam, meta, reason: res.reason || 'timeout' });
                  }
                }
              } else {
                // Notes & DPP Documents
                const hw = item.homeworkIds?.[0];
                const att = hw?.attachmentIds?.[0] || item.attachmentIds?.[0];
                const contentId = att?._id || hw?._id || item._id;
                const docName = hw?.topic || att?.name || item.topic || 'Notes';
                if (!contentId) continue;

                const startParam = `${batch._id}_${contentId}`;
                const meta = {
                  batchId: batch._id,
                  batchName: batch.name,
                  contentId,
                  type: 'document',
                  name: docName,
                  subject: subject.subject,
                  topic: topic.name
                };

                const res = await fetchAndDumpSingleItem(activeClient, startParam, meta, onProgress);
                if (res.status === 'dumped') {
                  totalDumped++;
                  if (onProgress) {
                    onProgress({
                      currentBatch: bIdx + 1,
                      totalBatches: batches.length,
                      batchName: batch.name,
                      subjectName: subject.subject,
                      topicName: topic.name,
                      lastItemName: docName,
                      totalDumped,
                      totalSkipped,
                      totalFailed: failedItems.length,
                      totalArchiveSize: lectureIndex.size
                    });
                  }
                  await sleep(2500);
                } else if (res.status === 'skipped') {
                  totalSkipped++;
                } else if (res.status === 'failed') {
                  failedItems.push({ startParam, meta, reason: res.reason || 'timeout' });
                }
              }
            }

            if (items.length < 20) {
              break; // Last page reached
            } else {
              page++;
            }
          }
        }
      }
    }
  }

  // â”€â”€â”€ Secondary Retry Pass on any Failed Items (Zero Miss Guarantee) â”€â”€â”€
  if (failedItems.length > 0 && !isDumpCancelled) {
    console.log(`\nðŸ”„ [Secondary Retry Pass] Attempting retry on ${failedItems.length} failed items...`);
    await sleep(10000); // 10s rest before retry pass

    const remainingFailed = [];
    for (const failed of failedItems) {
      if (isDumpCancelled) break;
      const res = await fetchAndDumpSingleItem(activeClient, failed.startParam, failed.meta, onProgress);
      if (res.status === 'dumped') {
        totalDumped++;
        console.log(`  ðŸŽ‰ [Retry Succeeded!] ${failed.meta.name}`);
        await sleep(3000);
      } else {
        remainingFailed.push(failed);
      }
    }
    failedItems = remainingFailed;
  }

  isDumpRunning = false;
  const durationMs = Date.now() - startTime;
  const durationMins = Math.floor(durationMs / 60000);
  const durationSecs = Math.floor((durationMs % 60000) / 1000);

  const summary = {
    totalDumped,
    totalSkipped,
    totalFailed: failedItems.length,
    failedItems: failedItems.slice(0, 5),
    totalArchiveSize: lectureIndex.size,
    isCancelled: isDumpCancelled,
    durationStr: `${durationMins}m ${durationSecs}s`
  };

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`ðŸŽ‰ BATCH DUMP COMPLETED!`);
  console.log(`ðŸ“¥ Total New Dumped: ${totalDumped}`);
  console.log(`â­ï¸ Total Skipped: ${totalSkipped}`);
  console.log(`âŒ Total Failed: ${failedItems.length}`);
  console.log(`ðŸ“Š Archive Size: ${lectureIndex.size} items`);
  console.log(`â±ï¸ Duration: ${summary.durationStr}`);
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  return summary;
}

function cancelDump() {
  if (isDumpRunning) {
    isDumpCancelled = true;
    return true;
  }
  return false;
}

function getDumpStatus() {
  return {
    isRunning: isDumpRunning,
    archiveSize: lectureIndex.size
  };
}

// Standalone CLI execution
if (require.main === module) {
  runBatchDump().then(() => {
    if (userbot) userbot.disconnect();
    process.exit(0);
  }).catch(err => {
    console.error('Fatal Dumper Error:', err);
    process.exit(1);
  });
}

module.exports = {
  runBatchDump,
  cancelDump,
  getDumpStatus,
  lectureIndex
};

