# 전쟁히어로 (War Hero)

실제 위성지도 위에서 **동 → 시·군·구 → 시·도 → 세계** 순서로 영토를 넓혀 가는 실시간 땅따먹기 전쟁 시뮬레이션.

## 플레이

| 단계 | 전장 | 단위 | 경쟁 세력 |
|---|---|---|---|
| 1 | 출격한 시·군·구 | 행정동 (예: 종로구 17개 동) | 같은 구의 동 자경단 |
| 2 | 소속 시·도 | 시·군·구 (예: 서울 25개 구) | 다른 구 방위군 |
| 3 | 대한민국 | 17개 시·도 | 다른 시·도 군단 |
| 4 | 세계 | 국가 183개 | 미국·중국·러시아·일본 등 12개 열강 |

- 내 영토와 맞닿은 지역(금색 점선)을 누르면 표적 카드가 열린다. 투입 병력을 정하면 승률이 실시간으로 계산된다. 같은 지역을 한 번 더 누르면 바로 공격한다.
- 섬은 해상 항로(하늘색 점선)로 연결되고, 바다를 건너는 공격은 수비 효율이 20% 높다.
- 군자금으로 공격·방어·생산을 강화하고, 정밀 폭격과 총동원령을 쓸 수 있다.
- AI 세력도 실시간으로 서로 싸우며 영토를 넓힌다. 전황 탭에 세력별 점유율, 랭킹 탭에 지휘관 순위가 나온다.
- 진행 상황은 브라우저에 자동 저장된다.

## 실행

정적 파일만 있으면 된다.

```bash
cd war-hero
python3 -m http.server 8000   # http://localhost:8000
```

### 웹사이트 공개 (GitHub Pages + Supabase 전체 랭킹)

1. [Supabase](https://supabase.com) 무료 프로젝트 생성 → SQL Editor 에 `supabase/schema.sql` 을 붙여 넣고 Run.
2. Project Settings → API 의 Project URL 과 anon public 키를 `config.js` 에 넣는다.
3. 저장소 Settings → Pages → Source 를 **GitHub Actions** 로 설정.
4. `main` 에 반영되면 `.github/workflows/war-hero-pages.yml` 이 https://kimeundo.github.io/SPOS/ 로 배포한다.

랭킹 보안: 누구나 읽을 수 있지만 쓰기는 `submit_score()` 함수로만 가능하고, 처음 등록한 브라우저의 비밀값이 맞아야 갱신된다. 플레이어별 최고 점수만 남는다. 점수 자체를 조작한 요청까지 막지는 못하므로 재미용 랭킹으로 쓴다.

Claude 아티팩트로 배포하면 `db` 기능으로 **전체 지휘관 랭킹**이 공유된다(로그인 + 기여자 이상 권한).
그 외 호스팅에서는 이 기기 기록(명예의 전당)만 표시된다.

## 구조

```
index.html        UI, 스타일
game.js           엔진: 투영, 캔버스 렌더러, 전투/경제/AI, 연출, 사운드(WebAudio 합성), 저장, 온라인 랭킹
data/*.json       TopoJSON 경계 + 라벨점·면적·육상 인접(nb)·해상 항로(sea)
tiles/*.bin       위성 타일 아틀라스 (index.json 이 z/x/y → 파일·오프셋 매핑)
tools/            데이터·타일·아티팩트 빌드 스크립트
```

### 데이터 재생성

```bash
npm i mapshaper@0.7.87 topojson-client@3.1.0
# 1) 원본 내려받기
curl -o dong.geojson https://raw.githubusercontent.com/vuski/admdongkor/master/ver20250101/HangJeongDong_ver20250101.geojson
curl -o world.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
# 2) mapshaper 로 단순화(out/kr_dong.json, kr_sgg.json, kr_sido.json, world.json) — 명령은 커밋 기록 참고
node tools/build-data.mjs ./out ./data
node tools/build-tiles.mjs ./data ./tilecache ./tiles
node tools/build-artifact.mjs ./dist/index.html
```

## 데이터 출처와 라이선스

- 위성영상: **Sentinel-2 cloudless 2016** by EOX IT Services GmbH — CC BY 4.0 (상업적 이용 가능, 출처 표기 필수).
  2017년 이후 버전은 CC BY-NC-SA(비상업)이므로 교체할 때 주의.
- 행정동 경계: 통계청 SGIS 행정동 경계(공공누리 제1유형, 출처표시) → [vuski/admdongkor](https://github.com/vuski/admdongkor) 가공본(CC BY 4.0), 2025-01-01 기준. 상업적 이용 가능, 두 출처 모두 표기 필수.
- 국가 경계: [Natural Earth](https://www.naturalearthdata.com/) 1:50m — 퍼블릭 도메인.

상용 출시 전 확인할 것: 타일 대량 다운로드가 EOX 서비스 약관에 맞는지, 고해상도가 필요하면 상용 위성 타일(예: MapTiler·Mapbox Satellite) 또는 브이월드 API 라이선스로 교체.
