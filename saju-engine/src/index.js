// 휘연당 만세력 엔진
// 사주 원국(연·월·일·시주)과 십신, 오행 분포, 충, 대운을 계산한다.
// 절기 시각은 astronomy-engine의 태양 시황경으로, 음력 변환은 한국천문연구원 데이터 기반의
// korean-lunar-calendar로, 과거 시간대(UTC+8:30, 서머타임)는 런타임의 IANA tz 데이터로 처리한다.

import * as Astronomy from 'astronomy-engine';
import KoreanLunarCalendar from 'korean-lunar-calendar';

export const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
export const STEMS_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
export const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
export const BRANCHES_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
export const ELEMENTS = ['목', '화', '토', '금', '수'];
export const ELEMENT_KEYS = ['wood', 'fire', 'earth', 'metal', 'water'];

// 지지의 오행
const BRANCH_ELEMENT = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
// 지지의 본기(정기) 천간. 십신을 지지에 붙일 때 쓴다.
const BRANCH_MAIN_STEM = [9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8];

const TEN_GODS = [
  ['비견', '겁재'],
  ['식신', '상관'],
  ['편재', '정재'],
  ['편관', '정관'],
  ['편인', '정인'],
];

const DAY_MS = 86400000;
const MIN_MS = 60000;
const IPCHUN_LONGITUDE = 315;

const mod = (n, m) => ((n % m) + m) % m;

export function stemElement(stem) {
  return Math.floor(stem / 2);
}

export function isYang(stem) {
  return stem % 2 === 0;
}

// 천간 인덱스(0~9)와 지지 인덱스(0~11)로 60갑자 인덱스(0 = 갑자)를 구한다.
export function ganzhiIndex(stem, branch) {
  if (mod(stem, 2) !== mod(branch, 2)) throw new Error('천간과 지지의 음양이 맞지 않는 조합입니다');
  return mod(6 * stem - 5 * branch, 60);
}

export function describeGanzhi(index) {
  const i = mod(index, 60);
  const stem = i % 10;
  const branch = i % 12;
  return {
    index: i,
    stem,
    branch,
    ganzhi: STEMS[stem] + BRANCHES[branch],
    hanja: STEMS_HANJA[stem] + BRANCHES_HANJA[branch],
    stemElement: ELEMENTS[stemElement(stem)],
    branchElement: ELEMENTS[BRANCH_ELEMENT[branch]],
    yinYang: isYang(stem) ? '양' : '음',
  };
}

// 일간(dayStem) 기준으로 다른 천간(otherStem)의 십신을 구한다.
export function tenGod(dayStem, otherStem) {
  const relation = mod(stemElement(otherStem) - stemElement(dayStem), 5);
  const samePolarity = dayStem % 2 === otherStem % 2;
  return TEN_GODS[relation][samePolarity ? 0 : 1];
}

export function tenGodOfBranch(dayStem, branch) {
  return tenGod(dayStem, BRANCH_MAIN_STEM[branch]);
}

