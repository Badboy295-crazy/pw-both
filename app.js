/* ════════════════════════════════════════════════════════════════
   Telegram Mini App (Claude Editorial Edition)
   State Machine Navigation • Dual API Architecture • Live Sync
   ════════════════════════════════════════════════════════════════ */

// ─── Global Configuration ──────────────────────────────────────
const CONFIG = {
  // Backend server URL for Batches, Subjects, and Topics (Render Backend)
  SERVER_URL: '', // Auto-detected from window.location (set per deployment via APP_CONFIG)

  // Direct content API fallback (a.pimaxer.in)
  CONTENT_API: 'https://a.pimaxer.in/v2',

  // Content API headers (matching pimaxer curl)
  CONTENT_HEADERS: {
    'accept': '*/*',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
    'origin': 'https://pw.learntopper.in',
    'referer': 'https://pw.learntopper.in/',
  },

  // Content tab metadata
  TABS: [
    { type: 'Videos',    label: 'Lectures', icon: '🎬' },
    { type: 'Notes',     label: 'Notes',    icon: '📄' },
    { type: 'DppNotes',  label: 'DPP',      icon: 'ðŸ“' },
    { type: 'DppVideos', label: 'DPP Vid',  icon: '📹' },
  ],
};

// ════════════════════════════════════════════════════════════════
// LAYER 1: CLIENT-SIDE SECURITY SHIELD & DEVTOOLS DETERRENT
// ════════════════════════════════════════════════════════════════
(function initClientSecurity() {
  // 1. Disable Right-Click Context Menu
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
  }, { capture: true });

  // 2. Intercept and Block Inspection Shortcuts
  document.addEventListener('keydown', (e) => {
    // Block F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      return false;
    }
    // Block Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) {
      e.preventDefault();
      return false;
    }
    // Block Ctrl+U (View Source) & Ctrl+S (Save Page)
    if (e.ctrlKey && ['u', 'U', 's', 'S'].includes(e.key)) {
      e.preventDefault();
      return false;
    }
    // Mac shortcuts (Cmd+Option+I, Cmd+Option+J, Cmd+Option+C, Cmd+U)
    if (e.metaKey && e.altKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) {
      e.preventDefault();
      return false;
    }
    if (e.metaKey && ['u', 'U', 's', 'S'].includes(e.key)) {
      e.preventDefault();
      return false;
    }
  }, { capture: true });

  // 3. Purge Console in Production
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const noop = () => {};
    window.console.log = noop;
    window.console.info = noop;
    window.console.warn = noop;
    window.console.debug = noop;
    window.console.table = noop;
  }

  // 4. Anti-Debugger Trap (Freezes inspector if forcefully opened)
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    setInterval(() => {
      const start = performance.now();
      try {
        (function() { return false; })['constructor']('debugger')();
        if (performance.now() - start > 100) {
          document.body.innerHTML = '';
          window.location.reload();
        }
      } catch (e) {}
    }, 2500);
  }
})();

// ─── Reactive Application State ────────────────────────────────
const state = {
  tg: null,
  chatId: null,

  view: 'platforms', // 'platforms' | 'home' | 'batch' | 'subject' | 'content'
  provider: 'pw', // 'pw' | 'nexttopper' | 'missionjeet' | 'vidyakul' | 'apnacollege' | 'sketchbook'
  providerEpoch: 0,

  // Loaded data
  batches: [],
  batchPage: 1,
  batchHasMore: true,
  batchLoading: false,

  // Selected items
  batch: null,     // { _id, name, slug, class, previewImage }
  subject: null,   // { _id, subject, slug, imageId, teacherIds, lectureCount, tagCount }
  topic: null,     // { _id, name, slug, videos, notes, exercises, lectureVideos }

  // Content state & pagination
  activeTab: 'Videos',
  content: { Videos: [], Notes: [], DppNotes: [], DppVideos: [] },
  contentPage: { Videos: 1, Notes: 1, DppNotes: 1, DppVideos: 1 },
  contentHasMore: { Videos: false, Notes: false, DppNotes: false, DppVideos: false },
  contentLoading: false,

  // Search
  searchQuery: '',
  searchTimer: null,
  isSearching: false,

  // Favourites
  homeTab: 'all', // 'all' | 'fav'
  favBatches: JSON.parse(localStorage.getItem('pw_fav_batches') || '{}'),
  favourites: new Set(JSON.parse(localStorage.getItem('pw_favs') || '[]')),

  // Data registries for clean, quote-safe ID lookups
  loadedBatches: {},
  loadedSubjects: {},
  loadedTopics: {},
  loadedPayloads: {},

  // Retry storage
  lastSentItem: null,
  lastSentType: null,
};

// ════════════════════════════════════════════════════════════════
// LAYER 1: TELEGRAM HMAC REQUEST SIGNING & ANTISPRAY INTERCEPTOR
// ════════════════════════════════════════════════════════════════
const _nativeFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const initData = getTelegramInitData();
  if (initData) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      if (!options.headers.has('X-Telegram-Init-Data')) {
        options.headers.set('X-Telegram-Init-Data', initData);
      }
    } else {
      if (!options.headers['X-Telegram-Init-Data']) {
        options.headers['X-Telegram-Init-Data'] = initData;
      }
    }
  }
  return _nativeFetch(url, options);
};

// ════════════════════════════════════════════════════════════════
// LAYER 1.5: ANTI-INSPECT & DEVTOOLS BLOCKED
// ════════════════════════════════════════════════════════════════
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
    (e.ctrlKey && ['U', 'u', 'S', 's'].includes(e.key))
  ) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, { capture: true });

// ─── Dynamic Telegram InitData & Identity Resolver ─────────────
function getTelegramInitData() {
  // 1. Native Telegram WebApp SDK
  if (window.Telegram?.WebApp?.initData && window.Telegram.WebApp.initData.length > 0) {
    const raw = window.Telegram.WebApp.initData;
    try { localStorage.setItem('rx_tg_init_data', raw); } catch(e) {}
    return raw;
  }
  // 2. Read from URL Hash (#tgWebAppData=...)
  if (typeof window !== 'undefined' && window.location && window.location.hash) {
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const tgData = hashParams.get('tgWebAppData');
    if (tgData) {
      try { localStorage.setItem('rx_tg_init_data', tgData); } catch(e) {}
      return tgData;
    }
  }
  // 3. Read from URL Search (?tgWebAppData=...)
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const searchParams = new URLSearchParams(window.location.search);
    const tgData = searchParams.get('tgWebAppData');
    if (tgData) {
      try { localStorage.setItem('rx_tg_init_data', tgData); } catch(e) {}
      return tgData;
    }
  }
  // 4. Stored persistent identity (retained in Chrome / installed PWA)
  try {
    const stored = localStorage.getItem('rx_tg_init_data');
    if (stored) return stored;
  } catch(e) {}
  return '';
}

function parseUserFromInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (userStr) return JSON.parse(userStr);
  } catch(e) {}
  return null;
}

// ─── Dynamic Telegram User ID Resolver ─────────────────────────
function getTelegramUserId() {
  if (state.chatId) return state.chatId;
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user || parseUserFromInitData(getTelegramInitData());
  return user?.id || null;
}

// ─── Dynamic Server Base URL Resolver ──────────────────────────
function getServerBaseUrl() {
  if (typeof window !== 'undefined' && window.location) {
    // 1. Check Query Param or Hash for backend URL
    const searchParams = new URLSearchParams(window.location.search);
    const bQuery = searchParams.get('backend');
    if (bQuery && bQuery.startsWith('http')) {
      const clean = bQuery.replace(/\/$/, '');
      try { localStorage.setItem('rx_backend_url', clean); } catch(e) {}
      return clean;
    }
    if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const bHash = hashParams.get('backend');
      if (bHash && bHash.startsWith('http')) {
        const clean = bHash.replace(/\/$/, '');
        try { localStorage.setItem('rx_backend_url', clean); } catch(e) {}
        return clean;
      }
    }
    // 2. Check localStorage (saved from previous launch)
    try {
      const saved = localStorage.getItem('rx_backend_url');
      if (saved && saved.startsWith('http')) {
        return saved.replace(/\/$/, '');
      }
    } catch(e) {}
  }

  // 3. Check CONFIG.SERVER_URL
  if (CONFIG.SERVER_URL && CONFIG.SERVER_URL.startsWith('http')) {
    return CONFIG.SERVER_URL.replace(/\/$/, '');
  }

  // 4. Fallback to origin if not netlify/telegram/file
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    if (origin && origin.startsWith('http') && !origin.includes('telegram.org') && !origin.includes('file://')) {
      return origin.replace(/\/$/, '');
    }
  }
  return '';
}

