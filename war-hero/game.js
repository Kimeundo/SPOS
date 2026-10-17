/* 전쟁히어로 — 실시간 영토 점령 시뮬레이션
 * 동 → 시·군·구 → 시·도 → 세계 4단계 전장. 위성 타일 위에 행정 경계를 그리고
 * 플레이어와 AI 세력이 인접 지역을 실시간으로 공격한다.
 */
(() => {
'use strict';

// ───────────────────────── 기본 유틸 ─────────────────────────
const $ = (s) => document.querySelector(s);
const WS = 65536;                       // 줌 8 기준 세계 픽셀 크기 (기본 좌표계)
const now = () => performance.now();
// 게임 시계: 일시정지 동안은 멈춘다 (연출·전투 타이밍은 모두 이 시계를 쓴다)
let pausedTotal = 0, pauseAt = 0;
const gnow = () => (G.paused ? pauseAt : now()) - pausedTotal;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const lerp = (a, b, t) => a + (b - a) * t;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = (lon) => ((lon + 180) / 360) * WS;
const py = (lat) => {
  const r = (clamp(lat, -85, 85) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WS;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('wh:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wh:' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem('wh:' + k); } catch { /* noop */ } },
};
function fmt(n) {
  n = Math.round(n);
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 1 : 2).replace(/\.0+$/, '') + '억';
  if (a >= 1e5) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '만';
  return n.toLocaleString('ko-KR');
}
const fmtFunds = (n) => '₩' + fmt(n) + '억';
function fmtTime(sec) {
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
}
const clock = () => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

// ───────────────────────── 전장 정의 ─────────────────────────
const STAGES = [
  { key: 'dong', file: 'kr_dong', title: '동 점령전', word: '동', M: 1, S: 1, rivals: 3, suffix: '자경단', aiMul: 0.72 },
  { key: 'sgg', file: 'kr_sgg', title: '시·군·구 평정전', word: '시·군·구', M: 10, S: 2, rivals: 4, suffix: '방위군', aiMul: 0.85 },
  { key: 'sido', file: 'kr_sido', title: '대한민국 통일전', word: '시·도', M: 80, S: 4, rivals: 4, suffix: '군단', aiMul: 0.95 },
  { key: 'world', file: 'world', title: '세계 정복전', word: '국가', M: 600, S: 8, rivals: 12, suffix: '', aiMul: 0.62 },
];
const SIDO_SHORT = { 11: '서울', 26: '부산', 27: '대구', 28: '인천', 29: '광주', 30: '대전', 31: '울산', 36: '세종', 41: '경기', 43: '충북', 44: '충남', 46: '전남', 47: '경북', 48: '경남', 50: '제주', 51: '강원', 52: '전북' };
const COUNTRY_SHORT = {
  PRK: '북한', CHN: '중국', TWN: '대만', ZAF: '남아공', AUS: '호주', COD: 'DR콩고', COG: '콩고', CAF: '중앙아프리카', DOM: '도미니카공',
  GNQ: '적도기니', BIH: '보스니아', USA: '미국', GBR: '영국', ARE: 'UAE', SAU: '사우디', PNG: '파푸아뉴기니', SLB: '솔로몬제도',
  CYN: '북키프로스', SOL: '소말릴란드', SDS: '남수단', TTO: '트리니다드토바고', ATF: '프랑스령 남방', SGS: '사우스조지아', FLK: '포클랜드',
  KOR: '대한민국', NZL: '뉴질랜드', CZE: '체코', MKD: '북마케도니아', VNM: '베트남', LAO: '라오스', KHM: '캄보디아', MMR: '미얀마',
};
const WORLD_POWERS = ['USA', 'CHN', 'RUS', 'JPN', 'IND', 'DEU', 'GBR', 'BRA', 'TUR', 'NGA', 'AUS', 'EGY'];
const COLORS = ['#ff4b5c', '#3d8bff', '#2ee59d', '#b06bff', '#ff8a3d', '#23d5e8', '#ff5fb5', '#a3e635', '#8b9cff', '#f2e3c6', '#00c2a8', '#ff7a7a'];
const HERO = '#ffc23d';
// 난이도: AI 생산력·공격성, 중립 수비군, 자동 방어 증원 한도, 점수 배율
const DIFF = {
  easy:   { name: '쉬움',  ai: 0.85, aggr: 0.8, neutral: 1.1, defCap: 0.6,  score: 0.8, autoGap: [1.6, 2.6] },
  normal: { name: '보통',  ai: 1.4,  aggr: 1.15, neutral: 1.7, defCap: 0.45, score: 1.0, autoGap: [2.6, 4.0] },
  hard:   { name: '어려움', ai: 1.9,  aggr: 1.45, neutral: 2.1, defCap: 0.35, score: 1.4, autoGap: [3.2, 4.8] },
};
const D = () => DIFF[G.diff] || DIFF.normal;
const STAGE_NAMES = ['동', '시·군·구', '시·도', '세계'];

// ───────────────────────── 사운드 (WebAudio 합성) ─────────────────────────
const Sound = {
  ctx: null, master: null, on: store.get('sound', true), noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.55 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  },
  toggle() {
    this.on = !this.on;
    store.set('sound', this.on);
    if (this.master) this.master.gain.value = this.on ? 0.55 : 0;
  },
  _noise(dur, f0, f1, vol, type = 'lowpass', t = 0) {
    const c = this.ctx; if (!c || !this.on) return;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type;
    const g = c.createGain();
    const T = c.currentTime + t;
    f.frequency.setValueAtTime(f0, T); f.frequency.exponentialRampToValueAtTime(f1, T + dur);
    g.gain.setValueAtTime(vol, T); g.gain.exponentialRampToValueAtTime(0.001, T + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(T, Math.random()); s.stop(T + dur + 0.05);
  },
  _tone(freq, dur, vol, type = 'sine', t = 0, f1) {
    const c = this.ctx; if (!c || !this.on) return;
    const o = c.createOscillator(); o.type = type;
    const g = c.createGain();
    const T = c.currentTime + t;
    o.frequency.setValueAtTime(freq, T);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, T + dur);
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(vol, T + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    o.connect(g).connect(this.master); o.start(T); o.stop(T + dur + 0.05);
  },
  launch() { this._noise(0.55, 600, 3500, 0.18, 'bandpass'); },
  boom(big = 1) {
    this._noise(0.9 * big, 1800, 60, 0.9 * Math.min(1, big), 'lowpass');
    this._tone(110, 0.6 * big, 0.7, 'sine', 0, 32);
  },
  capture() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone(f, 0.5, 0.18, 'triangle', i * 0.07));
  },
  fail() { this._tone(220, 0.35, 0.2, 'sawtooth', 0, 140); this._tone(165, 0.45, 0.16, 'sawtooth', 0.12, 110); },
  alert() { this._tone(880, 0.12, 0.15, 'square'); this._tone(660, 0.12, 0.15, 'square', 0.15); },
  click() { this._tone(1400, 0.05, 0.06, 'square'); },
  fanfare() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone(f, 0.9, 0.16, 'triangle', i * 0.12));
    this._tone(130.8, 1.6, 0.25, 'sine', 0.48);
  },
};
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* 지원 안 함 */ } }

// ───────────────────────── 위성 타일 저장소 ─────────────────────────
// 타일은 8×8 JPEG 스프라이트 시트로 묶여 있다. index.json: tiles["z/x/y"] = [시트 번호, 칸 번호]
const Tiles = {
  index: null, sheets: new Map(), maxZ: 14, grid: 8,
  async init() {
    try {
      const r = await fetch('tiles/index.json');
      if (!r.ok) throw new Error();
      this.index = await r.json();
      this.grid = this.index.grid || 8;
      let mz = 0;
      for (const k in this.index.tiles) mz = Math.max(mz, +k.split('/')[0]);
      this.maxZ = mz;
    } catch { this.index = null; }
  },
  sheet(i) {
    let sh = this.sheets.get(i);
    if (sh) { sh.t = now(); return sh.img ? sh : null; }
    sh = { img: null, t: now() };
    this.sheets.set(i, sh);
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { sh.img = im; Render.dirty = true; this.evict(); };
    im.onerror = () => { sh.failed = true; };
    im.src = 'tiles/' + this.index.files[i];
    return null;
  },
  // 해당 타일 이미지 영역, 아직 없으면 가장 가까운 상위 타일의 일부분을 돌려준다
  get(z, x, y) {
    if (!this.index) return null;
    for (let dz = 0; dz <= z; dz++) {
      const zz = z - dz, xx = x >> dz, yy = y >> dz;
      const e = this.index.tiles[zz + '/' + xx + '/' + yy];
      if (!e) continue;
      const sh = this.sheet(e[0]);
      if (!sh) continue;
      const sz = 256 / (1 << dz);
      const cx = (e[1] % this.grid) * 256, cy = Math.floor(e[1] / this.grid) * 256;
      return { img: sh.img, sx: cx + (x - (xx << dz)) * sz, sy: cy + (y - (yy << dz)) * sz, sw: sz };
    }
    return null;
  },
  evict() {
    const loaded = [...this.sheets.entries()].filter(([i, v]) => v.img && !this.index.files[i].startsWith('world'));
    if (loaded.length <= 28) return;
    loaded.sort((a, b) => a[1].t - b[1].t);
    for (const [i] of loaded.slice(0, loaded.length - 28)) this.sheets.delete(i);
  },
};

// ───────────────────────── 지도 데이터 ─────────────────────────
const Data = {
  raw: {},
  async load(file, onProgress) {
    if (this.raw[file]) return this.raw[file];
    const r = await fetch('data/' + file + '.json');
    if (!r.ok) throw new Error(file + ' 로드 실패');
    const topo = await r.json();
    const key = Object.keys(topo.objects)[0];
    const geoms = topo.objects[key].geometries;
    const feats = geoms.map((g) => topojson.feature(topo, g));
    this.raw[file] = { topo, geoms, feats };
    onProgress && onProgress();
    return this.raw[file];
  },
};

function polysOf(geom) {
  if (!geom) return [];
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}

// 전장(theater) 구성: 원본 데이터에서 일부 지역만 골라 지역 객체와 인접 그래프를 만든다
function buildTheater(stageIdx, filter) {
  const st = STAGES[stageIdx];
  const raw = Data.raw[st.file];
  const pickIdx = [];
  raw.geoms.forEach((g, i) => { if (filter(g.properties)) pickIdx.push(i); });
  const remap = new Map(pickIdx.map((oi, ni) => [oi, ni]));
  const units = pickIdx.map((oi, ni) => {
    const p = raw.geoms[oi].properties;
    const path = new Path2D();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polysOf(raw.feats[oi].geometry)) {
      for (const ring of poly) {
        for (let j = 0; j < ring.length; j++) {
          const X = px(ring[j][0]), Y = py(ring[j][1]);
          if (j === 0) path.moveTo(X, Y); else path.lineTo(X, Y);
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
        path.closePath();
      }
    }
    let name = p.n;
    if (st.key === 'world') name = COUNTRY_SHORT[p.a] || p.n;
    let w;
    if (st.key === 'world') w = clamp(Math.sqrt((p.p || 1e5) / 2e7) + (p.e || 0) / 2.5e6, 0.35, 6);
    else w = p.ar || 1;
    return {
      i: ni, name, p, path, bb: [x0, y0, x1, y1], lx: px(p.lx), ly: py(p.ly), w,
      land: (p.nb || []).filter((j) => remap.has(j)).map((j) => remap.get(j)),
      sea: (p.sea || []).filter((j) => remap.has(j)).map((j) => remap.get(j)),
      owner: -1, troops: 0, cap: 0, flash: 0, cap0: 0, hitT: 0,
    };
  });
  // 한국 전장의 무게: 면적의 중앙값 대비 제곱근 (0.55–2.4)
  if (st.key !== 'world') {
    const sorted = units.map((u) => u.w).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1] || 1;
    for (const u of units) u.w = clamp(Math.sqrt(u.w / med), 0.55, 2.4);
  }
  // 연결성 보정: 떨어진 섬 덩어리를 가장 가까운 지역과 해상 항로로 잇는다
  const parent = units.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  for (const u of units) for (const j of [...u.land, ...u.sea]) join(u.i, j);
  for (let guard = 0; guard < 400; guard++) {
    const groups = new Map();
    units.forEach((u) => { const r = find(u.i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(u); });
    if (groups.size <= 1) break;
    const list = [...groups.values()].sort((a, b) => b.length - a.length);
    const main = list[0];
    let best = null;
    for (const g of list.slice(1)) {
      for (const a of g) for (const b of main) {
        const d = (a.lx - b.lx) ** 2 + (a.ly - b.ly) ** 2;
        if (!best || d < best[0]) best = [d, a, b];
      }
    }
    if (!best) break;
    best[1].sea.push(best[2].i); best[2].sea.push(best[1].i); join(best[1].i, best[2].i);
  }
  for (const u of units) {
    u.adj = [...new Set([...u.land, ...u.sea])];
    u.seaSet = new Set(u.sea.filter((j) => !u.land.includes(j)));
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const u of units) { bx0 = Math.min(bx0, u.bb[0]); by0 = Math.min(by0, u.bb[1]); bx1 = Math.max(bx1, u.bb[2]); by1 = Math.max(by1, u.bb[3]); }
  const mask = new Path2D();
  for (const u of units) mask.addPath(u.path);
  return { units, bbox: [bx0, by0, bx1, by1], mask };
}

