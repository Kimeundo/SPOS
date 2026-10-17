// 전쟁히어로 — 위성 타일 아틀라스 빌드
// 이미지: Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0)
//         https://s2maps.eu  (Contains modified Copernicus Sentinel data 2016)
// 타일을 내려받아 캐시 폴더에 저장하고, 묶음(groups.json)을 기록한다.
// 게임은 스프라이트 시트를 필요할 때만 받아 타일을 꺼내 그린다 (외부 타일 서버 호출 없음).
//
// 사용: node tools/build-tiles.mjs <data 폴더> <타일 캐시 폴더> <출력 폴더>
import fs from 'node:fs';
import path from 'node:path';

const [, , DATA = './data', CACHE = './tilecache', OUT = './tiles'] = process.argv;
const URL = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const clampY = (v, z) => Math.max(0, Math.min(2 ** z - 1, v));

// atlas 이름 -> Set("z/x/y")
const atlases = new Map();
const owner = new Map(); // key -> atlas
function add(atlas, z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (owner.has(k)) return;
  owner.set(k, atlas);
  if (!atlases.has(atlas)) atlases.set(atlas, []);
  atlases.get(atlas).push(k);
}
function addBox(atlas, z, [w, s, e, n]) {
  const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = clampY(lat2y(n, z), z), y1 = clampY(lat2y(s, z), z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(atlas, z, x, y);
}

// 1) 전 세계 z0–4, 동아시아 z5–6
for (let z = 0; z <= 4; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) add('world', z, x, y);
for (let z = 5; z <= 6; z++) addBox('asia', z, [95, 5, 150, 55]);

// 2) 한반도 z7–10
for (let z = 7; z <= 10; z++) addBox('korea', z, [124.4, 32.9, 131.95, 38.75]);

// 3) 시군구별 고해상도: 시군구 폭이 타일 2.5장 정도가 되는 줌 (11–14), 그 위 한 단계 포함
const sgg = JSON.parse(fs.readFileSync(path.join(DATA, 'kr_sgg.json'), 'utf8'));
for (const g of Object.values(sgg.objects)[0].geometries) {
  const p = g.properties;
  const [w, s, e, n] = p.bb;
  const span = Math.max(e - w, (n - s) * 1.25);
  let z = Math.round(Math.log2((2.6 * 360) / span));
  z = Math.max(11, Math.min(14, z));
  const atlas = 'sido' + p.s;
  for (let zz = 11; zz <= z; zz++) addBox(atlas, zz, [w, s, e, n]);
}

const total = [...atlases.values()].reduce((s, a) => s + a.length, 0);
console.log('tiles:', total, Object.fromEntries([...atlases].map(([k, v]) => [k, v.length])));

async function fetchTile(k) {
  const file = path.join(CACHE, k + '.jpg');
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  const [z, x, y] = k.split('/').map(Number);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(URL(z, x, y));
      if (res.status === 404) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  console.warn('failed', k);
}

const keys = [...owner.keys()];
let done = 0;
const CONC = 10;
await Promise.all(
  Array.from({ length: CONC }, async (_, w) => {
    for (let i = w; i < keys.length; i += CONC) {
      await fetchTile(keys[i]);
      if (++done % 500 === 0) console.log('downloaded', done, '/', keys.length);
    }
  }),
);

// 4) 묶음 목록 저장 → tools/pack-sheets.py 가 8×8 JPEG 스프라이트 시트로 묶는다
fs.writeFileSync(path.join(CACHE, 'groups.json'), JSON.stringify(Object.fromEntries(atlases)));
console.log('groups written; next: python3 tools/pack-sheets.py', CACHE, OUT);
