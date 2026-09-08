import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

# ════════════════════════════════════════════════════════════════
# 1. Update server/index.js
# ════════════════════════════════════════════════════════════════
server_index_path = 'server/index.js'
server_code = open(server_index_path, 'r', encoding='utf-8').read()

# Replace the routing section from AS_PROVIDERS down to before LINK PREVIEW STORE
as_routing_block = """// ════════════════════════════════════════════════════════════════
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
  k = k.toLowerCase().replace(/[^a-zA-Z0-9\\u0900-\\u097F]+/g, ' ').trim();
  const words = k.split(/\\s+/).filter(Boolean);
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
  const m = s.match(/^(Chapter\\s+\\d+\\s*-\\s*[^-]+)\\s*-\\s*(.+)$/i);
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
        const rest = s.slice(k.length).replace(/^[\\s\\-|:>]+/, '').trim();
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
    /\\bdpp\\b/, /\\bd\\.p\\.p\\b/, /\\bassignment\\b/, /\\bpractice sheet\\b/,
    /\\bpractice-sheet\\b/, /\\bworksheet\\b/, /\\bquestion paper\\b/,
    /\\btest paper\\b/, /\\bhomework\\b/, /\\bh\\.w\\b/, /\\bh\\/w\\b/,
    /\\bquestion practice\\b/, /\\bdaily practice\\b/, /\\bexercise\\b/
  ];
  return dppPatterns.some(p => p.test(t));
}

function isDppVideoItem(rawTitle) {
  const t = String(rawTitle || '').toLowerCase();
  const dppPatterns = [
    /\\bdpp\\b/, /\\bd\\.p\\.p\\b/, /\\bdiscussion\\b/, /\\bsolution\\b/,
    /\\bexercise solution\\b/, /\\bncert solution\\b/, /\\btest solution\\b/,
    /\\bhomework discussion\\b/, /\\bquestion practice\\b/, /\\bdpp solution\\b/,
    /\\bproblem discussion\\b/
  ];
  return dppPatterns.some(p => p.test(t));
}

function lectureSortKey(item) {
  const name = item.name || '';
  const m = name.match(/\\b(?:L|Lecture|Class|Part)[-\\s]*0*(\\d+)\\b/i);
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
        return {
          _id: sId,
          id: sId,
          name: name,
          title: name,
          slug: s.slug || sId,
          image: img,
          previewImage: { baseUrl: img, key: '' }
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
"""

# Match from AS_PROVIDERS start down to before LINK PREVIEW STORE
pattern = re.compile(r'const AS_PROVIDERS = \{.*?app\.get\(\'/api/teacher/:teacherId\'.*?res\.status\(500\)\.json\(\{ error: err\.message \}\);\s*\}\s*\}\);\n', re.DOTALL)
if pattern.search(server_code):
  new_server_code = pattern.sub(as_routing_block + '\n', server_code)
  open(server_index_path, 'w', encoding='utf-8').write(new_server_code)
  print('Updated server/index.js routing section cleanly!')
else:
  # Fallback: search for AS_PROVIDERS to LINK PREVIEW STORE
  start_idx = server_code.find('const AS_PROVIDERS = {')
  end_marker = '// ════════════════════════════════════════════════════════════════\n// LINK PREVIEW STORE'
  end_idx = server_code.find(end_marker)
  if start_idx != -1 and end_idx != -1:
    new_server_code = server_code[:start_idx] + as_routing_block + '\n\n' + server_code[end_idx:]
    open(server_index_path, 'w', encoding='utf-8').write(new_server_code)
    print('Updated server/index.js routing section (fallback slice)!')
  else:
    print('Error: Could not locate replacement range in server/index.js')

print('Step 1 complete.')