// ════════════════════════════════════════════════════════════════
// LAYER 2: PERSISTENT WEBSOCKET TUNNEL (wss://) & ROLLING TOKEN SYSTEM
// Eliminates all Fetch/XHR network requests (0 items in Network tab)
// ════════════════════════════════════════════════════════════════
const WSBridge = {
  socket: null,
  connected: false,
  authenticated: false,
  connecting: false,
  token: null,
  pending: new Map(),
  reconnectAttempts: 0,
  pingInterval: null,
  readyPromise: null,
  resolveReady: null,

  init() {
    this.connect();
  },

  getWsUrl() {
    const serverBase = getServerBaseUrl();
    if (serverBase && serverBase.startsWith('http')) {
      const url = new URL(serverBase);
      const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${url.host}/ws`;
    }
    if (typeof window !== 'undefined' && window.location) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      if (host && !host.includes('telegram.org') && window.location.protocol !== 'file:') {
        return `${proto}//${host}/ws`;
      }
    }
    return '';
  },

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const wsUrl = this.getWsUrl();
    if (!wsUrl) return;

    this.connecting = true;
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.resolveReady = resolve;
      });
    }

    try {
      this.socket = new WebSocket(wsUrl);
    } catch (e) {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectAttempts = 0;

      // Send initial Handshake with Telegram signature
      const initData = getTelegramInitData();
      try {
        this.socket.send(JSON.stringify({
          action: 'handshake',
          initData: initData
        }));
      } catch (err) {
        console.warn('WS handshake send error:', err);
      }

      // Ping keepalive every 25 seconds
      clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          try {
            this.socket.send(JSON.stringify({ action: 'ping' }));
          } catch (e) {}
        }
      }, 25000);
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Handshake Ack
        if (msg.type === 'handshake_ack') {
          if (msg.success) {
            this.authenticated = true;
            this.token = msg.token;
            if (this.resolveReady) {
              this.resolveReady(true);
              this.resolveReady = null;
            }
          } else {
            console.warn('WS Handshake rejected:', msg.error);
          }
          return;
        }

        // Pong heartbeat
        if (msg.type === 'pong') return;

        // Dispatch response to waiting promise
        const reqId = msg.id;
        if (reqId && this.pending.has(reqId)) {
          const { resolve, reject, timer } = this.pending.get(reqId);
          clearTimeout(timer);
          this.pending.delete(reqId);

          if (msg.token) {
            this.token = msg.token; // Save fresh single-use next_token
          }

          if (msg.success) {
            resolve(msg.response);
          } else {
            reject(new Error(msg.error || 'WebSocket action failed'));
          }
        }
      } catch (err) {
        console.warn('WS parse error:', err);
      }
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.authenticated = false;
      this.connecting = false;
      this.readyPromise = null;
      this.resolveReady = null;
      clearInterval(this.pingInterval);
      this.rejectAllPending('WebSocket tunnel disconnected');
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.connected = false;
      this.authenticated = false;
      this.connecting = false;
    };
  },

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(8000, 1000 * Math.pow(1.5, this.reconnectAttempts));
    setTimeout(() => this.connect(), delay);
  },

  rejectAllPending(reason) {
    for (const [id, req] of this.pending.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  },

  isReady() {
    return this.connected && this.authenticated && Boolean(this.token);
  },

  async call(action, params = {}, timeoutMs = 25000) {
    if (!this.isReady() && this.connecting && this.readyPromise) {
      await Promise.race([
        this.readyPromise,
        new Promise(r => setTimeout(r, 2500))
      ]);
    }

    if (!this.isReady()) {
      throw new Error('WebSocket tunnel not connected');
    }

    return new Promise((resolve, reject) => {
      const reqId = `ws_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const currentToken = this.token;

      const timer = setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error(`WebSocket request timed out for action '${action}'`));
        }
      }, timeoutMs);

      this.pending.set(reqId, { resolve, reject, timer });

      try {
        this.socket.send(JSON.stringify({
          id: reqId,
          action: action,
          token: currentToken,
          params: params
        }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err);
      }
    });
  }
};

function parseApiRouteToWsAction(path) {
  try {
    const url = new URL(path, 'https://dummy.local');
    const pathname = url.pathname;
    const searchParams = url.searchParams;
    const provider = searchParams.get('provider') || state.provider || 'pw';

    // 1. /api/batches
    if (pathname === '/api/batches') {
      return {
        action: 'get_batches',
        params: {
          page: parseInt(searchParams.get('page') || '1', 10),
          limit: parseInt(searchParams.get('limit') || '20', 10),
          provider: provider
        }
      };
    }

    // 2. /api/batches/search
    if (pathname === '/api/batches/search') {
      return {
        action: 'search_batches',
        params: {
          query: searchParams.get('q') || '',
          provider: provider
        }
      };
    }

    // 3. /api/batch/:batch_id/details
    let m = pathname.match(/^\/api\/batch\/([^\/]+)\/details$/);
    if (m) {
      return {
        action: 'get_batch_details',
        params: {
          batch_id: decodeURIComponent(m[1]),
          provider: provider
        }
      };
    }

    // 4. /api/batch/:batch_id/subject/:subject_id/topics
    m = pathname.match(/^\/api\/batch\/([^\/]+)\/subject\/([^\/]+)\/topics$/);
    if (m) {
      return {
        action: 'get_topics',
        params: {
          batch_id: decodeURIComponent(m[1]),
          subject_id: decodeURIComponent(m[2]),
          provider: provider
        }
      };
    }

    // 5. /api/batch/:batch_id/subject/:subject_id/content/:content_id/details
    m = pathname.match(/^\/api\/batch\/([^\/]+)\/subject\/([^\/]+)\/content\/([^\/]+)\/details$/);
    if (m) {
      return {
        action: 'get_content_details',
        params: {
          batch_id: decodeURIComponent(m[1]),
          subject_id: decodeURIComponent(m[2]),
          content_id: decodeURIComponent(m[3]),
          provider: provider
        }
      };
    }

    // 6. /api/batch/:batch_id/subject/:subject_id/content
    m = pathname.match(/^\/api\/batch\/([^\/]+)\/subject\/([^\/]+)\/content$/);
    if (m) {
      return {
        action: 'get_content',
        params: {
          batch_id: decodeURIComponent(m[1]),
          subject_id: decodeURIComponent(m[2]),
          tag: searchParams.get('tag') || '',
          type: searchParams.get('type') || 'Videos',
          page: parseInt(searchParams.get('page') || '1', 10),
          provider: provider
        }
      };
    }

    // 7. /api/check-sub
    if (pathname === '/api/check-sub') {
      return {
        action: 'check_sub',
        params: {
          userId: searchParams.get('chatId') || searchParams.get('userId') || getTelegramUserId()
        }
      };
    }

    // 8. /api/user/vip-status
    if (pathname === '/api/user/vip-status') {
      return {
        action: 'get_vip_status',
        params: {
          user_id: searchParams.get('user_id') || getTelegramUserId()
        }
      };
    }
  } catch (e) {
    console.warn('parseApiRouteToWsAction error:', e);
  }
  return null;
}

// ─── Telegram WebApp Initialization ────────────────────────────
function initTelegram() {
  WSBridge.init();
  const initData = getTelegramInitData();
  const parsedUser = parseUserFromInitData(initData);

  if (window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp;
    state.tg = tg;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#08080a');
      tg.setBackgroundColor('#08080a');
    } catch(e) {}

    // Hardware/Platform back button handling
    try {
      tg.BackButton.onClick(() => {
        const prev = { home: 'platforms', batch: 'home', subject: 'batch', content: 'subject' };
        if (prev[state.view]) navigate(prev[state.view]);
      });
    } catch(e) {}
  }

  const user = window.Telegram?.WebApp?.initDataUnsafe?.user || parsedUser;
  if (user) {
    state.chatId = user.id;
    const avatar = document.getElementById('user-avatar');
    const name = document.getElementById('user-name');
    if (avatar) avatar.textContent = user.first_name?.[0] || '👤';
    if (name) name.textContent = user.first_name || 'Student';

    const avatarPlat = document.getElementById('user-avatar-platforms');
    const namePlat = document.getElementById('user-name-platforms');
    if (avatarPlat) avatarPlat.textContent = user.first_name?.[0] || '👤';
    if (namePlat) namePlat.textContent = user.first_name || 'Student';
  }

  // Clean URL hash if credentials were received via redirection
  if (typeof window !== 'undefined' && window.location && window.location.hash && (window.location.hash.includes('tgWebAppData') || window.location.hash.includes('backend'))) {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch(e) {}
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 2: TELEGRAM-ONLY ACCESS GATEWAY (DIRECT BROWSER LOCK)
// ════════════════════════════════════════════════════════════════
function verifyTelegramAccess() {
  const initData = getTelegramInitData();
  const hasInitData = Boolean(initData && initData.length > 0);
  const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  if (!hasInitData && !isLocalhost) {
    const guardEl = document.getElementById('telegram-only-guard');
    const appEl = document.getElementById('app');
    if (guardEl) guardEl.classList.remove('hidden');
    if (appEl) appEl.style.display = 'none';
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// LAYER 3: IN-APP FORCESUB COMMUNITY VERIFICATION GATEWAY
// ════════════════════════════════════════════════════════════════
async function checkInAppForceSub(manualVerify = false) {
  const userId = state.chatId || window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  // If testing outside Telegram or local dev without user ID, pass through
  if (!userId) {
    if (isLocalhost) return true;
    return true;
  }

  try {
    const data = await serverGet(userId ? `/api/check-sub?chatId=${encodeURIComponent(userId)}` : `/api/check-sub`);
    if (!data) return true;

    const guardEl = document.getElementById('forcesub-guard');
    const maintGuardEl = document.getElementById('maintenance-guard');
    const appEl = document.getElementById('app');
    const msgEl = document.getElementById('forcesub-message');
    const subtextEl = document.getElementById('forcesub-subtext');
    const channelBtn = document.getElementById('forcesub-channel-btn');
    const groupBtn = document.getElementById('forcesub-group-btn');

    // 1. Full Mini App Off / Maintenance Mode Lock
    if (data.maintenance && !data.is_admin) {
      if (appEl) appEl.style.display = 'none';
      if (guardEl) guardEl.classList.add('hidden');
      if (maintGuardEl) {
        maintGuardEl.classList.remove('hidden');
        const maintMsgEl = document.getElementById('maintenance-message');
        if (maintMsgEl && data.maintenance_msg) {
          maintMsgEl.textContent = data.maintenance_msg;
        }
        const maintChannelLink = document.getElementById('maintenance-channel-link');
        if (maintChannelLink && data.channel_link) {
          maintChannelLink.href = data.channel_link;
        }
      }
      return false;
    } else {
      if (maintGuardEl) maintGuardEl.classList.add('hidden');
    }

    if (data.subscribed) {
      if (guardEl) guardEl.classList.add('hidden');
      if (appEl) appEl.style.display = '';
      if (manualVerify) {
        haptic('success');
        showToast(`✅ Verification Successful! Welcome to ${window.APP_CONFIG?.BOT_NAME || 'Study Hub'}.`);
      }
      return true;
    }

    // Access Restricted!
    if (appEl) appEl.style.display = 'none';
    if (guardEl) guardEl.classList.remove('hidden');

    if (channelBtn && data.channel_link) channelBtn.href = data.channel_link;
    if (groupBtn && data.group_link) groupBtn.href = data.group_link;

    const channelMissing = !data.channel_ok;
    const groupMissing = !data.group_ok;

    if (channelMissing && groupMissing) {
      if (msgEl) {
        msgEl.innerHTML = 'To access study materials, video lectures, notes &amp; DPPs, you must join both our <strong>Official Channel</strong> and <strong>Discussion Group</strong>.';
      }
      if (subtextEl) subtextEl.textContent = '1. Join Channel  •  2. Join Group  •  Tap Verify';
      if (channelBtn) channelBtn.style.display = 'flex';
      if (groupBtn) groupBtn.style.display = 'flex';
    } else if (channelMissing) {
      if (msgEl) {
        msgEl.innerHTML = 'You have joined the group, but you have <strong>NOT joined our Official Channel</strong> yet!';
      }
      if (subtextEl) subtextEl.textContent = 'Tap below to join our Official Channel, then click Verify:';
      if (channelBtn) channelBtn.style.display = 'flex';
      if (groupBtn) groupBtn.style.display = 'none';
    } else if (groupMissing) {
      if (msgEl) {
        msgEl.innerHTML = 'You have joined the channel, but you have <strong>NOT joined our Discussion Group</strong> yet!';
      }
      if (subtextEl) subtextEl.textContent = 'Tap below to join our Discussion Group, then click Verify:';
      if (channelBtn) channelBtn.style.display = 'none';
      if (groupBtn) groupBtn.style.display = 'flex';
    }

    if (manualVerify) {
      haptic('error');
      showToast('🔒 Verification pending: Please join the required community above first!');
    }
    return false;
  } catch (err) {
    console.warn('ForceSub check failed:', err);
    return true;
  }
}

window.verifySubFromMiniApp = async function() {
  const btn = document.getElementById('forcesub-verify-btn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>â³ Verifying Membership...</span>';
  }
  try {
    const ok = await checkInAppForceSub(true);
    if (ok) {
      if (!state.batches || state.batches.length === 0) {
        loadBatches(true);
      }
      updateTgBackButton();
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml || '<span>🔄 Joined! Verify Now</span>';
    }
  }
};

function triggerMaintenanceScreen(msg) {
  const appEl = document.getElementById('app');
  const guardEl = document.getElementById('forcesub-guard');
  const maintGuardEl = document.getElementById('maintenance-guard');
  const maintMsgEl = document.getElementById('maintenance-message');

  if (appEl) appEl.style.display = 'none';
  if (guardEl) guardEl.classList.add('hidden');
  if (maintGuardEl) {
    maintGuardEl.classList.remove('hidden');
    if (maintMsgEl && msg) maintMsgEl.textContent = msg;
  }
}

window.checkMaintenanceAgain = async function() {
  const btn = document.getElementById('maintenance-refresh-btn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>â³ Checking Status...</span>';
  }
  try {
    const ok = await checkInAppForceSub(true);
    if (ok) {
      const maintGuard = document.getElementById('maintenance-guard');
      if (maintGuard) maintGuard.classList.add('hidden');
      const appEl = document.getElementById('app');
      if (appEl) appEl.style.display = '';
      haptic('success');
      showToast('🟢 Study Hub is now LIVE!');
      loadBatches(true);
      updateTgBackButton();
    } else {
      haptic('error');
      showToast('🛑 App is still in maintenance mode. Please wait a moment.');
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml || '<span>🔄 Check Again / Refresh</span>';
    }
  }
};

function updateTgBackButton() {
  if (!state.tg?.BackButton) return;
  try {
    if (state.view === 'platforms') {
      state.tg.BackButton.hide();
    } else {
      state.tg.BackButton.show();
    }
  } catch(e) {}
}

function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error' || type === 'warning') {
      state.tg?.HapticFeedback?.notificationOccurred?.(type);
    } else {
      state.tg?.HapticFeedback?.impactOccurred?.(type);
    }
  } catch(e) {}
}

// ─── View Navigation Router ────────────────────────────────────
function navigate(view) {
  const current = document.getElementById(`view-${state.view}`);
  const next = document.getElementById(`view-${view}`);
  if (!next || view === state.view) return;

  current?.classList.remove('active');
  next.classList.remove('hidden');
  next.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });

  state.view = view;
  updateTgBackButton();
  updateBreadcrumbs(view);
  haptic('light');
}

function updateBreadcrumbs(view) {
  const bar = document.getElementById('global-breadcrumb-bar');
  const trail = document.getElementById('crumb-trail-scroll');
  if (!bar || !trail) return;

  if (view === 'platforms') {
    bar.classList.add('hidden');
    trail.innerHTML = '';
    return;
  }
  if (view === 'guru') {
    bar.classList.remove('hidden');
    trail.innerHTML = `<span class="crumb-link" onclick="navigate('platforms')">ðŸ›ï¸ Platforms</span> <span class="crumb-sep">›</span> <span class="crumb-current">🤖 ${window.APP_CONFIG ? window.APP_CONFIG.BOT_NAME + " Guru" : "Study Guru"}</span>`;
    return;
  }

  bar.classList.remove('hidden');

  const p = PROVIDERS[state.provider] || { name: state.provider, icon: '⚡' };
  const bName = state.batch?.name || state.batch?.title || 'Batch';
  const sName = state.subject?.subject || state.subject?.title || 'Subject';
  const tName = state.topic?.name || state.topic?.topic || 'Chapter';

  let crumbs = [];

// ════════════════════════════════════════════════════════════════
// DYNAMIC BRAND CONFIG — Loaded from /api/config on startup
// ════════════════════════════════════════════════════════════════
window.APP_CONFIG = null;

function formatBrandHtml(rawName) {
  const name = (rawName || 'InvalidStudy').trim();
  let prefix = name;
  let suffix = '';

  // 1. If contains space (e.g. "Invalid Study" or "Study Hub")
  if (name.includes(' ')) {
    const parts = name.split(' ');
    prefix = parts.slice(0, -1).join(' ');
    suffix = parts[parts.length - 1];
  } else {
    // 2. If CamelCase / compound (e.g. "InvalidStudy" -> "Invalid" + "Study", "RangeXCoder" -> "RangeX" + "Coder")
    const m = name.match(/^([A-Z]?[a-z0-9]+|[A-Z]+[a-z0-9]*?)([A-Z][a-z0-9]*)$/);
    if (m && m[1] && m[2]) {
      prefix = m[1];
      suffix = m[2];
    } else if (name.length > 5) {
      const mid = Math.ceil(name.length / 2);
      prefix = name.slice(0, mid);
      suffix = name.slice(mid);
    }
  }

  if (suffix) {
    return `<span class="brand-prefix">${prefix}</span><span class="accent-serif">${suffix}</span>`;
  }
  return `<span class="brand-prefix">${prefix}</span>`;
}

async function loadAppConfig() {
  try {
    const base = (CONFIG.SERVER_URL && CONFIG.SERVER_URL.startsWith('http'))
      ? CONFIG.SERVER_URL.replace(/\/$/, '')
      : window.location.origin.replace(/\/$/, '');
    const res = await fetch(base + '/api/config');
    if (res.ok) {
      window.APP_CONFIG = await res.json();
      applyBrandConfig(window.APP_CONFIG);
    }
  } catch (e) {}
  if (!window.APP_CONFIG) {
    window.APP_CONFIG = { BOT_NAME: 'Study Hub', BOT_LINK: '', ACCENT_COLOR: '#ff6b4a', POWERED_BY: 'Study Hub', BOT_USERNAME: 'yourstudybot' };
  }
}

function applyBrandConfig(cfg) {
  if (!cfg) return;
  const bName = cfg.BOT_NAME || 'InvalidStudy';
  const brandHtml = formatBrandHtml(bName);

  // Page title & meta
  document.title = cfg.WEBAPP_TITLE || bName;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', cfg.WEBAPP_TAGLINE || 'Your free study companion');
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', cfg.WEBAPP_TITLE || bName);

  // Brand accent color CSS variable
  if (cfg.ACCENT_COLOR) {
    const hex = cfg.ACCENT_COLOR.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) || 255;
    const g = parseInt(hex.slice(2, 4), 16) || 107;
    const b = parseInt(hex.slice(4, 6), 16) || 74;
    document.documentElement.style.setProperty('--accent-primary', cfg.ACCENT_COLOR);
    document.documentElement.style.setProperty('--accent-terracotta', cfg.ACCENT_COLOR);
    document.documentElement.style.setProperty('--accent-primary-glow', `rgba(${r},${g},${b},0.25)`);
    document.documentElement.style.setProperty('--accent-primary-border', `rgba(${r},${g},${b},0.35)`);
  }

  // Update stylized brand headers & Guru title
  document.querySelectorAll('[data-brand-html]').forEach(el => { el.innerHTML = brandHtml; });
  document.querySelectorAll('.brand-title').forEach(el => { el.innerHTML = brandHtml; });
  const homeTitle = document.getElementById('home-platform-brand-title');
  if (homeTitle) homeTitle.innerHTML = brandHtml;
  const guruTitle = document.getElementById('guru-card-brand-title');
  if (guruTitle) guruTitle.innerHTML = `${brandHtml} Guru`;

  // Update text-only data-brand-* elements
  document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = bName; });
  document.querySelectorAll('[data-brand-powered-by]').forEach(el => { el.textContent = cfg.POWERED_BY || bName; });
  document.querySelectorAll('[data-brand-bot-link]').forEach(el => { el.href = cfg.BOT_LINK || '#'; });

  // Player badge
  const badge = document.querySelector('.player-badge');
  if (badge) badge.textContent = '⚡ ' + bName.toUpperCase() + ' PLAYER';
  // Guard link (bot)
  document.querySelectorAll('[data-brand-bot-link]').forEach(el => {
    if (cfg.BOT_LINK) el.href = cfg.BOT_LINK;
  });
  const guardLink = document.querySelector('.btn-guard-telegram');
  if (guardLink && cfg.BOT_LINK) {
    guardLink.href = cfg.BOT_LINK;
    const span = guardLink.querySelector('span');
    if (span) span.textContent = '\uD83D\uDD17 Open in Telegram (@' + (cfg.BOT_USERNAME || 'yourstudybot') + ')';
  }
  // Channel links (force-sub, maintenance guard)
  const channelLink = cfg.CHANNEL_LINK || '';
  document.querySelectorAll('[data-brand-channel-link]').forEach(el => {
    if (channelLink) el.href = channelLink;
  });
  // Group links
  const groupLink = cfg.GROUP_LINK || '';
  document.querySelectorAll('[data-brand-group-link]').forEach(el => {
    if (groupLink) el.href = groupLink;
  });
  // Dynamic Banner
  if (cfg.BANNER_URL || cfg.BANNER_FILE) {
    const bannerSrc = cfg.BANNER_URL || cfg.BANNER_FILE || 'banner.jpg';
    document.querySelectorAll('[data-brand-banner]').forEach(el => {
      if (el.tagName === 'IMG') el.src = bannerSrc;
      else el.style.backgroundImage = `url('${bannerSrc}')`;
    });
  }
}


  crumbs.push(`<span class="crumb-link" onclick="navigate('platforms')">ðŸ›ï¸ Platforms</span>`);

  if (view === 'home') {
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-current" title="${p.name}">${p.icon} ${p.name}</span>`);
  } else if (view === 'batch') {
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('home')" title="${p.name}">${p.icon} ${p.name}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-current" title="${bName}">${bName}</span>`);
  } else if (view === 'subject') {
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('home')" title="${p.name}">${p.icon} ${p.name}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('batch')" title="${bName}">${bName}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-current" title="${sName}">${sName}</span>`);
  } else if (view === 'content') {
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('home')" title="${p.name}">${p.icon} ${p.name}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('batch')" title="${bName}">${bName}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-link" onclick="navigate('subject')" title="${sName}">${sName}</span>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    crumbs.push(`<span class="crumb-current" title="${tName}">${tName}</span>`);
  }

  trail.innerHTML = crumbs.join(' ');
  requestAnimationFrame(() => {
    trail.scrollLeft = trail.scrollWidth;
  });
}

