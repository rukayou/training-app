// 役割は2つ。
//
// (1) ServiceWorkerRegistration.showNotification() を使えるようにする
//     (レストタイマーのバックグラウンド通知バナー / js/app.js)。
//
// (2) 「更新が届かない」問題への対処。ホーム画面に追加した状態
//     (スタンドアロン)ではアドレスバーが無く、Safariのキャッシュに
//     居座られると手動リロードの逃げ道がほとんど無い。そこで同一
//     オリジンのGETは必ずサーバーに問い合わせる(cache: 'no-cache')
//     ようにして、起動のたびに最新版が来るようにする。
//
// キャッシュは「オフライン時の最後の手段」としてだけ持つ。オンラインなら
// 毎回ネットワークの結果で上書きするので、古い内容が残り続けることはない
// - これが「offline caching は careful な cache-invalidation story が要る」
// という以前のコメントに対する答えで、無効化の手順そのものを無くしている。
const CACHE_NAME = 'training-app-offline-fallback-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 旧名のキャッシュが残っていたら掃除しておく。
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

// ページ側の「最新の状態に更新」から、待機中の新しいワーカーを
// 即座に有効化させるための口。
self.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Google Fonts などの外部リソースには一切触らない。
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        // ナビゲーション要求は mode: 'navigate' のまま作り直せないため、
        // URLから組み立て直す。
        const fresh = request.mode === 'navigate'
            ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })
            : new Request(request, { cache: 'no-cache' });

        try {
            // no-cache は「キャッシュがあっても必ずサーバーに確認する」。
            // 変更が無ければ304が返り本文は流れないので、毎回全部
            // ダウンロードし直すことにはならない。
            const response = await fetch(fresh);
            if (response && response.ok) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(url.href, response.clone());
            }
            return response;
        } catch (e) {
            // ここに来るのは基本オフラインの時だけ。
            const cached = await caches.match(url.href);
            if (cached) return cached;
            throw e;
        }
    })());
});
