import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update webapp/index.html
html_path = 'webapp/index.html'
with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# Remove player.js script tag if present
html = html.replace('<script src="player.js?v=1" defer></script>', '')
html = html.replace('<script src="player.js" defer></script>', '')
html = html.replace('<script src="player.js"></script>', '')
html = html.replace('<!-- Advanced Interactive Player -->', '')

# Ensure modal HTML is present and cleanly branded
player_modal_html = """  <!-- RangeXCoder Video Player Modal -->
  <div id="player-modal" class="player-modal-backdrop hidden">
    <div class="player-container">
      <div class="video-wrapper" id="video-wrapper" onclick="togglePlayerControlsVisibility(event)">
        <!-- Video Element -->
        <video id="rangex-video" playsinline preload="metadata"></video>
        
        <!-- Top Bar Overlay (Floating) -->
        <div class="player-top-bar" id="player-top-bar">
          <div class="player-title-box">
            <span class="player-badge">⚡ <span data-brand-name>INVALIDSTUDY</span> PLAYER</span>
            <div class="player-video-title" id="player-video-title">Lecture Video</div>
          </div>
          <button class="player-close-btn" onclick="closeRangeXPlayer(event)" title="Close Player">✕</button>
        </div>

        <!-- Big Center Play/Pause Overlay -->
        <div class="video-play-center" id="video-play-center" onclick="toggleRangeXPlay(event)">
          <span class="center-play-icon" id="center-play-icon">▶</span>
        </div>

        <!-- Bottom Controls Overlay (Floating Netlify/YouTube Style) -->
        <div class="player-bottom-controls" id="player-bottom-controls">
          <!-- Custom Video Scrubber -->
          <div class="player-scrubber-wrap">
            <span class="player-time-curr" id="time-current">00:00</span>
            <div class="scrubber-track" id="scrubber-track">
              <div class="scrubber-buffered" id="scrubber-buffered"></div>
              <div class="scrubber-played" id="scrubber-played"></div>
              <div class="scrubber-handle" id="scrubber-handle"></div>
            </div>
            <span class="player-time-total" id="time-total">00:00</span>
          </div>

          <!-- Controls Buttons Bar -->
          <div class="player-controls-bar">
            <div class="controls-left">
              <button class="ctrl-btn-action" id="btn-play-pause" onclick="toggleRangeXPlay(event)" title="Play/Pause">▶</button>
              <button class="ctrl-btn-action" onclick="skipVideo(-10)" title="Rewind 10s">↺ 10s</button>
              <button class="ctrl-btn-action" onclick="skipVideo(10)" title="Forward 10s">↻ 10s</button>
            </div>

            <div class="controls-center">
              <span class="speed-label">Speed:</span>
              <div class="speed-buttons">
                <button class="speed-btn active" onclick="setPlaySpeed(1)">1x</button>
                <button class="speed-btn" onclick="setPlaySpeed(1.25)">1.25x</button>
                <button class="speed-btn" onclick="setPlaySpeed(1.5)">1.5x</button>
                <button class="speed-btn" onclick="setPlaySpeed(2)">2x</button>
                <button class="speed-btn" onclick="setPlaySpeed(3)">3x</button>
              </div>
            </div>

            <div class="controls-right">
              <!-- Quality Selector -->
              <div class="quality-dropdown-wrap" id="quality-dropdown-wrap">
                <button class="ctrl-btn-quality" id="btn-quality" onclick="toggleQualityMenu(event)" title="Select Video Quality">
                  <span>⚙️</span>
                  <span id="quality-label">Auto</span>
                </button>
                <div class="quality-menu hidden" id="quality-menu">
                  <!-- Dynamically populated: Auto, 720p, 480p, 360p, 240p -->
                </div>
              </div>
              <!-- Fullscreen / Theatre Toggle -->
              <button class="ctrl-btn-fs" onclick="toggleRangeXFullscreen()" title="Fullscreen">⛶</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>"""

pattern = re.compile(r'<!-- (?:RangeXCoder|Study Hub) Video Player Modal -->.*?</div>\s*</div>\s*</div>', re.DOTALL)
if pattern.search(html):
    html = pattern.sub(player_modal_html, html)
    print('Updated player modal HTML in webapp/index.html!')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)

