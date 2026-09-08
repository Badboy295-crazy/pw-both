import os
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update webapp/app.js
app_path = 'webapp/app.js'
with open(app_path, 'r', encoding='utf-8') as f:
    app_code = f.read()

replacements = [
    ("ðŸ›ï¸ Platforms", "🏛️ Platforms"),
    ("ðŸ›ï¸", "🏛️"),
    ("â€º", "›"),
    ("â¤ï¸", "❤️"),
    ("ðŸ¤", "🤍"),
    ("â‹®", "⋮"),
    ("ðŸ“­", "📦"),
    ("ðŸ”", "🔍"),
    ("ðŸ“–", "📖"),
    ("ðŸ“º", "📺"),
    ("ðŸ“·", "📸"),
    ("ðŸŒ", "🌐"),
    ("ðŸ§ ", "🧠"),
    ("ðŸ“", "📝"),
]

for bad, good in replacements:
    app_code = app_code.replace(bad, good)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app_code)
print('Cleaned webapp/app.js mojibake and heart symbols!')

# 2. Update server/index.js and server/dumper.js
for sp in ['server/index.js', 'server/dumper.js']:
    if os.path.exists(sp):
        with open(sp, 'r', encoding='utf-8') as f:
            scode = f.read()
        for bad, good in replacements:
            scode = scode.replace(bad, good)
        scode = scode.replace('â˜ï¸', '☁️')
        scode = scode.replace('â˜', '☁️')
        scode = scode.replace('ðŸ¡', '🏷️')
        scode = scode.replace('ðŸ·ï¸', '👤')
        with open(sp, 'w', encoding='utf-8') as f:
            f.write(scode)
        print(f'Cleaned {sp} mojibake!')

# 3. Update webapp/style.css for Responsive Provider Bar Grid
css_path = 'webapp/style.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css_code = f.read()

new_provider_css = """/* ─── Provider Selector Bar (Dynamic Responsive 3-Column Grid) ─── */
.provider-selector-wrapper,
.providers-bar-container {
  padding: 12px 16px 0;
  overflow: visible;
}
.provider-selector,
.providers-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
}
@media (max-width: 380px) {
  .provider-selector,
  .providers-bar {
    grid-template-columns: repeat(2, 1fr);
  }
}
.provider-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
  transition: all var(--transition-fast);
}"""

pattern = re.compile(r'/\* ─── Provider Selector Bar ───.*?\n\.provider-btn:hover \{', re.DOTALL)
if pattern.search(css_code):
    css_code = pattern.sub(new_provider_css + '\n.provider-btn:hover {', css_code)
    print('Replaced provider bar CSS in webapp/style.css!')
else:
    print('Pattern not matched in webapp/style.css')

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css_code)

print('All fixes applied successfully!')
