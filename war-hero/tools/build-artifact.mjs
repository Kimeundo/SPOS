// index.html + game.js 를 하나의 아티팩트 페이지로 합친다 (doctype/head/body 래퍼 제거, 스크립트 인라인)
// 사용: node tools/build-artifact.mjs <출력 파일>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'dist', 'index.html');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
if (js.includes('</script')) throw new Error('game.js 안에 </script 문자열이 있으면 인라인할 수 없습니다');

let body = html.split('<!--ARTIFACT-START-->')[1].split('<!--ARTIFACT-END-->')[0];
body = body.replace('</head>\n<body>\n', '');
// 아티팩트는 자체 db 랭킹을 쓰므로 Supabase 설정 파일은 넣지 않는다
body = body.replace('<script src="config.js"></script>\n', '');
body = body.replace('<script src="game.js"></script>', () => `<script>\n${js}</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body.trim() + '\n');
console.log('wrote', out, (body.length / 1024).toFixed(0) + 'KB');
