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

dev = 'WEB_TEST_DEV_01'
h = get_headers(dev)

providers = {
    'missionjeet': ('185', '12909'),
    'nt': ('193', '13555'),
    'vidyakul': ('toppers-multi-year', '11-2023-24'),
    'apnacollage': ('sigma-feb24', '1')
}

for prov, (b_id, s_id) in providers.items():
    print(f'=== Testing Provider: {prov} ===')
    # 1. Handshake
    try:
        r = urllib.request.Request(f'https://api.asmultiverse.app/api/v1/{prov}/batches?page=1', headers=h)
        with urllib.request.urlopen(r, context=ctx) as resp:
            print(f'  Handshake: {resp.status}')
    except Exception as e:
        print(f'  Handshake failed: {e}')
        continue

    # 2. Topics
    try:
        r_v = urllib.request.Request(f'https://api.asmultiverse.app/api/v1/{prov}/batch/{b_id}/subject/{s_id}/topics?contentType=VIDEO', headers=h)
        with urllib.request.urlopen(r_v, context=ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            chaps = data.get('data', {}).get('chapters', [])
            print(f'  Video chapters for batch {b_id} subject {s_id}: {len(chaps)}')
            for c in chaps[:3]:
                print(f'    - {c.get("title")}')
    except Exception as e:
        print(f'  Video topics failed: {e}')

print('\nDone testing all providers!')
