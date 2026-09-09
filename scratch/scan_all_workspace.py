import os, sys, glob, re

sys.stdout.reconfigure(encoding='utf-8')

def scan_entire_workspace():
    skip_dirs = {'node_modules', '.git', '.gemini', '__pycache__'}
    
    total_files = 0
    clean_files = 0
    dirty_files = []
    
    suspicious_chars = ['\ufffd', 'â', 'ð', 'Ã', 'ï¸', 'â€', 'âŒ', 'â³', 'ðŸ', 'â–', 'â”', 'Â']
    
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fn in files:
            if fn.endswith(('.pyc', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf')):
                continue
            fpath = os.path.normpath(os.path.join(root, fn)).replace('\\', '/')
            total_files += 1
            has_issue = False
            try:
                with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                    for lno, line in enumerate(f, 1):
                        for m in suspicious_chars:
                            if m in line:
                                has_issue = True
                                dirty_files.append((fpath, lno, m, line.strip()))
                                break
            except Exception as e:
                print(f"Error checking {fpath}: {e}")
            if not has_issue:
                clean_files += 1
                
    print(f"\nScanned {total_files} files across entire workspace.")
    print(f"Clean files: {clean_files}")
    print(f"Files with issues: {len(dirty_files)}")
    for fp, lno, m, text in dirty_files[:30]:
        print(f"  [{fp}:L{lno}] ({repr(m)}): {text[:80]}")

if __name__ == '__main__':
    scan_entire_workspace()
