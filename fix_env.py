import codecs

# Read corrupted file as raw bytes
with open('.env.bak', 'rb') as f:
    raw = f.read()

# Remove BOM if present
if raw[:3] == b'\xef\xbb\xbf':
    raw = raw[3:]

# The original file was CP1251. We need to:
# 1. Interpret bytes as CP1251 to get proper Unicode
# 2. Write as UTF-8

text = raw.decode('cp1251')

with open('.env', 'w', encoding='utf-8') as f:
    f.write(text)

print("Done. First 5 lines:")
with open('.env', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i >= 5:
            break
        print(line.rstrip())
