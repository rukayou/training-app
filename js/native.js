// Capacitor でネイティブアプリとして動いているときだけ有効になる薄いブリッジ。
// ブラウザで開いたときは isNative が false になり、全ての関数が安全に
// 何もしないので、Web版とネイティブ版で js/app.js を共通のまま使える。
//
// バンドラは使っていない。Capacitor のネイティブ実行時はブリッジが
// window.Capacitor.Plugins に各プラグインを生やすので、npm パッケージを
// import せずそのまま呼べる(この構成ではビルド手順を増やさないのが大事)。
(function () {
    'use strict';

    const cap = window.Capacitor;
    const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    const plugins = (cap && cap.Plugins) || {};
    const LocalNotifications = plugins.LocalNotifications;
    const Haptics = plugins.Haptics;

    // レスト終了の通知は常に1件だけ。付け替えのたびに同じIDで上書きする。
    const REST_NOTIFICATION_ID = 1001;

    let permissionPromise = null;

    // 権限の確認は「初めてレストを開始した時」に走る。起動直後に訊くと、
    // 何のための通知か分からないまま拒否されやすい。
    async function ensureNotificationPermission() {
        if (!isNative || !LocalNotifications) return false;
        if (!permissionPromise) {
            permissionPromise = (async () => {
                try {
                    const current = await LocalNotifications.checkPermissions();
                    if (current.display === 'granted') return true;
                    if (current.display === 'denied') return false;
                    const asked = await LocalNotifications.requestPermissions();
                    return asked.display === 'granted';
                } catch (e) {
                    console.error('通知の権限確認に失敗:', e);
                    return false;
                }
            })();
        }
        return permissionPromise;
    }

    // レスト終了時刻をOSに preddicate として渡しておく。これが本命の
    // ネイティブ機能で、アプリを閉じていても・バックグラウンドでも・
    // サイレントスイッチが入っていても、確実に終了を知らせられる
    // (Web版はアプリが前面に居ないと鳴らないことがあった)。
    async function scheduleRestAlarm(endTimestamp) {
        if (!isNative || !LocalNotifications) return;
        if (!(await ensureNotificationPermission())) return;
        const at = new Date(endTimestamp);
        if (at.getTime() <= Date.now()) return;
        try {
            await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
            await LocalNotifications.schedule({
                notifications: [{
                    id: REST_NOTIFICATION_ID,
                    title: 'レスト終了',
                    body: '次のセットを始めよう',
                    schedule: { at, allowWhileIdle: true },
                    sound: 'default',
                }],
            });
        } catch (e) {
            console.error('レスト通知の予約に失敗:', e);
        }
    }

    // 停止・中止・±15秒の付け替え・記録の保存など、予約が実態と合わなく
    // なる場面では必ず消す。放っておくと終わったはずのレストが後から鳴る。
    async function cancelRestAlarm() {
        if (!isNative || !LocalNotifications) return;
        try {
            await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
        } catch (e) {
            // 予約が無い状態で消そうとした場合もここに来る。実害は無い。
        }
    }

    // iOS Safari は navigator.vibrate に対応していないので、Web版では
    // 振動が一切鳴っていなかった。ネイティブなら触覚フィードバックを出せる。
    function impact(style) {
        if (!isNative || !Haptics) return;
        try {
            Haptics.impact({ style: style || 'MEDIUM' });
        } catch (e) {
            // ignore
        }
    }

    function notificationFeedback() {
        if (!isNative || !Haptics) return;
        try {
            Haptics.notification({ type: 'SUCCESS' });
        } catch (e) {
            // ignore
        }
    }

    window.NativeBridge = {
        isNative,
        ensureNotificationPermission,
        scheduleRestAlarm,
        cancelRestAlarm,
        impact,
        notificationFeedback,
    };
})();
