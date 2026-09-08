import sys

sys.stdout.reconfigure(encoding='utf-8')
c = open('server/index.js', encoding='utf-8', errors='replace').read()
marker = "app.get('/api/batch/:batchId/details'"
idx = c.find(marker)
if idx != -1:
    print(c[idx:idx+800])
else:
    print('Marker not found!')
