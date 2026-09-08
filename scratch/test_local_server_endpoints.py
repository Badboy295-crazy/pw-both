import subprocess
import time
import urllib.request
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

node_exe = r'C:\Users\SUVAS\AppData\Local\Programs\HTTP Toolkit\resources\httptoolkit-server\bin\node.exe'

env = os.environ.copy()
env['PORT'] = '3333'
env['BOT_NAME'] = 'InvalidStudy'
env['BOT_USERNAME'] = 'InvalidStudyRobot'
env['BANNER'] = '2'

print('Starting local server on port 3333...')
proc = subprocess.Popen([node_exe, 'server/index.js'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

time.sleep(2)

def test_endpoint(name, url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f'✅ [200 OK] {name}: {url}')
            if isinstance(data, dict):
                success = data.get('success', True)
                d = data.get('data')
                cnt = len(d) if isinstance(d, list) else (1 if d else 0)
                print(f'   Success: {success}, Items: {cnt}')
            elif isinstance(data, list):
                print(f'   Array Items: {len(data)}')
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'❌ [{e.code} ERROR] {name}: {url}\n   Body: {body[:150]}')
        return False
    except Exception as ex:
        print(f'❌ [EXCEPTION] {name}: {url}\n   Error: {ex}')
        return False

tests = [
    ('Health Check', 'http://localhost:3333/health'),
    ('Config Brand API', 'http://localhost:3333/api/config'),
    ('PW Batches', 'http://localhost:3333/api/batches?provider=pw&page=1&limit=5'),
    ('Mission JEET Batches', 'http://localhost:3333/api/batches?provider=missionjeet&page=1&limit=5'),
    ('NextTopper Batches', 'http://localhost:3333/api/batches?provider=nexttopper&page=1&limit=5'),
    ('Vidyakul Batches', 'http://localhost:3333/api/batches?provider=vidyakul&page=1&limit=5'),
    ('Apna College Batches', 'http://localhost:3333/api/batches?provider=apnacollege&page=1&limit=5'),
    ('Mission JEET Batch 185 Details', 'http://localhost:3333/api/batch/185/details?provider=missionjeet'),
    ('Mission JEET Batch 185 Subject 12909 Topics', 'http://localhost:3333/api/batch/185/subject/12909/topics?provider=missionjeet'),
    ('Mission JEET Batch 185 Subject 12909 Content', 'http://localhost:3333/api/batch/185/subject/12909/content?provider=missionjeet&type=Videos'),
    ('NextTopper Batch 193 Details', 'http://localhost:3333/api/batch/193/details?provider=nexttopper'),
    ('NextTopper Batch 193 Subject 13555 Topics', 'http://localhost:3333/api/batch/193/subject/13555/topics?provider=nexttopper'),
    ('NextTopper Batch 193 Subject 13555 Topic Content', 'http://localhost:3333/api/batch/193/subject/13555/topic/tenses/content?provider=nexttopper&type=Videos')
]

passed = 0
for name, url in tests:
    if test_endpoint(name, url):
        passed += 1

print(f'\nResults: {passed}/{len(tests)} tests passed!')

proc.terminate()
proc.wait()