// ───────────────────────── 게임 상태 ─────────────────────────
const G = {
  running: false, stage: 0, th: null, factions: [], callsign: '', start: null,
  up: { atk: 0, def: 0, eco: 0 }, cd: { strike: 0, mobil: 0 },
  score: 0, stageT: 0, totalT: 0, caps: 0, stageCaps: 0, lost: 0, combo: 0, lastCap: 0,
  medals: {}, feed: [], selected: null, auto: store.get('auto', true), focus: store.get('focus', false), pendingSave: 0, rates: { troops: 0, funds: 0 },
};
const P = () => G.factions[0];

function makeFaction(name, color, kind, extra = {}) {
  return { name, color, kind, pool: 0, funds: 0, alive: true, next: rand(2, 5), lvl: 0, caps: 0, lastCapName: '', ...extra };
}
const atkMul = (f) => 1 + 0.12 * (f.kind === 'player' ? G.up.atk : f.lvl);
const defMul = (owner) => (owner < 0 ? 1 : 1 + 0.12 * (owner === 0 ? G.up.def : G.factions[owner].lvl));
const ecoMul = (f) => 1 + 0.15 * (f.kind === 'player' ? G.up.eco : f.lvl * 0.6);
const unitCap = (u) => STAGES[G.stage].M * 90 * u.w * defMul(u.owner);

// 시작 지점에서 그래프상 가장 먼 지역들을 경쟁 세력 거점으로 고른다
function spreadPicks(units, fromIdx, count) {
  const chosen = [fromIdx];
  const dist = (src) => {
    const d = new Array(units.length).fill(Infinity); d[src] = 0;
    const q = [src];
    while (q.length) { const c = q.shift(); for (const n of units[c].adj) if (d[n] === Infinity) { d[n] = d[c] + 1; q.push(n); } }
    return d;
  };
  const dists = [dist(fromIdx)];
  const out = [];
  for (let k = 0; k < count; k++) {
    let best = -1, bd = -1;
    units.forEach((u, i) => {
      if (chosen.includes(i)) return;
      const m = Math.min(...dists.map((d) => d[i]));
      const score = m + Math.random() * 0.8 + u.w * 0.3;
      if (m >= 2 && score > bd) { bd = score; best = i; }
    });
    if (best < 0) break;
    chosen.push(best); out.push(best); dists.push(dist(best));
  }
  return out;
}

function stageFilter(stageIdx) {
  const s = G.start;
  if (stageIdx === 0) return (p) => p.g === s.sgg;
  if (stageIdx === 1) return (p) => p.s === s.sido;
  if (stageIdx === 2) return () => true;
  return (p) => (p.ar || 0) >= 500 || p.a === 'KOR';
}
function homeIndex(stageIdx, units) {
  const s = G.start;
  if (stageIdx === 0) return units.findIndex((u) => u.name === s.dong);
  if (stageIdx === 1) return units.findIndex((u) => u.p.g === s.sgg);
  if (stageIdx === 2) return units.findIndex((u) => u.p.s === s.sido);
  return units.findIndex((u) => u.p.a === 'KOR');
}

async function setupStage(stageIdx, restore) {
  const st = STAGES[stageIdx];
  await Data.load(st.file);
  G.stage = stageIdx;
  G.th = buildTheater(stageIdx, stageFilter(stageIdx));
  const units = G.th.units;
  const M = st.M;
  // 2단계에 시군구가 하나뿐인 세종 등은 다음 단계로 넘어간다
  if (!restore && stageIdx === 1 && units.length < 3) return setupStage(2);
  let home = homeIndex(stageIdx, units);
  if (home < 0) home = 0;

  if (restore) {
    G.factions = restore.factions;
    restore.units.forEach(([o, t], i) => { if (units[i]) { units[i].owner = o; units[i].troops = t; } });
  } else {
    const player = makeFaction(G.callsign, HERO, 'player');
    player.pool = M * 230;
    player.funds = Math.max(P()?.funds || 0, 60 * st.S);
    G.factions = [player];
    for (const u of units) u.troops = Math.round(M * 70 * u.w * rand(0.8, 1.2) * D().neutral);
    units[home].owner = 0;
    units[home].troops = Math.round(M * 110 * units[home].w);
    if (stageIdx === 3) {
      WORLD_POWERS.forEach((code, k) => {
        const idx = units.findIndex((u) => u.p.a === code);
        if (idx < 0 || idx === home) return;
        const f = makeFaction(units[idx].name, COLORS[k % COLORS.length], 'ai', { lvl: 2, home: idx });
        f.pool = M * 50 * units[idx].w;
        G.factions.push(f);
        units[idx].owner = G.factions.length - 1;
        units[idx].troops = Math.round(M * 150 * units[idx].w);
      });
    } else {
      const n = Math.min(st.rivals, Math.max(1, Math.floor(units.length / 5)));
      const picks = units.length >= 4 ? spreadPicks(units, home, n) : [];
      picks.forEach((idx, k) => {
        const u = units[idx];
        const label = stageIdx === 2 ? (SIDO_SHORT[u.p.s] || u.name) : u.name;
        const f = makeFaction(`${label} ${st.suffix}`, COLORS[k % COLORS.length], 'ai', { lvl: stageIdx, home: idx });
        f.pool = M * 120;
        G.factions.push(f);
        u.owner = G.factions.length - 1;
        u.troops = Math.round(M * 120 * u.w);
      });
    }
  }
  G.stageT = restore?.stageT || 0;
  G.stageCaps = restore?.stageCaps || 0;
  G.selected = null;
  if (G.paused) UI.setPause(false);
  G.running = true;
  Render.strikes = []; Render.parts = []; Render.texts = []; Render.rings = [];
  Cam.fit(G.th.bbox, !restore);
  if (stageIdx < 3) Data.load(STAGES[stageIdx + 1].file).catch(() => {});
  $('#stageNo').textContent = `STAGE ${stageIdx + 1} · ${STAGE_NAMES[stageIdx]} · ${D().name}`;
  $('#stageName').textContent = stageTitle();
  UI.closeTarget();
  UI.renderTab();
  UI.hud();
  if (!restore) {
    pushFeed(`<i style="color:${HERO}">${esc(G.callsign)}</i> 사령부가 ${esc(units[home].name)}에 거점을 세웠습니다.`, HERO);
    UI.banner('작전 개시', stageTitle(), `${units.length}개 ${st.word} · 경쟁 세력 ${G.factions.length - 1}`);
  }
  save();
}
function stageTitle() {
  const s = G.start, st = STAGES[G.stage];
  if (G.stage === 0) return `${SIDO_SHORT[s.sido]} ${s.sggName} ${st.title}`;
  if (G.stage === 1) return `${s.sidoName} ${st.title}`;
  return st.title;
}

// ───────────────────────── 전투 ─────────────────────────
function isSeaHop(from, to) { return from.seaSet.has(to.i); }
function frontierSource(fi, target) {
  let best = null;
  for (const j of target.adj) {
    const u = G.th.units[j];
    if (u.owner === fi && (!best || u.troops > best.troops)) best = u;
  }
  return best;
}
function attackOdds(fi, target, commit) {
  const src = frontierSource(fi, target);
  if (!src) return { p: 0, src: null };
  const sea = isSeaHop(src, target);
  const att = commit * atkMul(G.factions[fi]);
  const def = target.troops * defMul(target.owner) * (sea ? 1.2 : 1);
  // 공격력에 0.8–1.25 난수가 곱해진다
  const p = att <= 0 ? 0 : clamp((1.25 - def / att) / 0.45, 0, 1);
  return { p, src, sea, def };
}
function neededFor(fi, target, prob) {
  const o = attackOdds(fi, target, 1);
  if (!o.src) return Infinity;
  return Math.ceil(o.def / ((1.25 - 0.45 * prob) * atkMul(G.factions[fi])));
}

function launch(fi, target, commit) {
  const f = G.factions[fi];
  const o = attackOdds(fi, target, commit);
  if (!o.src || commit <= 0 || commit > f.pool + 0.5) return false;
  f.pool -= commit;
  const isPlayer = fi === 0;
  const n = clamp(Math.round(2 + Math.log2(1 + commit / (STAGES[G.stage].M * 40))), 2, isPlayer ? 8 : 4);
  const t0 = gnow();
  const from = { x: o.src.lx, y: o.src.ly }, to = { x: target.lx, y: target.ly };
  const missiles = [];
  for (let k = 0; k < n; k++) {
    missiles.push({ delay: k * 90, jx: rand(-1, 1), jy: rand(-1, 1), hit: false, arc: rand(0.25, 0.45) });
  }
  Render.strikes.push({ fi, color: f.color, from, to, t0, dur: isPlayer ? 720 : 820, missiles, target, commit, sea: o.sea, done: false, player: isPlayer });
  if (isPlayer) { Sound.launch(); }
  if (target.owner === 0 && !isPlayer) {
    UI.alert();
    pushFeed(`<i style="color:${f.color}">${esc(f.name)}</i>이(가) ${esc(target.name)}을(를) 공격합니다!`, f.color);
    if (G.auto) autoDefend(target, commit * atkMul(f), o.sea);
  }
  return true;
}

// 자동 방어: 적 공격이 날아오면 최악의 경우(공격력 ×1.25)도 막을 만큼 기동 병력에서 증원한다
function autoDefend(target, attPow, sea) {
  const f = P();
  const dm = defMul(0) * (sea ? 1.2 : 1);
  const worst = attPow * 1.25;
  const def = target.troops * dm;
  if (worst <= def) {
    Render.text(target.lx, target.ly, '방어 태세', '#7fd3ff', 14);
    return;
  }
  const add = Math.min(f.pool * D().defCap, ((worst - def) / dm) * 1.05);
  if (add < 1) return;
  f.pool -= add;
  target.troops += add;
  const t0 = gnow();
  Render.rings.push({ x: target.lx, y: target.ly, t0, color: '#7fd3ff', r: 60 });
  Render.rings.push({ x: target.lx, y: target.ly, t0: t0 + 150, color: '#7fd3ff', r: 40 });
  Render.text(target.lx, target.ly, `증원 +${fmt(add)}`, '#7fd3ff', 17);
  Sound._tone(520, 0.18, 0.12, 'triangle'); Sound._tone(780, 0.22, 0.12, 'triangle', 0.08);
  pushFeed(`${esc(target.name)}에 방어군 ${fmt(add)} 증원`, '#7fd3ff');
}

