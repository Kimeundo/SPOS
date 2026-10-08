import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSaju, dayGanzhiIndex, describeGanzhi, ipchun, tenGod, wallTimeToUtc, dailyRelation, nextJie,
} from '../src/index.js';

const KST = 9 * 3600000;
const kst = (d) => new Date(d.getTime() + KST).toISOString().slice(0, 16);

test('일진 기준일: 2000-01-01 무오일, 1949-10-01 갑자일', () => {
  assert.equal(describeGanzhi(dayGanzhiIndex(2000, 1, 1)).hanja, '戊午');
  assert.equal(describeGanzhi(dayGanzhiIndex(1949, 10, 1)).hanja, '甲子');
});

test('입춘 시각: 2024-02-04 17:27, 2025-02-03 23:10, 2026-02-04 05:02 (KST, 분 단위 반올림)', () => {
  const round = (d) => kst(new Date(Math.round(d.getTime() / 60000) * 60000));
  assert.equal(round(ipchun(2024)), '2024-02-04T17:27');
  assert.equal(round(ipchun(2025)), '2025-02-03T23:10');
  assert.equal(round(ipchun(2026)), '2026-02-04T05:02');
});

test('연주는 입춘에서 바뀐다', () => {
  const before = calculateSaju({ year: 2025, month: 2, day: 3, hour: 23, minute: 0, timeMode: 'clock' });
  const after = calculateSaju({ year: 2025, month: 2, day: 3, hour: 23, minute: 20, timeMode: 'clock' });
  assert.equal(before.pillars.year.hanja, '甲辰');
  assert.equal(after.pillars.year.hanja, '乙巳');
  assert.equal(before.pillars.month.hanja, '丁丑');
  assert.equal(after.pillars.month.hanja, '戊寅');
});

test('월주: 갑년 인월은 병인, 경칩 이후는 정묘', () => {
  assert.equal(calculateSaju({ year: 2024, month: 2, day: 20, hour: 12 }).pillars.month.hanja, '丙寅');
  assert.equal(calculateSaju({ year: 2024, month: 3, day: 10, hour: 12 }).pillars.month.hanja, '丁卯');
});

test('시주: 경일 자시는 병자시', () => {
  let d = new Date(Date.UTC(2024, 0, 1));
  while (dayGanzhiIndex(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) % 10 !== 6) d = new Date(d.getTime() + 86400000);
  const r = calculateSaju({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 0, minute: 30, timeMode: 'clock' });
  assert.equal(r.pillars.day.stem, 6);
  assert.equal(r.pillars.hour.hanja, '丙子');
});

test('야자시: split은 당일 일주, unified는 다음 날 일주. 시주는 같다', () => {
  const base = { year: 2024, month: 5, day: 10, hour: 23, minute: 30, timeMode: 'clock' };
  const split = calculateSaju({ ...base, zasi: 'split' });
  const unified = calculateSaju({ ...base, zasi: 'unified' });
  assert.equal(split.pillars.day.index, dayGanzhiIndex(2024, 5, 10));
  assert.equal(unified.pillars.day.index, dayGanzhiIndex(2024, 5, 11));
  assert.equal(split.pillars.hour.hanja, unified.pillars.hour.hanja);
  assert.equal(split.pillars.hour.branch, 0);
});

test('과거 시간대: 1988년 여름 서머타임(UTC+10), 1958년 UTC+8:30', () => {
  const dst = wallTimeToUtc({ year: 1988, month: 7, day: 1, hour: 12, minute: 0 }, 'Asia/Seoul');
  assert.equal(dst.offsetMinutes, 600);
  assert.equal(dst.utc.toISOString(), '1988-07-01T02:00:00.000Z');
  const old = wallTimeToUtc({ year: 1958, month: 1, day: 1, hour: 12, minute: 0 }, 'Asia/Seoul');
  assert.equal(old.offsetMinutes, 510);
  assert.equal(old.utc.toISOString(), '1958-01-01T03:30:00.000Z');
});

test('보정 모드: standard는 서머타임만 빼고, mean은 경도로 보정한다', () => {
  const input = { year: 1988, month: 7, day: 1, hour: 12, minute: 0 };
  assert.equal(calculateSaju({ ...input, timeMode: 'clock' }).time.sajuLocalTime, '1988-07-01 12:00');
  assert.equal(calculateSaju({ ...input, timeMode: 'standard' }).time.sajuLocalTime, '1988-07-01 11:00');
  // 서울 경도 126.98° → UTC+8:27.9
  assert.equal(calculateSaju({ ...input, timeMode: 'mean' }).time.sajuLocalTime, '1988-07-01 10:27');
});

test('음력 2024년 1월 1일은 양력 2024년 2월 10일', () => {
  const r = calculateSaju({ calendar: 'lunar', year: 2024, month: 1, day: 1, hour: 12 });
  assert.deepEqual(r.solarDate, { year: 2024, month: 2, day: 10 });
});

test('십신', () => {
  assert.equal(tenGod(0, 2), '식신'); // 갑 → 병
  assert.equal(tenGod(0, 3), '상관'); // 갑 → 정
  assert.equal(tenGod(0, 5), '정재'); // 갑 → 기
  assert.equal(tenGod(6, 3), '정관'); // 경 → 정
  assert.equal(tenGod(9, 6), '정인'); // 계 → 경
  assert.equal(tenGod(0, 0), '비견');
});

test('대운: 양년 남자는 순행, 첫 대운은 월주 다음 간지', () => {
  const r = calculateSaju({ year: 2024, month: 5, day: 10, hour: 12, gender: 'male' }); // 갑진년(양)
  assert.equal(r.daewoon.direction, '순행');
  assert.equal(r.daewoon.list[0].index, (r.pillars.month.index + 1) % 60);
  const f = calculateSaju({ year: 2024, month: 5, day: 10, hour: 12, gender: 'female' });
  assert.equal(f.daewoon.direction, '역행');
  assert.equal(f.daewoon.list[0].index, (r.pillars.month.index + 59) % 60);
  // 순행 대운수 = 다음 절입까지 일수 / 3
  const days = (nextJie(new Date(r.time.utc)).at - new Date(r.time.utc)) / 86400000;
  assert.ok(Math.abs(r.daewoon.startAgeExact - days / 3) < 0.01);
});

test('오행 분포는 여덟 글자 합계, 시간 모르면 여섯 글자', () => {
  const full = calculateSaju({ year: 1990, month: 8, day: 15, hour: 9 });
  assert.equal(Object.values(full.elements).reduce((a, b) => a + b, 0), 8);
  const three = calculateSaju({ year: 1990, month: 8, day: 15 });
  assert.equal(three.pillars.hour, null);
  assert.equal(Object.values(three.elements).reduce((a, b) => a + b, 0), 6);
  assert.ok(three.warnings.some((w) => w.includes('삼주')));
});

test('오늘의 운세용 일진 관계', () => {
  const r = dailyRelation(0, 2000, 1, 1); // 갑 일간, 무오일
  assert.equal(r.ganzhi.hanja, '戊午');
  assert.equal(r.stemTenGod, '편재');
});