# 2. Update webapp/app.js to ensure original player functions are 100% active
app_path = 'webapp/app.js'
with open(app_path, 'r', encoding='utf-8') as f:
    app_code = f.read()

# Replace the player logic section in webapp/app.js
player_js_block = """// ═══════════════════════════════════════════════════════════════
// ORIGINAL IN-APP VIDEO PLAYER (HLS.js + Dash.js Engine)
// ═══════════════════════════════════════════════════════════════
let playerControlsInitialized = false;
let controlsTimeout = null;
let isDraggingScrubber = false;

function formatPlayerTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
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
  const centerIcon = document.getElementById('center-play-icon');
  const playBtn = document.getElementById('btn-play-pause');

  if (!videoEl) return;

  // Time update -> Scrubber & Counters
  videoEl.addEventListener('timeupdate', () => {
    if (isDraggingScrubber || !videoEl.duration) return;
    const pct = (videoEl.currentTime / videoEl.duration) * 100;
    if (played) played.style.width = `${pct}%`;
    if (handle) handle.style.left = `${pct}%`;
    if (timeCurr) timeCurr.textContent = formatPlayerTime(videoEl.currentTime);
    if (timeTotal) timeTotal.textContent = formatPlayerTime(videoEl.duration);
  });

  // Progress update -> Buffered bar
  videoEl.addEventListener('progress', () => {
    if (!videoEl.duration || videoEl.buffered.length === 0) return;
    try {
      const buffEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
      const pct = (buffEnd / videoEl.duration) * 100;
      if (buffered) buffered.style.width = `${Math.min(pct, 100)}%`;
    } catch (e) {}
  });

  // Play/Pause UI sync
  videoEl.addEventListener('play', () => {
    if (playBtn) playBtn.textContent = '❚❚';
    if (centerIcon) centerIcon.textContent = '❚❚';
    showPlayerControls();
    resetControlsTimeout();
  });

  videoEl.addEventListener('pause', () => {
    if (playBtn) playBtn.textContent = '▶';
    if (centerIcon) centerIcon.textContent = '▶';
    showPlayerControls();
  });

  videoEl.addEventListener('ended', () => {
    if (playBtn) playBtn.textContent = '▶';
    if (centerIcon) centerIcon.textContent = '↺';
    showPlayerControls();
  });

  // Scrubber Click & Drag
  function seekTo(clientX) {
    if (!track || !videoEl.duration) return;
    const rect = track.getBoundingClientRect();
    const pos = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const pct = pos / rect.width;
    videoEl.currentTime = pct * videoEl.duration;
    if (played) played.style.width = `${pct * 100}%`;
    if (handle) handle.style.left = `${pct * 100}%`;
    if (timeCurr) timeCurr.textContent = formatPlayerTime(videoEl.currentTime);
  }

  if (track) {
    track.addEventListener('click', (e) => {
      seekTo(e.clientX);
      showPlayerControls();
      resetControlsTimeout();
    });

    track.addEventListener('mousedown', (e) => {
      isDraggingScrubber = true;
      seekTo(e.clientX);
      const onMove = (ev) => { if (isDraggingScrubber) seekTo(ev.clientX); };
      const onUp = () => {
        isDraggingScrubber = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        resetControlsTimeout();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    track.addEventListener('touchstart', (e) => {
      isDraggingScrubber = true;
      if (e.touches[0]) seekTo(e.touches[0].clientX);
    }, { passive: true });

    track.addEventListener('touchmove', (e) => {
      if (isDraggingScrubber && e.touches[0]) seekTo(e.touches[0].clientX);
    }, { passive: true });

    track.addEventListener('touchend', () => {
      isDraggingScrubber = false;
      resetControlsTimeout();
    });
  }

  videoEl.addEventListener('loadedmetadata', () => {
    if (timeTotal) timeTotal.textContent = formatPlayerTime(videoEl.duration);
  });
}

function toggleRangeXPlay(e) {
  if (e) e.stopPropagation();
  const videoEl = document.getElementById('rangex-video');
  if (!videoEl) return;
  haptic('light');

  if (videoEl.paused) {
    videoEl.play().catch(err => console.warn('Play error:', err));
  } else {
    videoEl.pause();
  }
  showPlayerControls();
  resetControlsTimeout();
}

function skipVideo(seconds) {
  const videoEl = document.getElementById('rangex-video');
  if (!videoEl || !videoEl.duration) return;
  haptic('light');
  videoEl.currentTime = Math.max(0, Math.min(videoEl.duration, videoEl.currentTime + seconds));
  showPlayerControls();
  resetControlsTimeout();
  showToast(seconds > 0 ? `Forward +${seconds}s` : `Rewind ${seconds}s`);
}

function setPlaySpeed(speed) {
  const videoEl = document.getElementById('rangex-video');
  if (videoEl) videoEl.playbackRate = speed;
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === `${speed}x` || (speed === 1 && btn.textContent === '1x'));
  });
  showToast(`Speed: ${speed}x`);
  resetControlsTimeout();
}

function showPlayerControls() {
  const topBar = document.getElementById('player-top-bar');
  const bottomBar = document.getElementById('player-bottom-controls');
  const centerBtn = document.getElementById('video-play-center');
  if (topBar) topBar.classList.remove('fade-out');
  if (bottomBar) bottomBar.classList.remove('fade-out');
  if (centerBtn) centerBtn.classList.remove('fade-out');
}

function hidePlayerControls() {
  const videoEl = document.getElementById('rangex-video');
  if (videoEl && videoEl.paused) return; // Don't auto-hide when paused
  const topBar = document.getElementById('player-top-bar');
  const bottomBar = document.getElementById('player-bottom-controls');
  const centerBtn = document.getElementById('video-play-center');
  if (topBar) topBar.classList.add('fade-out');
  if (bottomBar) bottomBar.classList.add('fade-out');
  if (centerBtn) centerBtn.classList.add('fade-out');
  closeQualityMenu();
}

function resetControlsTimeout() {
  clearTimeout(controlsTimeout);
  showPlayerControls();
  controlsTimeout = setTimeout(hidePlayerControls, 2800);
}

function togglePlayerControlsVisibility(e) {
  if (e.target.closest('#player-bottom-controls') || 
      e.target.closest('#player-top-bar') ||
      e.target.closest('.quality-menu')) {
    return;
  }
  const bottomBar = document.getElementById('player-bottom-controls');
  if (bottomBar && bottomBar.classList.contains('fade-out')) {
    showPlayerControls();
    resetControlsTimeout();
  } else {
    hidePlayerControls();
  }
}

function toggleQualityMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('quality-menu');
  if (menu) menu.classList.toggle('hidden');
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
    let html = '<div class="quality-menu-header">Select Video Quality</div>';
    const isAuto = (window.hlsPlayer.currentLevel === -1);
    html += `
      <button class="quality-item ${isAuto ? 'active' : ''}" onclick="setQualityLevel(-1, 'Auto')">
        <span>⚡ Auto (Default)</span>
        ${isAuto ? '<span class="quality-check">✓</span>' : ''}
      </button>
    `;
    levels.forEach((lvl, idx) => {
      const res = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`;
      const isAct = (window.hlsPlayer.currentLevel === idx);
      html += `
        <button class="quality-item ${isAct ? 'active' : ''}" onclick="setQualityLevel(${idx}, '${res}')">
          <span>📺 ${res}</span>
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
    showToast(`📺 Quality: ${label}`);
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

  if (!rawUrl) {
    showToast('❌ Video stream not found');
    return;
  }

  haptic('medium');
  const modal = document.getElementById('player-modal');
  const videoEl = document.getElementById('rangex-video');
  const titleEl = document.getElementById('player-video-title');
  const badgeEl = document.querySelector('.player-badge');

  if (titleEl) titleEl.textContent = name;
  if (badgeEl && window.APP_CONFIG?.BOT_NAME) {
    badgeEl.textContent = `⚡ ${window.APP_CONFIG.BOT_NAME.toUpperCase()} PLAYER`;
  }
  if (modal) modal.classList.remove('hidden');

  initPlayerControls();

  // Reset controls state
  const played = document.getElementById('scrubber-played');
  const buffered = document.getElementById('scrubber-buffered');
  const handle = document.getElementById('scrubber-handle');
  const timeCurr = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const qualityLabel = document.getElementById('quality-label');
  if (played) played.style.width = '0%';
  if (buffered) buffered.style.width = '0%';
  if (handle) handle.style.left = '0%';
  if (timeCurr) timeCurr.textContent = '00:00';
  if (timeTotal) timeTotal.textContent = '00:00';
  if (qualityLabel) qualityLabel.textContent = 'Auto';
  setPlaySpeed(1);
  closeQualityMenu();
  showPlayerControls();
  resetControlsTimeout();

  // Destroy previous player instances
  if (window.dashPlayer) {
    try { window.dashPlayer.destroy(); } catch (e) {}
    window.dashPlayer = null;
  }
  if (window.hlsPlayer) {
    try { window.hlsPlayer.destroy(); } catch (e) {}
    window.hlsPlayer = null;
  }

  const cleanUrl = rawUrl.trim();
  console.log('[InvalidStudy Player] Loading stream:', cleanUrl);

  const isHls = cleanUrl.includes('.m3u8') || 
                cleanUrl.includes('cloudfront.net') || 
                cleanUrl.includes('wistia.com') || 
                cleanUrl.includes('playlist') || 
                cleanUrl.includes('manifest') ||
                cleanUrl.includes('/video');

  try {
    if (cleanUrl.includes('.mpd') && window.dashjs) {
      window.dashPlayer = dashjs.MediaPlayer().create();
      window.dashPlayer.initialize(videoEl, cleanUrl, true);
    } else if (isHls && window.Hls && Hls.isSupported()) {
      window.hlsPlayer = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 5
      });
      window.hlsPlayer.loadSource(cleanUrl);
      window.hlsPlayer.attachMedia(videoEl);
      window.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        renderQualityOptions();
        videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
      });
      window.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[Hls] Fatal network error, trying to recover...', data);
              window.hlsPlayer.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[Hls] Fatal media error, recovering...', data);
              window.hlsPlayer.recoverMediaError();
              break;
            default:
              console.warn('[Hls] Fatal unrecoverable error, trying native video fallback', data);
              try { window.hlsPlayer.destroy(); } catch (e) {}
              window.hlsPlayer = null;
              videoEl.src = cleanUrl;
              videoEl.play().catch(e => console.warn('Fallback play error:', e));
              break;
          }
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = cleanUrl;
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
      }, { once: true });
    } else {
      videoEl.src = cleanUrl;
      videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
    }
  } catch (err) {
    console.error('Player error:', err);
    videoEl.src = cleanUrl;
    videoEl.play().catch(() => {});
  }

  // Push a Telegram back-button handler for the player
  if (state.tg && state.tg.BackButton) {
    state.tg.BackButton.onClick(closeRangeXPlayer);
    state.tg.BackButton.show();
  }
}

function closeRangeXPlayer(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } catch (err) {}
  }
  const modal = document.getElementById('player-modal');
  const videoEl = document.getElementById('rangex-video');

  clearTimeout(controlsTimeout);

  if (videoEl) {
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
  }

  if (window.dashPlayer) {
    try { window.dashPlayer.destroy(); } catch (e) {}
    window.dashPlayer = null;
  }
  if (window.hlsPlayer) {
    try { window.hlsPlayer.destroy(); } catch (e) {}
    window.hlsPlayer = null;
  }

  closeQualityMenu();
  if (modal) modal.classList.add('hidden');
  updateTgBackButton();
}"""

# Replace in app_code from `let playerControlsInitialized` to before `BOT CONFIRMATION POPUP BOTTOM SHEET`
pattern_js = re.compile(r'let playerControlsInitialized = false;.*?// ═══════════════════════════════════════════════════════════════\s*// BOT CONFIRMATION POPUP', re.DOTALL)
if pattern_js.search(app_code):
    app_code = pattern_js.sub(player_js_block + '\n\n// ═══════════════════════════════════════════════════════════════\n// BOT CONFIRMATION POPUP', app_code)
    print('Replaced player JS block in webapp/app.js!')

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app_code)

print('Updated webapp/app.js and webapp/index.html!')
