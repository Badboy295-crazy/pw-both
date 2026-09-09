import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

# Replacements map for exact broken sequences
REPLACEMENTS = [
    ('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”', '──────────────────────────────────────────────────'),
    ('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”', '────────────────────────'),
    ('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”', '────────────────────'),
    ('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”', '──────────────────'),
    ('â”', '─'),
    ('âš™ï¸', '⚙️'),
    ('âš™', '⚙️'),
    ('â­ï¸', '⭐'),
    ('â­', '⭐'),
    ('â±ï¸', '⏱️'),
    ('â±', '⏱️'),
    ('âœï¸', '✨'),
    ('âœ', '✨'),
    ('🛡️ï¸', '🛡️'),
    ('⚠️ï¸', '⚠️'),
    ('ℹ️ï¸', 'ℹ️'),
    ('⬇️ï¸', '⬇️'),
    ('↗ï¸', '↗'),
    ('↗️ï¸', '↗'),
    ('ðŸ›ï¸', '🏛️'),
]

files = [
    'server/index.js',
    'server/dumper.js',
    'webapp/app.js',
    'app.js',
    'walkthrough.md'
]

for fpath in files:
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    orig = content
    for src, dst in REPLACEMENTS:
        content = content.replace(src, dst)
        
    if content != orig:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed broken sequences in: {fpath}")
    else:
        print(f"No changes needed for: {fpath}")