function navigateGlobalBack() {
  haptic('light');
  if (state.view === 'guru') {
    navigate('platforms');
  } else if (state.view === 'content') {
    navigate('subject');
  } else if (state.view === 'subject') {
    navigate('batch');
  } else if (state.view === 'batch') {
    navigate('home');
  } else if (state.view === 'home') {
    navigate('platforms');
  }
}

// ─── Resilient API Helpers (WebSocket Tunnel First, HTTP Fallback) ───
async function serverGet(path, retries = 1) {
  // 1. Route through persistent WebSocket Tunnel if available (0 Fetch/XHR footprint!)
  try {
    const parsed = parseApiRouteToWsAction(path);
    if (parsed && (WSBridge.isReady() || WSBridge.connecting)) {
      const data = await WSBridge.call(parsed.action, parsed.params, 20000);
      if (data && data.maintenance) {
        triggerMaintenanceScreen(data.message);
        throw new Error('Maintenance Mode Active');
      }
      return data;
    }
  } catch (wsErr) {
    if (wsErr && wsErr.message === 'Maintenance Mode Active') throw wsErr;
    console.warn(`[serverGet] WS Tunnel bypass/fallback for ${path}:`, wsErr.message);
  }

  // 2. Resilient HTTP fallback with Telegram HMAC signature header
  const base = getServerBaseUrl();
  const userId = getTelegramUserId();
  const sep = path.includes('?') ? '&' : '?';
  const url = userId ? `${base}${path}${sep}chatId=${encodeURIComponent(userId)}` : `${base}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      if (data && data.maintenance) {
        triggerMaintenanceScreen(data.message);
        throw new Error('Maintenance Mode Active');
      }
      return data;
    } catch (err) {
      if (err && err.message === 'Maintenance Mode Active') throw err;
      if (attempt === retries) throw err;
      console.warn(`[serverGet] Retrying ${path} (attempt ${attempt + 1}):`, err.message);
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

async function fetchBatchContent(batchId, subjectId, topicId, type = 'Videos', page = 1) {
  const safeBatch   = encodeURIComponent(batchId   || '');
  const safeSubject = encodeURIComponent(subjectId || '');
  const safeTopic   = encodeURIComponent(topicId   || '');
  const providerParam = state.provider ? `&provider=${encodeURIComponent(state.provider)}` : '';

  // 1. Primary: Unified Topic content route (PW & Multi-Providers)
  try {
    const res = await serverGet(
      `/api/batch/${safeBatch}/subject/${safeSubject}/topic/${safeTopic}/content?type=${type}&page=${page}${providerParam}`
    );
    if (res && Array.isArray(res.data) && res.data.length > 0) return res;
    if (res && Array.isArray(res) && res.length > 0) return { data: res };
    if (res && res.data && !Array.isArray(res.data)) return res;
  } catch (err) {
    console.warn(`[fetchBatchContent] Topic route failed (${type}):`, err.message);
  }

  // 2. Fallback: Subject content route with tag filter
  try {
    const safeTag = encodeURIComponent(topicId || '');
    let contentType = type;
    if (type.toLowerCase() === 'notes') contentType = 'notes';
    else if (type.toLowerCase() === 'videos') contentType = 'Videos';
    else if (type.toLowerCase() === 'dppnotes') contentType = 'DppNotes';
    else if (type.toLowerCase() === 'dppvideos') contentType = 'DppVideos';
    const res = await serverGet(
      `/api/batch/${safeBatch}/subject/${safeSubject}/content?tag=${safeTag}&type=${contentType}&page=${page}${providerParam}`
    );
    if (res && Array.isArray(res.data)) return res;
    if (res && Array.isArray(res)) return { data: res };
    if (res && res.data) return res;
  } catch (err) {
    console.warn(`[fetchBatchContent] Fallback content failed (${type}):`, err.message);
  }

  return { success: true, data: [] };
}


async function contentGet(path) {
  return await serverGet(`/api${path}`);
}

// ─── Asset & Formatting Utilities ──────────────────────────────
function imgUrl(previewImage) {
  if (!previewImage) return '';
  if (typeof previewImage === 'string') return previewImage;
  return (previewImage.baseUrl || '') + (previewImage.key || '');
}

function fmtDate(dateStr) {
  if (!dateStr || dateStr === 0 || dateStr === '0') return '';
  let val = dateStr;
  if (typeof val === 'number' && val < 10000000000) {
    val = val * 1000;
  } else if (typeof val === 'string' && /^\d{10}$/.test(val)) {
    val = parseInt(val, 10) * 1000;
  }
  const d = new Date(val);
  if (isNaN(d.getTime()) || d.getFullYear() <= 1970) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Editorial Toast Notifications ─────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── Skeletons & Loaders ───────────────────────────────────────
function renderSkeletons(containerId, count = 4) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(count).fill(`
    <div class="skeleton-row" style="height:120px;border-radius:16px;">
      <div class="skeleton skeleton-thumb" style="width:90px;height:90px;"></div>
      <div class="skeleton-text-group">
        <div class="skeleton skeleton-line w-80" style="height:16px;"></div>
        <div class="skeleton skeleton-line w-50" style="height:12px;"></div>
      </div>
    </div>
  `).join('');
}

function skeletonRows(count = 4) {
  return Array(count).fill(`
    <div class="skeleton-row">
      <div class="skeleton skeleton-thumb"></div>
      <div class="skeleton-text-group">
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-50"></div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════
// VIEW 1: HOME — Batches & Search & Multi-Provider
// ═══════════════════════════════════════════════════════════════

const PROVIDERS = {
  pw: { name: 'Physics Wallah', appId: '5eb393ee95fab7468a79d189', icon: '🌟' },
  nexttopper: { name: 'Next Toppers', appId: '5eb393ee95fab7468a79d182', icon: '🎓' },
  missionjeet: { name: 'Mission JEET', appId: '69d6a2a167a3a4263ae3d0d0', icon: '🎯' },
  vidyakul: { name: 'Vidyakul', appId: '5eb393ee95fab7468a79d2853', icon: '📚' },
  apnacollege: { name: 'Apna College', appId: '5eb393ee95fab7468a79456669', icon: '💻' },
  sketchbook: { name: 'SketchBook', appId: '6a3d1c9cd754c8894bf5812a', icon: '🎨' },
};

function isStreamProvider(provider) {
  return ['nexttopper', 'missionjeet', 'vidyakul', 'apnacollege', 'sketchbook'].includes(provider);
}

function selectPlatform(providerKey) {
  if (providerKey === 'guru') {
    navigate('guru');
    return;
  }
  if (state.provider !== providerKey) {
    switchProvider(providerKey);
  }
  updateActivePlatformIndicator();
  navigate('home');
  if (!state.batches || state.batches.length === 0) {
    loadBatches(true);
  }
}

function exitGuruToPlatforms() {
  navigate('platforms');
}

function updateActivePlatformIndicator() {
  const p = PROVIDERS[state.provider] || { name: state.provider, icon: '⚡' };
  const el = document.getElementById('active-platform-indicator');
  if (el) el.textContent = `${p.icon} ${p.name}`;
  const sub = document.getElementById('home-platform-brand-subtitle');
  if (sub) sub.textContent = `${p.name} Batches, Lectures, Notes & DPPs`;
}

function switchProvider(providerKey) {
  if (state.provider === providerKey) return;
  state.provider = providerKey;
  state.providerEpoch = (state.providerEpoch || 0) + 1;
  haptic('medium');

  // Cancel any active in-flight batch/content loading
  state.batchLoading = false;
  state.contentLoading = false;

  // Clear search input & panel
  const searchInput = document.getElementById('batch-search-input');
  if (searchInput) searchInput.value = '';
  state.searchQuery = '';
  state.isSearching = false;
  document.getElementById('search-results-panel')?.classList.add('hidden');

  // Clear active selections
  state.batch = null;
  state.subject = null;
  state.topic = null;
  state.content = { Videos: [], Notes: [], DppNotes: [], DppVideos: [] };
  state.contentPage = { Videos: 1, Notes: 1, DppNotes: 1, DppVideos: 1 };
  state.contentHasMore = { Videos: false, Notes: false, DppNotes: false, DppVideos: false };

  // Reset to home view if currently inside a batch/subject/content view
  if (state.view !== 'home' && state.view !== 'platforms') {
    navigate('home');
  }

  // Update button active state
  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === providerKey);
  });

  updateActivePlatformIndicator();

  const p = PROVIDERS[providerKey] || { name: providerKey, icon: '⚡' };
  showToast(`${p.icon} Switched to ${p.name}`);

  // Immediately render skeletons in the grid to clear old provider's batches
  renderSkeletons('batches-grid', 4);

  loadBatches(true);
}