// 그레고리력 날짜의 율리우스 일수(JDN)
function julianDayNumber(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

// 날짜의 일진(60갑자 인덱스). 기준: 2000-01-01 = 무오(54), 1949-10-01 = 갑자(0)
export function dayGanzhiIndex(y, m, d) {
  return mod(julianDayNumber(y, m, d) + 49, 60);
}

// 입춘 기준 연도의 세운 간지 인덱스. 1984년 = 갑자
export function yearGanzhiIndex(sajuYear) {
  return mod(sajuYear - 4, 60);
}

export function sunLongitude(date) {
  return Astronomy.SunPosition(date).elon;
}

function searchSunLongitude(longitude, start, limitDays) {
  const t = Astronomy.SearchSunLongitude(longitude, start, limitDays);
  if (!t) throw new Error(`태양황경 ${longitude}° 시각을 찾지 못했습니다`);
  return t.date;
}

// 해당 양력 연도의 입춘 시각(UTC Date)
export function ipchun(year) {
  return searchSunLongitude(IPCHUN_LONGITUDE, new Date(Date.UTC(year, 0, 1)), 60);
}

// 절(節) 12개의 태양황경: 입춘 315°부터 30°씩. 315 ≡ 15 (mod 30)
const JIE_NAMES = {
  315: '입춘', 345: '경칩', 15: '청명', 45: '입하', 75: '망종', 105: '소서',
  135: '입추', 165: '백로', 195: '한로', 225: '입동', 255: '대설', 285: '소한',
};

export function nextJie(date) {
  const lon = sunLongitude(date);
  let target = mod(15 + 30 * Math.ceil((lon - 15) / 30), 360);
  if (Math.abs(mod(target - lon, 360)) < 1e-9) target = mod(target + 30, 360);
  const at = searchSunLongitude(target, date, 40);
  return { name: JIE_NAMES[target], longitude: target, at };
}

export function previousJie(date) {
  const lon = sunLongitude(date);
  const target = mod(15 + 30 * Math.floor((lon - 15) / 30), 360);
  const at = searchSunLongitude(target, new Date(date.getTime() - 40 * DAY_MS), 40);
  return { name: JIE_NAMES[target], longitude: target, at };
}

// ---- 시간대 ----

function tzOffsetMinutes(utcMs, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

// 그 지역 벽시계 시각을 UTC로 바꾼다. 서머타임 전환 때문에 없는 시각(gap)이나
// 두 번 있는 시각(ambiguous)이면 표시해서 돌려준다.
export function wallTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const base = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = [...new Set([tzOffsetMinutes(base - 12 * 3600000, timeZone), tzOffsetMinutes(base + 12 * 3600000, timeZone)])];
  const valid = candidates
    .map((offset) => ({ offset, utc: base - offset * MIN_MS }))
    .filter((c) => tzOffsetMinutes(c.utc, timeZone) === c.offset)
    .sort((a, b) => a.utc - b.utc);
  if (valid.length === 0) {
    const offset = candidates[0];
    return { utc: new Date(base - offset * MIN_MS), offsetMinutes: offset, status: 'gap' };
  }
  return { utc: new Date(valid[0].utc), offsetMinutes: valid[0].offset, status: valid.length > 1 ? 'ambiguous' : 'ok' };
}

// 그 해의 표준시 오프셋(서머타임 제외). 1월과 7월 중 작은 값
function standardOffsetMinutes(year, timeZone) {
  return Math.min(
    tzOffsetMinutes(Date.UTC(year, 0, 15), timeZone),
    tzOffsetMinutes(Date.UTC(year, 6, 15), timeZone),
  );
}

// 균시차(분). NOAA 근사식, 오차 약 30초 이내
export function equationOfTimeMinutes(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / DAY_MS);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const g = (2 * Math.PI / 365) * (dayOfYear + (hour - 12) / 24);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
}

function lunarToSolar(year, month, day, leap) {
  const cal = new KoreanLunarCalendar();
  if (!cal.setLunarDate(year, month, day, !!leap)) {
    throw new Error('존재하지 않는 음력 날짜이거나 지원 범위(1000~2050년)를 벗어났습니다');
  }
  return cal.getSolarCalendar();
}

// ---- 원국 계산 ----

/**
 * @param {object} input
 * @param {'solar'|'lunar'} [input.calendar='solar']
 * @param {number} input.year
 * @param {number} input.month
 * @param {number} input.day
 * @param {boolean} [input.leapMonth=false] 음력 윤달 여부
 * @param {number|null} [input.hour] 0~23. 모르면 null
 * @param {number} [input.minute=0]
 * @param {'female'|'male'|null} [input.gender] 대운 방향 계산용
 * @param {string} [input.timeZone='Asia/Seoul']
 * @param {number} [input.longitude=126.98] 출생지 경도(동경 +). 기본값 서울
 * @param {'clock'|'standard'|'mean'|'apparent'} [input.timeMode='mean']
 *   clock: 입력한 벽시계 시각 그대로, standard: 서머타임만 제거,
 *   mean: 경도 기준 지방평균시, apparent: 지방평균시 + 균시차(진태양시)
 * @param {'split'|'unified'} [input.zasi='split']
 *   split: 야자시(23~24시)는 당일 일주, unified: 23시에 일주가 다음 날로 바뀜
 */
