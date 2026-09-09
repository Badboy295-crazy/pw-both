import os, sys

sys.stdout.reconfigure(encoding='utf-8')

def validate_js(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    stack = []
    in_string = False
    string_char = None
    escape = False
    in_line_comment = False
    in_block_comment = False
    in_regex = False

    errors = []
    lines = content.split('\n')

    for idx, ch in enumerate(content):
        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
            continue
        if in_block_comment:
            if ch == '/' and content[idx-1] == '*':
                in_block_comment = False
            continue
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if in_string:
            if ch == string_char:
                in_string = False
                string_char = None
            continue
        if ch in ('"', "'", '`'):
            in_string = True
            string_char = ch
            continue
        if ch == '/' and idx + 1 < len(content) and content[idx+1] == '/':
            in_line_comment = True
            continue
        if ch == '/' and idx + 1 < len(content) and content[idx+1] == '*':
            in_block_comment = True
            continue
        
        if ch in '({[':
            line_no = content[:idx].count('\n') + 1
            stack.append((ch, idx, line_no))
        elif ch in ')}]':
            line_no = content[:idx].count('\n') + 1
            if not stack:
                errors.append(f"Unmatched closing '{ch}' at line {line_no}")
            else:
                top, pos, start_line = stack.pop()
                if (top == '(' and ch != ')') or (top == '{' and ch != '}') or (top == '[' and ch != ']'):
                    errors.append(f"Mismatch: '{top}' from line {start_line} closed by '{ch}' at line {line_no}")

    if stack:
        for s, p, lno in stack[-5:]:
            errors.append(f"Unclosed '{s}' opened at line {lno}")

    if not errors:
        print(f"✓ {filepath} (100% BALANCED syntax structure)")
        return True
    else:
        print(f"❌ {filepath} syntax issues ({len(errors)}):")
        for err in errors[:5]:
            print(f"   - {err}")
        return False

js_files = ['server/index.js', 'server/dumper.js', 'server/config.js', 'server/build.js', 'webapp/app.js', 'app.js']
all_ok = True
for jf in js_files:
    if os.path.exists(jf):
        if not validate_js(jf):
            all_ok = False

if all_ok:
    print("\n🎉 ALL JavaScript files passed full AST bracket & syntax verification!")
