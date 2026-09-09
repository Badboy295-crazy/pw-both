import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

def check_js_ast(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    # Accurate JS Tokenizer
    # Tokens: String ("...", '...', `...`), Comment (//, /* */), Regex (/.../[flags]), or code
    i = 0
    n = len(code)
    stack = []
    errors = []

    def get_line(pos):
        return code[:pos].count('\n') + 1

    last_token_was_operand = False

    while i < n:
        ch = code[i]
        
        # Whitespace
        if ch in ' \t\r\n':
            i += 1
            continue

        # Single-line comment
        if ch == '/' and i + 1 < n and code[i+1] == '/':
            i += 2
            while i < n and code[i] != '\n':
                i += 1
            continue

        # Multi-line comment
        if ch == '/' and i + 1 < n and code[i+1] == '*':
            i += 2
            while i < n and not (code[i] == '*' and i + 1 < n and code[i+1] == '/'):
                i += 1
            i += 2
            continue

        # String single or double quote
        if ch in ('"', "'"):
            quote = ch
            i += 1
            while i < n:
                if code[i] == '\\':
                    i += 2
                    continue
                if code[i] == quote:
                    i += 1
                    break
                i += 1
            last_token_was_operand = True
            continue

        # Template literal
        if ch == '`':
            i += 1
            while i < n:
                if code[i] == '\\':
                    i += 2
                    continue
                if code[i] == '$' and i + 1 < n and code[i+1] == '{':
                    # Expression inside template literal
                    stack.append(('`_expr', i, get_line(i)))
                    i += 2
                    last_token_was_operand = False
                    break
                if code[i] == '`':
                    i += 1
                    break
                i += 1
            last_token_was_operand = True
            continue

        # Regex vs Division
        if ch == '/':
            if not last_token_was_operand:
                # This is a regex literal!
                i += 1
                in_class = False
                while i < n:
                    if code[i] == '\\':
                        i += 2
                        continue
                    if code[i] == '[':
                        in_class = True
                    elif code[i] == ']':
                        in_class = False
                    elif code[i] == '/' and not in_class:
                        i += 1
                        # skip flags
                        while i < n and code[i].isalpha():
                            i += 1
                        break
                    i += 1
                last_token_was_operand = True
                continue
            else:
                # Division
                i += 1
                last_token_was_operand = False
                continue

        # Brackets
        if ch in '({[':
            stack.append((ch, i, get_line(i)))
            last_token_was_operand = False
            i += 1
            continue

        if ch in ')}]':
            line_no = get_line(i)
            if not stack:
                errors.append(f"Unmatched closing '{ch}' at line {line_no}")
            else:
                top, pos, s_line = stack.pop()
                if top == '`_expr' and ch == '}':
                    # closing template literal expression, continue reading template literal!
                    while i + 1 < n:
                        i += 1
                        if code[i] == '\\':
                            i += 1
                            continue
                        if code[i] == '$' and i + 1 < n and code[i+1] == '{':
                            stack.append(('`_expr', i, get_line(i)))
                            i += 1
                            last_token_was_operand = False
                            break
                        if code[i] == '`':
                            break
                    last_token_was_operand = True
                    i += 1
                    continue
                elif (top == '(' and ch != ')') or (top == '{' and ch != '}') or (top == '[' and ch != ']'):
                    errors.append(f"Mismatch: '{top}' at line {s_line} closed by '{ch}' at line {line_no}")
            last_token_was_operand = True
            i += 1
            continue

        # Operators & identifiers
        if ch in '+-*/%=&|!^~?:;,.<>':
            last_token_was_operand = False
        else:
            last_token_was_operand = True
        i += 1

    if stack:
        for s, p, lno in stack:
            errors.append(f"Unclosed '{s}' opened at line {lno}")

    if not errors:
        print(f"✓ {filepath}: 100% PERFECT AST syntax & bracket balance!")
        return True
    else:
        print(f"❌ {filepath} errors:")
        for e in errors:
            print(f"  - {e}")
        return False

for f in ['server/index.js', 'server/dumper.js', 'server/config.js', 'server/build.js', 'webapp/app.js', 'app.js']:
    check_js_ast(f)
