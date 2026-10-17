// 웹사이트용 전체 랭킹 서버(Supabase) 설정.
// Supabase 대시보드 → Project Settings → API 의 Project URL 과 anon public 키를 넣는다.
// anon 키는 브라우저에 공개되도록 만든 키라 커밋해도 된다 (쓰기는 supabase/schema.sql 의 함수로만 가능).
// 비워 두면 각 기기 기록만 저장된다.
window.WH_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
