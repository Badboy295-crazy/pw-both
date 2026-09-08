import sys

sys.stdout.reconfigure(encoding='utf-8')

css_path = 'webapp/style.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css_code = f.read()

old_block = """/* ─── Provider Selector Switcher ──────────────────────────────── */
.provider-selector-wrapper {
  padding: 14px 18px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.provider-selector-wrapper::-webkit-scrollbar {
  display: none;
}
.provider-selector {
  display: flex;
  gap: 8px;
  min-width: max-content;
}
.provider-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}"""

new_block = """/* ─── Provider Selector Switcher (Dynamic Responsive 3-Column Grid) ─── */
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

if old_block in css_code:
    css_code = css_code.replace(old_block, new_block)
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css_code)
    print('Successfully updated provider bar grid in webapp/style.css!')
else:
    print('Warning: old_block not found in webapp/style.css')