export function calculateSaju(input) {
  const {
    calendar = 'solar', leapMonth = false, hour = null, minute = 0, gender = null,
    timeZone = 'Asia/Seoul', longitude = 126.98, timeMode = 'mean', zasi = 'split',
  } = input;
  const warnings = [];

  let { year, month, day } = input;
  if (calendar === 'lunar') {
    const s = lunarToSolar(year, month, day, leapMonth);
    year = s.year; month = s.month; day = s.day;
  }

  const timeKnown = hour !== null && hour !== undefined;
  const wall = { year, month, day, hour: timeKnown ? hour : 12, minute: timeKnown ? minute : 0 };
  const conv = wallTimeToUtc(wall, timeZone);
  if (conv.status === 'gap') warnings.push('서머타임 전환으로 존재하지 않는 시각입니다. 전환 전 시간대로 계산했습니다.');
  if (conv.status === 'ambiguous') warnings.push('서머타임 해제로 같은 시각이 두 번 있었습니다. 앞선 시각(서머타임)으로 계산했습니다.');
  const utc = conv.utc;

  // 사주 계산에 쓰는 지방 시각(일주·시주 경계용)
  let sajuOffset;
  if (timeMode === 'clock') sajuOffset = conv.offsetMinutes;
  else if (timeMode === 'standard') sajuOffset = standardOffsetMinutes(year, timeZone);
  else if (timeMode === 'mean') sajuOffset = longitude * 4;
  else if (timeMode === 'apparent') sajuOffset = longitude * 4 + equationOfTimeMinutes(utc);
  else throw new Error(`알 수 없는 timeMode: ${timeMode}`);
  const local = new Date(utc.getTime() + sajuOffset * MIN_MS);
  const lY = local.getUTCFullYear(), lM = local.getUTCMonth() + 1, lD = local.getUTCDate();
  const lMinutes = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;

  // 연주: 입춘 기준
  const gYear = utc.getUTCFullYear();
  const sajuYear = utc >= ipchun(gYear) ? gYear : gYear - 1;
  const yearIdx = yearGanzhiIndex(sajuYear);
  const yearStem = yearIdx % 10;

  // 월주: 태양황경으로 절기 구간을 정한다. 0 = 인월
  const lon = sunLongitude(utc);
  const monthOrder = Math.floor(mod(lon - IPCHUN_LONGITUDE, 360) / 30);
  const monthBranch = mod(2 + monthOrder, 12);
  const monthStem = mod(yearStem * 2 + 2 + monthOrder, 10);
  const monthIdx = ganzhiIndex(monthStem, monthBranch);

  // 일주·시주
  const lateZi = timeKnown && lMinutes >= 23 * 60;
  const todayIdx = dayGanzhiIndex(lY, lM, lD);
  const dayIdx = zasi === 'unified' && lateZi ? todayIdx + 1 : todayIdx;
  const dayStem = mod(dayIdx, 10);

  let hourIdx = null;
  if (timeKnown) {
    const hourBranch = Math.floor((lMinutes + 60) / 120) % 12;
    const baseStem = mod(lateZi ? todayIdx + 1 : todayIdx, 10);
    const hourStem = mod(baseStem * 2 + hourBranch, 10);
    hourIdx = ganzhiIndex(hourStem, hourBranch);

    const toBoundary = Math.min(mod(lMinutes - 60, 120), 120 - mod(lMinutes - 60, 120));
    if (toBoundary < 10) warnings.push('시주 경계(홀수 정시)와 10분 이내입니다. 출생 시각이 조금만 달라도 시주가 바뀝니다.');
  }

  // 절입 근처 경고
  const prev = previousJie(utc);
  const next = nextJie(utc);
  const nearPrev = utc - prev.at < next.at - utc;
  const nearJieHours = (nearPrev ? utc - prev.at : next.at - utc) / 3600000;
  if (!timeKnown && nearJieHours < 24) {
    warnings.push(`출생일이 절입(${nearPrev ? prev.name : next.name}) 부근이라 출생 시각을 모르면 월주가 확정되지 않을 수 있습니다.`);
  } else if (timeKnown && nearJieHours < 2) {
    warnings.push('절입 시각과 2시간 이내입니다. 출생 시각이 정확한지 확인하세요.');
  }

  const pillars = {
    year: describeGanzhi(yearIdx),
    month: describeGanzhi(monthIdx),
    day: describeGanzhi(dayIdx),
    hour: hourIdx === null ? null : describeGanzhi(hourIdx),
  };

  // 십신
  const tenGods = {};
  for (const [key, p] of Object.entries(pillars)) {
    if (!p) continue;
    tenGods[key] = {
      stem: key === 'day' ? '일간' : tenGod(dayStem, p.stem),
      branch: tenGodOfBranch(dayStem, p.branch),
    };
  }

  // 오행 분포(천간·지지 표면 오행, 지장간 미반영)
  const elements = Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 0]));
  for (const p of Object.values(pillars)) {
    if (!p) continue;
    elements[ELEMENT_KEYS[stemElement(p.stem)]] += 1;
    elements[ELEMENT_KEYS[BRANCH_ELEMENT[p.branch]]] += 1;
  }

  // 원국 안의 지지 충
  const clashes = [];
  const keys = Object.keys(pillars).filter((k) => pillars[k]);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = pillars[keys[i]].branch, b = pillars[keys[j]].branch;
      if (mod(a - b, 12) === 6) clashes.push({ between: [keys[i], keys[j]], pair: BRANCHES[a] + BRANCHES[b] + '충' });
    }
  }

  // 대운
  let daewoon = null;
  if (gender === 'male' || gender === 'female') {
    const forward = isYang(yearStem) === (gender === 'male');
    const days = forward ? (next.at - utc) / DAY_MS : (utc - prev.at) / DAY_MS;
    const startAgeExact = days / 3; // 3일 = 1년
    const startAge = Math.max(1, Math.round(startAgeExact));
    const list = [];
    for (let k = 1; k <= 10; k++) {
      list.push({ age: startAge + (k - 1) * 10, ...describeGanzhi(monthIdx + (forward ? k : -k)) });
    }
    daewoon = { direction: forward ? '순행' : '역행', startAgeExact: Math.round(startAgeExact * 100) / 100, startAge, list };
  }

  if (!timeKnown) warnings.push('출생 시각을 몰라 시주 없이 삼주로 계산했습니다.');

  return {
    input: { ...input },
    solarDate: { year, month, day },
    time: {
      utc: utc.toISOString(),
      civilOffsetMinutes: conv.offsetMinutes,
      timeMode,
      sajuOffsetMinutes: Math.round(sajuOffset * 10) / 10,
      sajuLocalTime: local.toISOString().slice(0, 16).replace('T', ' '),
      zasi,
      timeKnown,
    },
    sajuYear,
    pillars,
    dayMaster: { stem: STEMS[dayStem], hanja: STEMS_HANJA[dayStem], element: ELEMENTS[stemElement(dayStem)], yinYang: isYang(dayStem) ? '양' : '음' },
    tenGods,
    elements,
    clashes,
    jie: {
      previous: { name: prev.name, at: prev.at.toISOString() },
      next: { name: next.name, at: next.at.toISOString() },
    },
    daewoon,
    warnings,
  };
}

// 오늘의 운세용: 특정 날짜 일진과 내 일간의 십신 관계
export function dailyRelation(dayMasterStem, year, month, day) {
  const g = describeGanzhi(dayGanzhiIndex(year, month, day));
  return { date: { year, month, day }, ganzhi: g, stemTenGod: tenGod(dayMasterStem, g.stem), branchTenGod: tenGodOfBranch(dayMasterStem, g.branch) };
}
