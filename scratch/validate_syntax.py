import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

def check_brackets(filepath):
    content = open(filepath, encoding='utf-8', errors='replace').read()
    stack = []
    pairs = {')': '(', '}': '{', ']': '['}
    in_str = None
    in_regex = False
    in_comment_line = False
    in_comment_block = False
    escape = False

    i = 0
    n = len(content)
    while i < n:
        c = content[i]
        
        if in_comment_line:
            if c == '\n':
                in_comment_line = False
            i += 1
            continue
            
        if in_comment_block:
            if c == '*' and i + 1 < n and content[i+1] == '/':
                in_comment_block = False
                i += 2
                continue
            i += 1
            continue

        if in_str:
            if escape:
                escape = False
            elif c == '\\':
                escape = True
            elif c == in_str:
                in_str = None
            i += 1
            continue

        # Check comment starts
        if c == '/' and i + 1 < n:
            if content[i+1] == '/':
                in_comment_line = True
                i += 2
                continue
            elif content[i+1] == '*':
                in_comment_block = True
                i += 2
                continue

        # Strings
        if c in ("'", '"', '`'):
            in_str = c
            escape = False
            i += 1
            continue

        # Brackets
        if c in ('(', '{', '['):
            stack.append((c, i))
        elif c in (')', '}', ']'):
            if not stack:
                return False, f'Unmatched closing {c} at pos {i}'
            top, pos = stack.pop()
            if pairs[c] != top:
                return False, f'Mismatched {top} at pos {pos} with {c} at pos {i}'
        i += 1

    if stack:
        top, pos = stack[-1]
        line = content[:pos].count('\n') + 1
        return False, f'Unclosed {top} from line {line}'
    return True, 'OK'

for f in ['server/index.js', 'server/config.js', 'webapp/app.js', 'webapp/player.js', 'webapp/lecture_player.js']:
    if os.path.exists(f):
        ok, msg = check_brackets(f)
        print(f'{f}: {msg}')
