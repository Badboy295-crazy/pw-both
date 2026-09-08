import urllib.request, json, ssl, time, hmac, hashlib, base64

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def get_headers(dev_id):
    ts = str(int(time.time()))
    encoded_ts = base64.b64encode(ts.encode()).decode()
    secret = '1mBD4OQnsBMBaN6oISWwTmryX1lHjkW9XLZhsirCOT0='
    sig = base64.b64encode(hmac.new(base64.b64decode(secret), ts.encode(), hashlib.sha256).digest()).decode()
    return {
        'X-Client-Id': dev_id,
        'MadX-Auth-Key': encoded_ts,
        'MadX-Auth-Signature': sig,
        'User-Agent': 'Mozilla/5.0'
    }

h = get_headers('WEB_TEST_007')
r1 = urllib.request.Request('https://api.asmultiverse.app/api/v1/nt/batches?page=1', headers=h)
urllib.request.urlopen(r1, context=ctx)

r2 = urllib.request.Request('https://api.asmultiverse.app/api/v1/nt/batch/193/details', headers=h)
with urllib.request.urlopen(r2, context=ctx) as resp:
    data = json.loads(resp.read().decode())
    rawSubjects = data.get('data', {}).get('subjects', [])
    print(f'Subjects count: {len(rawSubjects)}')
    for s in rawSubjects:
        print(f"  - {s.get('title')}: totalVideos={s.get('totalVideos')}, totalNotes={s.get('totalNotes')}")
