import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

server_index_path = 'server/index.js'
server_code = open(server_index_path, 'r', encoding='utf-8').read()

start_marker = 'const AS_PROVIDERS = {'
end_marker = "app.post('/api/link-preview'"

start_idx = server_code.find(start_marker)
end_idx = server_code.find(end_marker)

print(f'start_idx: {start_idx}, end_idx: {end_idx}')
if start_idx != -1 and end_idx != -1:
    # find the comment header right before end_marker if present
    pre_comment_idx = server_code.rfind('// ═', start_idx, end_idx)
    if pre_comment_idx != -1:
        end_idx = pre_comment_idx
    print(f'Replacing from {start_idx} to {end_idx}')