async function loadBatches(reset = false) {
  if (state.batchLoading) return;
  const thisEpoch = state.providerEpoch || 0;
  if (reset) {
    state.batches = [];
    state.batchPage = 1;
    state.batchHasMore = true;
  }
  if (!state.batchHasMore) return;

  state.batchLoading = true;
  const grid = document.getElementById('batches-grid');

  if (reset && grid) {
    renderSkeletons('batches-grid', 4);
  }

  try {
    const providerParam = state.provider ? `&provider=${state.provider}` : '';
    const res = await serverGet(`/api/batches?page=${state.batchPage}&limit=20${providerParam}`);
    if (thisEpoch !== (state.providerEpoch || 0)) return; // Discard stale provider response!
    const items = res.data || [];

    if (reset && grid) grid.innerHTML = '';

    if (items.length === 0) {
      if (state.batches.length === 0 && grid) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1">
            <div class="empty-state-icon">ðŸ“­</div>
            <div class="empty-state-title">No Batches in ${PROVIDERS[state.provider]?.name || 'Provider'}</div>
            <div class="empty-state-sub">Batches for this platform will sync automatically</div>
          </div>`;
      }
      state.batchHasMore = false;
    } else {
      const existingIds = new Set(state.batches.map(b => b._id).filter(Boolean));
      const newItems = reset ? items : items.filter(b => !existingIds.has(b._id));

      if (newItems.length === 0) {
        state.batchHasMore = false;
      } else {
        if (reset) {
          state.batches = newItems;
        } else {
          state.batches.push(...newItems);
        }
        if (grid) {
          newItems.forEach(b => grid.insertAdjacentHTML('beforeend', renderBatchCard(b)));
        }
        state.batchPage++;
        if (items.length < 20 || newItems.length < items.length) {
          state.batchHasMore = false;
        }
      }
    }

    updateBatchCounts();
    document.getElementById('load-more-btn')?.classList.toggle('hidden', !state.batchHasMore);

  } catch (err) {
    console.error('Batch load error:', err);
    if (state.batches.length === 0 && grid) {
      grid.innerHTML = `
        <div class="error-state" style="grid-column:1/-1">
          <div class="error-state-icon">⚡</div>
          <div class="error-state-title">Waking Up Cloud Server</div>
          <div class="error-state-msg">The backend is booting up from standby. Please tap retry in a moment.</div>
          <button class="retry-btn" onclick="loadBatches(true)">🔄 Tap to Connect</button>
        </div>`;
    }
  } finally {
    state.batchLoading = false;
  }
}

function loadMoreBatches() { loadBatches(false); }

function updateBatchCounts() {
  const allCountEl = document.getElementById('count-all-batches');
  const favCountEl = document.getElementById('count-fav-batches');
  if (allCountEl) allCountEl.textContent = state.batches.length ? `${state.batches.length}${state.batchHasMore ? '+' : ''}` : '';
  if (favCountEl) {
    const favCount = Object.keys(state.favBatches || {}).length;
    favCountEl.textContent = favCount > 0 ? favCount : '';
  }
}

function renderBatchCard(b) {
  const bId = b._id || b.id;
  if (bId) {
    b._id = bId;
    state.loadedBatches[bId] = b;
  }
  const name = b.name || b.title || 'Batch';
  const img = imgUrl(b.previewImage) || b.image || b.pngUrl || '';
  const cls = b.class || '';
  const isFav = state.favourites.has(bId);

  return `
    <div class="batch-card" id="batch-${bId}" onclick="openBatch('${bId}')">
      <div class="batch-card-thumb-wrap">
        ${img ? `<img class="batch-card-img" src="${img}" alt="${name}" loading="lazy" onerror="this.style.display='none'" />` : ''}
        <div class="batch-card-overlay"></div>
        <button class="batch-card-fav-btn" onclick="event.stopPropagation(); toggleFavourite('${bId}')" id="heart-${bId}">
          ${isFav ? 'â¤ï¸' : 'ðŸ¤'}
        </button>
      </div>
      <div class="batch-card-body">
        <div class="batch-card-class-tag">${cls ? `CLASS ${cls}` : (PROVIDERS[state.provider]?.name?.toUpperCase() || 'BATCH ARCHIVE')}</div>
        <h3 class="batch-card-title">${name}</h3>
        <div class="batch-card-footer">
          <span class="batch-card-tag">Explore Curriculum</span>
          <span class="batch-card-arrow">→</span>
        </div>
      </div>
    </div>`;
}

function openBatch(batchRef) {
  haptic('medium');
  let b = null;
  if (typeof batchRef === 'object' && batchRef !== null) {
    b = batchRef;
  } else if (typeof batchRef === 'string') {
    if (state.loadedBatches && state.loadedBatches[batchRef]) {
      b = state.loadedBatches[batchRef];
    } else if (state.favBatches && state.favBatches[batchRef]) {
      b = state.favBatches[batchRef];
    } else if (state.batches) {
      b = state.batches.find(x => (x._id === batchRef || x.id === batchRef));
    } else if (batchRef.startsWith('{')) {
      try { b = JSON.parse(batchRef); } catch (e) {}
    }
  }
  if (!b) return;
  const bId = b._id || b.id;
  b._id = bId;
  state.batch = b;
  navigate('batch');
  loadSubjects(bId);

  // Update batch hero card
  const name = b.name || b.title || 'Batch';
  const img = imgUrl(b.previewImage) || b.image || b.pngUrl || '';
  const imgEl = document.getElementById('batch-hero-img');
  if (imgEl) {
    imgEl.src = img;
    imgEl.style.display = img ? 'block' : 'none';
  }
  document.getElementById('batch-hero-name').textContent = name;
  document.getElementById('batch-hero-class').textContent = b.class ? `Class ${b.class}` : (PROVIDERS[state.provider]?.name || (window.APP_CONFIG?.BOT_NAME || 'Study Hub'));

  const batchHeartEl = document.getElementById('batch-view-heart');
  if (batchHeartEl) batchHeartEl.textContent = state.favourites.has(bId) ? 'â¤ï¸' : 'ðŸ¤';
}

// ─── Instant Search Engine ─────────────────────────────────────
function initSearch() {
  const input = document.getElementById('batch-search-input');
  const clearBtn = document.getElementById('search-clear');
  const panel = document.getElementById('search-results-panel');

  if (!input || !clearBtn || !panel) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.classList.toggle('hidden', !q);

    clearTimeout(state.searchTimer);
    if (!q) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    state.searchTimer = setTimeout(() => doSearch(q), 350);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    panel.classList.add('hidden');
    panel.innerHTML = '';
    input.focus();
  });
}

async function doSearch(q) {
  const thisEpoch = state.providerEpoch || 0;
  const panel = document.getElementById('search-results-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">ðŸ”</div><div class="empty-state-title">Searching...</div></div>`;

  try {
    const providerParam = state.provider ? `&provider=${state.provider}` : '';
    const res = await serverGet(`/api/batches/search?q=${encodeURIComponent(q)}${providerParam}`);
    if (thisEpoch !== (state.providerEpoch || 0)) return;
    const items = res.data || [];

    if (!items.length) {
      panel.innerHTML = `<div class="empty-state"><div class="empty-state-icon">ðŸ“­</div><div class="empty-state-title">No matching batches found</div></div>`;
      return;
    }

    panel.innerHTML = items.map(b => {
      const bId = b._id || b.id;
      if (bId) {
        b._id = bId;
        state.loadedBatches[bId] = b;
      }
      const name = b.name || b.title || 'Batch';
      const img = imgUrl(b.previewImage) || b.image || b.pngUrl || '';
      return `
        <div class="search-result-item" onclick="openBatch('${bId}')">
          <img class="search-result-thumb" src="${img || ''}" alt="${name}" onerror="this.style.display='none'" />
          <div class="search-result-info">
            <div class="search-result-title">${name}</div>
            <div class="search-result-meta">${b.class ? `Class ${b.class}` : (PROVIDERS[state.provider]?.name || 'Batch')}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    panel.innerHTML = `<div class="error-state"><div class="error-state-msg">${err.message}</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// VIEW 2: BATCH — Subjects
// ═══════════════════════════════════════════════════════════════

async function loadSubjects(batchId) {
  const thisEpoch = state.providerEpoch || 0;
  const list = document.getElementById('subjects-list');
  list.innerHTML = skeletonRows(4);

  try {
    const providerParam = state.provider ? `?provider=${state.provider}` : '';
    const res = await serverGet(`/api/batch/${batchId}/details${providerParam}`);
    if (thisEpoch !== (state.providerEpoch || 0)) return;
    const subjects = res.data?.subjects || [];

    if (!subjects.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div class="empty-state-title">No Subjects Found</div>
          <div class="empty-state-sub">Curriculum details are not available yet</div>
          <button class="retry-btn" style="margin-top:14px;" onclick="loadSubjects('${batchId}')">🔄 Refresh</button>
        </div>`;
      return;
    }

    subjects.forEach(s => {
      const sId = s._id || s.id;
      if (sId) {
        s._id = sId;
        state.loadedSubjects[sId] = s;
      }
    });

    list.innerHTML = subjects.map(s => renderSubjectCard(s)).join('');
  } catch (err) {
    list.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️ï¸</div>
        <div class="error-state-title">Failed to load subjects</div>
        <div class="error-state-msg">${err.message}</div>
        <button class="retry-btn" onclick="loadSubjects('${batchId}')">Retry</button>
      </div>`;
  }
}

function renderSubjectCard(s) {
  const sId = s._id || s.id;
  if (sId) {
    s._id = sId;
    state.loadedSubjects[sId] = s;
  }
  const subName = s.subject || s.title || 'Subject';
  const img = imgUrl(s.imageId) || s.image || '';
  const teacher = s.teacherIds?.[0];
  const tName = teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : '';
  const videoCount = s.lectureCount ?? s.totalVideos ?? 0;

  return `
    <div class="subject-card" onclick="openSubject('${sId}')">
      ${img ? `<img class="subject-card-icon" src="${img}" alt="${subName}" onerror="this.style.display='none'" />` : '<div class="subject-card-icon"></div>'}
      <div class="subject-card-info">
        <div class="subject-card-title">${subName}</div>
        <div class="subject-card-teacher">${tName ? `Faculty: ${tName} • ` : ''}${videoCount} Lectures</div>
      </div>
      <span class="subject-card-arrow">→</span>
    </div>`;
}

function openSubject(subjectRef) {
  haptic('medium');
  let s = null;
  if (typeof subjectRef === 'object' && subjectRef !== null) {
    s = subjectRef;
  } else if (typeof subjectRef === 'string') {
    if (state.loadedSubjects && state.loadedSubjects[subjectRef]) {
      s = state.loadedSubjects[subjectRef];
    } else if (subjectRef.startsWith('{')) {
      try { s = JSON.parse(subjectRef); } catch (e) {}
    }
  }
  if (!s) return;
  const sId = s.slug || s._id || s.id;
  s._id = s._id || s.id || sId;
  state.subject = s;
  navigate('subject');
  loadTopics(state.batch._id, sId);

  // Update subject view header
  const subName = s.subject || s.title || 'Subject';
  const img = imgUrl(s.imageId) || s.image || '';
  const teacher = s.teacherIds?.[0];
  const tImg = teacher ? imgUrl(teacher.imageId) : '';
  const tName = teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : '';

  const heroImg = document.getElementById('subject-hero-img');
  if (heroImg) {
    heroImg.src = img || '';
    heroImg.style.display = img ? 'block' : 'none';
  }
  document.getElementById('subject-hero-name').textContent = subName;

  const tWrap = document.getElementById('subject-teacher-wrap');
  if (tName) {
    if (tWrap) tWrap.style.display = 'inline-flex';
    document.getElementById('subject-teacher-name').textContent = tName;
    const tImgEl = document.getElementById('subject-teacher-img');
    if (tImgEl) {
      tImgEl.src = tImg || '';
      tImgEl.style.display = tImg ? 'block' : 'none';
    }
  } else if (tWrap) {
    tWrap.style.display = 'none';
  }

  const backName = document.getElementById('back-batch-name');
  if (backName) backName.textContent = state.batch?.name?.slice(0, 18) || 'Subjects';
}

// ═══════════════════════════════════════════════════════════════
// VIEW 3: SUBJECT — Topics / Chapters
// ═══════════════════════════════════════════════════════════════

async function loadTopics(batchId, subjectId) {
  const thisEpoch = state.providerEpoch || 0;
  const list = document.getElementById('topics-list');
  list.innerHTML = skeletonRows(5);

  try {
    const providerParam = state.provider ? `?provider=${state.provider}` : '';
    const res = await serverGet(`/api/batch/${batchId}/subject/${subjectId}/topics${providerParam}`);
    if (thisEpoch !== (state.providerEpoch || 0)) return;
    const topics = res.data || [];

    if (!topics.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">ðŸ“–</div>
          <div class="empty-state-title">No Chapters Found</div>
          <div class="empty-state-sub">Content will appear once scheduled</div>
        </div>`;
      return;
    }

    topics.forEach(t => {
      const tId = t._id || t.id;
      if (tId) {
        t._id = tId;
        state.loadedTopics[tId] = t;
      }
    });

    list.innerHTML = topics.map((t, i) => renderTopicCard(t, i)).join('');
  } catch (err) {
    list.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️ï¸</div>
        <div class="error-state-title">Failed to load chapters</div>
        <div class="error-state-msg">${err.message}</div>
        <button class="retry-btn" onclick="loadTopics('${batchId}','${subjectId}')">Retry</button>
      </div>`;
  }
}

function renderTopicCard(t, idx) {
  const tId = t._id || t.id;
  if (tId) {
    t._id = tId;
    state.loadedTopics[tId] = t;
  }
  const num = String(idx + 1).padStart(2, '0');
  const pills = [];
  if (t.lectureVideos > 0) pills.push(`<span class="topic-badge">🎥 ${t.lectureVideos} Lectures</span>`);
  if (t.notes > 0)         pills.push(`<span class="topic-badge">📄 ${t.notes} Notes</span>`);
  if (t.exercises > 0)     pills.push(`<span class="topic-badge">📝 ${t.exercises} DPP</span>`);

  return `
    <div class="topic-card" onclick="openTopic('${tId}')">
      <span class="topic-index">${num} //</span>
      <div class="topic-info">
        <div class="topic-title">${t.name}</div>
        ${pills.length ? `<div class="topic-meta-badges">${pills.join('')}</div>` : ''}
      </div>
      <span class="topic-arrow">→</span>
    </div>`;
}

function openTopic(topicRef) {
  haptic('medium');
  let t = null;
  if (typeof topicRef === 'object' && topicRef !== null) {
    t = topicRef;
  } else if (typeof topicRef === 'string') {
    if (state.loadedTopics && state.loadedTopics[topicRef]) {
      t = state.loadedTopics[topicRef];
    } else if (topicRef.startsWith('{')) {
      try { t = JSON.parse(topicRef); } catch (e) {}
    }
  }
  if (!t) return;
  const tId = t._id || t.id;
  t._id = tId;
  state.topic = t;

  // Reset content state
  state.content = { Videos: [], Notes: [], DppNotes: [], DppVideos: [] };
  state.contentPage = { Videos: 1, Notes: 1, DppNotes: 1, DppVideos: 1 };
  state.contentHasMore = { Videos: false, Notes: false, DppNotes: false, DppVideos: false };
  state.activeTab = 'Videos';

  navigate('content');

  // Update content view header
  document.getElementById('topic-hero-name').textContent = t.name;
  const backSubjectName = document.getElementById('back-subject-name');
  if (backSubjectName) backSubjectName.textContent = state.subject?.subject || 'Chapters';

  // Reset tabs UI
  document.querySelectorAll('.content-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'Videos');
  });

  // Reset tab counts
  CONFIG.TABS.forEach(tab => {
    const el = document.getElementById(`tab-count-${tab.type}`);
    if (el) el.textContent = '';
  });

  // Show skeleton on active tab
  document.getElementById('content-list').innerHTML = skeletonRows(5);
  updateContentLoadMore('Videos');

  // ─── PARALLEL PRE-FETCH: Load Page 1 for All 4 Tabs ───
  const batchId = state.batch._id;
  const subjectSlug = state.subject.slug || state.subject._id || state.subject.id;
  const topicSlug = t.slug || t._id || t.id;

  const fetchTab = async (type) => {
    try {
      const res = await fetchBatchContent(batchId, subjectSlug, topicSlug, type, 1);
      const rawItems = res.data || [];
      state.content[type] = rawItems;
      state.contentPage[type] = 2;
      state.contentHasMore[type] = rawItems.length >= 20;

      // Update badge count
      const countEl = document.getElementById(`tab-count-${type}`);
      if (countEl) {
        countEl.textContent = rawItems.length ? (rawItems.length + (state.contentHasMore[type] ? '+' : '')) : '';
      }
    } catch (e) {
      state.content[type] = [];
      state.contentHasMore[type] = false;
      console.warn(`[Parallel] Failed to load ${type}:`, e.message);
    }
  };

  Promise.all(CONFIG.TABS.map(tab => fetchTab(tab.type))).then(() => {
    renderContentList(state.activeTab);
    updateContentLoadMore(state.activeTab);
  });
}

// ═══════════════════════════════════════════════════════════════
// VIEW 4: CONTENT — Lectures, Notes, DPPs
// ═══════════════════════════════════════════════════════════════

function switchTab(type) {
  if (state.activeTab === type) return;
  haptic('light');
  state.activeTab = type;

  document.querySelectorAll('.content-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });

  if (!state.content[type]?.length && state.contentPage[type] === 1) {
    loadContent(type, true);
  } else {
    renderContentList(type);
    updateContentLoadMore(type);
  }
}

function updateContentLoadMore(type) {
  const lm = document.getElementById('content-load-more');
  const lmBtn = document.getElementById('content-load-more-btn');
  if (!lm || !lmBtn) return;

  const hasMore = state.contentHasMore && state.contentHasMore[type];
  if (hasMore) {
    lm.classList.remove('hidden');
    lmBtn.disabled = state.contentLoading;
    if (!state.contentLoading) {
      const typeLabel = CONFIG.TABS.find(t => t.type === type)?.label || 'Items';
      lmBtn.innerHTML = `<span class="btn-load-more-text">Load More ${typeLabel}</span><span class="btn-load-more-arrow">←“</span>`;
    }
    lmBtn.onclick = () => loadContent(type, false);
  } else {
    lm.classList.add('hidden');
  }
}

function getContentItemId(item) {
  if (!item) return '';
  if (item._hw && item.attId) return String(item.attId);
  if (item.videoDetails && item.videoDetails._id) return String(item.videoDetails._id);
  if (item._id) return String(item._id);
  if (item.homeworkIds && item.homeworkIds[0]) {
    const hw = item.homeworkIds[0];
    if (hw.attachmentIds && hw.attachmentIds[0] && hw.attachmentIds[0]._id) {
      return String(hw.attachmentIds[0]._id);
    }
    return String(hw._id || '');
  }
  return '';
}

async function loadContent(type, reset = false) {
  if (state.contentLoading) return;
  if (!state.batch || !state.subject || !state.topic) return;
  const thisEpoch = state.providerEpoch || 0;

  state.contentLoading = true;
  const list = document.getElementById('content-list');
  const lmBtn = document.getElementById('content-load-more-btn');

  if (reset) {
    state.content[type] = [];
    state.contentPage[type] = 1;
    state.contentHasMore[type] = true;
    list.innerHTML = skeletonRows(5);
    updateContentLoadMore(type);
  } else if (lmBtn) {
    lmBtn.disabled = true;
    lmBtn.innerHTML = `<span class="btn-load-more-text">â³ Loading Page ${state.contentPage[type]}...</span>`;
  }

  const batchId = state.batch._id;
  const subjectSlug = state.subject.slug || state.subject._id || state.subject.id;
  const topicSlug = state.topic.slug || state.topic._id || state.topic.id;
  const page = state.contentPage[type] || 1;

  try {
    const res = await fetchBatchContent(batchId, subjectSlug, topicSlug, type, page);
    if (thisEpoch !== (state.providerEpoch || 0)) return;
    const rawItems = res.data || [];

    if (reset) {
      state.content[type] = rawItems;
      state.contentPage[type] = 2;
      // learnxpw: empty array = no more pages. Also stop if < 20 items
      state.contentHasMore[type] = rawItems.length > 0 && rawItems.length >= 20;
      renderContentList(type);
      // After render, load teacher details async for video tabs
      if ((type === 'Videos' || type === 'DppVideos') && rawItems.length > 0) {
        loadTeacherBadges(rawItems);
      }
    } else {
      // Deduplicate incoming items against already loaded items in state.content[type]
      const existingIds = new Set(
        state.content[type].map(it => getContentItemId(it)).filter(Boolean)
      );

      const newItems = rawItems.filter(it => {
        const id = getContentItemId(it);
        return !id || !existingIds.has(id);
      });

      if (newItems.length === 0) {
        // No new items: The server returned the same dataset or reached the end
        state.contentHasMore[type] = false;
        showToast('ℹ️ï¸ All items loaded');
      } else {
        state.content[type].push(...newItems);
        state.contentPage[type]++;
        
        // If incoming batch was smaller than 20, or fewer new items than fetched, no more pages
        if (rawItems.length < 20 || newItems.length < rawItems.length) {
          state.contentHasMore[type] = false;
        } else {
          state.contentHasMore[type] = true;
        }

        const newHtml = (type === 'Videos' || type === 'DppVideos')
          ? newItems.map(item => renderVideoItem(item, type)).join('')
          : newItems.map(item => renderNotesItem(item, type)).join('');
        list.insertAdjacentHTML('beforeend', newHtml);
      }
    }

    // Update tab badge count
    const countEl = document.getElementById(`tab-count-${type}`);
    if (countEl && state.content[type].length > 0) {
      countEl.textContent = state.content[type].length + (state.contentHasMore[type] ? '+' : '');
    }

  } catch (err) {
    console.error('Content load error:', err);
    if (reset) {
      list.innerHTML = `
        <div class="error-state">
          <div class="error-state-icon">⚠️ï¸</div>
          <div class="error-state-title">Failed to load content</div>
          <div class="error-state-msg">${err.message}</div>
          <button class="retry-btn" onclick="loadContent('${type}', true)">Retry</button>
        </div>`;
    } else {
      showToast('âŒ Failed to load more items');
    }
  } finally {
    state.contentLoading = false;
    updateContentLoadMore(type);
  }
}

function renderContentList(type) {
  const list = document.getElementById('content-list');
  const items = state.content[type] || [];

  if (!items.length) {
    const tabCfg = CONFIG.TABS.find(t => t.type === type) || { icon: '📁', label: type };
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${tabCfg.icon}</div>
        <div class="empty-state-title">No ${tabCfg.label} Available</div>
        <div class="empty-state-sub">There are no ${tabCfg.label.toLowerCase()} uploaded for this chapter yet</div>
      </div>`;
    updateContentLoadMore(type);
    return;
  }

  if (type === 'Videos' || type === 'DppVideos') {
    list.innerHTML = items.map(item => renderVideoItem(item, type)).join('');
  } else {
    list.innerHTML = items.map(item => renderNotesItem(item, type)).join('');
  }

  updateContentLoadMore(type);
}

function renderVideoItem(item, type) {
  const vd = item.videoDetails || {};
  // learnxpw: item._id=schedule contentId, item.topic=name, item.teachers[]=teacherIds
  const name      = vd.name || item.topic || item.name || 'Lecture';
  const img       = vd.image || item.image || '';
  const dur       = vd.duration || item.duration || '';
  const date      = fmtDate(item.date);
  const itemId    = item._id || vd._id || `vid_${Math.random().toString(36).slice(2)}`;
  const teacherId = Array.isArray(item.teachers) && item.teachers.length > 0 ? item.teachers[0] : null;
  state.loadedPayloads[itemId] = item;

  const isStream     = isStreamProvider(state.provider);
  const clickHandler = isStream ? `handleStreamPlay('${itemId}', '${type}')` : `sendContent('${itemId}', '${type}')`;
  const actionIcon   = isStream ? '▶' : '↗';
  const actionTitle  = isStream ? 'Watch Lecture' : 'Send to Telegram';
  const teacherHtml  = teacherId
    ? `<span class="teacher-badge" id="teacher-${itemId}" data-teacher-id="${teacherId}">👤 ...</span>`
    : '';

  return `
    <div class="content-item" onclick="${clickHandler}">
      <div class="content-thumb-wrap">
        ${img ? `<img class="content-thumb-img" src="${img}" alt="${name}" loading="lazy" onerror="this.style.display='none'" />` : ''}
        <div class="content-play-badge">▶</div>
      </div>
      <div class="content-info-block">
        <div class="content-item-name">${name}</div>
        <div class="content-item-meta-row">
          ${dur  ? `<span class="content-duration-pill">⏱ ${dur}</span>`  : ''}
          ${date ? `<span class="content-date-pill">📅 ${date}</span>` : ''}
          ${teacherHtml}
        </div>
      </div>
      <div class="content-send-action-btn" title="${actionTitle}">${actionIcon}</div>
    </div>`;
}

// Load teacher name+photo badges for video cards (async, batched per teacher ID)
async function loadTeacherBadges(items) {
  const teacherIds = [...new Set(
    items.flatMap(it => Array.isArray(it.teachers) ? it.teachers : []).filter(Boolean)
  )];
  if (!teacherIds.length) return;
  if (!state._teacherCache) state._teacherCache = {};

  for (const tid of teacherIds) {
    try {
      if (!state._teacherCache[tid]) {
        const res = await serverGet(`/api/teacher/${encodeURIComponent(tid)}`);
        state._teacherCache[tid] = res?.data?.[0] || null;
      }
      const teacher = state._teacherCache[tid];
      if (!teacher) continue;
      const teacherName = teacher.name || `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim();
      const photoUrl    = (teacher.imageId?.baseUrl && teacher.imageId?.key)
        ? teacher.imageId.baseUrl + teacher.imageId.key : null;

      document.querySelectorAll(`.teacher-badge[data-teacher-id="${tid}"]`).forEach(el => {
        el.innerHTML = photoUrl
          ? `<img src="${photoUrl}" class="teacher-avatar" alt="${teacherName}" onerror="this.style.display='none'"/> ${teacherName}`
          : `👤 ${teacherName}`;
        el.removeAttribute('data-teacher-id');
      });
    } catch (e) {
      document.querySelectorAll(`.teacher-badge[data-teacher-id="${tid}"]`).forEach(el => el.remove());
    }
  }
}



async function handleStreamPlay(itemId, type) {
  haptic('medium');
  const item = state.loadedPayloads[itemId];
  if (!item) {
    showToast('âŒ Video item not found');
    return;
  }

  const batchId = item.batchId || state.batch?._id || state.batch?.id || '';
  const subjectId = item.subjectId || state.subject?._id || state.subject?.id || '';
  const contentId = item.contentId || item._id || item.id || '';
  const name = item.videoDetails?.name || item.name || item.topic || 'Lecture';

  showToast('â³ Loading video player...');

  try {
    const res = await serverGet(
      `/api/batch/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/content/${encodeURIComponent(contentId)}/details?provider=${state.provider}`,
      2
    );

    const streamUrl = res?.data?.link || res?.link || '';
    if (!streamUrl) {
      showToast('⚠️ï¸ Video stream is currently unavailable. Please try another lecture.');
      return;
    }

    selectedActionItem = {
      itemId,
      type,
      item: {
        ...item,
        videoDetails: {
          ...(item.videoDetails || {}),
          name: res.data?.title || name,
          videoUrl: streamUrl,
          url: streamUrl
        }
      }
    };

    launchRangeXPlayer();
  } catch (err) {
    console.error('Error fetching stream details:', err);
    showToast('âŒ Video stream currently unavailable');
  }
}

// renderNotesItem: expand each homework within a session into its own separate card
// A session (item) can have multiple homeworks (e.g. Class Notes + Assignment)
function renderNotesItem(item, type) {
  const isDpp = type === 'DppNotes';
  const date = fmtDate(item.date || item.createdAt);
  const hws = item.homeworkIds && item.homeworkIds.length > 0 ? item.homeworkIds : [item];

  return hws.map((hw, idx) => {
    const att = hw.attachmentIds?.[0] || {};
    const name = hw.topic || att.name || item.name || item.topic || 'Notes';
    const payloadKey = `hw_${hw._id || att._id || `${item._id}_${idx}`}`;
    state.loadedPayloads[payloadKey] = {
      _hw:        true,
      hwId:       hw._id,
      attId:      att._id,
      attBaseUrl: att.baseUrl || 'https://static.pw.live/',
      attKey:     att.key || '',
      attName:    att.name || name,
      name,
      date:       item.date,
      batchId:    item.batchId || state.batch?._id || state.batch?.id,
      subjectId:  item.subjectId || state.subject?.slug || state.subject?._id || state.subject?.id,
      contentId:  item.contentId || item._id || item.id,
      provider:   item.provider || state.provider,
      pdfUrl:     item.pdfUrl || item.url || ''
    };

    return `
    <div class="content-item" onclick="sendContent('${payloadKey}', '${type}')">
      <div class="content-doc-icon-wrap ${isDpp ? 'doc-dpp-icon' : 'doc-notes-icon'}">
        ${isDpp ? 'ðŸ“' : '📄'}
      </div>
      <div class="content-info-block">
        <div class="content-item-name">${name}</div>
        <div class="content-item-meta-row">
          <span class="content-duration-pill">${isDpp ? 'DPP PDF' : 'CLASS NOTES'}</span>
          ${date ? `<span class="content-date-pill">📅 ${date}</span>` : ''}
        </div>
      </div>
      <div class="content-send-action-btn" title="Open or Send PDF">↗</div>
    </div>`;
  }).join('');
}

// ─── Send Content to Telegram Bot ──────────────────────────────
async function sendContent(keyOrItem, type) {
  if (state.isSending) return;
  state.isSending = true;

  haptic('medium');
  let item = null;
  if (typeof keyOrItem === 'object' && keyOrItem !== null) {
    item = keyOrItem;
  } else if (typeof keyOrItem === 'string') {
    if (state.loadedPayloads && state.loadedPayloads[keyOrItem]) {
      item = state.loadedPayloads[keyOrItem];
    } else if (keyOrItem.startsWith('{')) {
      try { item = JSON.parse(keyOrItem); } catch (e) {}
    }
  }

  if (!item) {
    showToast('âŒ Item data not found');
    state.isSending = false;
    return;
  }

  const isVideo = type === 'Videos' || type === 'DppVideos';
  const batchId = item.batchId || state.batch?._id || state.batch?.id || '';
  const subject = state.subject?.subject || state.subject?.title || '';
  const topicName = state.topic?.name || '';
  const subjectId = item.subjectId || state.subject?.slug || state.subject?._id || state.subject?.id || '';
  const scheduleContentId = item.contentId || item._id || item.id || '';

  let contentId = '', name = '', image = '', pdfUrl = '';

  if (isVideo) {
    const vd = item.videoDetails || {};
    contentId = vd._id || vd.id || item._id || item.id || item.contentId || '';
    name      = vd.name || item.name || item.topic || 'Lecture';
    image     = vd.image || item.image || '';
  } else if (item.pdfUrl) {
    // NextTopper / MissionJEET / direct PDF
    pdfUrl    = item.pdfUrl;
    contentId = item.contentId || item._id || item.id || '';
    name      = item.name || item.topic || 'Notes';
    image     = item.image || '';
  } else if (item._hw) {
    // Homework card: has pre-resolved attachment info
    if (item.attKey) {
      pdfUrl = (item.attBaseUrl || 'https://static.pw.live/') + item.attKey;
    } else if (item.pdfUrl) {
      pdfUrl = item.pdfUrl;
    }
    contentId = item.contentId || item.attId || item.hwId || item._id || '';
    name      = item.name || item.attName || item.topic || 'Notes';
    image     = item.image || '';
  } else {
    // Fallback: nested structure
    const hw  = item.homeworkIds?.[0] || item;
    const att = hw.attachmentIds?.[0] || hw;
    if (att.baseUrl && att.key) pdfUrl = att.baseUrl + att.key;
    contentId = item.contentId || att._id || hw._id || item._id || item.id || '';
    name      = item.name || hw.topic || att.name || item.topic || 'Notes';
    image     = '';
  }

  // For PW notes/DPP without direct URL, resolve using LearnXPW GetPdf
  if (!isVideo && !pdfUrl && (state.provider === 'pw' || !state.provider)) {
    showToast('⏳ Fetching PDF document...');
    try {
      const pdfId = item.contentId || scheduleContentId || '';
      const attId = item.attId || (item.homeworkIds?.[0]?.attachmentIds?.[0]?._id) || '';
      if (batchId && subjectId && pdfId && attId) {
        const res = await serverGet(
          `/api/getpdf?batchId=${encodeURIComponent(batchId)}&subjectId=${encodeURIComponent(subjectId)}&pdfId=${encodeURIComponent(pdfId)}&attachmentId=${encodeURIComponent(attId)}`
        );
        if (res?.data?.pdfUrl) {
          pdfUrl = res.data.pdfUrl;
        } else if (res?.data?.baseUrl && res?.data?.key) {
          pdfUrl = res.data.baseUrl + res.data.key;
        }
      }
    } catch (err) {
      console.warn('[GetPdf] Failed:', err.message);
    }
  }

  // For AS Multiverse providers Notes: resolve live CloudFront PDF URL if needed
  if (!isVideo && !pdfUrl && isStreamProvider(state.provider)) {
    showToast('â³ Fetching PDF document...');
    try {
      const res = await serverGet(
        `/api/batch/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/content/${encodeURIComponent(contentId)}/details?provider=${state.provider}`
      );
      if (res?.data?.link) {
        pdfUrl = res.data.link;
        if (state.tg && state.tg.openLink) {
          try { state.tg.openLink(pdfUrl); } catch (e) {}
        }
      } else {
        showToast('📄 Notes for this lecture have not been uploaded by faculty yet');
        state.isSending = false;
        return;
      }
    } catch (err) {
      console.warn('PDF details fetch failed:', err);
      showToast('📄 Notes for this lecture have not been uploaded by faculty yet');
      state.isSending = false;
      return;
    }
  }

  // For Notes/DPP: require either pdfUrl OR contentId
  // For Videos: require batchId + contentId
  if (isVideo && (!batchId || !contentId)) {
    showToast('âŒ Could not identify content');
    state.isSending = false;
    return;
  }
  if (!isVideo && !pdfUrl && !contentId) {
    showToast('âŒ No PDF URL or ID found');
    state.isSending = false;
    return;
  }

  showToast('â³ Sending to Telegram chat...');

  const teacher = state.subject?.teacherIds?.[0];
  let faculty = teacher ? `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() : '';
  if (!faculty) {
    const match = (subject || '').match(/by\s+([A-Za-z\s]+?)(?:\s*\(|$)/i);
    if (match && match[1]) faculty = match[1].trim();
  }
  if (!faculty) faculty = 'Faculty';

  const payload = {
    chatId:           state.chatId,
    type,
    batchId,
    contentId,
    name,
    image,
    subject,
    topic:            topicName,
    faculty:          faculty,
    subjectId,
    scheduleContentId,
    pdfUrl,           // Direct PDF URL for Notes/DPPs
    provider:         state.provider || 'pw',
    homeworks:        [],
    dpps:             [],
  };

  // For PW videos: fetch Schedule attachments (Notes + DPP) from learnxpw
  // These become the attachment buttons in the Telegram bot message
  if (isVideo && (state.provider === 'pw' || !state.provider) && batchId && subjectId && scheduleContentId) {
    try {
      const scheduleRes = await serverGet(
        `/api/batch/${encodeURIComponent(batchId)}/subject/${encodeURIComponent(subjectId)}/content/${encodeURIComponent(scheduleContentId)}/schedule`
      );
      const schedData = scheduleRes?.data || {};
      // homeworkIds = Class Notes PDFs
      if (Array.isArray(schedData.homeworkIds)) {
        payload.homeworks = Array.isArray(schedData.homeworkIds) ? schedData.homeworkIds.filter(hw => Array.isArray(hw.attachmentIds) && hw.attachmentIds.length > 0) : [];
      }
      // dppHomeworks = DPP PDFs (dpp.homeworkIds in schedule response)
      if (schedData.dpp && Array.isArray(schedData.dpp.homeworkIds)) {
        payload.dpps = (schedData.dpp && Array.isArray(schedData.dpp.homeworkIds)) ? schedData.dpp.homeworkIds.filter(dp => Array.isArray(dp.attachmentIds) && dp.attachmentIds.length > 0) : [];
      }
    } catch (schedErr) {
      console.warn('[Schedule fetch] Failed, sending without attachments:', schedErr.message);
    }
  }

  try {
    let result = null;
    if (WSBridge.isReady() || WSBridge.connecting) {
      try {
        result = await WSBridge.call('send_bot', payload, 25000);
      } catch (wsErr) {
        console.warn('Bot send via WS tunnel fallback to HTTP:', wsErr);
      }
    }

    if (!result) {
      const resp = await fetch('/bot/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      result = await resp.json();
    }

    if (result.success) {
      haptic('success');
      state.lastSentItem = item;
      state.lastSentType = type;
      openPopup();
    } else {
      if (result.forcesub) {
        await checkInAppForceSub(false);
        showToast('🔒 Access Restricted: Please join our community first!');
        return;
      }
      throw new Error(result.error || 'Send failed');
    }
  } catch (err) {
    console.warn('Bot send failed:', err.message);
    showToast('âŒ Failed to send. Please try again.');
  } finally {
    state.isSending = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTION SELECTION SHEET & IN-APP VIDEO PLAYER
// ═══════════════════════════════════════════════════════════════

let selectedActionItem = null;

function openActionSheet(itemId, type) {
  haptic('light');
  const item = state.loadedPayloads[itemId];
  if (!item) return;

  selectedActionItem = { itemId, type, item };
  const vd = item.videoDetails || {};
  const name = vd.name || item.topic || 'Lecture';
  const sub = state.subject?.subject || '';

  const nameEl = document.getElementById('action-lecture-name');
  const subEl = document.getElementById('action-lecture-sub');
  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = sub ? `${sub} • Choose action` : 'Choose action';

  const overlay = document.getElementById('action-overlay');
  const sheet = document.getElementById('action-sheet');
  if (overlay && sheet) {
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      sheet.classList.add('popup-visible');
    });
  }
}

function closeActionSheet() {
  const sheet = document.getElementById('action-sheet');
  const overlay = document.getElementById('action-overlay');
  if (sheet) sheet.classList.remove('popup-visible');
  setTimeout(() => {
    if (overlay) overlay.classList.add('hidden');
  }, 250);
}

function confirmSendToChat() {
  closeActionSheet();
  if (selectedActionItem) {
    sendContent(selectedActionItem.itemId, selectedActionItem.type);
  }
}

// --- Modern In-App HLS/DASH Video Player ---
let playerControlsInitialized = false;
let isDraggingScrubber = false;
let controlsTimeout = null;

function formatPlayerTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${String(remM).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function initPlayerControls() {
  if (playerControlsInitialized) return;
  playerControlsInitialized = true;

  const videoEl = document.getElementById('rangex-video');
  const track = document.getElementById('scrubber-track');
  const played = document.getElementById('scrubber-played');
  const buffered = document.getElementById('scrubber-buffered');
  const handle = document.getElementById('scrubber-handle');
  const timeCurr = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const playPauseBtn = document.getElementById('btn-play-pause');
  const centerIcon = document.getElementById('center-play-icon');
  const centerOverlay = document.getElementById('video-play-center');

  if (!videoEl || !track) return;

  function updateScrubber() {
    if (!videoEl.duration || isDraggingScrubber) return;
    const pct = (videoEl.currentTime / videoEl.duration) * 100;
    if (played) played.style.width = `${pct}%`;
    if (handle) handle.style.left = `${pct}%`;
    if (timeCurr) timeCurr.textContent = formatPlayerTime(videoEl.currentTime);
    if (timeTotal) timeTotal.textContent = formatPlayerTime(videoEl.duration);

    if (buffered && videoEl.buffered.length > 0) {
      try {
        const bufEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
        const bufPct = (bufEnd / videoEl.duration) * 100;
        buffered.style.width = `${Math.min(bufPct, 100)}%`;
      } catch (e) {}
    }
  }

  function seekVideo(e) {
    const rect = track.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (videoEl.duration) {
      videoEl.currentTime = ratio * videoEl.duration;
      const pct = ratio * 100;
      if (played) played.style.width = `${pct}%`;
      if (handle) handle.style.left = `${pct}%`;
      if (timeCurr) timeCurr.textContent = formatPlayerTime(videoEl.currentTime);
    }
  }

  track.addEventListener('mousedown', (e) => {
    isDraggingScrubber = true;
    clearTimeout(controlsTimeout);
    showPlayerControls();
    seekVideo(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (isDraggingScrubber) {
      clearTimeout(controlsTimeout);
      showPlayerControls();
      seekVideo(e);
    }
  });
  window.addEventListener('mouseup', () => {
    if (isDraggingScrubber) {
      isDraggingScrubber = false;
      resetControlsTimeout();
    }
  });

  track.addEventListener('touchstart', (e) => {
    isDraggingScrubber = true;
    clearTimeout(controlsTimeout);
    showPlayerControls();
    seekVideo(e);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (isDraggingScrubber) {
      clearTimeout(controlsTimeout);
      showPlayerControls();
      seekVideo(e);
    }
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (isDraggingScrubber) {
      isDraggingScrubber = false;
      resetControlsTimeout();
    }
  });

  // Mouse & Touch movement anywhere on video wakes up controls
  const wrapper = document.getElementById('video-wrapper');
  if (wrapper) {
    wrapper.addEventListener('mousemove', () => resetControlsTimeout());
    wrapper.addEventListener('touchstart', () => resetControlsTimeout(), { passive: true });
  }

  videoEl.addEventListener('timeupdate', updateScrubber);
  videoEl.addEventListener('durationchange', () => {
    if (timeTotal) timeTotal.textContent = formatPlayerTime(videoEl.duration);
  });
  videoEl.addEventListener('progress', updateScrubber);

  videoEl.addEventListener('play', () => {
    if (playPauseBtn) playPauseBtn.innerHTML = 'âšâš';
    if (centerIcon) centerIcon.innerHTML = 'âšâš';
    if (centerOverlay) centerOverlay.classList.add('playing');
    resetControlsTimeout();
  });

  videoEl.addEventListener('pause', () => {
    if (playPauseBtn) playPauseBtn.innerHTML = 'â–¶';
    if (centerIcon) centerIcon.innerHTML = 'â–¶';
    if (centerOverlay) centerOverlay.classList.remove('playing');
    clearTimeout(controlsTimeout);
    showPlayerControls();
  });

  videoEl.addEventListener('ended', () => {
    if (playPauseBtn) playPauseBtn.innerHTML = 'â–¶';
    if (centerIcon) centerIcon.innerHTML = 'â–¶';
    if (centerOverlay) centerOverlay.classList.remove('playing');
    clearTimeout(controlsTimeout);
    showPlayerControls();
  });

  window.addEventListener('click', (e) => {
    if (!e.target.closest('#quality-dropdown-wrap')) {
      closeQualityMenu();
    }
  });
}

function showPlayerControls() {
  const topBar = document.getElementById('player-top-bar');
  const bottomBar = document.getElementById('player-bottom-controls');
  const wrapper = document.getElementById('video-wrapper');
  if (topBar) topBar.classList.remove('fade-out');
  if (bottomBar) bottomBar.classList.remove('fade-out');
  if (wrapper) wrapper.classList.remove('hide-cursor');
}

function hidePlayerControls() {
  const videoEl = document.getElementById('rangex-video');
  const topBar = document.getElementById('player-top-bar');
  const bottomBar = document.getElementById('player-bottom-controls');
  const wrapper = document.getElementById('video-wrapper');
  const qualityMenu = document.getElementById('quality-menu');

  if (!videoEl || videoEl.paused || isDraggingScrubber) return;
  if (qualityMenu && !qualityMenu.classList.contains('hidden')) return;

  if (topBar) topBar.classList.add('fade-out');
  if (bottomBar) bottomBar.classList.add('fade-out');
  if (wrapper) wrapper.classList.add('hide-cursor');
}

function resetControlsTimeout() {
  clearTimeout(controlsTimeout);
  showPlayerControls();
  const videoEl = document.getElementById('rangex-video');
  if (videoEl && !videoEl.paused && !isDraggingScrubber) {
    controlsTimeout = setTimeout(hidePlayerControls, 2500); // 2.5s Netlify auto-hide
  }
}

function togglePlayerControlsVisibility(e) {
  if (e.target.closest('#player-bottom-controls') || 
      e.target.closest('#player-top-bar') || 
      e.target.closest('#quality-menu') || 
      e.target.closest('.video-play-center')) return;

  const bottomBar = document.getElementById('player-bottom-controls');
  if (!bottomBar) return;
  if (bottomBar.classList.contains('fade-out')) {
    resetControlsTimeout();
  } else {
    hidePlayerControls();
  }
}

function toggleRangeXPlay(e) {
  if (e) e.stopPropagation();
  const videoEl = document.getElementById('rangex-video');
  if (!videoEl) return;
  haptic('light');
  if (videoEl.paused) {
    videoEl.play().catch(() => {});
  } else {
    videoEl.pause();
  }
}

function skipVideo(delta) {
  const videoEl = document.getElementById('rangex-video');
  if (!videoEl) return;
  haptic('light');
  const target = Math.max(0, Math.min(videoEl.duration || 0, videoEl.currentTime + delta));
  videoEl.currentTime = target;
  showToast(delta > 0 ? `â© +${delta}s` : `âª ${delta}s`);
  resetControlsTimeout();
}

function setPlaySpeed(speed) {
  const videoEl = document.getElementById('rangex-video');
  if (videoEl) videoEl.playbackRate = speed;

  document.querySelectorAll('.speed-buttons .speed-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim() === `${speed}x`);
  });
  showToast(`⚡ Speed: ${speed}x`);
  resetControlsTimeout();
}

function toggleQualityMenu(e) {
  if (e) e.stopPropagation();
  haptic('light');
  const menu = document.getElementById('quality-menu');
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

function closeQualityMenu() {
  const menu = document.getElementById('quality-menu');
  if (menu) menu.classList.add('hidden');
}

function renderQualityOptions() {
  const menu = document.getElementById('quality-menu');
  const label = document.getElementById('quality-label');
  if (!menu) return;

  if (window.hlsPlayer && window.hlsPlayer.levels && window.hlsPlayer.levels.length > 0) {
    const levels = window.hlsPlayer.levels;
    let html = `<div class="quality-menu-header">Select Video Quality</div>`;
    const isAuto = (window.hlsPlayer.currentLevel === -1);
    html += `
      <button class="quality-item ${isAuto ? 'active' : ''}" onclick="setQualityLevel(-1, 'Auto')">
        <span>⚡ Auto (Best)</span>
        ${isAuto ? '<span class="quality-check">✓</span>' : ''}
      </button>
    `;
    levels.forEach((lvl, idx) => {
      const res = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`;
      const isAct = (window.hlsPlayer.currentLevel === idx);
      html += `
        <button class="quality-item ${isAct ? 'active' : ''}" onclick="setQualityLevel(${idx}, '${res}')">
          <span>ðŸ“º ${res}</span>
          ${isAct ? '<span class="quality-check">✓</span>' : ''}
        </button>
      `;
    });
    menu.innerHTML = html;
  } else {
    menu.innerHTML = `
      <div class="quality-menu-header">Select Video Quality</div>
      <button class="quality-item active" onclick="setQualityLevel(-1, 'Auto')">
        <span>⚡ Auto (Default)</span>
        <span class="quality-check">✓</span>
      </button>
    `;
    if (label) label.textContent = 'Auto';
  }
}

function setQualityLevel(levelIndex, label) {
  if (window.hlsPlayer) {
    window.hlsPlayer.currentLevel = levelIndex;
    const lbl = document.getElementById('quality-label');
    if (lbl) lbl.textContent = label;
    showToast(`ðŸ“º Quality: ${label}`);
  }
  closeQualityMenu();
  renderQualityOptions();
}

function toggleRangeXFullscreen() {
  const modal = document.getElementById('player-modal');
  const videoEl = document.getElementById('rangex-video');
  if (!modal) return;
  haptic('light');

  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFs) {
    if (modal.requestFullscreen) {
      modal.requestFullscreen().catch(() => {});
    } else if (videoEl && videoEl.webkitEnterFullscreen) {
      videoEl.webkitEnterFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen().catch(() => {});
    }
  }
  resetControlsTimeout();
}

function launchRangeXPlayer() {
  closeActionSheet();
  if (!selectedActionItem) return;

  const item = selectedActionItem.item;
  const vd = item.videoDetails || {};
  const name = vd.name || item.topic || 'Lecture';
  const rawUrl = vd.videoUrl || vd.url || item.url || '';
  const drm = vd.drm || item.drm || null;

  // Slides & notes (from PW API response)
  const slides = vd.slides || item.slides || [];
  const notes = vd.notes || item.homeworkIds || item.homeworks || [];

  if (!rawUrl) {
    showToast('\u26a0\ufe0f Video stream not found');
    return;
  }

  haptic('medium');

  const accent = (window.APP_CONFIG && window.APP_CONFIG.ACCENT_COLOR) || '#ff6b4a';

  InvalidPlayer.open({
    url: rawUrl,
    title: name,
    drm: drm,
    accentColor: accent,
    slides: slides,
    notes: notes,
    onClose: () => {
      haptic('light');
      updateTgBackButton();
    }
  });

  // Push a Telegram back-button handler for the player
  if (state.tg && state.tg.BackButton) {
    state.tg.BackButton.onClick(() => {
      InvalidPlayer.close();
    });
    state.tg.BackButton.show();
  }
}

function closeInteractivePlayer(e) {
  if (e) e.stopPropagation();
  (window.InteractivePlayer || window.InvalidPlayer)?.close();
}
function closeRangeXPlayer(e) {
  if (e) e.stopPropagation();
  InvalidPlayer.close();
}

// ═══════════════════════════════════════════════════════════════
// BOT CONFIRMATION POPUP BOTTOM SHEET
// ═══════════════════════════════════════════════════════════════

function openPopup() {
  const overlay = document.getElementById('popup-overlay');
  const sheet = document.getElementById('popup-sheet');
  const retryBtn = document.getElementById('popup-retry-btn');
  if (retryBtn) retryBtn.setAttribute('onclick', 'retrySend()');
  
  if (overlay && sheet) {
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      sheet.classList.add('popup-visible');
    });
  }
}

function closePopup() {
  const sheet = document.getElementById('popup-sheet');
  const overlay = document.getElementById('popup-overlay');
  if (sheet) sheet.classList.remove('popup-visible');
  setTimeout(() => {
    if (overlay) overlay.classList.add('hidden');
  }, 250);
}

function retrySend() {
  closePopup();
  if (state.lastSentItem && state.lastSentType) {
    sendContent(state.lastSentItem, state.lastSentType);
  }
}

function openBotLink(url) {
  if (state.tg?.openTelegramLink) {
    state.tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
}

// ═══════════════════════════════════════════════════════════════
// FAVOURITES MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function toggleFavourite(batchId, batchData = null) {
  haptic('light');
  if (!batchId) return;

  let bObj = null;
  if (batchData && typeof batchData === 'object') {
    bObj = batchData;
  } else if (state.loadedBatches && state.loadedBatches[batchId]) {
    bObj = state.loadedBatches[batchId];
  } else if (state.batch && state.batch._id === batchId) {
    bObj = state.batch;
  } else if (state.batches) {
    bObj = state.batches.find(b => b._id === batchId);
  } else if (state.favBatches && state.favBatches[batchId]) {
    bObj = state.favBatches[batchId];
  }

  if (state.favourites.has(batchId)) {
    state.favourites.delete(batchId);
    if (state.favBatches) delete state.favBatches[batchId];
  } else {
    state.favourites.add(batchId);
    if (!state.favBatches) state.favBatches = {};
    if (bObj) state.favBatches[batchId] = bObj;
  }

  localStorage.setItem('pw_favs', JSON.stringify([...state.favourites]));
  localStorage.setItem('pw_fav_batches', JSON.stringify(state.favBatches || {}));

  // Update heart on batch card
  const heartEl = document.getElementById(`heart-${batchId}`);
  if (heartEl) heartEl.textContent = state.favourites.has(batchId) ? 'â¤ï¸' : 'ðŸ¤';

  // Update heart on batch view hero
  const batchHeartEl = document.getElementById('batch-view-heart');
  if (batchHeartEl && state.batch && state.batch._id === batchId) {
    batchHeartEl.textContent = state.favourites.has(batchId) ? 'â¤ï¸' : 'ðŸ¤';
  }

  updateBatchCounts();
  if (state.homeTab === 'fav') renderFavourites();
}

function renderFavourites() {
  const grid = document.getElementById('batches-grid');
  const favBatches = Object.values(state.favBatches || {});

  if (favBatches.length === 0) {
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">â¤ï¸</div>
          <div class="empty-state-title">No Favourites Saved</div>
          <div class="empty-state-sub">Tap ðŸ¤ on any batch to pin it here for fast 1-tap access</div>
        </div>`;
    }
  } else if (grid) {
    favBatches.forEach(b => {
      if (b._id) state.loadedBatches[b._id] = b;
    });
    grid.innerHTML = favBatches.map(b => renderBatchCard(b)).join('');
  }
}

function switchHomeTab(tab) {
  state.homeTab = tab;
  document.getElementById('tab-all')?.classList.toggle('active', tab === 'all');
  document.getElementById('tab-fav')?.classList.toggle('active', tab === 'fav');
  document.getElementById('load-more-btn')?.classList.toggle('hidden', tab === 'fav');

  const label = document.getElementById('home-section-label');
  if (tab === 'fav') {
    if (label) label.textContent = 'Favourite Batches';
    renderFavourites();
  } else {
    if (label) label.textContent = 'Enrolled Batches';
    const grid = document.getElementById('batches-grid');
    if (grid) grid.innerHTML = state.batches.map(b => renderBatchCard(b)).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 1: DYNAMIC THEMES & SKINS ENGINE
// ═══════════════════════════════════════════════════════════════
const THEME_STORAGE_KEY = 'studyhub_theme';
const THEME_META_COLORS = {
  violet: '#08080a',
  cyberpunk: '#030806',
  netflix: '#060606',
  gold: '#070604'
};

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || 'violet';
  applyTheme(saved, false);
}

function applyTheme(themeKey, notify = true) {
  const validThemes = ['violet', 'cyberpunk', 'netflix', 'gold'];
  const theme = validThemes.includes(themeKey) ? themeKey : 'violet';
  
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  const metaColor = document.getElementById('meta-theme-color');
  if (metaColor) metaColor.setAttribute('content', THEME_META_COLORS[theme] || '#08080a');

  try {
    state.tg?.setHeaderColor?.(THEME_META_COLORS[theme] || '#08080a');
    state.tg?.setBackgroundColor?.(THEME_META_COLORS[theme] || '#08080a');
  } catch (e) {}

  validThemes.forEach(t => {
    const card = document.getElementById(`theme-card-${t}`);
    if (card) {
      if (t === theme) {
        card.style.borderColor = 'var(--accent-cyan)';
        card.style.background = 'var(--bg-card-hover)';
      } else {
        card.style.borderColor = 'var(--border-subtle)';
        card.style.background = 'var(--bg-input)';
      }
    }
  });

  if (notify) {
    haptic('light');
    showToast(`✨ Theme changed to ${theme.toUpperCase()}`);
  }
}

function selectTheme(themeKey) {
  applyTheme(themeKey, true);
  closeThemeModal();
}

function openThemeModal() {
  haptic('light');
  const modal = document.getElementById('modal-theme-picker');
  if (modal) modal.classList.remove('hidden');
}

function closeThemeModal() {
  const modal = document.getElementById('modal-theme-picker');
  if (modal) modal.classList.add('hidden');
}

function closeThemeModalOnBackdrop(e) {
  if (e.target.id === 'modal-theme-picker') closeThemeModal();
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: PWA INSTALLATION ENGINE (STANDALONE ANDROID APP)
// ═══════════════════════════════════════════════════════════════
let deferredPwaPrompt = null;

function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('SW registration skipped:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    showPWAInstallButtons(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    showPWAInstallButtons(false);
    haptic('success');
    showToast('🎉 \ App Installed!');
  });

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!isStandalone) {
    showPWAInstallButtons(true);
  } else {
    showPWAInstallButtons(false);
  }
}

function showPWAInstallButtons(show) {
  const btnPlatforms = document.getElementById('btn-install-pwa');
  const btnHome = document.getElementById('btn-install-pwa-home');
  if (btnPlatforms) btnPlatforms.classList.toggle('hidden', !show);
  if (btnHome) btnHome.classList.toggle('hidden', !show);

  // Show "Open Web" button inside Telegram so students know they can play on browser
  const isInsideTelegram = Boolean(window.Telegram?.WebApp?.initData);
  const btnWebPlatforms = document.getElementById('btn-open-web');
  const btnWebHome = document.getElementById('btn-open-web-home');
  if (btnWebPlatforms) btnWebPlatforms.classList.toggle('hidden', !isInsideTelegram);
  if (btnWebHome) btnWebHome.classList.toggle('hidden', !isInsideTelegram);
}

function triggerPWAInstall() {
  haptic('light');
  const modal = document.getElementById('modal-install-guide');
  if (modal) modal.classList.remove('hidden');
}

function closeInstallModal() {
  const modal = document.getElementById('modal-install-guide');
  if (modal) modal.classList.add('hidden');
}

function closeInstallModalOnBackdrop(e) {
  if (e.target.id === 'modal-install-guide') closeInstallModal();
}

function openInChromeBrowser() {
  haptic('medium');
  const initData = getTelegramInitData();
  
  // Destination: If running on Netlify use current origin, otherwise default to user's netlify URL
  const isNetlify = typeof window !== 'undefined' && window.location.hostname.includes('netlify.app');
  const targetDomain = isNetlify ? window.location.origin : window.APP_CONFIG?.WEBAPP_URL || window.location.origin;
  
  const hashParts = [];
  if (initData) hashParts.push(`tgWebAppData=${encodeURIComponent(initData)}`);
  
  const targetUrl = hashParts.length > 0 
    ? `${targetDomain.replace(/\/$/, '')}/#${hashParts.join('&')}`
    : `${targetDomain.replace(/\/$/, '')}/`;
  
  if (state.tg?.openLink) {
    try {
      state.tg.openLink(targetUrl, { try_instant_view: false });
    } catch (e) {
      window.open(targetUrl, '_blank');
    }
  } else {
    window.open(targetUrl, '_blank');
  }
  showToast('ðŸŒ Opening in Chrome... tap (â‹®) -> "Install App"');
}

async function handleInstallAction() {
  if (deferredPwaPrompt) {
    try {
      deferredPwaPrompt.prompt();
      const choice = await deferredPwaPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showToast('â³ Installing \ App...');
      }
      deferredPwaPrompt = null;
      closeInstallModal();
    } catch (e) {
      openInChromeBrowser();
    }
  } else {
    openInChromeBrowser();
  }
}

async function triggerNativeInstallPrompt() {
  handleInstallAction();
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 3: VIP REFERRAL & INVITE SYSTEM
// ═══════════════════════════════════════════════════════════════
let userReferralData = {
  is_vip: false,
  referrals: 0,
  target: 3,
  invite_link: (window.APP_CONFIG?.BOT_LINK || 'https://t.me/yourstudybot')
};

async function fetchVipStatus() {
  const uid = state.chatId;
  if (!uid) return;

  try {
    const data = await serverGet(`/api/user/vip-status?user_id=${encodeURIComponent(uid)}`);
    if (data && data.success) {
      userReferralData = {
        is_vip: !!data.is_vip,
        referrals: data.referrals || 0,
        target: data.target || 3,
        invite_link: data.invite_link || `' + (window.APP_CONFIG ? window.APP_CONFIG.BOT_LINK : 'https://t.me/yourstudybot') + '?start=ref_${uid}`
      };
      renderVipStatusUI();
    }
  } catch (e) {
    console.warn('VIP status check error:', e);
  }
}

function renderVipStatusUI() {
  const isVip = userReferralData.is_vip || userReferralData.referrals >= userReferralData.target;
  
  const vipBtnPlatforms = document.getElementById('btn-vip-header');
  const vipBtnHome = document.getElementById('btn-vip-header-home');
  if (vipBtnPlatforms) vipBtnPlatforms.classList.toggle('hidden', !isVip);
  if (vipBtnHome) vipBtnHome.classList.toggle('hidden', !isVip);

  const countEl = document.getElementById('ref-stat-count');
  if (countEl) countEl.textContent = `${userReferralData.referrals} / ${userReferralData.target}`;

  const statusEl = document.getElementById('ref-stat-status');
  if (statusEl) {
    statusEl.innerHTML = isVip ? '👑 VIP Student' : 'Student';
    statusEl.style.color = isVip ? 'var(--accent-gold)' : 'var(--text-primary)';
  }

  const linkEl = document.getElementById('referral-link-display');
  if (linkEl) {
    linkEl.textContent = userReferralData.invite_link;
  }
}

function openReferralModal() {
  haptic('light');
  const modal = document.getElementById('modal-referral');
  if (modal) modal.classList.remove('hidden');
  fetchVipStatus();
}

function closeReferralModal() {
  const modal = document.getElementById('modal-referral');
  if (modal) modal.classList.add('hidden');
}

function closeReferralModalOnBackdrop(e) {
  if (e.target.id === 'modal-referral') closeReferralModal();
}

function copyReferralLink() {
  const link = userReferralData.invite_link || (state.chatId ? `' + (window.APP_CONFIG ? window.APP_CONFIG.BOT_LINK : 'https://t.me/yourstudybot') + '?start=ref_${state.chatId}` : (window.APP_CONFIG?.BOT_LINK || 'https://t.me/yourstudybot'));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      haptic('success');
      showToast('📋 Unique Invite Link Copied!');
    }).catch(() => {
      fallbackCopy(link);
    });
  } else {
    fallbackCopy(link);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    haptic('success');
    showToast('📋 Unique Invite Link Copied!');
  } catch (e) {
    showToast('⚠️ï¸ Could not auto-copy. Please select and copy link manually.');
  }
  document.body.removeChild(ta);
}

