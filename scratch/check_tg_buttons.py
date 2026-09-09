import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

with open('server/index.js', 'r', encoding='utf-8', errors='replace') as f:
    server_code = f.read()

# Find all inline_keyboard and keyboard in server/index.js
print("--- TELEGRAM BUTTONS IN server/index.js ---")
button_matches = re.findall(r'(\[[\s\S]*?\{[\s\S]*?text:\s*[`\'"].*?[`\'"][\s\S]*?\}[\s\S]*?\])', server_code)
for idx, bm in enumerate(button_matches):
    # filter to short chunks
    if len(bm) < 1000 and any(k in bm for k in ['text:', 'inline_keyboard', 'reply_markup']):
        print(f"\n[Button Group #{idx+1}]:\n{bm.strip()}")

# Also find all bot.sendMessage calls in server/index.js
print("\n--- ALL MESSAGE TEMPLATES IN server/index.js ---")
lines = server_code.split('\n')
for i, line in enumerate(lines, 1):
    if any(pattern in line for pattern in ['bot.sendMessage', 'reply_markup', 'inline_keyboard', 'â', '', 'ï¸', 'ð']):
        print(f"L{i}: {line}")
