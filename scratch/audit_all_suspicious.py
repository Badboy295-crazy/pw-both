import os, sys, glob, re

sys.stdout.reconfigure(encoding='utf-8')

def audit_all():
    target_exts = ('.js', '.html', '.css', '.json', '.py', '.md', '.env')
    skip_dirs = {'node_modules', '.git', '.gemini', '__pycache__', 'scratch'}
    
    found = []
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fn in files:
            if not fn.endswith(target_exts):
                continue
            fpath = os.path.normpath(os.path.join(root, fn)).replace('\\', '/')
            try:
                with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
                    
                # Look for suspicious patterns
                # 1. Broken variation selectors or mojibake
                suspicious_patterns = [
                    r'ï¸', r'â[”š±­œ–€]', r'â”', r'ðŸ', r'Ã', r'Â', r'\ufffd', r'\u201d'
                ]
                for pattern in suspicious_patterns:
                    matches = list(re.finditer(pattern, content))
                    if matches:
                        for m in matches:
                            start = max(0, m.start() - 30)
                            end = min(len(content), m.end() + 30)
                            found.append((fpath, m.group(0), content[start:end].replace('\n', ' ')))
            except Exception as e:
                print(f"Error reading {fpath}: {e}")
                
    print(f"Total suspicious occurrences found: {len(found)}")
    for fpath, match, snippet in found:
        print(f"[{fpath}] match={repr(match)} -> snippet: {repr(snippet)}")

if __name__ == '__main__':
    audit_all()