// 자동 공격: 승률 85% 병력을 맞출 수 있는 가장 효율 좋은 인접 지역을 공격한다
function playerAuto(dt) {
  if (!G.auto || !G.running) return;
  G.autoNext = (G.autoNext || 0) - dt;
  if (G.autoNext > 0) return;
  G.autoNext = rand(...D().autoGap);
  const f = P();
  const units = G.th.units;
  const inflight = Render.strikes.filter((s) => s.fi === 0 && !s.done);
  if (inflight.length >= 2) return;
  const busy = new Set(inflight.map((s) => s.target.i));
  let best = null, bestScore = 0, bestNeed = 0;
  for (const j of playerFrontier()) {
    if (busy.has(j)) continue;
    const t = units[j];
    const need = neededFor(0, t, 0.85);
    if (!isFinite(need)) continue;
    let sc = t.w / (need + 1);
    if (t.owner < 0) sc *= 1.2;
    if (t.lostT && gnow() - t.lostT < 30000) sc *= 3;            // 빼앗긴 땅 탈환 우선
    if (t.owner > 0 && (G.factions[t.owner].units || 0) <= 2) sc *= 1.5; // 약한 세력 마무리
    if (sc > bestScore) { bestScore = sc; best = t; bestNeed = need; }
  }
  if (!best) return;
  const usable = f.pool * 0.88;   // 방어용 예비 12%
  if (usable >= bestNeed) launch(0, best, Math.min(usable, Math.ceil(bestNeed * 1.15)));
}

function resolve(strike) {
  const { fi, target, commit } = strike;
  const f = G.factions[fi];
  if (!f.alive && fi !== 0) return;
  const sea = strike.sea;
  const prev = target.owner;
  if (prev === fi) { target.troops += Math.round(commit * 0.9); return; }
  const att = commit * atkMul(f) * rand(0.8, 1.25);
  const def = target.troops * defMul(prev) * (sea ? 1.2 : 1);
  const M = STAGES[G.stage].M;
  if (att > def) {
    const survivors = (att - def) / atkMul(f);
    target.owner = fi;
    target.troops = Math.max(Math.round(M * 8), Math.round(survivors * 0.85));
    target.cap0 = gnow();
    target.capColor = f.color;
    target.capX = strike.to.x; target.capY = strike.to.y;
    f.caps++; f.lastCapName = target.name;
    onCaptured(fi, prev, target, strike);
  } else {
    const left = (def - att) / defMul(prev) / (sea ? 1.2 : 1);
    target.troops = Math.max(1, Math.round(left));
    Render.text(target.lx, target.ly, '방어 성공', fi === 0 ? '#ff8b96' : '#cfe', 15);
    if (fi === 0) {
      Sound.fail();
      UI.banner('공격 실패', target.name, `잔존 수비군 ${fmt(target.troops)}`, true);
      G.combo = 0;
    } else if (prev === 0) {
      pushFeed(`${esc(target.name)} 방어에 성공했습니다.`, HERO);
    }
  }
}

function onCaptured(fi, prev, target, strike) {
  const st = STAGES[G.stage];
  const f = G.factions[fi];
  if (fi === 0) {
    const pts = Math.round(10 * target.w * st.S * (prev > 0 ? 1.5 : 1) * D().score);
    const t = gnow();
    G.combo = t - G.lastCap < 7000 ? G.combo + 1 : 1;
    G.lastCap = t;
    const bonus = G.combo > 1 ? Math.round(pts * 0.2 * (G.combo - 1)) : 0;
    G.score += pts + bonus;
    G.caps++; G.stageCaps++;
    Sound.capture(); buzz([20, 40, 30]);
    Render.shake = Math.max(Render.shake, 14);
    Render.text(target.lx, target.ly, `+${fmt(pts + bonus)}점`, HERO, 22);
    UI.banner('점령 완료', target.name, `+${fmt(pts + bonus)}점${prev > 0 ? ' · 적 거점 탈취' : ''}`);
    if (G.combo > 1) UI.combo(G.combo);
    pushFeed(`<i style="color:${HERO}">${esc(f.name)}</i> 사령부가 ${esc(target.name)}을(를) 점령했습니다.`, HERO);
    medal('first', '첫 점령', '첫 번째 지역을 손에 넣었습니다');
    if (G.combo >= 3) medal('combo3', '전격전', '7초 안에 3연속 점령');
    if (G.combo >= 5) medal('combo5', '파죽지세', '7초 안에 5연속 점령');
    if (strike.sea) medal('sea', '상륙 작전', '바다 건너 지역을 점령했습니다');
    if (strike.odds != null && strike.odds < 0.4) medal('upset', '기적의 역전', '승률 40% 미만 공격을 성공시켰습니다');
    scheduleRank();
  } else {
    if (prev === 0) {
      G.lost++;
      target.lostT = gnow();
      Sound.alert(); buzz(80);
      UI.banner('거점 함락', target.name, `${f.name}에게 빼앗겼습니다`, true);
      pushFeed(`<i style="color:${f.color}">${esc(f.name)}</i>에게 ${esc(target.name)}을(를) 빼앗겼습니다.`, '#ff4b5c');
    } else if (Math.random() < (G.stage === 3 ? 0.35 : 0.6)) {
      pushFeed(`<i style="color:${f.color}">${esc(f.name)}</i>이(가) ${esc(target.name)}을(를) 점령했습니다.`, f.color);
    }
  }
  if (prev > 0) {
    const pf = G.factions[prev];
    if (!G.th.units.some((u) => u.owner === prev)) {
      pf.alive = false;
      pushFeed(`<i style="color:${pf.color}">${esc(pf.name)}</i> 세력이 소멸했습니다.`, pf.color);
      if (fi === 0) { medal('wipe', '섬멸전', '경쟁 세력 하나를 지도에서 지웠습니다'); UI.toast('세력 섬멸', `${pf.name} 소멸`); }
    }
  }
  if (prev === 0 && !G.th.units.some((u) => u.owner === 0)) defeat();
  else if (G.th.units.every((u) => u.owner === 0)) stageClear();
  UI.dirtyTab = true;
  save();
}

function airstrike(target) {
  const st = STAGES[G.stage];
  const cost = 80 * st.S;
  const f = P();
  if (G.cd.strike > 0 || f.funds < cost || target.owner === 0) return;
  f.funds -= cost;
  G.cd.strike = 10;
  const t0 = gnow();
  for (let k = 0; k < 6; k++) {
    const x = target.lx + rand(-1, 1) * (target.bb[2] - target.bb[0]) * 0.18;
    const y = target.ly + rand(-1, 1) * (target.bb[3] - target.bb[1]) * 0.18;
    Render.bombs.push({ x, y, t: t0 + k * 120 + 380, onHit: k === 5 ? () => {
      const cut = Math.round(target.troops * 0.42);
      target.troops -= cut;
      Render.text(target.lx, target.ly, `-${fmt(cut)}`, '#ff8b96', 24);
      UI.dirtyTarget = true;
    } : null });
  }
  Sound._noise(0.9, 300, 2400, 0.25, 'bandpass');
  pushFeed(`정밀 폭격: ${esc(target.name)} 수비군 타격`, HERO);
  UI.hud();
}
function mobilize() {
  const st = STAGES[G.stage];
  const cost = 140 * st.S;
  const f = P();
  if (G.cd.mobil > 0 || f.funds < cost) return;
  f.funds -= cost;
  G.cd.mobil = 40;
  const gain = Math.round(G.rates.troops * 25 + st.M * 120);
  f.pool += gain;
  Sound.fanfare();
  UI.toast('총동원령', `기동 병력 +${fmt(gain)}`);
  UI.hud();
}
const upCost = (k) => Math.round(110 * STAGES[G.stage].S * 1.55 ** G.up[k]);
function upgrade(k) {
  const c = upCost(k);
  if (P().funds < c || G.up[k] >= 15) return;
  P().funds -= c;
  G.up[k]++;
  Sound.click();
  UI.toast('사령부 강화', { atk: '공격력', def: '방어력', eco: '생산력' }[k] + ` Lv.${G.up[k]}`);
  UI.dirtyTab = true;
  save();
}

// ───────────────────────── 경제 · AI 틱 ─────────────────────────
function tick(dt) {
  if (!G.running || G.paused) return;
  const st = STAGES[G.stage];
  const units = G.th.units;
  G.stageT += dt; G.totalT += dt;
  G.cd.strike = Math.max(0, G.cd.strike - dt);
  G.cd.mobil = Math.max(0, G.cd.mobil - dt);
  const sumW = new Array(G.factions.length).fill(0);
  const cnt = new Array(G.factions.length).fill(0);
  for (const u of units) {
    if (u.owner >= 0) { sumW[u.owner] += u.w; cnt[u.owner]++; }
    const cap = u.owner < 0 ? st.M * 70 * u.w * 1.15 : unitCap(u);
    if (u.troops < cap) u.troops = Math.min(cap, u.troops + cap * (u.owner < 0 ? 0.004 : 0.02) * dt);
  }
  G.factions.forEach((f, i) => {
    if (!f.alive) return;
    const ai = i === 0 ? 1 : st.aiMul * D().ai * (1 + G.stageT / 400);
    const troopRate = st.M * (6 + 2.4 * sumW[i]) * ecoMul(f) * ai;
    const fundRate = (1.2 + 1.1 * sumW[i]) * st.S * ecoMul(f) * (i === 0 ? 1 : 0.5);
    f.pool += troopRate * dt;
    f.funds += fundRate * dt;
    if (i === 0) { G.rates.troops = troopRate; G.rates.funds = fundRate; }
    f.units = cnt[i];
  });
  for (let i = 1; i < G.factions.length; i++) aiThink(i, dt, cnt);
  playerAuto(dt);
  if (now() - G.pendingSave > 8000) save();
}

function aiThink(i, dt, cnt) {
  const f = G.factions[i];
  if (!f.alive) return;
  f.next -= dt;
  if (f.next > 0) return;
  f.next = G.stage === 3 ? rand(3.5, 7) : rand(1.6, 3.8);
  if (G.stageT > 120 * (f.lvl + 1) && f.lvl < G.stage + 4) f.lvl++;
  const units = G.th.units;
  const total = units.length;
  const playerShare = (cnt[0] || 0) / total;
  const aggr = (0.55 + playerShare * 1.4 + Math.min(1, G.stageT / 300) * 0.4) * D().aggr;
  const inFlight = new Set(Render.strikes.filter((s) => s.fi === i && !s.done).map((s) => s.target.i));
  let best = null, bestScore = 0;
  const seen = new Set();
  for (const u of units) {
    if (u.owner !== i) continue;
    for (const j of u.adj) {
      if (seen.has(j)) continue;
      seen.add(j);
      const t = units[j];
      if (t.owner === i || inFlight.has(j)) continue;
      const mult = t.owner < 0 ? 1.25 : t.owner === 0 ? aggr : 0.9;
      const s = (t.w * mult) / (t.troops * defMul(t.owner) + 1);
      if (s > bestScore) { bestScore = s; best = t; }
    }
  }
  if (!best) return;
  const need = neededFor(i, best, 0.75);
  if (f.pool >= need) launch(i, best, Math.min(f.pool, Math.ceil(need * rand(1.0, 1.35))));
}

