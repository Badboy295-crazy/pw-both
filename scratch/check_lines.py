import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('server/index.js', 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

def print_range(start, end):
    print(f"=== Lines {start} to {end} ===")
    for i in range(start - 1, min(end, len(lines))):
        print(f"{i+1}: {repr(lines[i])}")

print_range(1985, 2010)
print_range(2045, 2100)
print_range(2190, 2210)
print_range(2585, 2605)
print_range(2665, 2730)
