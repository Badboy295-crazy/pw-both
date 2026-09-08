// ════════════════════════════════════════════════════════════════════════════
// webapp/player.js  —  Advanced Interactive Player (Vanilla JS Port)
// Features: HLS.js + Shaka (DASH/DRM), slides sidebar, speed controls,
//           double-tap skip, touch gestures, quality selector, notes panel
// ════════════════════════════════════════════════════════════════════════════
// CDN dependencies loaded in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
//   <script src="https://cdn.jsdelivr.net/npm/shaka-player@4/dist/shaka-player.ui.js"></script>

'use strict';

(function () {
  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
  const DBL_TAP_DELAY = 280;
  const SKIP_WIN = 800;

  // ─── Player State ──────────────────────────────────────────────────────
  let _video = null;
  let _hls = null;
  let _shaka = null;
  let _playerEl = null;
  let _controlsTimeout = null;
  let _skipResetTimeout = null;

  let _state = {
    url: '', title: '', drm: null, accentColor: '#ff3131',
    slides: [], notes: [],
    isPlaying: false, duration: 0, currentTime: 0,
    volume: 1, isMuted: false, playbackRate: 1,
    isFullscreen: false, showControls: true,
    isBuffering: true, hasError: false, isResolved: false,
    qualities: [], selectedQuality: -1,
    sidebarOpen: false, sidebarTab: 'slides',
    activeSlide: null,
    lastTap: 0, skipAmount: 0, skipDir: null,
    showSkipFeedback: false, showPlayFeedback: false, playFeedbackType: 'play',
    showSpeedFeedback: false, speedFeedbackVal: 1,
    onClose: null,
  };

  // ─── Utility ───────────────────────────────────────────────────────────
  function fmt(t) {
    if (isNaN(t) || t < 0) return '00:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function el(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qA(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function css(el, obj) { if (el) Object.assign(el.style, obj); }
  function show(el) { if (el) el.classList.remove('px-hidden'); }
  function hide(el) { if (el) el.classList.add('px-hidden'); }
  function toggle(el, on) { if (el) el.classList.toggle('px-hidden', !on); }

  function accentRgb(hex) {
    const h = (hex || '#ff3131').replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }

  // ─── Build Player DOM ──────────────────────────────────────────────────
  function buildPlayerHTML(accent) {
    const [r,g,b] = accentRgb(accent);
    return `
<div id="px-overlay" class="px-overlay px-hidden">
  <div id="px-root" class="px-root">

    <!-- VIDEO -->
    <video id="px-video" class="px-video" playsinline></video>

    <!-- BUFFERING SPINNER -->
    <div id="px-spinner" class="px-spinner px-center">
      <div class="px-spin-ring" style="border-top-color:${accent}"></div>
    </div>

    <!-- ERROR STATE -->
    <div id="px-error" class="px-error px-center px-hidden">
      <div class="px-error-icon">⚠️</div>
      <p class="px-error-text">Failed to load video</p>
      <button class="px-btn-retry" onclick="InvalidPlayer.retry()">↺ Retry</button>
    </div>

    <!-- SKIP FEEDBACK -->
    <div id="px-skip-fb" class="px-skip-fb px-center px-hidden">
      <span id="px-skip-icon">⏩</span>
      <span id="px-skip-text"></span>
    </div>

    <!-- PLAY/PAUSE FEEDBACK -->
    <div id="px-play-fb" class="px-play-fb px-center px-hidden">
      <span id="px-play-icon">▶</span>
    </div>

    <!-- SPEED FEEDBACK -->
    <div id="px-speed-fb" class="px-speed-fb px-hidden">
      <span id="px-speed-text"></span>
    </div>

    <!-- 2X SPEED BOOST OVERLAY HUD (YouTube style) -->
    <div id="px-boost-hud" class="px-boost-hud px-hidden">
      <span class="px-boost-icon">⚡</span>
      <span class="px-boost-text">2X Speed</span>
    </div>

    <!-- CLICK ZONES (left skip / center toggle / right skip) -->
    <div class="px-zones">
      <div class="px-zone-left" id="px-zone-l" onclick="InvalidPlayer._tapLeft(event)"></div>
      <div class="px-zone-center" id="px-zone-c" onclick="InvalidPlayer._tapCenter(event)"></div>
      <div class="px-zone-right" id="px-zone-r" onclick="InvalidPlayer._tapRight(event)"></div>
    </div>

    <!-- TOP BAR -->
    <div id="px-topbar" class="px-topbar">
      <div class="px-topbar-left">
        <span class="px-badge" style="background:rgba(${r},${g},${b},0.2);color:${accent};border-color:rgba(${r},${g},${b},0.4)">
          ⚡ <span id="px-brand-badge" data-brand-name>STUDY HUB</span> PLAYER
        </span>
        <span id="px-title" class="px-title"></span>
      </div>
      <div class="px-topbar-right">
        <button class="px-icon-btn" id="px-btn-sidebar" onclick="InvalidPlayer.toggleSidebar()" title="Slides & Notes">
          📖
        </button>
        <button class="px-icon-btn" id="px-btn-close" onclick="InvalidPlayer.close()" title="Close">✕</button>
      </div>
    </div>

    <!-- CONTROLS BOTTOM BAR -->
    <div id="px-controls" class="px-controls">

      <!-- PROGRESS BAR -->
      <div class="px-progress-wrap">
        <span class="px-time" id="px-cur-time">00:00</span>
        <div class="px-progress-track" id="px-progress-track">
          <div class="px-progress-fill" id="px-progress-fill" style="background:${accent}"></div>
          <input type="range" class="px-scrubber" id="px-scrubber" min="0" value="0" step="0.1"
            oninput="InvalidPlayer.seek(this.value)" />
        </div>
        <span class="px-time" id="px-dur-time">00:00</span>
      </div>

      <!-- CONTROL ROW -->
      <div class="px-ctrl-row">
        <!-- LEFT: speed, skip back -->
        <div class="px-ctrl-group">
          <button class="px-icon-btn" onclick="InvalidPlayer.changeSpeed(-1)" title="Slower">🐢</button>
          <span class="px-speed-label" id="px-speed-label">1×</span>
          <button class="px-icon-btn" onclick="InvalidPlayer.changeSpeed(1)" title="Faster">⚡</button>
          <button class="px-icon-btn" onclick="InvalidPlayer.skip(-10)" title="Back 10s">⏪</button>
        </div>

        <!-- CENTER: play/pause -->
        <div class="px-ctrl-center">
          <button class="px-play-btn" id="px-play-btn" onclick="InvalidPlayer.togglePlay()" style="background:${accent}">
            <span id="px-play-icon-btn">▶</span>
          </button>
        </div>

        <!-- RIGHT: skip fwd, volume, quality, fullscreen -->
        <div class="px-ctrl-group px-ctrl-right">
          <button class="px-icon-btn" onclick="InvalidPlayer.skip(10)" title="Forward 10s">⏩</button>
          <button class="px-icon-btn" id="px-btn-mute" onclick="InvalidPlayer.toggleMute()" title="Mute">🔊</button>
          <input type="range" class="px-vol-slider" id="px-vol-slider" min="0" max="1" step="0.05" value="1"
            oninput="InvalidPlayer.setVolume(this.value)" />
          <button class="px-icon-btn px-quality-btn" id="px-btn-quality" onclick="InvalidPlayer.toggleSettings()" title="Quality">⚙️</button>
          <button class="px-icon-btn" onclick="InvalidPlayer.toggleFullscreen()" title="Fullscreen">
            <span id="px-fs-icon">⛶</span>
          </button>
        </div>
      </div>
    </div>

    <!-- QUALITY PANEL -->
    <div id="px-settings" class="px-settings px-hidden">
      <div class="px-settings-title">Quality</div>
      <div id="px-quality-list" class="px-quality-list"></div>
    </div>

    <!-- SIDEBAR -->
    <div id="px-sidebar" class="px-sidebar px-hidden">
      <div class="px-sidebar-tabs">
        <button class="px-tab px-tab-active" id="px-tab-slides" onclick="InvalidPlayer.setSidebarTab('slides')">📸 Slides</button>
        <button class="px-tab" id="px-tab-notes" onclick="InvalidPlayer.setSidebarTab('notes')">📄 Notes</button>
        <button class="px-sidebar-close" onclick="InvalidPlayer.closeSidebar()">✕</button>
      </div>
      <div id="px-sidebar-body" class="px-sidebar-body"></div>
    </div>

    <!-- ACTIVE SLIDE ZOOM -->
    <div id="px-slide-zoom" class="px-slide-zoom px-hidden" onclick="InvalidPlayer.closeSlideZoom()">
      <button class="px-slide-zoom-close" onclick="InvalidPlayer.closeSlideZoom()">✕ Close</button>
      <img id="px-slide-zoom-img" src="" alt="Slide" class="px-slide-zoom-img" />
    </div>

  </div>
</div>`;
  }

  // ─── Inject styles ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('px-styles')) return;
    const s = document.createElement('style');
    s.id = 'px-styles';
    s.textContent = `
.px-hidden { display:none !important; }
.px-center { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; }
.px-overlay {
  position:fixed; inset:0; z-index:99999;
  background:#000; display:flex; align-items:center; justify-content:center;
}
.px-root {
  position:relative; width:100%; height:100%;
  background:#000; overflow:hidden; user-select:none;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif;
}
.px-video { width:100%; height:100%; object-fit:contain; display:block; }
.px-spinner { z-index:10; }
.px-spin-ring {
  width:48px; height:48px; border-radius:50%;
  border:3px solid rgba(255,255,255,0.1); border-top-color:#ff3131;
  animation:px-spin 0.8s linear infinite;
}
@keyframes px-spin { to { transform:rotate(360deg); } }
.px-error { z-index:10; text-align:center; color:#fff; }
.px-error-icon { font-size:40px; margin-bottom:8px; }
.px-error-text { font-size:14px; color:rgba(255,255,255,0.6); margin-bottom:12px; }
.px-btn-retry {
  padding:8px 20px; border-radius:20px; border:1px solid rgba(255,255,255,0.2);
  background:rgba(255,255,255,0.1); color:#fff; cursor:pointer; font-size:13px;
}
.px-skip-fb {
  z-index:20; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px);
  border-radius:12px; padding:12px 20px; color:#fff; font-weight:700;
  display:flex; flex-direction:column; align-items:center; gap:4px;
  animation:px-fade 0.3s ease; font-size:22px;
}
.px-play-fb {
  z-index:20; background:rgba(0,0,0,0.5); backdrop-filter:blur(8px);
  border-radius:50%; width:64px; height:64px;
  display:flex; align-items:center; justify-content:center;
  font-size:28px; animation:px-pop 0.25s ease;
}
.px-speed-fb {
  position:absolute; top:16px; left:50%; transform:translateX(-50%);
  background:rgba(0,0,0,0.7); backdrop-filter:blur(8px); border-radius:8px;
  padding:6px 14px; color:#fff; font-weight:700; font-size:13px; z-index:20;
  animation:px-fade 0.3s ease;
}
.px-boost-hud {
  position:absolute; top:54px; left:50%; transform:translateX(-50%);
  display:inline-flex; align-items:center; gap:6px;
  background:rgba(15,23,42,0.92); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,0.22); color:#fff;
  font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:13px; font-weight:800;
  letter-spacing:0.4px; padding:6px 16px; border-radius:9999px; z-index:30;
  box-shadow:0 8px 24px rgba(0,0,0,0.6), 0 0 16px rgba(255,107,74,0.4);
  pointer-events:none; transition:opacity 0.15s ease, transform 0.15s ease;
  animation:px-boost-pulse 1.2s infinite ease-in-out;
}
@keyframes px-boost-pulse {
  0%, 100% { transform:translateX(-50%) scale(1); }
  50% { transform:translateX(-50%) scale(1.05); box-shadow:0 8px 28px rgba(0,0,0,0.7), 0 0 24px rgba(255,107,74,0.7); }
}
@keyframes px-fade { from{opacity:0;transform:translate(-50%,-50%) scale(0.8)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
@keyframes px-pop { from{opacity:0;transform:translate(-50%,-50%) scale(0.5)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
.px-zones { position:absolute; inset:0; display:flex; z-index:5; }
.px-zone-left,.px-zone-center,.px-zone-right { flex:1; cursor:pointer; }
/* TOP BAR */
.px-topbar {
  position:absolute; top:0; left:0; right:0; z-index:15;
  padding:12px 16px; display:flex; justify-content:space-between; align-items:center;
  background:linear-gradient(to bottom,rgba(0,0,0,0.75) 0%,transparent 100%);
  transition:opacity 0.3s ease;
}
.px-topbar-left { display:flex; align-items:center; gap:10px; min-width:0; }
.px-topbar-right { display:flex; align-items:center; gap:8px; }
.px-badge {
  font-size:9px; font-weight:900; letter-spacing:1.5px; text-transform:uppercase;
  padding:3px 8px; border-radius:4px; border:1px solid; white-space:nowrap;
}
.px-title {
  font-size:12px; font-weight:600; color:rgba(255,255,255,0.85);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;
}
/* CONTROLS */
.px-controls {
  position:absolute; bottom:0; left:0; right:0; z-index:15;
  padding:0 12px 12px; background:linear-gradient(to top,rgba(0,0,0,0.85) 0%,transparent 100%);
  transition:opacity 0.3s ease;
}
.px-controls.px-hidden-ctrl, .px-topbar.px-hidden-ctrl { opacity:0; pointer-events:none; }
.px-progress-wrap {
  display:flex; align-items:center; gap:8px; margin-bottom:8px;
}
.px-progress-track {
  flex:1; height:4px; background:rgba(255,255,255,0.2); border-radius:2px;
  position:relative; cursor:pointer;
}
.px-progress-fill {
  position:absolute; inset:0; width:0%; border-radius:2px; pointer-events:none;
}
.px-scrubber {
  position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; margin:0;
}
.px-time { font-size:10px; font-weight:700; color:rgba(255,255,255,0.7); font-variant-numeric:tabular-nums; white-space:nowrap; }
.px-ctrl-row { display:flex; align-items:center; justify-content:space-between; }
.px-ctrl-group { display:flex; align-items:center; gap:6px; }
.px-ctrl-right { justify-content:flex-end; }
.px-ctrl-center { display:flex; justify-content:center; }
.px-icon-btn {
  background:none; border:none; cursor:pointer; color:rgba(255,255,255,0.85);
  font-size:16px; padding:4px; border-radius:6px; transition:all 0.15s ease;
  display:flex; align-items:center; justify-content:center;
}
.px-icon-btn:hover { background:rgba(255,255,255,0.12); color:#fff; }
.px-play-btn {
  width:44px; height:44px; border-radius:50%; border:none; cursor:pointer;
  color:#fff; font-size:18px; display:flex; align-items:center; justify-content:center;
  box-shadow:0 4px 20px rgba(0,0,0,0.4); transition:transform 0.15s ease;
}
.px-play-btn:active { transform:scale(0.92); }
.px-speed-label { font-size:11px; font-weight:700; color:rgba(255,255,255,0.8); min-width:28px; text-align:center; }
.px-vol-slider {
  -webkit-appearance:none; width:70px; height:3px; border-radius:3px;
  background:rgba(255,255,255,0.25); cursor:pointer; outline:none;
}
.px-vol-slider::-webkit-slider-thumb {
  -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:#fff;
}
/* QUALITY PANEL */
.px-settings {
  position:absolute; bottom:90px; right:12px; z-index:25;
  background:rgba(15,15,20,0.96); backdrop-filter:blur(16px);
  border:1px solid rgba(255,255,255,0.1); border-radius:12px;
  padding:12px; min-width:140px; max-height:60vh; overflow-y:auto;
}
.px-settings-title { font-size:10px; font-weight:900; color:rgba(255,255,255,0.4); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px; }
.px-quality-list { display:flex; flex-direction:column; gap:4px; }
.px-quality-item {
  padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600;
  color:rgba(255,255,255,0.75); border:1px solid transparent; transition:all 0.15s;
}
.px-quality-item:hover { background:rgba(255,255,255,0.08); }
.px-quality-item.px-active { color:#fff; border-color:currentColor; }
/* SIDEBAR */
.px-sidebar {
  position:absolute; top:0; right:0; bottom:0; width:min(320px, 90vw); z-index:20;
  background:rgba(10,10,15,0.97); backdrop-filter:blur(20px);
  border-left:1px solid rgba(255,255,255,0.08);
  display:flex; flex-direction:column;
}
.px-sidebar-tabs {
  display:flex; align-items:center; gap:4px; padding:12px 12px 0;
  border-bottom:1px solid rgba(255,255,255,0.07);
}
.px-tab {
  flex:1; padding:8px 10px; border-radius:8px 8px 0 0; border:none; cursor:pointer;
  font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;
  background:none; color:rgba(255,255,255,0.4); transition:all 0.2s;
}
.px-tab.px-tab-active { background:rgba(255,255,255,0.07); color:#fff; }
.px-sidebar-close {
  margin-left:auto; background:none; border:none; color:rgba(255,255,255,0.4);
  cursor:pointer; font-size:14px; padding:4px 8px; border-radius:6px; transition:all 0.15s;
}
.px-sidebar-close:hover { color:#fff; background:rgba(255,255,255,0.1); }
.px-sidebar-body { flex:1; overflow-y:auto; padding:12px; }
.px-sidebar-body::-webkit-scrollbar { width:4px; }
.px-sidebar-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:4px; }
/* SLIDES */
.px-slides-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.px-slide-card {
  position:relative; border-radius:8px; overflow:hidden; cursor:pointer;
  border:1px solid rgba(255,255,255,0.06); aspect-ratio:16/9;
  background:rgba(255,255,255,0.03); group:true;
}
.px-slide-card img { width:100%; height:100%; object-fit:cover; }
.px-slide-card-overlay {
  position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,0.85) 0%,transparent 60%);
  padding:8px; display:flex; flex-direction:column; justify-content:flex-end;
  opacity:0; transition:opacity 0.2s;
}
.px-slide-card:hover .px-slide-card-overlay { opacity:1; }
.px-slide-name { font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; color:#fff; }
.px-slide-ts { font-size:8px; font-weight:700; font-family:monospace; margin-top:2px; }
.px-slide-jump {
  position:absolute; bottom:6px; left:6px; padding:3px 8px; border-radius:4px;
  font-size:8px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px;
  color:#fff; border:none; cursor:pointer; display:flex; align-items:center; gap:3px;
}
/* NOTES */
.px-note-card {
  display:flex; align-items:center; gap:10px; padding:12px; border-radius:10px;
  border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.03);
  margin-bottom:8px; cursor:pointer; text-decoration:none; transition:border-color 0.2s;
}
.px-note-card:hover { border-color:rgba(255,255,255,0.15); }
.px-note-icon {
  width:36px; height:36px; border-radius:8px; display:flex; align-items:center;
  justify-content:center; font-size:16px; flex-shrink:0;
}
.px-note-title { font-size:11px; font-weight:700; color:#fff; line-height:1.3; }
.px-note-sub { font-size:9px; color:rgba(255,255,255,0.3); font-family:monospace; text-transform:uppercase; letter-spacing:0.5px; margin-top:3px; }
.px-sidebar-empty { text-align:center; padding:40px 20px; color:rgba(255,255,255,0.2); font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; }
/* SLIDE ZOOM */
.px-slide-zoom {
  position:absolute; inset:0; z-index:50; background:rgba(0,0,0,0.93);
  backdrop-filter:blur(12px); display:flex; align-items:center; justify-content:center;
  flex-direction:column; padding:16px;
}
.px-slide-zoom-close {
  position:absolute; top:16px; right:16px; background:rgba(255,255,255,0.08);
  border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:20px;
  padding:6px 14px; font-size:10px; font-weight:900; text-transform:uppercase;
  letter-spacing:1px; cursor:pointer; transition:all 0.15s;
}
.px-slide-zoom-close:hover { background:rgba(255,255,255,0.15); }
.px-slide-zoom-img { max-width:100%; max-height:80vh; border-radius:12px; object-fit:contain; }
`;
    document.head.appendChild(s);
  }

  // ─── Build Quality List ────────────────────────────────────────────────
  function buildQualityList(accent) {
    const list = el('px-quality-list');
    if (!list) return;
    list.innerHTML = '';

    const autoItem = document.createElement('div');
    autoItem.className = 'px-quality-item' + (_state.selectedQuality === -1 ? ' px-active' : '');
    autoItem.style.color = _state.selectedQuality === -1 ? accent : '';
    autoItem.textContent = 'Auto (ABR)';
    autoItem.onclick = () => handleQualityChange(-1);
    list.appendChild(autoItem);

    _state.qualities.forEach(q => {
      const item = document.createElement('div');
      item.className = 'px-quality-item' + (_state.selectedQuality === q.originalIndex ? ' px-active' : '');
      item.style.color = _state.selectedQuality === q.originalIndex ? accent : '';
      item.textContent = q.height ? `${q.height}p` : `Level ${q.originalIndex}`;
      item.onclick = () => handleQualityChange(q.originalIndex);
      list.appendChild(item);
    });
  }

  function handleQualityChange(idx) {
    _state.selectedQuality = idx;
    if (_hls) {
      _hls.nextLevel = idx;
    } else if (_shaka) {
      if (idx === -1) {
        _shaka.configure({ abr: { enabled: true } });
      } else {
        _shaka.configure({ abr: { enabled: false } });
        const tracks = _shaka.getVariantTracks();
        const t = tracks.find(t => t.id === idx);
        if (t) {
          try { _shaka.selectVariantTrack(t, true, 0); } catch (e) {}
        }
      }
    }
    buildQualityList(_state.accentColor);
    el('px-settings')?.classList.add('px-hidden');
  }

  // ─── Build Sidebar Content ─────────────────────────────────────────────
  function buildSidebar() {
    const body = el('px-sidebar-body');
    if (!body) return;
    const accent = _state.accentColor;
    const [r,g,b] = accentRgb(accent);

    if (_state.sidebarTab === 'slides') {
      if (_state.slides.length === 0) {
        body.innerHTML = `<div class="px-sidebar-empty">📸<br>No Slides Found</div>`;
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'px-slides-grid';
      _state.slides.forEach((slide, i) => {
        const imgUrl = slide.imageUrl || slide.url || slide.src || '';
        const ts = slide.timeStamp || slide.timestamp || '';
        const name = slide.name || `Slide ${i + 1}`;

        const card = document.createElement('div');
        card.className = 'px-slide-card';
        card.innerHTML = `
          ${imgUrl ? `<img src="${imgUrl}" alt="Slide ${i+1}" loading="lazy" onerror="this.style.display='none'" />` : '<div style="height:100%;background:rgba(255,255,255,0.03);"></div>'}
          <div class="px-slide-card-overlay">
            <span class="px-slide-name">${name}</span>
            ${ts ? `<span class="px-slide-ts" style="color:${accent}">${fmt(parseInt(ts))}</span>` : ''}
          </div>
          ${ts ? `<button class="px-slide-jump" style="background:${accent}" onclick="event.stopPropagation();InvalidPlayer.seekTo(${parseInt(ts)})">▶ Jump</button>` : ''}
        `;
        card.onclick = () => { if (imgUrl) InvalidPlayer.openSlideZoom(imgUrl); };
        grid.appendChild(card);
      });
      body.innerHTML = '';
      body.appendChild(grid);
    } else {
      if (_state.notes.length === 0) {
        body.innerHTML = `<div class="px-sidebar-empty">📄<br>No Notes Found</div>`;
        return;
      }
      body.innerHTML = '';
      _state.notes.forEach((note, idx) => {
        const att = (Array.isArray(note.attachmentIds) && note.attachmentIds[0]) ? note.attachmentIds[0] : note;
        const noteUrl = (att.baseUrl && att.key) ? `${att.baseUrl}${att.key}` : (note.baseUrl && note.key ? `${note.baseUrl}${note.key}` : note.pdfUrl || note.url || note.documentUrl || '');
        const title = note.topic || note.name || att.name || note.title || `Document ${idx+1}`;
        const isDpp = (note.note === 'DPP' || (title && title.toLowerCase().includes('dpp')));
        const a = document.createElement('a');
        a.className = 'px-note-card';
        a.href = noteUrl || '#';
        if (noteUrl) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.innerHTML = `
          <div class="px-note-icon" style="background:rgba(${r},${g},${b},0.12);border:1px solid rgba(${r},${g},${b},0.2)">${isDpp ? '📝' : '📄'}</div>
          <div>
            <div class="px-note-title">${title}</div>
            <div class="px-note-sub">${noteUrl ? 'Open PDF Document ↗' : 'Attachment'}</div>
          </div>
        `;
        body.appendChild(a);
      });
    }
  }

  // ─── Controls Visibility ───────────────────────────────────────────────
  function showControls() {
    const ctrl = el('px-controls');
    const top = el('px-topbar');
    ctrl?.classList.remove('px-hidden-ctrl');
    top?.classList.remove('px-hidden-ctrl');
    clearTimeout(_controlsTimeout);
    if (_state.isPlaying) {
      _controlsTimeout = setTimeout(hideControls, 3000);
    }
  }

  function hideControls() {
    if (!_state.isPlaying) return;
    el('px-controls')?.classList.add('px-hidden-ctrl');
    el('px-topbar')?.classList.add('px-hidden-ctrl');
  }

  // ─── Update UI ─────────────────────────────────────────────────────────
  function updateProgress() {
    const prog = el('px-progress-fill');
    const scrub = el('px-scrubber');
    const cur = el('px-cur-time');
    const dur = el('px-dur-time');
    const pct = _state.duration > 0 ? (_state.currentTime / _state.duration) * 100 : 0;
    if (prog) prog.style.width = pct + '%';
    if (scrub) { scrub.max = _state.duration || 0; scrub.value = _state.currentTime; }
    if (cur) cur.textContent = fmt(_state.currentTime);
    if (dur) dur.textContent = fmt(_state.duration);
  }

  function updatePlayBtn() {
    const icon = el('px-play-icon-btn');
    if (icon) icon.textContent = _state.isPlaying ? '⏸' : '▶';
  }

  function updateMuteBtn() {
    const btn = el('px-btn-mute');
    if (btn) btn.textContent = _state.isMuted ? '🔇' : '🔊';
  }

  function updateSpeedLabel() {
    const lbl = el('px-speed-label');
    if (lbl) lbl.textContent = `${_state.playbackRate}×`;
  }

  function showSkipFb(dir, amount) {
    const fb = el('px-skip-fb');
    const icon = el('px-skip-icon');
    const text = el('px-skip-text');
    if (!fb) return;
    if (icon) icon.textContent = dir === 'forward' ? '⏩' : '⏪';
    if (text) text.textContent = `${amount}s`;
    fb.classList.remove('px-hidden');
    clearTimeout(_skipResetTimeout);
    _skipResetTimeout = setTimeout(() => fb?.classList.add('px-hidden'), 900);
  }

  function flashPlayFb(type) {
    const fb = el('px-play-fb');
    const icon = el('px-play-icon');
    if (!fb) return;
    if (icon) icon.textContent = type === 'play' ? '▶' : '⏸';
    fb.classList.remove('px-hidden');
    setTimeout(() => fb?.classList.add('px-hidden'), 500);
  }

  function flashSpeedFb(rate) {
    const fb = el('px-speed-fb');
    const txt = el('px-speed-text');
    if (!fb) return;
    if (txt) txt.textContent = `${rate}×`;
    fb.classList.remove('px-hidden');
    setTimeout(() => fb?.classList.add('px-hidden'), 1000);
  }

  // ─── Player Actions ────────────────────────────────────────────────────
  function togglePlay() {
    if (!_video) return;
    if (_video.paused) {
      _video.play().catch(() => {});
      flashPlayFb('play');
    } else {
      _video.pause();
      flashPlayFb('pause');
    }
    showControls();
  }

  function skip(sec) {
    if (!_video) return;
    const dir = sec > 0 ? 'forward' : 'backward';
    _video.currentTime = Math.max(0, Math.min(_video.currentTime + sec, _state.duration));

    // Accumulate skip amount display
    const now = Date.now();
    if (now - _state.lastTap < SKIP_WIN && _state.skipDir === dir) {
      _state.skipAmount = (_state.skipAmount || 0) + Math.abs(sec);
    } else {
      _state.skipAmount = Math.abs(sec);
    }
    _state.skipDir = dir;
    _state.lastTap = now;
    showSkipFb(dir, _state.skipAmount);
    showControls();
  }

  function changeSpeed(dir) {
    const idx = SPEED_OPTIONS.indexOf(_state.playbackRate);
    const next = SPEED_OPTIONS[Math.max(0, Math.min(idx + dir, SPEED_OPTIONS.length - 1))];
    if (next !== _state.playbackRate) {
      _state.playbackRate = next;
      if (_video) _video.playbackRate = next;
      updateSpeedLabel();
      flashSpeedFb(next);
    }
  }

  function toggleMute() {
    if (!_video) return;
    _video.muted = !_state.isMuted;
    _state.isMuted = _video.muted;
    updateMuteBtn();
  }

  function setVolume(v) {
    if (!_video) return;
    _video.volume = parseFloat(v);
    _video.muted = parseFloat(v) === 0;
    _state.volume = parseFloat(v);
    _state.isMuted = _video.muted;
    updateMuteBtn();
  }

  function seek(v) {
    if (_video) _video.currentTime = parseFloat(v);
  }

  function seekTo(t) {
    if (_video) { _video.currentTime = t; _video.play().catch(() => {}); }
  }

  function toggleFullscreen() {
    const root = el('px-root');
    if (!document.fullscreenElement) {
      root?.requestFullscreen().then(() => {
        _state.isFullscreen = true;
        el('px-fs-icon').textContent = '⛶';
        if (window.innerWidth < 1024 && screen.orientation?.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }).catch(() => {});
    } else {
      document.exitFullscreen();
      _state.isFullscreen = false;
      el('px-fs-icon').textContent = '⛶';
      screen.orientation?.unlock?.();
    }
  }

  function toggleSettings() {
    el('px-settings')?.classList.toggle('px-hidden');
    buildQualityList(_state.accentColor);
  }

  function toggleSidebar() {
    _state.sidebarOpen = !_state.sidebarOpen;
    toggle(el('px-sidebar'), _state.sidebarOpen);
    if (_state.sidebarOpen) buildSidebar();
  }

  function closeSidebar() {
    _state.sidebarOpen = false;
    el('px-sidebar')?.classList.add('px-hidden');
  }

  function setSidebarTab(tab) {
    _state.sidebarTab = tab;
    el('px-tab-slides')?.classList.toggle('px-tab-active', tab === 'slides');
    el('px-tab-notes')?.classList.toggle('px-tab-active', tab === 'notes');
    buildSidebar();
  }

  function openSlideZoom(url) {
    const img = el('px-slide-zoom-img');
    if (img) img.src = url;
    el('px-slide-zoom')?.classList.remove('px-hidden');
  }

  function closeSlideZoom() {
    el('px-slide-zoom')?.classList.add('px-hidden');
  }

  // ─── Touch Zone Handlers ───────────────────────────────────────────────
  let _lastTapTs = 0, _tapTimer = null;

  function _tapLeft(e) {
    e.stopPropagation();
    const now = Date.now();
    if (now - _lastTapTs < DBL_TAP_DELAY) {
      clearTimeout(_tapTimer);
      skip(-10);
      _lastTapTs = 0;
    } else {
      _lastTapTs = now;
      _tapTimer = setTimeout(() => { showControls(); }, DBL_TAP_DELAY + 10);
    }
  }

  function _tapCenter(e) {
    e.stopPropagation();
    const now = Date.now();
    if (now - _lastTapTs < DBL_TAP_DELAY) {
      clearTimeout(_tapTimer);
      toggleFullscreen();
      _lastTapTs = 0;
    } else {
      _lastTapTs = now;
      _tapTimer = setTimeout(() => { togglePlay(); }, DBL_TAP_DELAY + 10);
    }
  }

  function _tapRight(e) {
    e.stopPropagation();
    const now = Date.now();
    if (now - _lastTapTs < DBL_TAP_DELAY) {
      clearTimeout(_tapTimer);
      skip(10);
      _lastTapTs = 0;
    } else {
      _lastTapTs = now;
      _tapTimer = setTimeout(() => { showControls(); }, DBL_TAP_DELAY + 10);
    }
  }

  // ─── Initialize HLS or DASH/Shaka ─────────────────────────────────────
  function initPlayer(url, drm) {
    if (!_video) return;
    _state.hasError = false;
    _state.isBuffering = true;
    toggle(el('px-spinner'), true);
    hide(el('px-error'));

    let playUrl = url;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if ((isIOS || isSafari) && playUrl.includes('.mpd')) {
      playUrl = playUrl.replace('.mpd', '.m3u8');
    }

    const isHLS = playUrl.toLowerCase().includes('.m3u8');
    const isDASH = playUrl.toLowerCase().includes('.mpd');

    // Attach common events
    _video.addEventListener('play', () => { _state.isPlaying = true; updatePlayBtn(); showControls(); });
    _video.addEventListener('pause', () => { _state.isPlaying = false; updatePlayBtn(); showControls(); });
    _video.addEventListener('timeupdate', () => { _state.currentTime = _video.currentTime; updateProgress(); });
    _video.addEventListener('durationchange', () => { _state.duration = _video.duration; updateProgress(); });
    _video.addEventListener('waiting', () => { _state.isBuffering = true; toggle(el('px-spinner'), true); });
    _video.addEventListener('playing', () => {
      _state.isBuffering = false;
      el('px-spinner')?.classList.add('px-hidden');
    });
    _video.addEventListener('canplay', () => {
      _state.isBuffering = false;
      el('px-spinner')?.classList.add('px-hidden');
    });

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      _hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      _hls.loadSource(playUrl);
      _hls.attachMedia(_video);
      _hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        _state.qualities = data.levels.map((l, i) => ({ height: l.height, originalIndex: i, bandwidth: l.bitrate }))
          .sort((a, b) => b.height - a.height);
        _video.play().catch(() => {});
      });
      _hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        _state.selectedQuality = data.level;
      });
      _hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          _state.hasError = true;
          el('px-spinner')?.classList.add('px-hidden');
          show(el('px-error'));
        }
      });
    } else if (isHLS && _video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      _video.src = playUrl;
      _video.play().catch(() => {});
    } else if (isDASH && typeof shaka !== 'undefined') {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        show(el('px-error')); return;
      }
      const player = new shaka.Player();
      _shaka = player;
      player.addEventListener('error', e => {
        const err = e.detail;
        if (err && (err.code === 7000 || err.code === 1001)) return;
        _state.hasError = true;
        show(el('px-error'));
      });
      player.attach(_video).then(() => {
        // DRM config
        if (drm) {
          if (drm.clearKeys) {
            player.configure({ drm: { clearKeys: drm.clearKeys } });
          } else if (drm.licenseServer) {
            player.configure({ drm: { servers: { 'com.widevine.alpha': drm.licenseServer } } });
          }
        }
        // PW signed CDN query param propagation
        try {
          const qs = playUrl.includes('?') ? playUrl.split('?')[1] : '';
          if (qs) {
            const mpdParams = new URLSearchParams(qs);
            player.getNetworkingEngine()?.registerRequestFilter((type, req) => {
              if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT ||
                  type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
                req.uris = req.uris.map(uri => {
                  try {
                    const u = new URL(uri);
                    if (u.hostname && !u.hostname.includes('localhost')) {
                      mpdParams.forEach((v, k) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
                    }
                    return u.toString();
                  } catch { return uri; }
                });
              }
            });
          }
        } catch (e) {}
        return player.load(playUrl);
      }).then(() => {
        const tracks = player.getVariantTracks();
        _state.qualities = tracks.map(t => ({ height: t.height, originalIndex: t.id, bandwidth: t.bandwidth }))
          .sort((a, b) => (b.height||0) - (a.height||0));
        _video.play().catch(() => {});
      }).catch(e => {
        if (e && (e.code === 7000 || e.code === 1001)) return;
        _state.hasError = true;
        show(el('px-error'));
      });
    } else {
      _video.src = playUrl;
      _video.play().catch(() => {});
    }
  }

  // ─── 2X Speed Press & Hold Engine (YouTube-style) ──────────────────────────
  let _spaceHoldTimer = null;
  let _isSpaceBoosting = false;
  let _preBoostRate = 1.0;
  let _touchHoldTimer = null;
  let _isTouchBoosting = false;

  function show2xBoostHud(visible) {
    const hud = el('px-boost-hud');
    if (!hud) return;
    if (visible) {
      hud.classList.remove('px-hidden');
      hud.style.opacity = '1';
      hud.style.transform = 'translateX(-50%) scale(1)';
    } else {
      hud.style.opacity = '0';
      hud.style.transform = 'translateX(-50%) scale(0.85)';
      setTimeout(() => { if (!_isSpaceBoosting && !_isTouchBoosting) hud.classList.add('px-hidden'); }, 150);
    }
  }

  function start2xBoost() {
    if (!_video || _video.paused) return;
    _preBoostRate = _video.playbackRate || _state.playbackRate || 1.0;
    _video.playbackRate = 2.0;
    show2xBoostHud(true);
    try {
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
      }
    } catch (e) {}
  }

  function stop2xBoost() {
    if (!_video) return;
    _video.playbackRate = _preBoostRate || _state.playbackRate || 1.0;
    show2xBoostHud(false);
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────
  function handleKeydown(e) {
    if (!_state.isResolved) return;
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return; // Prevent OS key-repeat from spamming

      clearTimeout(_spaceHoldTimer);
      _spaceHoldTimer = setTimeout(() => {
        if (!_isSpaceBoosting && _video && !_video.paused) {
          _isSpaceBoosting = true;
          start2xBoost();
        }
      }, 200);
      return;
    }

    switch (e.code) {
      case 'KeyK': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': skip(10); break;
      case 'ArrowLeft': skip(-10); break;
      case 'ArrowUp': e.preventDefault(); setVolume(Math.min(1, _state.volume + 0.1)); break;
      case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, _state.volume - 0.1)); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'Comma': changeSpeed(-1); break;
      case 'Period': changeSpeed(1); break;
      case 'Escape': if (_state.isFullscreen) toggleFullscreen(); else InvalidPlayer.close(); break;
    }
  }

  function handleKeyup(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      clearTimeout(_spaceHoldTimer);
      if (_isSpaceBoosting) {
        _isSpaceBoosting = false;
        stop2xBoost();
      } else {
        // Quick tap (< 200ms) = standard play/pause toggle
        togglePlay();
      }
    }
  }

  function initHoldTo2XListeners(container) {
    if (!container) return;

    const startHold = (e) => {
      if (e.target.closest('#px-controls, #px-topbar, #px-sidebar, #px-settings, #px-slide-zoom, button, input')) {
        return;
      }
      clearTimeout(_touchHoldTimer);
      _touchHoldTimer = setTimeout(() => {
        if (_video && !_video.paused) {
          _isTouchBoosting = true;
          start2xBoost();
        }
      }, 350);
    };

    const endHold = (e) => {
      clearTimeout(_touchHoldTimer);
      if (_isTouchBoosting) {
        _isTouchBoosting = false;
        stop2xBoost();
        if (e) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
      }
    };

    container.addEventListener('pointerdown', startHold, { passive: true });
    container.addEventListener('pointerup', endHold);
    container.addEventListener('pointercancel', endHold);
    container.addEventListener('pointerleave', endHold);
  }


  // ─── 2X Hold Safety Guards (Blur / VisibilityChange) ──────────────────
  function handleBlurOrHidden() {
    clearTimeout(_spaceHoldTimer);
    clearTimeout(_touchHoldTimer);
    if (_isSpaceBoosting || _isTouchBoosting) {
      _isSpaceBoosting = false;
      _isTouchBoosting = false;
      stop2xBoost();
    }
  }
  window.addEventListener('blur', handleBlurOrHidden);
  document.addEventListener('visibilitychange', handleBlurOrHidden);

  // ─── Public API ────────────────────────────────────────────────────────
  window.InteractivePlayer = window.InvalidPlayer = {
    open(opts) {
      const { url, title = '', drm = null, accentColor = '#ff3131',
              slides = [], notes = [], onClose = null } = opts;

      Object.assign(_state, { url, title, drm, accentColor, slides, notes, onClose,
        isPlaying: false, currentTime: 0, duration: 0, volume: 1, isMuted: false,
        playbackRate: 1, isFullscreen: false, isBuffering: true, hasError: false,
        isResolved: true, qualities: [], selectedQuality: -1, sidebarOpen: false,
        sidebarTab: 'slides', activeSlide: null, skipAmount: 0 });

      // Decode XHS_ scrambled URL if needed
      let resolvedUrl = url;
      if (typeof url === 'string' && url.startsWith('XHS_')) {
        try { resolvedUrl = atob(url.slice(4)).split('').reverse().join(''); } catch {}
      }

      injectStyles();

      // Inject or reuse player DOM
      if (!document.getElementById('px-overlay')) {
        document.body.insertAdjacentHTML('beforeend', buildPlayerHTML(accentColor));
      }

      _playerEl = el('px-overlay');
      _video = el('px-video');
      _playerEl.classList.remove('px-hidden');

      // Set title
      const titleEl = el('px-title');
      if (titleEl) titleEl.textContent = title;

      // Apply accent color to badge
      if (window.APP_CONFIG?.BOT_NAME) {
        const badge = el('px-brand-badge');
        if (badge) badge.textContent = window.APP_CONFIG.BOT_NAME.toUpperCase();
      }

      // Destroy existing instances
      if (_hls) { _hls.destroy(); _hls = null; }
      if (_shaka) { _shaka.destroy().catch(() => {}); _shaka = null; }

      // Block scroll
      document.body.style.overflow = 'hidden';

      // Keyboard listeners (keydown + keyup for 2X hold)
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('keyup', handleKeyup);
      clearTimeout(_spaceHoldTimer);
      clearTimeout(_touchHoldTimer);
      if (_isSpaceBoosting || _isTouchBoosting) {
        _isSpaceBoosting = false;
        _isTouchBoosting = false;
        stop2xBoost();
      }
      document.removeEventListener('keyup', handleKeyup);
      document.addEventListener('keydown', handleKeydown);
      document.addEventListener('keyup', handleKeyup);

      // Pointer press-and-hold for mobile & desktop video click
      initHoldTo2XListeners(el('px-root'));

      // ── vlink token resolution ──────────────────────────────────
      // If URL is /api/vlink/<token>, resolve it server-side first.
      // This ensures raw CDN URLs are NEVER exposed in browser devtools.
      if (typeof resolvedUrl === 'string' && resolvedUrl.startsWith('/api/vlink/')) {
        const base = window.location.origin;
        fetch(base + resolvedUrl)
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.url) {
              initPlayer(data.url, data.drm || drm);
            } else {
              _state.hasError = true;
              show(el('px-error'));
            }
          })
          .catch(() => { _state.hasError = true; show(el('px-error')); });
      } else {
        initPlayer(resolvedUrl, drm);
      }
      showControls();
    },

    close() {
      if (_hls) { _hls.destroy(); _hls = null; }
      if (_shaka) { _shaka.destroy().catch(() => {}); _shaka = null; }
      if (_video) { _video.pause(); _video.src = ''; }
      el('px-overlay')?.classList.add('px-hidden');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeydown);
      if (_state.onClose) _state.onClose();
    },

    retry() {
      hide(el('px-error'));
      initPlayer(_state.url, _state.drm);
    },

    togglePlay, skip, seekTo, changeSpeed, toggleMute, setVolume, seek,
    toggleFullscreen, toggleSettings, toggleSidebar, closeSidebar, setSidebarTab,
    openSlideZoom, closeSlideZoom,
    _tapLeft, _tapCenter, _tapRight,
  };

  // Expose showControls on mousemove
  document.addEventListener('mousemove', () => {
    if (el('px-overlay') && !el('px-overlay').classList.contains('px-hidden')) {
      showControls();
    }
  });

})();