// ───────────────────────── 카메라 ─────────────────────────
const Cam = {
  x: px(127.8), y: py(36.3), z: 6.4, anim: null,
  scale() { return 2 ** (this.z - 8); },
  view() {
    const c = Render.canvas;
    const desk = window.innerWidth > 820;
    const side = desk && !G.focus ? 360 : 0;
    const top = G.focus ? (desk ? 70 : 64) : desk ? 80 : 120;
    const bottom = desk || G.focus ? 0 : 60;
    return { w: c.clientWidth - side, h: c.clientHeight - top - bottom, ox: -side / 2, oy: (top - bottom) / 2 };
  },
  fit(bb, animate) {
    const v = this.view();
    const bw = Math.max(bb[2] - bb[0], 1e-3), bh = Math.max(bb[3] - bb[1], 1e-3);
    const z = clamp(8 + Math.log2(Math.min(v.w / (bw * 1.12), v.h / (bh * 1.12))), 1.2, 16);
    const s = 2 ** (z - 8);
    const tx = (bb[0] + bb[2]) / 2 - v.ox / s, ty = (bb[1] + bb[3]) / 2 - v.oy / s;
    if (animate) this.fly(tx, ty, z, 1800); else { this.x = tx; this.y = ty; this.z = z; }
    this.home = { x: tx, y: ty, z };
  },
  fly(x, y, z, dur) {
    this.anim = { x0: this.x, y0: this.y, z0: this.z, x, y, z, t0: now(), dur };
  },
  step() {
    const a = this.anim;
    if (!a) return;
    const t = clamp((now() - a.t0) / a.dur, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    // 줌아웃 후 다시 들어가는 '하이퍼점프' 곡선
    const hop = Math.sin(Math.PI * t) * Math.min(2.2, Math.abs(a.z - a.z0) * 0.3 + Math.hypot(a.x - a.x0, a.y - a.y0) * 2 ** (Math.min(a.z, a.z0) - 8) / 2500);
    this.x = lerp(a.x0, a.x, e); this.y = lerp(a.y0, a.y, e); this.z = lerp(a.z0, a.z, e) - hop;
    Render.dirty = true;
    if (t >= 1) this.anim = null;
  },
  toWorld(sx, sy) {
    const c = Render.canvas, s = this.scale();
    return { x: this.x + (sx - c.clientWidth / 2) / s, y: this.y + (sy - c.clientHeight / 2) / s };
  },
  toScreen(wx, wy) {
    const c = Render.canvas, s = this.scale();
    return { x: (wx - this.x) * s + c.clientWidth / 2 + Render.sx, y: (wy - this.y) * s + c.clientHeight / 2 + Render.sy };
  },
  zoomAt(sx, sy, dz) {
    const before = this.toWorld(sx, sy);
    this.z = clamp(this.z + dz, 1.2, 16.5);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x; this.y += before.y - after.y;
    this.anim = null;
    Render.dirty = true;
  },
};

// ───────────────────────── 렌더링 ─────────────────────────
const Render = {
  canvas: null, ctx: null, dpr: 1, dirty: true, shake: 0, sx: 0, sy: 0,
  strikes: [], parts: [], texts: [], rings: [], bombs: [], hover: null, hit: null,
  init() {
    this.canvas = $('#map');
    this.ctx = this.canvas.getContext('2d');
    this.hit = document.createElement('canvas').getContext('2d');
    const resize = () => {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
      this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
      this.dirty = true;
    };
    window.addEventListener('resize', resize);
    resize();
  },
  text(x, y, str, color, size = 16) { this.texts.push({ x, y, str, color, size, t0: gnow() }); },
  burst(x, y, color, big = 1) {
    const t0 = gnow();
    this.rings.push({ x, y, t0, color, r: 70 * big });
    this.rings.push({ x, y, t0: t0 + 60, color: '#fff', r: 34 * big });
    for (let k = 0; k < 22 * big; k++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 340) * big;
      this.parts.push({ x, y, ox: 0, oy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.4, 0.9), t: 0, c: pick(['#fff3c4', '#ffc23d', '#ff8a3d', color]), s: rand(1.5, 3.5), g: 300 });
    }
    for (let k = 0; k < 8 * big; k++) {
      const a = rand(0, Math.PI * 2), sp = rand(10, 60);
      this.parts.push({ x, y, ox: 0, oy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: rand(1.0, 1.8), t: 0, c: 'smoke', s: rand(10, 22) * big, g: -10 });
    }
    this.shake = Math.max(this.shake, 7 * big);
  },

  frame(dt) {
    Cam.step();
    const ctx = this.ctx, c = this.canvas, dpr = this.dpr;
    const W = c.clientWidth, H = c.clientHeight;
    this.shake *= Math.pow(0.0025, dt);
    if (this.shake < 0.3) this.shake = 0;
    this.sx = rand(-1, 1) * this.shake; this.sy = rand(-1, 1) * this.shake;
    const s = Cam.scale();
    const T = gnow();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, W, H);
    this.drawTiles(W, H, s);

    // 지도 좌표계 변환
    const tx = W / 2 - Cam.x * s + this.sx, ty = H / 2 - Cam.y * s + this.sy;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    const lw = 1 / s;
    const th = G.th;
    if (th) {
      // 전장 밖은 어둡게
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fog = new Path2D();
      fog.rect(-50, -50, W + 100, H + 100);
      fog.addPath(th.mask, new DOMMatrix([s, 0, 0, s, tx, ty]));
      ctx.fillStyle = 'rgba(2,5,7,.58)';
      ctx.fill(fog, 'evenodd');
      ctx.restore();

      const view = { x0: Cam.x - W / 2 / s, y0: Cam.y - H / 2 / s, x1: Cam.x + W / 2 / s, y1: Cam.y + H / 2 / s };
      const vis = th.units.filter((u) => u.bb[2] >= view.x0 && u.bb[0] <= view.x1 && u.bb[3] >= view.y0 && u.bb[1] <= view.y1);
      const frontier = playerFrontier();
      const pulse = 0.5 + 0.5 * Math.sin(T / 260);

      // 영토 채색
      for (const u of vis) {
        if (u.owner < 0) {
          ctx.fillStyle = 'rgba(8,14,18,.10)';
          ctx.fill(u.path, 'evenodd');
          continue;
        }
        const f = G.factions[u.owner];
        ctx.globalAlpha = u.owner === 0 ? 0.42 : 0.36;
        ctx.fillStyle = f.color;
        ctx.fill(u.path, 'evenodd');
        ctx.globalAlpha = 1;
      }
      // 점령 와이프 연출
      for (const u of vis) {
        const age = T - u.cap0;
        if (u.cap0 && age < 1400) {
          const maxR = Math.hypot(u.bb[2] - u.bb[0], u.bb[3] - u.bb[1]);
          const r = maxR * clamp(age / 520, 0, 1);
          ctx.save();
          ctx.clip(u.path, 'evenodd');
          ctx.globalAlpha = age < 520 ? 0.85 : 0.85 * (1 - (age - 520) / 880);
          ctx.fillStyle = u.capColor;
          ctx.beginPath(); ctx.arc(u.capX, u.capY, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = age < 520 ? 0.9 : 0;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3 * lw;
          ctx.beginPath(); ctx.arc(u.capX, u.capY, r, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
      // 경계선
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(235,245,240,.32)';
      ctx.lineWidth = 0.8 * lw;
      for (const u of vis) ctx.stroke(u.path);
      for (const u of vis) {
        if (u.owner <= 0) continue;
        ctx.strokeStyle = G.factions[u.owner].color;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.6 * lw;
        ctx.stroke(u.path);
      }
      ctx.globalAlpha = 1;
      // 공격 가능 지역: 점선
      ctx.setLineDash([5 * lw, 4 * lw]);
      ctx.lineDashOffset = -T / 60 * lw;
      ctx.strokeStyle = `rgba(255,194,61,${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 1.6 * lw;
      for (const u of vis) if (frontier.has(u.i)) ctx.stroke(u.path);
      ctx.setLineDash([]);
      // 내 영토: 발광 테두리
      ctx.save();
      ctx.shadowColor = HERO;
      ctx.shadowBlur = 12 * dpr;
      ctx.strokeStyle = HERO;
      ctx.lineWidth = 2.2 * lw;
      for (const u of vis) if (u.owner === 0) ctx.stroke(u.path);
      ctx.restore();
      // 피격 깜빡임
      for (const u of vis) {
        if (u.hitT && T - u.hitT < 450) {
          ctx.globalAlpha = 0.55 * (1 - (T - u.hitT) / 450);
          ctx.fillStyle = '#fff';
          ctx.fill(u.path, 'evenodd');
          ctx.globalAlpha = 1;
        }
      }
      // 선택·호버
      if (this.hover && this.hover !== G.selected) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 2 * lw;
        ctx.stroke(this.hover.path);
      }
      if (G.selected) {
        ctx.save();
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 16 * dpr;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = (2.5 + pulse) * lw;
        ctx.stroke(G.selected.path);
        ctx.restore();
      }
      // 해상 항로
      ctx.setLineDash([3 * lw, 5 * lw]);
      ctx.lineWidth = 1.2 * lw;
      ctx.strokeStyle = 'rgba(140,220,255,.55)';
      const drawn = new Set();
      for (const u of th.units) {
        if (u.owner !== 0 && u !== G.selected) continue;
        for (const j of u.seaSet) {
          const key = Math.min(u.i, j) + ':' + Math.max(u.i, j);
          if (drawn.has(key)) continue;
          drawn.add(key);
          const v = th.units[j];
          ctx.beginPath(); ctx.moveTo(u.lx, u.ly);
          const mx = (u.lx + v.lx) / 2, my = (u.ly + v.ly) / 2 - Math.hypot(v.lx - u.lx, v.ly - u.ly) * 0.15;
          ctx.quadraticCurveTo(mx, my, v.lx, v.ly); ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // 라벨 (화면 좌표)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawLabels(vis, s, tx, ty, frontier);
    } else if (this.preview) {
      ctx.save();
      ctx.shadowColor = HERO; ctx.shadowBlur = 14 * dpr;
      ctx.strokeStyle = HERO; ctx.lineWidth = 2.4 * lw;
      ctx.stroke(this.preview.path);
      if (this.preview.dpath) { ctx.fillStyle = 'rgba(255,194,61,.45)'; ctx.fill(this.preview.dpath, 'evenodd'); }
      ctx.restore();
    }

    // 미사일 · 폭발 (화면 좌표)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawStrikes(T, s, tx, ty);
    this.drawFx(dt, T, s, tx, ty);

    // 비네트
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  },

  drawTiles(W, H, s) {
    const ctx = this.ctx;
    const tz = clamp(Math.round(Cam.z + Math.log2(this.dpr) - 0.25), 0, Tiles.maxZ);
    const tsz = WS / 2 ** tz;
    const v0 = Cam.toWorld(-20, -20), v1 = Cam.toWorld(W + 20, H + 20);
    const n = 2 ** tz;
    const x0 = clamp(Math.floor(v0.x / tsz), 0, n - 1), x1 = clamp(Math.floor(v1.x / tsz), 0, n - 1);
    const y0 = clamp(Math.floor(v0.y / tsz), 0, n - 1), y1 = clamp(Math.floor(v1.y / tsz), 0, n - 1);
    ctx.imageSmoothingQuality = 'high';
    const ox = W / 2 - Cam.x * s + this.sx, oy = H / 2 - Cam.y * s + this.sy;
    const size = tsz * s;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const t = Tiles.get(tz, x, y);
        if (!t) continue;
        // 타일 이음새가 보이지 않도록 0.5px 겹친다
        ctx.drawImage(t.img, t.sx, t.sy, t.sw, t.sw, Math.floor(ox + x * size), Math.floor(oy + y * size), Math.ceil(size) + 1, Math.ceil(size) + 1);
      }
    }
    // 위성 사진을 살짝 가라앉혀 영토 색이 돋보이게
    ctx.fillStyle = 'rgba(4,10,14,.12)';
    ctx.fillRect(0, 0, W, H);
  },

  drawLabels(vis, s, tx, ty, frontier) {
    const ctx = this.ctx;
    const placed = [];
    const sorted = [...vis].sort((a, b) => (b.owner === 0) - (a.owner === 0) || b.w - a.w);
    for (const u of sorted) {
      const wpx = (u.bb[2] - u.bb[0]) * s;
      const hpx = (u.bb[3] - u.bb[1]) * s;
      const X = u.lx * s + tx, Y = u.ly * s + ty;
      const show = Math.max(wpx, hpx) > 34 || u === G.selected || u.owner === 0;
      if (!show) continue;
      const nameSize = clamp(Math.sqrt(wpx * hpx) / 7, 11, 17);
      ctx.font = `600 ${nameSize}px "IBM Plex Sans KR", sans-serif`;
      const nw = ctx.measureText(u.name).width;
      const troops = fmt(u.troops);
      ctx.font = `700 12px "Chakra Petch", sans-serif`;
      const tw = ctx.measureText(troops).width + 14;
      const box = [X - Math.max(nw, tw) / 2 - 4, Y - nameSize - 4, X + Math.max(nw, tw) / 2 + 4, Y + 18];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      ctx.font = `600 ${nameSize}px "IBM Plex Sans KR", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(u.name, X, Y - 2);
      ctx.fillStyle = u.owner === 0 ? '#ffe2a0' : '#f1f6f4';
      ctx.fillText(u.name, X, Y - 2);
      // 병력 배지
      const col = u.owner < 0 ? 'rgba(20,28,32,.9)' : G.factions[u.owner].color;
      ctx.fillStyle = col;
      roundRect(ctx, X - tw / 2, Y + 2, tw, 16, 3);
      ctx.fill();
      if (frontier.has(u.i)) { ctx.strokeStyle = HERO; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.font = `700 12px "Chakra Petch", sans-serif`;
      ctx.fillStyle = u.owner < 0 ? '#dfe8e4' : '#0b0f10';
      ctx.textBaseline = 'middle';
      ctx.fillText(troops, X, Y + 10.5);
      ctx.textBaseline = 'alphabetic';
    }
  },

  drawStrikes(T, s, tx, ty) {
    const ctx = this.ctx;
    const S = (x, y) => ({ x: x * s + tx, y: y * s + ty });
    for (const st of this.strikes) {
      const a = S(st.from.x, st.from.y), b = S(st.to.x, st.to.y);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      let allHit = true;
      for (const m of st.missiles) {
        const t = (T - st.t0 - m.delay) / st.dur;
        if (t < 0) { allHit = false; continue; }
        const jx = m.jx * Math.min(26, dist * 0.12), jy = m.jy * Math.min(18, dist * 0.08);
        const bx = b.x + jx, by = b.y + jy;
        const cx = (a.x + bx) / 2, cy = (a.y + by) / 2 - Math.max(40, dist * m.arc);
        const P2 = (k) => ({ x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * cx + k * k * bx, y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * cy + k * k * by });
        if (t < 1) {
          allHit = false;
          const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
          // 궤적
          ctx.beginPath();
          const steps = 14;
          for (let k = 0; k <= steps; k++) {
            const q = Math.max(0, e - 0.28) + (Math.min(e, 1) - Math.max(0, e - 0.28)) * (k / steps);
            const p = P2(q);
            if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
          const grad = st.color;
          ctx.strokeStyle = grad;
          ctx.globalAlpha = 0.65;
          ctx.lineWidth = st.player ? 2.4 : 1.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
          const h = P2(e);
          ctx.save();
          ctx.shadowColor = st.color; ctx.shadowBlur = 14;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(h.x, h.y, st.player ? 3.2 : 2.4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          if (Math.random() < 0.6) this.parts.push({ x: (h.x - tx) / s, y: (h.y - ty) / s, ox: 0, oy: 0, vx: rand(-12, 12), vy: rand(-12, 12), life: 0.45, t: 0, c: 'smoke', s: rand(3, 6), g: -6 });
        } else if (!m.hit) {
          m.hit = true;
          this.burst((bx - tx) / s, (by - ty) / s, st.color, st.player ? 1 : 0.6);
          st.target.hitT = T;
          if (st.player || st.target.owner === 0) Sound.boom(st.player ? 1 : 0.6);
        }
      }
      if (allHit && !st.done) {
        st.done = true;
        resolve(st);
        UI.dirtyTarget = true;
      }
    }
    this.strikes = this.strikes.filter((st) => !st.done);

    // 정밀 폭격 낙하
    for (const bm of this.bombs) {
      const t = (T - bm.t) / 1;
      const p = S(bm.x, bm.y);
      if (t < 0) {
        const k = clamp(1 + t / 380, 0, 1);
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 260 * (1 - k) - 30); ctx.lineTo(p.x, p.y - 260 * (1 - k)); ctx.stroke();
      } else if (!bm.hit) {
        bm.hit = true;
        if (bm.onHit) bm.onHit();
        this.burst(bm.x, bm.y, '#ffd34d', 1.2);
        Sound.boom(1.1);
        buzz(30);
      }
    }
    this.bombs = this.bombs.filter((b) => !b.hit);
  },

  drawFx(dt, T, s, tx, ty) {
    const ctx = this.ctx;
    for (const r of this.rings) {
      const t = (T - r.t0) / 600;
      if (t < 0 || t > 1) continue;
      const X = r.x * s + tx, Y = r.y * s + ty;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.beginPath(); ctx.arc(X, Y, r.r * (0.2 + t * 0.9), 0, Math.PI * 2); ctx.stroke();
      if (t < 0.18) {
        ctx.globalAlpha = (0.18 - t) / 0.18;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath(); ctx.arc(X, Y, r.r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.rings = this.rings.filter((r) => T - r.t0 < 600);
    for (const p of this.parts) {
      p.t += dt;
      p.vy += p.g * dt;
      p.ox += p.vx * dt; p.oy += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
      const k = p.t / p.life;
      if (k >= 1) continue;
      const X = p.x * s + tx + p.ox, Y = p.y * s + ty + p.oy;
      if (p.c === 'smoke') {
        ctx.fillStyle = `rgba(60,60,60,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(X, Y, p.s * (0.6 + k), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = p.c;
        ctx.globalAlpha = 1 - k;
        ctx.fillRect(X - p.s / 2, Y - p.s / 2, p.s, p.s);
        ctx.globalAlpha = 1;
      }
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    for (const t of this.texts) {
      const k = (T - t.t0) / 1300;
      if (k > 1) continue;
      const X = t.x * s + tx, Y = t.y * s + ty - 26 - k * 46;
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const sc = k < 0.1 ? 1.6 - k * 6 : 1;
      ctx.font = `700 ${t.size * sc}px "Chakra Petch","IBM Plex Sans KR",sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.9)';
      ctx.strokeText(t.str, X, Y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, X, Y);
    }
    ctx.globalAlpha = 1;
    this.texts = this.texts.filter((t) => T - t.t0 < 1300);
  },

  pick(sx, sy) {
    if (!G.th) return null;
    const w = Cam.toWorld(sx, sy);
    const hit = this.hit;
    let best = null;
    for (const u of G.th.units) {
      if (w.x < u.bb[0] || w.x > u.bb[2] || w.y < u.bb[1] || w.y > u.bb[3]) continue;
      if (hit.isPointInPath(u.path, w.x, w.y, 'evenodd')) {
        if (!best || (u.bb[2] - u.bb[0]) < (best.bb[2] - best.bb[0])) best = u;
      }
    }
    return best;
  },
};
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
let frontierCache = { key: '', set: new Set() };
function playerFrontier() {
  if (!G.th) return new Set();
  const key = G.th.units.map((u) => (u.owner === 0 ? 1 : 0)).join('');
  if (key === frontierCache.key) return frontierCache.set;
  const set = new Set();
  for (const u of G.th.units) if (u.owner === 0) for (const j of u.adj) if (G.th.units[j].owner !== 0) set.add(j);
  frontierCache = { key, set };
  return set;
}

// ───────────────────────── 입력 ─────────────────────────
const Input = {
  pointers: new Map(), drag: null, moved: 0, pinch: null, lastTap: { u: null, t: 0 },
  init() {
    const c = Render.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) { this.drag = { x: e.clientX, y: e.clientY }; this.moved = 0; }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: Cam.z };
        this.moved = 99;
      }
      Cam.anim = null;
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') { const u = Render.pick(e.clientX, e.clientY); if (u !== Render.hover) Render.hover = u; }
        return;
      }
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const target = this.pinch.z + Math.log2(d / this.pinch.d);
        Cam.zoomAt(mx, my, target - Cam.z);
        const s = Cam.scale();
        Cam.x -= (e.clientX - prev.x) / s / 2; Cam.y -= (e.clientY - prev.y) / s / 2;
      } else if (this.drag) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this.moved += Math.abs(dx) + Math.abs(dy);
        if (this.moved > 6) c.classList.add('dragging');
        const s = Cam.scale();
        Cam.x -= dx / s; Cam.y -= dy / s;
      }
    });
    const end = (e) => {
      const wasTap = this.pointers.size === 1 && this.moved <= 6;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) { this.drag = null; c.classList.remove('dragging'); }
      if (wasTap && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { Render.hover = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      Cam.zoomAt(e.clientX, e.clientY, -e.deltaY * (e.ctrlKey ? 0.012 : 0.0022));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input,select,textarea')) return;
      if (e.key === 'Escape') UI.closeTarget();
      if ((e.key === ' ' || e.key === 'Enter') && G.selected && !$('#target').hidden) { e.preventDefault(); UI.fire(); }
      if (e.key === 'h' && Cam.home) Cam.fly(Cam.home.x, Cam.home.y, Cam.home.z, 700);
      if (e.key === 'f') UI.setFocus(!G.focus);
      if (e.key === 'p') UI.setPause(!G.paused);
      if (e.key === 'a') UI.setAuto(!G.auto);
    });
  },
  tap(x, y) {
    if (!G.running || G.paused) return;
    const u = Render.pick(x, y);
    Sound.init();
    if (!u) { UI.closeTarget(); return; }
    const t = now();
    const quick = this.lastTap.u === u && t - this.lastTap.t < 3000 && G.selected === u;
    this.lastTap = { u, t };
    if (quick && u.owner !== 0 && playerFrontier().has(u.i)) { UI.fire(); return; }
    G.selected = u;
    Sound.click();
    UI.openTarget(u);
  },
};

