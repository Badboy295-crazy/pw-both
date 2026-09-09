import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

# Check fav symbol and buttons in webapp/index.html and webapp/app.js
for fp in ['webapp/index.html', 'webapp/app.js', 'webapp/style.css']:
    with open(fp, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    print(f"=== {fp} ===")
    # Find any bookmark / favorite symbols
    for line_no, line in enumerate(content.splitlines(), 1):
        if any(term in line.lower() for term in ['fav', 'bookmark', 'filter', 'provider', 'button', 'badge']):
            if len(line.strip()) < 150:
                print(f"  L{line_no}: {line.strip()}")
