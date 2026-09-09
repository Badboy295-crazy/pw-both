import os, sys, glob, re

sys.stdout.reconfigure(encoding='utf-8')

def check_files():
    suspicious_chars = ['\ufffd', 'â', 'ð', 'Ã', 'â€', 'âŒ', 'â³', 'ðŸ', 'â–', 'â”', 'Â']
    files = [
        'server/index.js', 'server/dumper.js', 'server/config.js',
        'webapp/app.js', 'webapp/index.html', 'webapp/style.css',
        'index.html', 'app.js', 'style.css'
    ]
    for root, dirs, fnames in os.walk('.'):
        if any(p in root for p in ['node_modules', '.git', '.gemini', '__pycache__', 'scratch']):
            continue
        for fn in fnames:
            if fn.endswith(('.js', '.html', '.css', '.json', '.py', '.md')):
                fpath = os.path.normpath(os.path.join(root, fn)).replace('\\', '/')
                if fpath not in files:
                    files.append(fpath)

    for fp in files:
        if not os.path.exists(fp):
            continue
        suspicious = []
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            for idx, line in enumerate(f, 1):
                # Look for suspicious sequences or weird unicode
                for marker in suspicious_chars:
                    if marker in line:
                        suspicious.append((idx, marker, line.strip()))
                        break
        if suspicious:
            print(f"=== {fp} ({len(suspicious)} suspicious lines) ===")
            for lno, m, text in suspicious[:20]:
                print(f"  L{lno} [{repr(m)}]: {text[:100]}")
            if len(suspicious) > 20:
                print(f"  ... and {len(suspicious) - 20} more lines")

if __name__ == '__main__':
    check_files()