// ───────────────────────── UI ─────────────────────────
const UI = {
  tab: 'war', dirtyTab: true, holdUntil: 0, tabAt: 0, dirtyTarget: false, commitFrac: null, rankView: 'global', globalRows: null,
  init() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      const side = $('#side');
      if (window.innerWidth <= 820 && this.tab === b.dataset.tab && side.classList.contains('open')) { side.classList.remove('open'); return; }
      this.tab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      side.classList.add('open');
      this.dirtyTab = true;
      this.renderTab(true);
    }));
    // 패널을 누르는 동안에는 다시 그리지 않는다 (버튼 클릭이 사라지지 않도록)
    const hold = () => { this.holdUntil = now() + 700; };
    $('#side').addEventListener('pointerdown', hold);
    $('#target').addEventListener('pointerdown', hold);
    $('#soundBtn').addEventListener('click', () => { Sound.init(); Sound.toggle(); this.soundIcon(); });
    $('#autoBtn').addEventListener('click', () => { Sound.init(); this.setAuto(!G.auto); });
    $('#focusBtn').addEventListener('click', () => { Sound.init(); this.setFocus(!G.focus); });
    $('#pauseBtn').addEventListener('click', () => { Sound.init(); this.setPause(!G.paused); });
    $('#resumeGame').addEventListener('click', () => this.setPause(false));
    this.setAuto(G.auto, true);
    this.setFocus(G.focus, true);
    this.soundIcon();
    $('#tabbody').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'up') { upgrade(b.dataset.k); this.dirtyTab = true; this.renderTab(true); }
      if (act === 'mobil') { mobilize(); this.dirtyTab = true; this.renderTab(true); }
      if (act === 'rv') { this.rankView = b.dataset.v; this.dirtyTab = true; this.renderTab(true); }
      if (act === 'goto') { const u = G.th.units[+b.dataset.u]; if (u) { Cam.fly(u.lx, u.ly, Math.max(Cam.z, 8 + Math.log2(260 / Math.max(1, u.bb[2] - u.bb[0]))), 700); G.selected = u; this.openTarget(u); } }
      if (act === 'reset') { store.del('save'); location.reload(); }
      if (act === 'home' && Cam.home) Cam.fly(Cam.home.x, Cam.home.y, Cam.home.z, 700);
      if (act === 'auto') { this.setAuto(!G.auto); this.dirtyTab = true; this.renderTab(true); }
    });
  },
  setAuto(on, quiet) {
    G.auto = on;
    store.set('auto', on);
    const b = $('#autoBtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    $('#autoLabel').textContent = on ? '자동전투 ON' : '자동전투 OFF';
    if (!quiet) { Sound.click(); UI.toast(on ? '자동전투 개시' : '수동 지휘', on ? '아군이 스스로 공격하고 공격받으면 증원합니다' : '지역을 눌러 직접 공격하세요'); }
  },
  setPause(on) {
    if (!G.running && on) return;
    if (on === !!G.paused) return;
    if (on) { pauseAt = now(); G.paused = true; }
    else { pausedTotal += now() - pauseAt; G.paused = false; }
    $('#pauseBtn').setAttribute('aria-pressed', String(on));
    $('#pauseLabel').textContent = on ? '재개' : '일시정지';
    $('#pauseIcon').innerHTML = on ? '<path d="M7 5l12 7-12 7z"/>' : '<path d="M8 5v14M16 5v14"/>';
    $('#paused').hidden = !on;
    if (on) {
      const units = G.th.units;
      const mine = units.filter((u) => u.owner === 0).length;
      $('#psInfo').textContent = `${stageTitle()} · 점유 ${Math.round((mine / units.length) * 100)}% · ${fmtTime(G.stageT)} 경과`;
      save();
    }
    Sound.click();
  },
  setFocus(on, quiet) {
    G.focus = on;
    store.set('focus', on);
    $('#app').classList.toggle('focus', on);
    $('#focusBtn').setAttribute('aria-pressed', String(on));
    $('#focusLabel').textContent = on ? '메뉴 보기' : '전장만 보기';
    if (on) $('#side').classList.remove('open');
    if (!quiet) {
      Sound.click();
      try {
        const el = document.documentElement;
        if (on && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
        if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      } catch { /* 전체화면 미지원 */ }
      if (G.th) setTimeout(() => Cam.fit(G.th.bbox, true), 60);
    }
  },
  soundIcon() { $('#soundWave').style.opacity = Sound.on ? 1 : 0.15; },
  hud() {
    if (!G.th) return;
    const f = P();
    const units = G.th.units;
    const mine = units.filter((u) => u.owner === 0).length;
    $('#sTroops').textContent = fmt(f.pool);
    $('#sTroopsRate').textContent = `+${fmt(G.rates.troops)}/s`;
    $('#sFunds').textContent = fmtFunds(f.funds);
    $('#sFundsRate').textContent = `+${G.rates.funds.toFixed(1)}/s`;
    $('#sShare').textContent = Math.round((mine / units.length) * 100) + '%';
    $('#sUnits').textContent = `${mine} / ${units.length} ${STAGES[G.stage].word}`;
    $('#sScore').textContent = fmt(G.score);
    $('#sRank').textContent = `전장 ${theaterRank()}위`;
  },
  closeTarget() { $('#target').hidden = true; G.selected = null; this.commitFrac = null; },
  openTarget(u) {
    this.commitFrac = null;
    $('#target').hidden = false;
    this.renderTarget(true);
  },
  renderTarget(full) {
    const u = G.selected;
    const el = $('#target');
    if (!u || el.hidden) return;
    const f = P();
    const ownerF = u.owner >= 0 ? G.factions[u.owner] : null;
    const ownerName = ownerF ? (u.owner === 0 ? `내 영토 · ${ownerF.name}` : ownerF.name) : '중립 지역';
    const ownerColor = ownerF ? ownerF.color : '#5d6f69';
    const st = STAGES[G.stage];
    const reachable = u.owner !== 0 && playerFrontier().has(u.i);
    const parent = G.stage === 0 ? `${G.start.sggName}` : G.stage === 1 ? G.start.sidoName : G.stage === 3 ? (u.p.c || '') : '대한민국';
    const income = st.M * 4 * u.w;
    if (full) {
      el.innerHTML = `
        <div class="t-head"><div><h3>${esc(u.name)}</h3><div class="own"><i style="background:${ownerColor}"></i>${esc(ownerName)} · ${esc(parent)}</div></div><button class="t-close" id="tClose" aria-label="닫기">×</button></div>
        <div class="t-grid">
          <div><label>수비 병력</label><span class="num" id="tTroops"></span></div>
          <div><label>${st.key === 'world' ? '인구' : '면적'}</label><span class="num">${st.key === 'world' ? fmt(u.p.p || 0) : (u.p.ar || 0).toLocaleString('ko-KR') + 'km²'}</span></div>
          <div><label>병력 생산</label><span class="num">+${fmt(income)}/s</span></div>
        </div>
        ${u.owner === 0 ? `<div class="t-why">내 영토입니다. 수비 병력은 자동으로 보충됩니다 (상한 ${fmt(unitCap(u))}). 점선으로 표시된 인접 지역을 공격하세요.</div>`
        : reachable ? `
        <div class="odds"><span class="t-why" style="flex:none">승률</span><div class="meter"><b id="tMeter"></b></div><span class="num" id="tOdds"></span></div>
        <div class="commit"><span>투입</span><input type="range" id="tSlider" min="1" max="100" value="50" aria-label="투입 병력 비율"><span class="num" id="tCommit"></span></div>
        <div class="t-actions">
          <button class="btn hero" id="tFire">공격 개시</button>
          <button class="btn" id="tSure" title="승률 90% 병력 자동 투입">필승</button>
          <button class="btn" id="tStrike" title="정밀 폭격: 수비군 42% 감소">폭격 <span class="num">${fmtFunds(80 * st.S)}</span></button>
        </div>
        <div class="t-why" id="tWhy"></div>`
        : `<div class="t-why">아직 닿을 수 없는 지역입니다. 이 지역과 맞닿은 곳을 먼저 점령하세요.</div>
           <div class="t-actions" style="grid-template-columns:1fr"><button class="btn" id="tStrike">정밀 폭격 <span class="num">${fmtFunds(80 * st.S)}</span></button></div>`}
      `;
      $('#tClose').onclick = () => this.closeTarget();
      const sl = $('#tSlider');
      if (sl) {
        const need = neededFor(0, u, 0.9);
        const frac = this.commitFrac ?? clamp(need / Math.max(1, f.pool), 0.05, 1);
        sl.value = Math.round(frac * 100);
        sl.oninput = () => { this.commitFrac = sl.value / 100; this.renderTarget(false); };
        $('#tFire').onclick = () => this.fire();
        $('#tSure').onclick = () => { this.commitFrac = clamp(neededFor(0, u, 0.9) / Math.max(1, f.pool), 0.01, 1); this.renderTarget(true); };
      }
      const sb = $('#tStrike');
      if (sb) sb.onclick = () => { airstrike(u); this.renderTarget(true); };
    }
    $('#tTroops').textContent = fmt(u.troops);
    const sl = $('#tSlider');
    if (sl) {
      const frac = this.commitFrac ?? sl.value / 100;
      const commit = Math.floor(f.pool * frac);
      const o = attackOdds(0, u, commit);
      const pct = Math.round(o.p * 100);
      $('#tCommit').textContent = fmt(commit);
      $('#tOdds').textContent = pct + '%';
      const m = $('#tMeter');
      m.style.width = pct + '%';
      m.style.background = pct >= 70 ? 'var(--ok)' : pct >= 40 ? 'var(--hero)' : 'var(--alert)';
      const need = neededFor(0, u, 0.9);
      $('#tFire').disabled = commit < 1;
      $('#tSure').disabled = need > f.pool;
      $('#tWhy').textContent = (o.sea ? '해상 상륙전: 수비 효율 +20%. ' : '') + (need > f.pool ? `90% 승률까지 ${fmt(need - f.pool)} 병력이 더 필요합니다.` : `필승 투입량 ${fmt(need)}.`);
    }
    const sb = $('#tStrike');
    if (sb) sb.disabled = G.cd.strike > 0 || f.funds < 80 * st.S || u.owner === 0;
  },
  fire() {
    if (G.paused) return;
    const u = G.selected;
    if (!u || u.owner === 0 || !playerFrontier().has(u.i)) return;
    const f = P();
    const sl = $('#tSlider');
    const need = neededFor(0, u, 0.9);
    const frac = this.commitFrac ?? (sl ? sl.value / 100 : clamp(need / Math.max(1, f.pool), 0.05, 1));
    const commit = Math.floor(f.pool * frac);
    if (commit < 1) return;
    const odds = attackOdds(0, u, commit).p;
    Sound.init();
    if (launch(0, u, commit)) {
      Render.strikes[Render.strikes.length - 1].odds = odds;
      buzz(15);
      this.renderTarget(true);
    }
  },
  banner(small, big, sub, bad) {
    const b = $('#banner');
    $('#bnSmall').textContent = small; $('#bnBig').textContent = big; $('#bnSub').textContent = sub || '';
    b.classList.toggle('bad', !!bad);
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  combo(n) {
    const c = $('#combo');
    c.textContent = `${n} 연속 점령!`;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  },
  alert() {
    const a = $('#alertfx');
    a.classList.add('on');
    clearTimeout(this._al);
    this._al = setTimeout(() => a.classList.remove('on'), 600);
  },
  toast(title, sub) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="ic">勳</span><div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  },
  ticker(html, color) {
    const t = $('#ticker');
    const el = document.createElement('div');
    el.style.setProperty('--c', color || '#8ea39b');
    el.innerHTML = html;
    t.appendChild(el);
    while (t.children.length > 4) t.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 5200);
  },
  renderTab(force) {
    if (!this.dirtyTab || !G.th) return;
    if (!force && now() < (this.holdUntil || 0)) return;
    this.dirtyTab = false;
    const body = $('#tabbody');
    const keepScroll = body.scrollTop;
    if (this.tab === 'war') body.innerHTML = this.warHTML();
    if (this.tab === 'rank') body.innerHTML = this.rankHTML();
    if (this.tab === 'hq') body.innerHTML = this.hqHTML();
    if (this.tab === 'log') body.innerHTML = this.logHTML();
    body.scrollTop = keepScroll;
  },
  warHTML() {
    const units = G.th.units;
    const total = units.length;
    const rows = G.factions.map((f, i) => {
      const us = units.filter((u) => u.owner === i);
      const troops = us.reduce((s, u) => s + u.troops, 0) + f.pool;
      return { f, i, n: us.length, pct: (us.length / total) * 100, troops, best: us.sort((a, b) => b.w - a.w)[0] };
    }).sort((a, b) => b.n - a.n || b.troops - a.troops);
    const neutral = units.filter((u) => u.owner < 0).length;
    const list = rows.map((r, k) => `
      <div class="fac ${r.i === 0 ? 'me' : ''} ${r.f.alive ? '' : 'dead'}">
        <span class="rk">${k + 1}</span>
        <span class="nm"><i style="background:${r.f.color}"></i><span>${esc(r.f.name)}${r.i === 0 ? ' (나)' : ''}</span></span>
        <span class="pc">${r.pct.toFixed(r.pct < 10 ? 1 : 0)}%</span>
        <div class="bar"><b style="width:${r.pct}%;background:${r.f.color}"></b></div>
        <div class="meta"><span>${r.n}개 ${STAGES[G.stage].word}</span><span>총병력 ${fmt(r.troops)}</span>${r.f.lastCapName ? `<span>최근 ${esc(r.f.lastCapName)}</span>` : ''}</div>
      </div>`).join('');
    const ladder = STAGES.map((s, k) => `<div class="${k <= G.stage ? 'on' : ''}">${k + 1}단계<b>${s.title}</b></div>`).join('');
    return `
      <div class="sect-h">세력별 진행 상황 <em>${fmtTime(G.stageT)} 경과</em></div>
      <div>${list}</div>
      <div class="note">중립 지역 ${neutral}곳 남음. 모든 ${STAGES[G.stage].word}을(를) 점령하면 다음 전장이 열립니다.</div>
      <div class="sect-h">정복 단계</div>
      <div class="ladder">${ladder}</div>
      <button class="btn" data-act="home">전장 전체 보기 (H)</button>`;
  },
  rankHTML() {
    const seg = `<div class="seg"><button data-act="rv" data-v="global" aria-pressed="${this.rankView === 'global'}">전체 지휘관</button><button data-act="rv" data-v="local" aria-pressed="${this.rankView === 'local'}">내 기록</button></div>`;
    if (this.rankView === 'local') {
      const runs = store.get('runs', []);
      const rows = runs.slice(0, 20).map((r, k) => `<div class="rankrow"><span class="rk">${k + 1}</span><span class="who">${esc(r.callsign)}</span><span class="sc">${fmt(r.score)}</span><span class="sub">${esc(r.where)} · ${STAGE_NAMES[r.stage] || ''} 단계 · ${esc(r.date)}</span></div>`).join('');
      return `${seg}<div class="sect-h">이 기기의 명예의 전당</div><div>${rows || '<div class="note">아직 기록이 없습니다. 전장을 클리어하거나 점수를 쌓으면 저장됩니다.</div>'}</div>`;
    }
    if (!Online.backend) {
      return `${seg}<div class="sect-h">전체 지휘관 랭킹</div><div class="note">온라인 랭킹 서버에 연결되지 않았습니다. 지금은 이 기기 기록만 저장됩니다.</div>${this.liveLine()}`;
    }
    const rows = (this.globalRows || []).map((r, k) => `
      <div class="rankrow ${r.id === Online.uid ? 'me' : ''}"><span class="rk">${k + 1}</span><span class="who">${esc(r.callsign || '무명 지휘관')}</span><span class="sc">${fmt(r.score || 0)}</span>
      <span class="sub">${esc(r.where || '')} 출신 · ${esc(r.stageName || '')}${r.diff ? ' · ' + esc(r.diff) : ''} · 점유 ${Math.round(r.share || 0)}%</span></div>`).join('');
    const live = Online.backend === 'supabase' ? (Online.error ? '연결 재시도 중' : '20초마다 갱신') : '실시간';
    return `${seg}<div class="sect-h">전체 지휘관 랭킹 <em>${live}</em></div>${this.liveLine()}<div>${rows || '<div class="note">아직 등록된 지휘관이 없습니다. 첫 지역을 점령하면 랭킹에 오릅니다.</div>'}</div>
      ${Online.canWrite === false ? '<div class="note">이 링크는 보기 전용이라 내 점수는 등록되지 않습니다.</div>' : ''}`;
  },
  liveLine() { return Online.peers > 0 ? `<div class="note">지금 ${Online.peers}명의 지휘관이 접속 중</div>` : ''; },
  hqHTML() {
    const st = STAGES[G.stage];
    const f = P();
    const up = (k, name, desc) => {
      const c = upCost(k);
      return `<div class="upg"><b>${name} <span class="num" style="color:var(--hero)">Lv.${G.up[k]}</span></b><small>${desc}</small><button class="btn ${f.funds >= c ? 'hero' : ''}" data-act="up" data-k="${k}" ${f.funds < c || G.up[k] >= 15 ? 'disabled' : ''}><span class="num">${fmtFunds(c)}</span></button></div>`;
    };
    const mc = 140 * st.S;
    const medals = MEDALS.map(([k, n, d]) => `<div class="medal ${G.medals[k] ? 'got' : ''}"><span class="ic">${G.medals[k] ? '勳' : '?'}</span><div><b>${n}</b><small>${d}</small></div></div>`).join('');
    return `
      <div class="sect-h">사령부 강화 <em>보유 ${fmtFunds(f.funds)}</em></div>
      ${up('atk', '공격 화력', '공격 병력의 전투력 +12%')}
      ${up('def', '방어 진지', '내 영토 수비력과 수비 상한 +12%')}
      ${up('eco', '군수 생산', '병력·군자금 생산 +15%')}
      <div class="sect-h">지휘 방식</div>
      <div class="upg"><b>자동전투 <span class="num" style="color:${G.auto ? 'var(--ok)' : 'var(--muted)'}">${G.auto ? 'ON' : 'OFF'}</span></b><small>아군이 인접 지역을 스스로 공격하고, 적이 공격하면 기동 병력에서 증원합니다 (단축키 A)</small><button class="btn" data-act="auto">${G.auto ? '끄기' : '켜기'}</button></div>
      <div class="sect-h">특수 작전</div>
      <div class="upg"><b>총동원령</b><small>${G.cd.mobil > 0 ? `재사용 ${Math.ceil(G.cd.mobil)}초` : '25초 분량의 병력을 즉시 징집'}</small><button class="btn" data-act="mobil" ${G.cd.mobil > 0 || f.funds < mc ? 'disabled' : ''}><span class="num">${fmtFunds(mc)}</span></button></div>
      <div class="note">정밀 폭격은 지도에서 지역을 선택한 뒤 표적 카드에서 사용합니다. 인접하지 않은 지역도 폭격할 수 있습니다.</div>
      <div class="sect-h">훈장</div>
      ${medals}
      <button class="btn" data-act="reset">새 지휘관으로 처음부터</button>`;
  },
  logHTML() {
    if (!G.feed.length) return '<div class="note">아직 전투 기록이 없습니다.</div>';
    return G.feed.slice().reverse().map((l) => `<div class="log"><time>${l.t}</time><span>${l.html}</span></div>`).join('');
  },
};
const MEDALS = [
  ['first', '첫 점령', '첫 번째 지역 점령'],
  ['combo3', '전격전', '7초 안에 3연속 점령'],
  ['combo5', '파죽지세', '7초 안에 5연속 점령'],
  ['sea', '상륙 작전', '바다 건너 지역 점령'],
  ['upset', '기적의 역전', '승률 40% 미만 공격 성공'],
  ['wipe', '섬멸전', '경쟁 세력 하나를 소멸'],
  ['s1', '동네 영웅', '1단계 클리어'],
  ['s2', '시·도 평정', '2단계 클리어'],
  ['s3', '통일 영웅', '대한민국 통일'],
  ['s4', '전쟁히어로', '세계 정복'],
];
function medal(k, title, sub) {
  if (G.medals[k]) return;
  G.medals[k] = Date.now();
  UI.toast('훈장 획득 · ' + title, sub);
  G.score += 50 * STAGES[G.stage].S;
  UI.dirtyTab = true;
}
function pushFeed(html, color) {
  G.feed.push({ t: clock(), html });
  if (G.feed.length > 80) G.feed.shift();
  UI.ticker(html, color);
  if (UI.tab === 'log') UI.dirtyTab = true;
}
function theaterRank() {
  const units = G.th.units;
  const counts = G.factions.map((_, i) => units.filter((u) => u.owner === i).length);
  return 1 + counts.filter((c, i) => i > 0 && c > counts[0]).length;
}

