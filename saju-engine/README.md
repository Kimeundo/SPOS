# 휘연당 만세력 엔진

생년월일시를 받아 사주 원국을 계산하는 엔진입니다. 계산 결과는 언어 모델이 풀이 문장을 쓸 때 입력 JSON으로 그대로 씁니다. 언어 모델이 간지를 직접 계산하지 않게 하는 것이 이 엔진의 목적입니다.

## 실행

```bash
npm install
npm test                                   # 테스트 13개
node examples/print.js 1990 8 15 9 30 female   # 연 월 일 시 분 성별 (시를 모르면 x)
```

## 사용

```js
import { calculateSaju, dailyRelation } from './src/index.js';

const r = calculateSaju({
  calendar: 'solar',      // 'lunar'이면 leapMonth로 윤달 지정
  year: 1990, month: 8, day: 15,
  hour: 9, minute: 30,    // 모르면 hour: null → 삼주 계산
  gender: 'female',       // 대운 방향 계산용. 없으면 대운 생략
  timeZone: 'Asia/Seoul',
  longitude: 126.98,      // 출생지 경도
  timeMode: 'mean',       // clock | standard | mean | apparent
  zasi: 'split',          // split(야자시) | unified(23시에 날짜 변경)
});

r.pillars        // 연·월·일·시주 (index, ganzhi, hanja, 오행, 음양)
r.dayMaster      // 일간
r.tenGods        // 각 기둥 천간·지지(본기)의 십신
r.elements       // 오행 개수 (여덟 글자 표면 기준)
r.clashes        // 원국 안의 지지 충
r.daewoon        // 방향, 대운수, 10개 대운
r.warnings       // 시주 경계, 절입 부근, 서머타임 전환 경고

dailyRelation(dayStem, 2026, 10, 8) // 오늘 일진과 내 일간의 십신 관계 (오늘의 운세용)
```

## 계산 기준

| 항목 | 기준 |
|---|---|
| 연주 | 입춘(태양황경 315°) 시각 기준 |
| 월주 | 12절(입춘, 경칩, 청명 …) 절입 시각 기준. 월간은 연간으로 정함(갑기년 병인월 시작) |
| 일주 | 율리우스 일수. 2000-01-01 무오일, 1949-10-01 갑자일로 검증 |
| 시주 | 홀수 정시 경계(23~01시 자시). 시간은 일간으로 정함(갑기일 갑자시 시작) |
| 절기 시각 | `astronomy-engine`의 태양 시황경. 2024·2025·2026 입춘이 공표 시각(17:27, 23:10, 05:02)과 분 단위로 일치 |
| 음력 변환 | `korean-lunar-calendar` (한국천문연구원 데이터 기반, 1000~2050년) |
| 과거 시간대 | 런타임 IANA tz 데이터(Asia/Seoul). 1954~1961년 UTC+8:30, 1948~1951·1955~1960·1987~1988년 서머타임 반영 |
| 대운수 | 절입까지 일수 ÷ 3, 반올림 (정밀값은 `startAgeExact`) |

### timeMode (일주·시주 경계에 쓰는 시각)

- `clock`: 입력한 벽시계 시각 그대로
- `standard`: 서머타임만 뺀 표준시
- `mean` (기본값): 출생지 경도로 계산한 지방평균시. 서울은 표준시보다 약 32분 늦음
- `apparent`: 지방평균시에 균시차를 더한 진태양시 (근사식, 오차 약 30초)

연주와 월주는 절입이라는 절대 시각과 비교하므로 timeMode의 영향을 받지 않습니다.

### zasi (23~24시 출생)

- `split` (기본값): 일주는 당일, 시주는 다음 날 일간 기준 자시
- `unified`: 23시에 일주가 다음 날로 바뀜

두 방식은 일주만 다르고 시주는 같습니다.

## 아직 정하지 않은 것

- timeMode, zasi 기본값은 서비스 정책으로 확정해야 합니다 (기획서 「결정할 것」 참고).
- 지장간은 본기만 씁니다. 여기·중기까지 쓸지는 학파별 차이가 있어 보류했습니다.
- 신살(도화, 역마 등)은 판단 기준(연지 또는 일지 기준 삼합)을 정한 뒤 추가합니다.
- 대운수 반올림 방식(반올림, 버림)은 사용하는 만세력에 맞춰 조정할 수 있습니다.
