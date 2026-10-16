"""위성 타일을 8×8 JPEG 스프라이트 시트로 묶는다.
사용: python3 tools/pack-sheets.py <타일 캐시 폴더> <출력 폴더>
출력: <출력>/<묶음>-<n>.jpg, <출력>/index.json  (tiles["z/x/y"] = [시트 번호, 칸 번호])
"""
import json, os, sys
from PIL import Image

cache, out = sys.argv[1], sys.argv[2]
N, TS = 8, 256
groups = json.load(open(os.path.join(cache, 'groups.json')))
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if f.endswith('.jpg') or f.endswith('.bin') or f == 'index.json':
        os.remove(os.path.join(out, f))
index = {'attribution': 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0)', 'grid': N, 'files': [], 'tiles': {}}
total = 0
for name, keys in groups.items():
    keys = [k for k in sorted(keys, key=lambda k: tuple(map(int, k.split('/')))) if os.path.exists(os.path.join(cache, k + '.jpg'))]
    for part in range(0, len(keys), N * N):
        chunk = keys[part:part + N * N]
        rows = (len(chunk) + N - 1) // N
        cols = N if rows > 1 else len(chunk)
        sheet = Image.new('RGB', (cols * TS, rows * TS), (6, 10, 14))
        for cell, k in enumerate(chunk):
            im = Image.open(os.path.join(cache, k + '.jpg')).convert('RGB')
            sheet.paste(im, ((cell % N) * TS, (cell // N) * TS))
            index['tiles'][k] = [len(index['files']), cell]
        fname = f'{name}-{part // (N * N)}.jpg'
        sheet.save(os.path.join(out, fname), 'JPEG', quality=84, optimize=True, progressive=True)
        total += os.path.getsize(os.path.join(out, fname))
        index['files'].append(fname)
json.dump(index, open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'))
print('sheets:', len(index['files']), 'MB:', round(total / 1048576, 1))