// ───────────────────────── 단계 전환 ─────────────────────────
function stageClear() {
  if (!G.running) return;
  G.running = false;
  const st = STAGES[G.stage];
  G.score += Math.round(1000 * st.S * D().score);
  medal('s' + (G.stage + 1), MEDALS.find((m) => m[0] === 's' + (G.stage + 1))[1], `${st.title} 완료`);
  Sound.fanfare();
  recordRun();
  scheduleRank(true);
  const titles = [`${G.start.sggName} 완전 장악`, `${G.start.sidoName} 평정`, '대한민국 통일', '세계 정복 완료'];
  $('#clKicker').textContent = `STAGE ${G.stage + 1} CLEAR`;
  $('#clTitle').textContent = titles[G.stage];
  const nextLede = [
    `${G.start.sggName}의 모든 동이 당신의 깃발 아래 있습니다. 이제 ${G.start.sidoName}의 시·군·구가 기다립니다.`,
    `${G.start.sidoName} 전역을 손에 넣었습니다. 다음은 17개 시·도가 맞붙는 대한민국 통일전입니다.`,
    '한반도 남쪽 전역이 하나가 되었습니다. 이제 세계 열강이 실시간으로 영토를 넓히는 세계 정복전으로 나아갑니다.',
    '전 세계가 당신의 지휘 아래 있습니다. 당신이 진짜 전쟁히어로입니다.',
  ];
  $('#clLede').textContent = nextLede[G.stage];
  $('#clCap').textContent = G.stageCaps;
  $('#clTime').textContent = fmtTime(G.stageT);
  $('#clScore').textContent = fmt(G.score);
  $('#clNext').textContent = G.stage < 3 ? '다음 전장으로' : '새로운 출격';
  $('#clear').hidden = false;
  save();
}
function defeat() {
  G.running = false;
  recordRun();
  Sound.fail();
  $('#clKicker').textContent = 'MISSION FAILED';
  $('#clTitle').textContent = '작전 실패';
  $('#clLede').textContent = '마지막 거점을 잃었습니다. 사령부 강화 수준과 점수는 유지한 채 이 전장을 다시 시작합니다.';
  $('#clCap').textContent = G.stageCaps;
  $('#clTime').textContent = fmtTime(G.stageT);
  $('#clScore').textContent = fmt(G.score);
  $('#clNext').textContent = '다시 도전';
  $('#clear').hidden = false;
  G.defeated = true;
}
function recordRun() {
  const runs = store.get('runs', []);
  const where = `${SIDO_SHORT[G.start.sido]} ${G.start.sggName} ${G.start.dong}`;
  const i = runs.findIndex((r) => r.id === G.runId);
  const rec = { id: G.runId, callsign: G.callsign, score: G.score, stage: G.stage, where, date: new Date().toLocaleDateString('ko-KR') };
  if (i >= 0) runs[i] = rec; else runs.push(rec);
  runs.sort((a, b) => b.score - a.score);
  store.set('runs', runs.slice(0, 30));
}

