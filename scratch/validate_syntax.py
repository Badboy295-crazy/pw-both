import os, sys, subprocess

sys.stdout.reconfigure(encoding='utf-8')

def test_syntax():
    # Check node syntax on JS files
    js_files = ['server/index.js', 'server/dumper.js', 'server/config.js', 'server/build.js', 'webapp/app.js', 'app.js']
    print("=== CHECKING NODE JS SYNTAX ===")
    for js in js_files:
        if os.path.exists(js):
            res = subprocess.run(['node', '--check', js], capture_output=True, text=True)
            if res.returncode == 0:
                print(f"✓ {js} syntax OK")
            else:
                print(f"❌ {js} syntax ERROR:\n{res.stderr}")

    # Check python syntax
    py_files = ['gen_session.py', 'scratch/test_live_as_providers.py', 'scratch/sync_webapp_to_root.py']
    print("\n=== CHECKING PYTHON SYNTAX ===")
    for py in py_files:
        if os.path.exists(py):
            res = subprocess.run(['python', '-m', 'py_compile', py], capture_output=True, text=True)
            if res.returncode == 0:
                print(f"✓ {py} syntax OK")
            else:
                print(f"❌ {py} syntax ERROR:\n{res.stderr}")

if __name__ == '__main__':
    test_syntax()
