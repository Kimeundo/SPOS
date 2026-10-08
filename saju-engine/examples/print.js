// 사용 예: node examples/print.js 1990 8 15 9 30 female
import { calculateSaju } from '../src/index.js';

const [year, month, day, hour, minute, gender] = process.argv.slice(2);
const result = calculateSaju({
  year: Number(year ?? 1990),
  month: Number(month ?? 8),
  day: Number(day ?? 15),
  hour: hour === undefined || hour === 'x' ? null : Number(hour),
  minute: Number(minute ?? 0),
  gender: gender ?? 'female',
});

const { pillars: p } = result;
const cell = (x) => (x ? x.hanja : '??');
console.log(`시  일  월  연`);
console.log(`${cell(p.hour)}  ${cell(p.day)}  ${cell(p.month)}  ${cell(p.year)}`);
console.log(`일간: ${result.dayMaster.hanja} (${result.dayMaster.yinYang}${result.dayMaster.element})`);
console.log('오행:', result.elements);
console.log('십신:', result.tenGods);
if (result.daewoon) console.log(`대운: ${result.daewoon.direction}, ${result.daewoon.startAge}세 시작 →`, result.daewoon.list.map((d) => `${d.age}${d.hanja}`).join(' '));
console.log('사주 기준 시각:', result.time.sajuLocalTime, `(${result.time.timeMode})`);
for (const w of result.warnings) console.log('주의:', w);
