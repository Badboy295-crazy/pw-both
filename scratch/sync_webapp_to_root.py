import shutil
import os

files_to_sync = ['app.js', 'index.html', 'style.css', 'player.js', 'lecture_player.js', 'manifest.json', 'sw.js', 'banner.jpg', 'banner2.jpg']

for f in files_to_sync:
    src = os.path.join('webapp', f)
    if os.path.exists(src):
        shutil.copy2(src, f)
        print(f'Synced {src} -> {f}')

print('Sync complete!')