function shareReferralTelegram() {
  const link = userReferralData.invite_link || (state.chatId ? `' + (window.APP_CONFIG ? window.APP_CONFIG.BOT_LINK : 'https://t.me/yourstudybot') + '?start=ref_${state.chatId}` : (window.APP_CONFIG?.BOT_LINK || 'https://t.me/yourstudybot'));
  const text = `🔥 Join \ for free Physics Wallah, NextToppers & JEE/NEET Batches, full lecture video streaming, notes & DPPs!`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  
  if (state.tg?.openTelegramLink) {
    state.tg.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, '_blank');
  }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: GURU AI DOUBT SOLVER ENGINE
// ═══════════════════════════════════════════════════════════════
let guruAttachedPhotoBase64 = null;

function handleGuruPhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    haptic('error');
    showToast('Please select a valid image file (PNG/JPG)');
    return;
  }

  const photoStatus = document.getElementById('guru-photo-status');
  if (photoStatus) {
    photoStatus.textContent = 'Processing image...';
    photoStatus.style.color = 'var(--accent-ochre)';
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const rawData = e.target.result;
    const img = new Image();
    img.onload = function() {
      try {
        const maxDim = 1280;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        guruAttachedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.8);
      } catch (err) {
        console.warn('Canvas compression fallback to raw:', err);
        guruAttachedPhotoBase64 = rawData;
      }

      const previewContainer = document.getElementById('guru-preview-container');
      const previewImg = document.getElementById('guru-preview-image');
      if (previewImg) previewImg.src = guruAttachedPhotoBase64;
      if (previewContainer) previewContainer.classList.remove('hidden');
      if (photoStatus) {
        photoStatus.textContent = `Attached: ${file.name.slice(0, 16)}... (Ready)`;
        photoStatus.style.color = 'var(--accent-cyan)';
      }
      haptic('light');
      showToast('ðŸ“· Photo ready! Tap "Ask Guru AI"');
    };
    img.onerror = function() {
      guruAttachedPhotoBase64 = rawData;
      const previewContainer = document.getElementById('guru-preview-container');
      const previewImg = document.getElementById('guru-preview-image');
      if (previewImg) previewImg.src = guruAttachedPhotoBase64;
      if (previewContainer) previewContainer.classList.remove('hidden');
      if (photoStatus) {
        photoStatus.textContent = `Attached: ${file.name.slice(0, 16)}...`;
        photoStatus.style.color = 'var(--accent-cyan)';
      }
      haptic('light');
      showToast('ðŸ“· Photo attached! Tap "Ask Guru AI"');
    };
    img.src = rawData;
  };
  reader.readAsDataURL(file);
}

