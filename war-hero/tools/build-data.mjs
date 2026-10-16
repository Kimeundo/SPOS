// 전쟁히어로 — 지도 데이터 빌드 스크립트
// 입력: mapshaper로 단순화한 TopoJSON (tools/README.md 참고)
// 출력: data/<level>.json  (TopoJSON + 각 지역 속성: lx,ly 라벨점, ar 면적, nb 육상 인접, sea 해상 항로)
//
// 사용: node tools/build-data.mjs <mapshaper 출력 폴더> <data 출력 폴더>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [, , SRC = './out', DST = './data'] = process.argv;
const topojson = require(require.resolve('topojson-client', { paths: [process.cwd(), SRC, path.dirname(SRC)] }));

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function hav(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function verticesOf(geom) {
  const out = [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const p of polys) for (const ring of p) for (let i = 0; i < ring.length; i += 1) out.push(ring[i]);
  return out;
}

function bboxOf(vs) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of vs) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}

// 두 지역 간 최소 거리(km) — 꼭짓점 샘플링
function minDist(va, vb, step) {
  let best = Infinity;
  for (let i = 0; i < va.length; i += step) {
    for (let j = 0; j < vb.length; j += step) {
      const d = hav(va[i], vb[j]);
      if (d < best) best = d;
    }
  }
  return best;
}

function build(name, opts) {
  const topo = JSON.parse(fs.readFileSync(path.join(SRC, name + '.json'), 'utf8'));
  const key = Object.keys(topo.objects)[0];
  const obj = topo.objects[key];
  const geoms = obj.geometries;
  const nb = topojson.neighbors(geoms);
  const feats = geoms.map((g) => topojson.feature(topo, g).geometry);
  const verts = feats.map((g) => (g ? verticesOf(g) : []));
  const boxes = verts.map((v) => (v.length ? bboxOf(v) : [0, 0, 0, 0]));
  const degPad = opts.seaKm / 80;
  const sea = geoms.map(() => []);

  geoms.forEach((g, i) => {
    const land = new Set(nb[i]);
    if (land.size >= opts.seaIfLandBelow) return;
    const cands = [];
    for (let j = 0; j < geoms.length; j++) {
      if (j === i || land.has(j) || !verts[j].length) continue;
      const a = boxes[i], b = boxes[j];
      if (b[0] > a[2] + degPad || b[2] < a[0] - degPad || b[1] > a[3] + degPad || b[3] < a[1] - degPad) continue;
      const step = Math.max(1, Math.floor(Math.sqrt(verts[i].length * verts[j].length) / 120));
      const d = minDist(verts[i], verts[j], step);
      if (d <= opts.seaKm) cands.push([d, j]);
    }
    cands.sort((x, y) => x[0] - y[0]);
    for (const [, j] of cands.slice(0, opts.seaMax)) {
      if (!sea[i].includes(j)) sea[i].push(j);
      if (!sea[j].includes(i)) sea[j].push(i);
    }
  });

  geoms.forEach((g, i) => {
    const p = g.properties;
    p.nb = nb[i];
    p.sea = sea[i].filter((j) => !nb[i].includes(j));
    p.lx = Math.round(p.lx * 1e4) / 1e4;
    p.ly = Math.round(p.ly * 1e4) / 1e4;
    const bb = boxes[i];
    p.bb = bb.map((v) => Math.round(v * 1e3) / 1e3);
  });
  obj.geometries = geoms;
  fs.writeFileSync(path.join(DST, name + '.json'), JSON.stringify(topo));
  const seaCount = sea.reduce((s, a) => s + a.length, 0) / 2;
  console.log(name, geoms.length, 'units,', seaCount, 'sea links');
}

fs.mkdirSync(DST, { recursive: true });
build('kr_dong', { seaKm: 25, seaMax: 2, seaIfLandBelow: 1 });
build('kr_sgg', { seaKm: 60, seaMax: 2, seaIfLandBelow: 1 });
build('kr_sido', { seaKm: 160, seaMax: 2, seaIfLandBelow: 1 });
build('world', { seaKm: 450, seaMax: 3, seaIfLandBelow: 4 });