// ───────────────────────── 저장 ─────────────────────────
function save() {
  if (!G.th) return;
  G.pendingSave = now();
  store.set('save', {
    v: 1, callsign: G.callsign, start: G.start, stage: G.stage, runId: G.runId, diff: G.diff,
    units: G.th.units.map((u) => [u.owner, Math.round(u.troops)]),
    factions: G.factions, up: G.up, score: G.score, medals: G.medals, totalT: G.totalT, stageT: G.stageT,
    caps: G.caps, stageCaps: G.stageCaps, lost: G.lost, cleared: !G.running && !G.defeated,
  });
}

// ───────────────────────── 온라인 랭킹 (artifact db) ─────────────────────────
// 온라인 랭킹 백엔드 두 가지:
//  · Claude 아티팩트로 열면 아티팩트 db (같은 조직·초대받은 사람끼리)
//  · 일반 웹사이트로 열면 Supabase (config.js 에 주소·anon 키가 있을 때, 누구나)
// 둘 다 없으면 이 기기 기록만 남는다.
const Supa = {
  cfg: window.WH_CONFIG || {},
  ok() { return !!(this.cfg.supabaseUrl && this.cfg.supabaseAnonKey); },
  headers() {
    const k = this.cfg.supabaseAnonKey;
    return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
  },
  url(path) { return this.cfg.supabaseUrl.replace(/\/+$/, '') + path; },
  async top(limit = 50) {
    const r = await fetch(this.url(`/rest/v1/scores?select=id,callsign,score,stage,stage_name,diff,region,share&order=score.desc&limit=${limit}`), { headers: this.headers() });
    if (!r.ok) throw new Error('rank ' + r.status);
    return (await r.json()).map((x) => ({ id: x.id, callsign: x.callsign, score: x.score, stageName: x.stage_name, diff: x.diff, where: x.region, share: x.share }));
  },
  async submit(body) {
    const r = await fetch(this.url('/rest/v1/rpc/submit_score'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('submit ' + r.status);
  },
};
function playerKey() {
  let k = store.get('pid', null);
  if (!k || !k.id || !k.secret) {
    const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
    const h = hex(16);
    const id = crypto.randomUUID ? crypto.randomUUID() : `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    k = { id, secret: hex(24) };
    store.set('pid', k);
  }
  return k;
}

const Online = {
  backend: null, db: null, uid: null, canWrite: null, peers: 0, lastSent: 0, lastScore: -1, timer: 0, pollT: 0,
  async init() {
    const cl = window.claude;
    if (cl && typeof cl.use === 'function') {
      try {
        const [db, user] = await Promise.all([cl.use('db'), cl.use('user')]);
        const uid = db && user ? await user.id() : null;
        if (uid) {
          this.backend = 'claude'; this.db = db; this.uid = uid;
          try { this.canWrite = await user.can('data.write'); } catch { /* 알 수 없음 */ }
          db.collection('rank').orderBy('score', 'desc').limit(30).onSnapshot((snap) => {
            this.setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          }, () => { /* 구독 종료: 로컬 랭킹만 사용 */ });
        }
      } catch { this.db = null; }
      try {
        const room = await cl.use('room');
        if (room) {
          const count = () => { try { this.peers = room.peers().length; } catch { /* noop */ } };
          room.onPeers(() => { count(); if (UI.tab === 'rank') UI.dirtyTab = true; }, () => {});
          count();
          this.room = room;
        }
      } catch { /* 접속자 표시 생략 */ }
    }
    if (!this.backend && Supa.ok()) {
      this.backend = 'supabase';
      this.uid = playerKey().id;
      this.poll();
      setInterval(() => { if (!document.hidden) this.poll(); }, 20000);
    }
    UI.dirtyTab = true;
  },
  setRows(rows) {
    UI.globalRows = rows;
    if (UI.tab === 'rank') { UI.dirtyTab = true; UI.renderTab(true); }
    updateGlobalRank();
  },
  async poll() {
    try { this.setRows(await Supa.top()); this.error = false; }
    catch { this.error = true; if (UI.tab === 'rank') UI.dirtyTab = true; }
  },
  async push() {
    if (!this.backend || this.canWrite === false || !G.th) return;
    if (G.score === this.lastScore) return;
    this.lastScore = G.score;
    this.lastSent = now();
    const units = G.th.units;
    const share = Math.round((units.filter((u) => u.owner === 0).length / units.length) * 100);
    const where = `${SIDO_SHORT[G.start.sido]} ${G.start.sggName}`;
    if (this.backend === 'supabase') {
      const k = playerKey();
      try {
        await Supa.submit({ p_id: k.id, p_secret: k.secret, p_callsign: G.callsign.slice(0, 14), p_score: Math.round(G.score), p_stage: G.stage, p_stage_name: STAGES[G.stage].title, p_diff: D().name, p_region: where, p_share: share });
        this.poll();
      } catch { /* 다음 점령 때 다시 보낸다 */ this.lastScore = -1; }
      return;
    }
    try {
      await this.db.doc('rank/' + this.uid).set({
        callsign: G.callsign, score: G.score, stage: G.stage, stageName: STAGES[G.stage].title, diff: D().name,
        where, share, updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      if (e && e.code === 'invalid_argument') this.canWrite = false;
    }
    try { this.room && this.room.presence({ callsign: G.callsign, stage: G.stage }); } catch { /* noop */ }
  },
};
function scheduleRank(force) {
  if (force) { Online.push(); return; }
  if (Online.timer) return;
  const wait = Math.max(0, 15000 - (now() - Online.lastSent));
  Online.timer = setTimeout(() => { Online.timer = 0; Online.push(); }, wait);
}
function updateGlobalRank() {
  if (!UI.globalRows) return;
  const i = UI.globalRows.findIndex((r) => r.id === Online.uid);
  if (i >= 0) G.globalRank = i + 1;
}

// ───────────────────────── 시작 화면 ─────────────────────────
const Start = {
  init() {
    const sido = Data.raw.kr_sido.geoms.map((g) => g.properties).sort((a, b) => a.s.localeCompare(b.s));
    const selSido = $('#selSido'), selSgg = $('#selSgg'), selDong = $('#selDong');
    selSido.innerHTML = sido.map((p) => `<option value="${p.s}">${esc(p.n)}</option>`).join('');
    const fillSgg = () => {
      const list = Data.raw.kr_sgg.geoms.map((g) => g.properties).filter((p) => p.s === selSido.value).sort((a, b) => a.n.localeCompare(b.n, 'ko'));
      selSgg.innerHTML = list.map((p) => `<option value="${p.g}">${esc(p.n)}</option>`).join('');
      fillDong();
    };
    const fillDong = () => {
      const list = Data.raw.kr_dong.geoms.map((g) => g.properties).filter((p) => p.g === selSgg.value).sort((a, b) => a.n.localeCompare(b.n, 'ko'));
      selDong.innerHTML = `<option value="">무작위 동</option>` + list.map((p) => `<option value="${esc(p.n)}">${esc(p.n)}</option>`).join('');
      this.preview();
    };
    selSido.onchange = fillSgg;
    selSgg.onchange = fillDong;
    selDong.onchange = () => this.preview();
    const last = store.get('lastStart', null);
    selSido.value = last?.sido || '11';
    fillSgg();
    if (last?.sgg) { selSgg.value = last.sgg; fillDong(); }
    $('#callsign').value = store.get('callsign', '');
    const seg = $('#diffSeg');
    const setDiff = (d) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === d)));
    setDiff(store.get('diff', 'normal'));
    seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-d]'); if (b) setDiff(b.dataset.d); });
    const saved = store.get('save', null);
    if (saved && saved.v === 1 && !(saved.cleared && saved.stage >= 3)) {
      $('#resumeBtn').hidden = false;
      $('#resumeBtn').textContent = `이어하기 · ${STAGE_NAMES[saved.cleared ? saved.stage + 1 : saved.stage]} 단계`;
      $('#resumeBtn').onclick = () => this.resume(saved);
    }
    $('#startForm').addEventListener('submit', (e) => { e.preventDefault(); this.go(); });
    $('#start').hidden = false;
  },
  preview() {
    const g = $('#selSgg').value;
    const raw = Data.raw.kr_sgg;
    const i = raw.geoms.findIndex((x) => x.properties.g === g);
    if (i < 0) return;
    const path = new Path2D();
    for (const poly of polysOf(raw.feats[i].geometry)) for (const ring of poly) { ring.forEach(([lo, la], j) => (j ? path.lineTo(px(lo), py(la)) : path.moveTo(px(lo), py(la)))); path.closePath(); }
    const dn = $('#selDong').value;
    const dong = dn ? Data.raw.kr_dong.geoms.findIndex((x) => x.properties.g === g && x.properties.n === dn) : -1;
    const dpath = new Path2D();
    if (dong >= 0) for (const poly of polysOf(Data.raw.kr_dong.feats[dong].geometry)) for (const ring of poly) { ring.forEach(([lo, la], j) => (j ? dpath.lineTo(px(lo), py(la)) : dpath.moveTo(px(lo), py(la)))); dpath.closePath(); }
    Render.preview = { path, dpath: dong >= 0 ? dpath : null };
    const bb = raw.geoms[i].properties.bb;
    const box = [px(bb[0]), py(bb[3]), px(bb[2]), py(bb[1])];
    const v = Cam.view();
    const z = clamp(8 + Math.log2(Math.min(v.w / ((box[2] - box[0]) * 2.6), v.h / ((box[3] - box[1]) * 2.6))), 3, 13);
    Cam.fly((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, z, 1400);
  },
  go() {
    Sound.init();
    const sido = $('#selSido').value, sgg = $('#selSgg').value;
    let dong = $('#selDong').value;
    const dongs = Data.raw.kr_dong.geoms.map((g) => g.properties).filter((p) => p.g === sgg);
    if (!dong) dong = pick(dongs).n;
    const sidoName = Data.raw.kr_sido.geoms.find((g) => g.properties.s === sido).properties.n;
    const sggName = Data.raw.kr_sgg.geoms.find((g) => g.properties.g === sgg).properties.n;
    const cs = ($('#callsign').value || '').trim() || `${dong}의 영웅`;
    store.set('callsign', cs);
    store.set('lastStart', { sido, sgg });
    G.callsign = cs;
    G.start = { sido, sgg, dong, sidoName, sggName };
    G.runId = Date.now().toString(36);
    G.diff = document.querySelector('#diffSeg [aria-pressed="true"]')?.dataset.d || 'normal';
    store.set('diff', G.diff);
    G.up = { atk: 0, def: 0, eco: 0 };
    G.score = 0; G.caps = 0; G.lost = 0; G.totalT = 0; G.medals = {}; G.feed = []; G.defeated = false;
    G.factions = [];
    $('#start').hidden = true;
    setupStage(0);
  },
  async resume(s) {
    Sound.init();
    G.callsign = s.callsign; G.start = s.start; G.runId = s.runId; G.up = s.up; G.score = s.score; G.diff = s.diff || 'normal';
    G.medals = s.medals || {}; G.totalT = s.totalT || 0; G.caps = s.caps || 0; G.lost = s.lost || 0; G.feed = [];
    $('#start').hidden = true;
    if (s.cleared) { G.factions = s.factions; await setupStage(s.stage + 1); return; }
    await setupStage(s.stage, { factions: s.factions, units: s.units, stageT: s.stageT, stageCaps: s.stageCaps });
    UI.banner('작전 재개', stageTitle(), '');
  },
};

// ───────────────────────── 메인 루프 ─────────────────────────
let last = now(), acc = 0, uiAcc = 0;
function loop() {
  const t = now();
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  acc += dt;
  if (G.paused) acc = 0;
  while (acc >= 0.1) { tick(0.1); acc -= 0.1; }
  uiAcc += dt;
  if (uiAcc > 0.25) {
    uiAcc = 0;
    UI.hud();
    const held = now() < UI.holdUntil;
    if (!$('#target').hidden) UI.renderTarget(UI.dirtyTarget && !held);
    if (!held) UI.dirtyTarget = false;
    if ((UI.tab === 'war' || UI.tab === 'hq') && t - UI.tabAt > 1000) { UI.dirtyTab = true; UI.tabAt = t; }
    UI.renderTab();
  }
  if (!G.running && !Cam.anim && !G.th) Cam.x += dt * 4;
  Render.frame(G.paused ? 0 : dt);
  requestAnimationFrame(loop);
}

$('#clNext').addEventListener('click', async () => {
  $('#clear').hidden = true;
  if (G.defeated) { G.defeated = false; G.factions[0].funds = Math.max(G.factions[0].funds, 60 * STAGES[G.stage].S); await setupStage(G.stage); return; }
  if (G.stage < 3) { await setupStage(G.stage + 1); return; }
  store.del('save');
  location.reload();
});
$('#clStay').addEventListener('click', () => { $('#clear').hidden = true; });

async function boot() {
  Render.init();
  Input.init();
  UI.init();
  requestAnimationFrame(loop);
  const bar = $('#loadBar');
  let done = 0;
  const step = () => { done++; bar.style.width = (done / 4) * 100 + '%'; };
  try {
    await Promise.all([Tiles.init().then(step), Data.load('kr_sido', step), Data.load('kr_sgg', step), Data.load('kr_dong', step)]);
  } catch (e) {
    $('#loading').innerHTML = `<div class="loading"><b>전쟁히어로</b>지도 데이터를 불러오지 못했습니다. 새로고침해 주세요.</div>`;
    return;
  }
  $('#loading').hidden = true;
  Start.init();
  Online.init();
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
}
if (location.hash === '#debug') window.WarHero = { G, Cam, Render, launch, UI, P, stageClear, setupStage };
boot();
})();