function clearGuruPhoto() {
  guruAttachedPhotoBase64 = null;
  const previewContainer = document.getElementById('guru-preview-container');
  const fileInput = document.getElementById('guru-file-input');
  const photoStatus = document.getElementById('guru-photo-status');

  if (previewContainer) previewContainer.classList.add('hidden');
  if (fileInput) fileInput.value = '';
  if (photoStatus) {
    photoStatus.textContent = 'No photo attached';
    photoStatus.style.color = 'var(--text-muted)';
  }
}

async function askGuruAI() {
  const inputEl = document.getElementById('guru-question-input');
  const text = (inputEl?.value || '').trim();

  if (!text && !guruAttachedPhotoBase64) {
    haptic('warning');
    showToast('⚠️ï¸ Please enter a question or upload a photo!');
    inputEl?.focus();
    return;
  }

  const loadingCard = document.getElementById('guru-loading-card');
  const resultCard = document.getElementById('guru-result-card');
  const btnAsk = document.getElementById('btn-ask-guru');
  const loadingText = document.getElementById('guru-loading-text');
  const loadingSubtext = document.getElementById('guru-loading-subtext');

  if (loadingText) loadingText.textContent = 'ðŸ” Reading & scanning question text...';
  if (loadingSubtext) loadingSubtext.textContent = 'Analyzing syntax, intent & extracting core concepts...';

  loadingCard?.classList.remove('hidden');
  resultCard?.classList.add('hidden');
  if (btnAsk) {
    btnAsk.disabled = true;
    btnAsk.style.opacity = '0.6';
  }

  haptic('medium');

  const startTime = Date.now();
  const timer1 = setTimeout(() => {
    if (loadingText) loadingText.textContent = 'ðŸ§  Analyzing syllabus & identifying governing laws...';
    if (loadingSubtext) loadingSubtext.textContent = 'Mapping topic to Physics Wallah / Next Toppers curriculum...';
  }, 750);

  const timer2 = setTimeout(() => {
    if (loadingText) loadingText.textContent = 'âœï¸ Formulating step-by-step verified solution...';
    if (loadingSubtext) loadingSubtext.textContent = 'Finalizing derivations, key formulas & exam takeaways...';
  }, 1600);

  try {
    let data = null;
    if (WSBridge.isReady() || WSBridge.connecting) {
      try {
        data = await WSBridge.call('solve_doubt', {
          question: text,
          photo_base64: guruAttachedPhotoBase64
        }, 35000);
      } catch (wsErr) {
        console.warn('Guru solve via WS tunnel failed, falling back to HTTP:', wsErr);
      }
    }

    if (!data) {
      const res = await fetch('/api/guru/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          photo_base64: guruAttachedPhotoBase64,
          user_id: state.chatId
        })
      });
      data = await res.json();
    }

    // Ensure a natural, realistic thinking duration of ~2.4s so it feels like real AI reasoning
    const elapsed = Date.now() - startTime;
    const minDelay = 2200;
    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }
    clearTimeout(timer1);
    clearTimeout(timer2);

    loadingCard?.classList.add('hidden');

    if (btnAsk) {
      btnAsk.disabled = false;
      btnAsk.style.opacity = '1';
    }

    if (data && data.success) {
      const solutionText = document.getElementById('guru-solution-text');
      const subjectTag = document.getElementById('guru-solution-subject');
      const recoText = document.getElementById('guru-recommendation-text');
      const timeTag = document.getElementById('guru-solution-timestamp');

      if (subjectTag) subjectTag.textContent = (data.subject || 'STEM').toUpperCase();
      if (timeTag) timeTag.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      if (solutionText) {
        let formatted = (data.answer || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code>$1</code>')
          .replace(/\n\n/g, '<br/><br/>')
          .replace(/\n/g, '<br/>');
        solutionText.innerHTML = formatted;
      }

      if (recoText) {
        recoText.textContent = data.recommendation || 'Physics Wallah Foundation / Arjuna / Lakshya Batches';
      }

      resultCard?.classList.remove('hidden');
      resultCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      haptic('success');
    } else {
      haptic('error');
      showToast(data.message || '⚠️ï¸ Guru could not solve this problem. Please retry!');
    }
  } catch (err) {
    console.error('Guru AI solver error:', err);
    loadingCard?.classList.add('hidden');
    if (btnAsk) {
      btnAsk.disabled = false;
      btnAsk.style.opacity = '1';
    }
    haptic('error');
    showToast('Connection error reaching Guru AI. Please try again.');
  }
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

// Immediate bootstrap
initTelegram();

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load brand config first (sets title, accent color, bot links, all branding)
  await loadAppConfig();

  initTelegram();
  if (!verifyTelegramAccess()) return;

  const subOk = await checkInAppForceSub(false);
  if (!subOk) return;

  initTheme();
  initPWA();
  fetchVipStatus();
  initSearch();
  loadBatches(true);
  updateTgBackButton();

  // Close search panel on click outside
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('search-results-panel');
    const input = document.getElementById('batch-search-input');
    if (panel && input && !panel.contains(e.target) && e.target !== input) {
      panel.classList.add('hidden');
    }
  });
});


