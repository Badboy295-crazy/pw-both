import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update webapp/index.html with specific platform card classes
html_path = 'webapp/index.html'
with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('<div class="platform-card" onclick="selectPlatform(\'pw\')">', '<div class="platform-card platform-card-pw" onclick="selectPlatform(\'pw\')">')
html = html.replace('<div class="platform-card" onclick="selectPlatform(\'nexttopper\')">', '<div class="platform-card platform-card-nt" onclick="selectPlatform(\'nexttopper\')">')
html = html.replace('<div class="platform-card" onclick="selectPlatform(\'missionjeet\')">', '<div class="platform-card platform-card-missionjeet" onclick="selectPlatform(\'missionjeet\')">')
html = html.replace('<div class="platform-card" onclick="selectPlatform(\'vidyakul\')">', '<div class="platform-card platform-card-vidyakul" onclick="selectPlatform(\'vidyakul\')">')
html = html.replace('<div class="platform-card" onclick="selectPlatform(\'apnacollege\')">', '<div class="platform-card platform-card-apnacollege" onclick="selectPlatform(\'apnacollege\')">')
html = html.replace('<div class="platform-card" onclick="selectPlatform(\'sketchbook\')">', '<div class="platform-card platform-card-sketchbook" onclick="selectPlatform(\'sketchbook\')">')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)
print('Updated webapp/index.html platform card classes!')

# 2. Update webapp/style.css with rich aesthetics, gradients & animations
css_path = 'webapp/style.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css_code = f.read()

