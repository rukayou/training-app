// リポジトリのルートがそのままWeb版(GitHub Pages)の公開ディレクトリなので、
// ネイティブ用の webDir を別に切り出す。Capacitor は webDir 以下を丸ごと
// アプリのバンドルへコピーするため、.git や node_modules を巻き込まないよう
// 必要なものだけを www/ に集める。
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');

// アプリ本体を構成するものだけ。ここに挙がっていないものはアプリに入らない。
const ENTRIES = ['index.html', 'css', 'js', 'fonts', 'icons'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of ENTRIES) {
    await cp(join(root, entry), join(out, entry), { recursive: true });
}

// sw.js は意図的にコピーしない。ネイティブ版はアプリのバンドルから直接
// 読み込むので「毎回サーバーに確認する」サービスワーカーは無意味なうえ、
// 余計なfetchの割り込みを挟むだけになる(js/app.js 側もネイティブでは
// 登録しないようにしてある)。
await writeFile(join(out, '.gitkeep'), '');

console.log(`built www/ from: ${ENTRIES.join(', ')}`);
