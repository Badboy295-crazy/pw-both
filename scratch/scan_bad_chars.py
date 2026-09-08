import os
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

bad_markers = ['ðŸ', 'â•', 'â€”', 'â€¢', 'â†’', 'â˜', 'â ³', 'â Œ', 'â¤', 'ðŸ¤', 'â€']

for root, dirs, files in os.walk('.'):
    if any(p in root for p in ['.git', 'node_modules', '__pycache__', 'scratch', 'webapp-dist', '.system_generated']):
        continue
    for f in files:
        if f.endswith(('.js', '.html', '.css', '.json')):
            p = os.path.join(root, f)
            lines = open(p, encoding='utf-8', errors='replace').read().splitlines()
            for i, l in enumerate(lines):
                for bad in bad_markers:
                    if bad in l:
                        print(f'{p}:{i+1} [found {bad}]: {l.strip()[:100]}')
                        break
