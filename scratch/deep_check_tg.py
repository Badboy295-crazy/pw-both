import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

# Let's inspect all bot commands, buttons, and messages in server/index.js
with open('server/index.js', 'r', encoding='utf-8', errors='replace') as f:
    text = f.read()

# Let's find all occurrences of bot.sendMessage, bot.sendPhoto, editMessageText, answerCallbackQuery
print("=== TELEGRAM BOT MESSAGES AND BUTTONS ===")
for m in re.finditer(r'(bot\.(?:sendMessage|sendPhoto|editMessageText)[\s\S]*?\);)', text):
    msg_block = m.group(1)
    if any(c in msg_block for c in ['â', 'ð', 'Ã', 'ï¸', 'â€', 'âŒ', 'â³', 'ðŸ', 'â–', 'â”', 'Â', '??', 'undefined', 'undefined']):
        print(f"\n--- Corrupted Message Block ---\n{msg_block[:300]}")

# Let's also check all inline_keyboard buttons in server/index.js
print("\n=== ALL INLINE KEYBOARDS ===")
for m in re.finditer(r'inline_keyboard:\s*\[([\s\S]*?)\]\s*\}', text):
    kb = m.group(1)
    print(f"\nKeyboard:\n{kb.strip()[:400]}")