landing_css_block = """/* ════════════════════════════════════════════════════════════════
   PLATFORMS LANDING PAGE BENTO GRID & DYNAMIC AESTHETICS
   ════════════════════════════════════════════════════════════════ */
.platforms-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding: 8px 18px 40px;
  perspective: 1200px;
}

@media (max-width: 380px) {
  .platforms-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}

.platform-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 18px 16px 16px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 140px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), 
              border-color 0.25s ease, 
              box-shadow 0.28s ease;
  animation: platformCardFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes platformCardFadeIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Staggered animation delays */
.platform-card:nth-child(1) { animation-delay: 0.04s; }
.platform-card:nth-child(2) { animation-delay: 0.08s; }
.platform-card:nth-child(3) { animation-delay: 0.12s; }
.platform-card:nth-child(4) { animation-delay: 0.16s; }
.platform-card:nth-child(5) { animation-delay: 0.20s; }
.platform-card:nth-child(6) { animation-delay: 0.24s; }
.platform-card:nth-child(7) { animation-delay: 0.28s; }

/* Subtle light reflection overlay */
.platform-card::after {
  content: "";
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
  transition: left 0.6s ease;
  pointer-events: none;
}

.platform-card:hover::after,
.platform-card:active::after {
  left: 100%;
}

.platform-card:hover {
  transform: translateY(-4px) scale(1.02);
}

.platform-card:active {
  transform: translateY(-1px) scale(0.99);
}

.platform-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.platform-card-emoji {
  font-size: 28px;
  display: inline-block;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.platform-card:hover .platform-card-emoji {
  transform: scale(1.18) rotate(-4deg);
}

.platform-card-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.25s ease;
}

.platform-card-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.3px;
  line-height: 1.25;
  margin-bottom: 12px;
}

.platform-card-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  transition: color 0.25s ease;
}

.platform-card-arrow {
  font-size: 14px;
  transition: transform 0.25s ease;
}

.platform-card:hover .platform-card-arrow {
  transform: translateX(4px);
}

/* ─── 1. Guru AI Doubt Solver (Featured Holo Banner) ─── */
.platform-card-guru {
  grid-column: 1 / -1;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.16) 0%, rgba(56, 189, 248, 0.1) 50%, rgba(16, 17, 24, 0.95) 100%) !important;
  border: 1px solid rgba(168, 85, 247, 0.45) !important;
  box-shadow: 0 8px 30px rgba(168, 85, 247, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  position: relative;
}
.platform-card-guru::before {
  content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, transparent 60%);
  pointer-events: none;
}
.platform-card-guru:hover {
  border-color: rgba(168, 85, 247, 0.7) !important;
  box-shadow: 0 12px 38px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
}
.platform-card-guru .guru-badge {
  background: linear-gradient(135deg, #a855f7, #38bdf8) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 2px 10px rgba(168, 85, 247, 0.4);
}
.platform-card-guru .platform-card-action {
  color: #c084fc;
}

/* ─── 2. Physics Wallah Card (PW Gold Glow) ─── */
.platform-card-pw {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(235, 94, 40, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(245, 158, 11, 0.35);
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.08);
}
.platform-card-pw:hover {
  border-color: rgba(245, 158, 11, 0.65);
  box-shadow: 0 8px 30px rgba(245, 158, 11, 0.2);
}
.platform-card-pw .platform-card-badge {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.4);
  color: #fbbf24;
}
.platform-card-pw .platform-card-action {
  color: #fbbf24;
}

/* ─── 3. Next Toppers Card (Royal Indigo Glow) ─── */
.platform-card-nt {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(59, 130, 246, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(99, 102, 241, 0.35);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.08);
}
.platform-card-nt:hover {
  border-color: rgba(99, 102, 241, 0.65);
  box-shadow: 0 8px 30px rgba(99, 102, 241, 0.2);
}
.platform-card-nt .platform-card-badge {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
}
.platform-card-nt .platform-card-action {
  color: #a5b4fc;
}

/* ─── 4. Mission JEET Card (Crimson Flame Glow) ─── */
.platform-card-missionjeet {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(249, 115, 22, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(239, 68, 68, 0.35);
  box-shadow: 0 4px 20px rgba(239, 68, 68, 0.08);
}
.platform-card-missionjeet:hover {
  border-color: rgba(239, 68, 68, 0.65);
  box-shadow: 0 8px 30px rgba(239, 68, 68, 0.2);
}
.platform-card-missionjeet .platform-card-badge {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}
.platform-card-missionjeet .platform-card-action {
  color: #fca5a5;
}

/* ─── 5. Vidyakul Card (Emerald Mint Glow) ─── */
.platform-card-vidyakul {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(20, 184, 166, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(16, 185, 129, 0.35);
  box-shadow: 0 4px 20px rgba(16, 185, 129, 0.08);
}
.platform-card-vidyakul:hover {
  border-color: rgba(16, 185, 129, 0.65);
  box-shadow: 0 8px 30px rgba(16, 185, 129, 0.2);
}
.platform-card-vidyakul .platform-card-badge {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.4);
  color: #6ee7b7;
}
.platform-card-vidyakul .platform-card-action {
  color: #6ee7b7;
}

/* ─── 6. Apna College Card (Electric Cyan Glow) ─── */
.platform-card-apnacollege {
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(6, 182, 212, 0.35);
  box-shadow: 0 4px 20px rgba(6, 182, 212, 0.08);
}
.platform-card-apnacollege:hover {
  border-color: rgba(6, 182, 212, 0.65);
  box-shadow: 0 8px 30px rgba(6, 182, 212, 0.2);
}
.platform-card-apnacollege .platform-card-badge {
  background: rgba(6, 182, 212, 0.18);
  border-color: rgba(6, 182, 212, 0.4);
  color: #67e8f9;
}
.platform-card-apnacollege .platform-card-action {
  color: #67e8f9;
}

/* ─── 7. SketchBook Card (Neon Pink Glow) ─── */
.platform-card-sketchbook {
  background: linear-gradient(135deg, rgba(236, 72, 153, 0.12) 0%, rgba(217, 70, 239, 0.08) 50%, rgba(16, 17, 24, 0.95) 100%);
  border: 1px solid rgba(236, 72, 153, 0.35);
  box-shadow: 0 4px 20px rgba(236, 72, 153, 0.08);
}
.platform-card-sketchbook:hover {
  border-color: rgba(236, 72, 153, 0.65);
  box-shadow: 0 8px 30px rgba(236, 72, 153, 0.2);
}
.platform-card-sketchbook .platform-card-badge {
  background: rgba(236, 72, 153, 0.18);
  border-color: rgba(236, 72, 153, 0.4);
  color: #f9a8d4;
}
.platform-card-sketchbook .platform-card-action {
  color: #f9a8d4;
}"""

pattern = re.compile(r'/\* ─── Platforms Bento Grid ───.*?\n/\* ─── Platform Header Nav in view-home', re.DOTALL)
if pattern.search(css_code):
    css_code = pattern.sub(landing_css_block + '\n\n/* ─── Platform Header Nav in view-home', css_code)
    print('Replaced platforms grid CSS in webapp/style.css!')
else:
    # Alternative pattern match
    alt_pattern = re.compile(r'\.platforms-grid\s*\{.*?\n/\* ─── Platform Header Nav', re.DOTALL)
    if alt_pattern.search(css_code):
        css_code = alt_pattern.sub(landing_css_block + '\n\n/* ─── Platform Header Nav', css_code)
        print('Replaced platforms grid CSS (alt pattern) in webapp/style.css!')
    else:
        print('Warning: platforms grid pattern not found in webapp/style.css')

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css_code)

print('Landing page aesthetic upgrade completed!')
