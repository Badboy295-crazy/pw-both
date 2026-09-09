import os, sys, re

sys.stdout.reconfigure(encoding='utf-8')

def find_all_text_issues():
    files_to_check = [
        'server/index.js',
        'server/dumper.js',
        'server/config.js',
        'webapp/app.js',
        'webapp/index.html',
        'webapp/style.css',
        'index.html',
        'app.js',
        'style.css'
    ]
    
    print("=== AUDITING ALL FILES FOR TEXT & CHAR ISSUES ===")
    for fp in files_to_check:
        if not os.path.exists(fp):
            continue
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
            
        print(f"\n--- FILE: {fp} ({len(lines)} lines) ---")
        issues = 0
        for idx, line in enumerate(lines, 1):
            # Check for mojibake or suspicious characters
            has_mojibake = any(m in line for m in ['\ufffd', 'â', 'ð', 'Ã', 'ï¸', 'â€', 'âŒ', 'â³', 'ðŸ', 'â–', 'â”', 'Â'])
            # Check for suspicious character patterns like `?` inside text or double symbols
            if has_mojibake:
                issues += 1
                print(f"  Line {idx}: {repr(line.strip())}")
                
        if issues == 0:
            print("  ✓ No character issues found.")

if __name__ == '__main__':
    find_all_text_issues()
