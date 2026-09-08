import os
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

REPLACEMENTS = [
    ('â•', '═'),
    ('â€”', '—'),
    ('â€“', '–'),
    ('â€¢', '•'),
    ('â†’', '→'),
    ('â†', '←'),
    ('âœ¨', '✨'),
    ('âš¡', '⚡'),
    ('âœ“', '✓'),
    ('âœ•', '✕'),
    ('âœ ', '✏️'),
    ('â˜ ï¸ ', '☁️'),
    ('â˜ ', '☁️'),
    ('â ³', '⏳'),
    ('â Œ', '❌'),
    ('â€™', "'"),
    ('â€œ', '"'),
    ('â€ ', '"'),
    ('â€˜', "'"),
    ('ðŸŽ“', '🎓'),
    ('ðŸ”¥', '🔥'),
    ('ðŸ¤–', '🤖'),
    ('ðŸ“š', '📚'),
    ('ðŸ” ', '🔍'),
    ('ðŸŒŸ', '🌟'),
    ('ðŸŽ¬', '🎬'),
    ('ðŸ“„', '📄'),
    ('ðŸ“‹', '📋'),
    ('ðŸ‘‰', '👉'),
    ('ðŸ”’', '🔒'),
    ('ðŸ”‘', '🔑'),
    ('ðŸ’¬', '💬'),
    ('ðŸ“ž', '📞'),
    ('ðŸš€', '🚀'),
    ('ðŸ“¡', '📡'),
    ('ðŸ› ï¸ ', '🛠️'),
    ('ðŸŽ‰', '🎉'),
    ('ðŸŽ¥', '🎥'),
    ('ðŸ‘©â€ ðŸ «', '👩‍🏫'),
    ('ðŸ‘¨â€ ðŸ «', '👨‍🏫'),
    ('â€‹', ''),
    ('â€¹', '‹'),
    ('â€º', '›'),
    ('Ã—', '×'),
    ('Â ', ' '),
    ('Â', ''),
]

def clean_file(path):
    if not os.path.exists(path):
        return
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    orig = content
    for bad, good in REPLACEMENTS:
        content = content.replace(bad, good)
    
    # Strip any remaining control mojibake artifacts like \u0080-\u009f
    content = re.sub(r'[\u0080-\u009f\ufffd]', '', content)
    
    if content != orig:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Cleaned mojibake in {path}')

for root, dirs, files in os.walk('.'):
    if any(p in root for p in ['.git', 'node_modules', '__pycache__', 'scratch', 'webapp-dist', '.system_generated']):
        continue
    for f in files:
        if f.endswith(('.js', '.html', '.css', '.json', '.py', '.md')):
            clean_file(os.path.join(root, f))

print('Mojibake cleanup completed!')
