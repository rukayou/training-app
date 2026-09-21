// 筋トレ記録 - 単独ローカルアプリ版。
// AICreate(ふたりの伝言板)の training.js をベースに、Firebase/ふたり概念を
// 全て取り除き、ブラウザの localStorage だけで完結するように書き換えたもの。
// ES modules は file:// 起源からだとブロックされるブラウザがあるため、
// このファイル1本を <script>(type="module"なし)として読み込む前提。

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 装飾専用のインラインSVGアイコン。外部ファイルを増やさずに済み、strokeが
// currentColor なので置いた場所の文字色にそのまま追従する(テーマ側で色を
// 決められる)。全て aria-hidden なので、読み上げは元々のテキストラベル
// (「開始」「削除」など)や aria-label がそのまま担当する。
const ICONS = {
    dumbbell: '<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    flame: '<path d="M12 3s5 4 5 8a5 5 0 0 1-10 0c0-1.5.7-2.8 1.5-3.7C9 8.8 9.5 10 10.5 10 10.5 7 12 5 12 3Z"/>',
    layers: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4.5 12.5 7.5 4.2 7.5-4.2"/>',
    repeat: '<path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H17"/><path d="m14.5 2.5 3 2.5-3 2.5"/><path d="M20 15v1.5a2.5 2.5 0 0 1-2.5 2.5H7"/><path d="m9.5 21.5-3-2.5 3-2.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>',
    chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7"/>',
    grip: '<path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01" stroke-width="2.6"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke-linejoin="round"/>',
    flag: '<path d="M5.5 21V4M5.5 5h11l-2 3.5 2 3.5h-11"/>',
    chart: '<path d="M4 19.5h16"/><path d="m5 15 4.5-5 3.5 3 5.5-7"/>',
    arrowUp: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
    arrowDown: '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
    close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    bell: '<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
};

function icon(name, cls = '') {
    const body = ICONS[name];
    if (!body) return '';
    return `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// A quick, self-dismissing confirmation (e.g. after saving a routine or
// finishing a workout) - unlike a full notification, nobody needs to read
// or act on it, so it fades out on its own after ~1.5s rather than sticking
// around waiting to be dismissed.
function showQuickToast(text) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-quick';
    toast.textContent = text;
    container.appendChild(toast);
    toast.addEventListener('animationend', (e) => {
        if (e.animationName === 'toast-fade-out') toast.remove();
    });
}

// Pure, dependency-free chart drawing - no DOM references.
// points: { date: string ("YYYY-MM-DD"), value: number }[], already sorted
// oldest-first.
function buildTrendSvgMarkup(points) {
    if (points.length < 2) {
        // A single point has no trend to draw.
        return '<p class="training-chart-empty">まだ十分な記録がありません。もう少し続けるとグラフが出ます。</p>';
    }

    const width = 320;
    const height = 200;
    const padding = { top: 28, right: 14, bottom: 30, left: 14 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const values = points.map((p) => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    // A flat trend (every session identical) would divide by zero below;
    // give it a synthetic range so the line still draws as a flat middle
    // line instead of crashing or collapsing to a single y value off-screen.
    const range = maxV - minV || 1;

    const stepX = plotW / (points.length - 1);
    const xAt = (i) => padding.left + i * stepX;
    const yAt = (v) => padding.top + plotH - ((v - minV) / range) * plotH;

    const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`);

    // Every point's date only really fits if there aren't too many of them
    // (this is a phone-width card) - thin out to every other/third label
    // once it'd get crowded, always keeping the very first and last so the
    // full span of the trend is still readable end to end.
    const dateLabelStride = points.length <= 6 ? 1 : points.length <= 9 ? 2 : 3;
    const shouldLabelDate = (i) => i === 0 || i === points.length - 1 || i % dateLabelStride === 0;

    const formatDate = (isoDate) => {
        const [, m, d] = isoDate.split('-');
        return `${Number(m)}/${Number(d)}`;
    };
    const formatValue = (v) => (Number.isInteger(v) ? `${v}` : v.toFixed(1));

    // 折れ線の下を塗るためのパス - 線と同じ座標をたどってから、
    // プロット領域の底辺まで降ろして閉じる。
    const areaPath = `M${coords[0]} L${coords.slice(1).join(' L')} L${xAt(points.length - 1).toFixed(1)},${(height - padding.bottom).toFixed(1)} L${xAt(0).toFixed(1)},${(height - padding.bottom).toFixed(1)} Z`;

    const circles = points.map((p, i) => {
        const [x, y] = coords[i].split(',');
        // Alternate the value label above/below the line itself so two
        // consecutive close-together points don't overlap their text.
        const labelY = i % 2 === 0 ? Number(y) - 10 : Number(y) + 18;
        // 最新の点だけ少し大きく・白フチを強めて「今ここ」を目立たせる。
        const isLatest = i === points.length - 1;
        return `
            <circle cx="${x}" cy="${y}" r="${isLatest ? 5 : 3.5}" class="training-chart-point${isLatest ? ' is-latest' : ''}" />
            <text x="${x}" y="${labelY}" class="training-chart-point-label" text-anchor="middle">${formatValue(p.value)}</text>
            ${shouldLabelDate(i) ? `<text x="${x}" y="${height - 8}" class="training-chart-date-label" text-anchor="middle">${formatDate(p.date)}</text>` : ''}
        `;
    }).join('');

    const latest = points[points.length - 1].value;
    const previous = points.length > 1 ? points[points.length - 2].value : null;
    const delta = previous !== null ? latest - previous : null;
    const deltaText = delta === null || delta === 0
        ? ''
        : delta > 0
            ? ` <span class="training-chart-delta-up">${icon('arrowUp')}${formatValue(delta)}</span>`
            : ` <span class="training-chart-delta-down">${icon('arrowDown')}${formatValue(Math.abs(delta))}</span>`;

    return `
        <p class="training-chart-summary">
            <span class="training-chart-summary-label">最新</span>
            <strong class="training-chart-summary-value">${formatValue(latest)}<span class="training-chart-summary-unit">kg</span></strong>${deltaText}
        </p>
        <svg class="training-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="成長トレンド、最新${formatValue(latest)}キログラム">
            <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
                    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
            </defs>
            <text x="${padding.left}" y="14" class="training-chart-range-label">${formatValue(maxV)}kg</text>
            <text x="${padding.left}" y="${height - padding.bottom + 14}" class="training-chart-range-label">${formatValue(minV)}kg</text>
            <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" class="training-chart-gridline" />
            <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="training-chart-gridline" />
            <path d="${areaPath}" class="training-chart-area" />
            <polyline points="${coords.join(' ')}" class="training-chart-line" />
            ${circles}
        </svg>
    `;
}

// Duplicated deliberately, not shared - this project's established
// convention (see the source AICreate app) is that files needing JST date
// math each carry their own well-tested copy rather than share one. Never
// the `sv-SE` locale trick: that silently produces locale-dependent output
// on some devices.
function jstDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const at = (type) => parts.find((p) => p.type === type)?.value;
    return `${at('year')}-${at('month')}-${at('day')}`;
}

// Whole JST calendar days between two "YYYY-MM-DD" strings, not elapsed
// milliseconds - a 23:00 session read again close to 96 hours later must
// not slip under the threshold just because a few hours are left. Comparing
// date-only values forces day-boundary math.
function jstDaysBetween(fromDateStr, toDateStr) {
    const [fy, fm, fd] = fromDateStr.split('-').map(Number);
    const [ty, tm, td] = toDateStr.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// The 7 "YYYY-MM-DD" strings for the current JST week (Sun-Sat) containing
// todayStr. Built entirely from date-string arithmetic (like jstDaysBetween
// above) rather than a raw `new Date(todayStr)` - that would parse in the
// browser's local timezone, not JST, and silently pick the wrong week near
// a JST day boundary.
function jstWeekDates(todayStr) {
    const [y, m, d] = todayStr.split('-').map(Number);
    const todayUtcMs = Date.UTC(y, m - 1, d);
    const weekday = new Date(todayUtcMs).getUTCDay(); // 0 = Sunday
    return Array.from({ length: 7 }, (_, i) => {
        const dt = new Date(todayUtcMs + (i - weekday) * 86400000);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    });
}

const DEFAULT_REST_SECONDS = 90;
const REST_ADJUST_SECONDS = 15;
const ALARM_REPEAT_MS = 1200;

const STATE_DEFAULTS = { total_workout_count: 0, last_workout_date: null, alert_threshold_days: 4, rest_seconds: DEFAULT_REST_SECONDS };

// --- localStorage data layer (replaces Firestore) ---
// Single-user, single-device: no personKey/userHash namespacing, just three
// fixed keys. training_routines is a plain array (index i = day i+1), so
// its own length IS the day count - no separate split_count field to keep
// in sync, and no "leftover doc" cleanup on save (the array replace IS the
// cleanup).
const LS_STATE_KEY = 'training_state';
const LS_ROUTINES_KEY = 'training_routines';
const LS_LOGS_KEY = 'training_logs';

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}
function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function loadState() {
    return { ...STATE_DEFAULTS, ...readJSON(LS_STATE_KEY, {}) };
}
function saveState(partial) {
    const merged = { ...loadState(), ...partial };
    writeJSON(LS_STATE_KEY, merged);
    return merged;
}
// Old-format exercises (default_weight/target_reps/target_sets, identical
// across every set) migrate to the new per-set sets:[{weight,reps}] shape
// lazily, right here on read - no one-time migration script. The next save
// (routine editor or a PB bump) always writes the new shape, so in practice
// a routine only ever passes through this branch once.
function normalizeExerciseSets(ex) {
    if (Array.isArray(ex.sets)) return ex;
    const weight = ex.default_weight ?? 0;
    const reps = ex.target_reps ?? 8;
    const count = ex.target_sets ?? 1;
    return { name: ex.name, sets: Array.from({ length: count }, () => ({ weight, reps })) };
}

function loadRoutines() {
    return readJSON(LS_ROUTINES_KEY, []).map((day) => ({
        ...day,
        exercises: day.exercises.map(normalizeExerciseSets),
    }));
}
function saveRoutines(days) {
    writeJSON(LS_ROUTINES_KEY, days.map((d) => ({
        label: d.label,
        exercises: d.exercises.map(({ name, sets }) =>
            ({ name, sets: sets.map(({ weight, reps }) => ({ weight, reps })) })), // 一時フィールドexpandedを除外
    })));
}
function updateRoutineDayExercises(day, exercises) {
    const routines = loadRoutines();
    routines[day - 1] = { ...routines[day - 1], exercises };
    saveRoutines(routines);
}
function loadLogs() {
    return readJSON(LS_LOGS_KEY, []).sort((a, b) => a.date.localeCompare(b.date));
}
function appendLog(entry) {
    const logs = readJSON(LS_LOGS_KEY, []);
    logs.push(entry);
    writeJSON(LS_LOGS_KEY, logs);
}

// Keyed by exercise index. Holds the setInterval id plus enough state to
// re-render the countdown - never trust DOM survival for this, since both
// "閉じる" and the post-save loadTraining() re-render wipe/replace the DOM
// these timers live in without knowing a JS interval is still ticking
// underneath. Once a rest hits zero, the same map entry switches over to
// holding the *alarm* repeat interval (see enterAlarmState) - either way,
// stopAllRestTimers()/stopRestTimer() only ever need to clear whatever
// intervalId is currently stored, never caring which phase it's in.
//
// This map only ever holds *live* JS interval state - it is NOT the source
// of truth for "is a rest running and when does it end". That's
// localStorage (see persistRestTimer() etc. below), so a rest survives a
// save-triggered loadTraining() re-render and, more importantly, closing
// the app entirely and reopening it later: the deadline is a wall-clock
// timestamp, not a tick count, so whatever real time passed while the JS
// wasn't running is accounted for correctly the moment the page runs again.
const restTimers = new Map();

const REST_TIMER_STORAGE_KEY = 'training_rest_timer';
const REST_STOP_STORAGE_KEY = 'training_rest_stop';

function loadPersistedRestTimers() {
    try {
        return JSON.parse(localStorage.getItem(REST_TIMER_STORAGE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function persistRestTimer(exIndex, endTimestamp) {
    try {
        const all = loadPersistedRestTimers();
        all[exIndex] = endTimestamp;
        localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
        // localStorage can throw (private browsing quota, etc.) - a rest
        // timer that doesn't survive a reload in that case is a minor
        // degradation, not worth surfacing to the user.
    }
}

function clearPersistedRestTimer(exIndex) {
    try {
        const all = loadPersistedRestTimers();
        delete all[exIndex];
        localStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
        // ignore
    }
}

// Exercise indices are only meaningful within one day's routine - "保存する"
// finishes the current session and rolls over to the next day's (different)
// exercise list, so any rest deadline still sitting in storage would
// otherwise get misread as belonging to whatever exercise now has that same
// index on the new day.
function clearAllPersistedRestTimers() {
    try {
        localStorage.removeItem(REST_TIMER_STORAGE_KEY);
    } catch (e) {
        // ignore
    }
}

// The overall "今日のトレーニング" card's session timer - separate from the
// per-exercise rest timers above, and only ever one at a time (unlike
// restTimers, which is keyed per exercise). Same wall-clock-timestamp
// philosophy: a mid-session reload must not lose elapsed time, so the
// source of truth is the absolute start timestamp in localStorage, not a
// running JS interval alone.
const ACTIVE_SESSION_STORAGE_KEY = 'training_active_session';

function loadActiveSession() {
    try {
        return JSON.parse(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) || 'null');
    } catch (e) {
        return null;
    }
}

function startActiveSession() {
    try {
        localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify({ startedAt: Date.now() }));
    } catch (e) {
        // ignore - a session timer that doesn't survive a reload in that
        // case is a minor degradation, not worth surfacing to the user.
    }
}

function clearActiveSession() {
    try {
        localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    } catch (e) {
        // ignore
    }
}

// A second, dedicated tab/window open on the same device ends up with its
// OWN independent countdown, in its OWN script instance - restTimers in
// that tab has never heard of this one. If both reach zero (each computes
// from the same wall-clock deadline, so they will, within moments of each
// other) both start ringing independently, and pressing "停止" in one only
// ever touched that tab's own Map entry.
//
// This can't be solved by watching training_rest_timer (the deadline key)
// for changes: every tab's own reachZero() already clears that key the
// moment IT rings, so by the time a human actually presses 停止, the key
// may already be absent with nothing left to change - no storage event
// fires from a value that isn't different. A dedicated key instead, written
// fresh (with a timestamp, so the value always changes) by every explicit
// stop, sidesteps both problems - it only ever means "a human just stopped
// this," never anything a normal countdown does on its own.
function broadcastRestStop(exIndex) {
    try {
        localStorage.setItem(REST_STOP_STORAGE_KEY, JSON.stringify({ exIndex, at: Date.now() }));
    } catch (e) {
        // ignore
    }
}

// The `storage` event fires in every OTHER same-origin tab/window when one
// of them writes to localStorage - never in the tab that made the change -
// so this is what makes broadcastRestStop() actually reach those other tabs.
window.addEventListener('storage', (event) => {
    if (event.key !== REST_STOP_STORAGE_KEY || !event.newValue) return;
    let payload;
    try {
        payload = JSON.parse(event.newValue);
    } catch (e) {
        return;
    }
    const exIndex = payload.exIndex;
    const timer = restTimers.get(exIndex);
    if (timer) {
        clearInterval(timer.intervalId);
        restTimers.delete(exIndex);
    }
    const actionsEl = document
        .getElementById('trainingCard')
        ?.querySelector(`.training-exercise-block[data-ex="${exIndex}"] .training-exercise-actions`);
    const liveTimerEl = actionsEl?.querySelector(
        `.training-rest-timer[data-ex="${exIndex}"], .training-rest-alarm[data-ex="${exIndex}"]`
    );
    if (liveTimerEl) liveTimerEl.outerHTML = restStartButtonHtml(exIndex);
    syncCardAlarmClass();
});

// One shared AudioContext, resumed on the "レスト開始" click (a real user
// gesture) rather than created inside the interval callback that fires ~90s
// later - browsers only unlock autoplay within a gesture's call stack.
// That alone wasn't enough in practice: some browsers auto-suspend an idle
// AudioContext again after enough silent seconds pass, which is exactly
// what a 90s rest is, so playBeep() below re-resumes it on every play
// rather than trusting the once-on-click unlock to still hold 90s later.
let audioCtx = null;

// iOS Safari mutes plain <audio>/Web Audio output ("ambient" audio session)
// while the hardware silent switch is on, but treats a <video> element's
// audio as media playback and lets it through regardless - this is documented
// WebKit behavior, not a permission-requiring hack. Routing the oscillators
// into #restAlarmAudioSink via a MediaStreamAudioDestinationNode instead of
// straight to audioCtx.destination gets the beep past silent mode on iOS,
// and is standard enough (plain MediaStream + <video>.srcObject) to work
// identically on Android/desktop too.
let mediaStreamDest = null;

// Called on the app's very first tap/click anywhere, not just the "レスト
// 開始" button - resumePersistedRestTimers() can enter the alarm state
// automatically on page load (catching up after the app was closed through
// a rest), before any gesture has happened, so that first playBeep()/
// showRestBanner() attempt is likely to be silently blocked by autoplay
// rules. The alarm keeps ringing every ALARM_REPEAT_MS regardless, so
// unlocking on the next tap - whatever it's for - lets the very next tick
// actually make noise.
function unlockAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        if (!mediaStreamDest) {
            mediaStreamDest = audioCtx.createMediaStreamDestination();
            const sink = document.getElementById('restAlarmAudioSink');
            if (sink) sink.srcObject = mediaStreamDest.stream;
        }
        // Re-attempted on every unlock, not just the first time the pipeline
        // is built - the OS itself can pause a backgrounded <video> (screen
        // lock, app switch), and this is the only place with a guaranteed
        // user gesture to resume it from.
        const sink = document.getElementById('restAlarmAudioSink');
        if (sink && sink.paused) sink.play().catch(() => {});
    } catch (e) {
        console.error('Rest timer audio unlock failed:', e);
    }

    // Local (non-push) notification permission - see enterAlarmState() for
    // where it's actually used. Asked once, here, alongside the audio
    // unlock since both need a real user gesture and this is the one place
    // that's guaranteed to have one.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

function playBeep() {
    if (!audioCtx || !mediaStreamDest) return;
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        [0, 0.25].forEach((startOffset) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(mediaStreamDest);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime + startOffset);
            osc.start(audioCtx.currentTime + startOffset);
            osc.stop(audioCtx.currentTime + startOffset + 0.15);
        });
    } catch (e) {
        console.error('Rest timer beep failed:', e);
    }
}

// Unconditional, maximally forceful mute - called from every real stop
// path. Closing the AudioContext itself is specified to release the entire
// audio processing graph and its underlying system audio resources in one
// step, regardless of what's still attached to it. unlockAudio()'s existing
// "create if missing" logic (called at the top of every startRestTimer(),
// i.e. on every subsequent real "レスト開始" tap - always a user gesture)
// rebuilds a fresh context and re-attaches a fresh stream to the sink from
// nothing, so there's no separate rebuild path to maintain here.
function teardownAudioPipeline() {
    if (audioCtx) {
        try { audioCtx.close(); } catch (e) { /* already closed */ }
    }
    audioCtx = null;
    mediaStreamDest = null;
    const sink = document.getElementById('restAlarmAudioSink');
    if (sink) {
        try {
            sink.pause();
            sink.srcObject = null;
        } catch (e) { /* ignore */ }
    }
}

// NOTE on iOS: Safari/WebKit has never implemented the Vibration API on
// iOS, in any browser - navigator.vibrate simply doesn't exist there, so
// this call is always a no-op on iPhone. Kept unconditional since it's a
// real, working alert on Android/desktop and harmless everywhere else.
function vibrateAlert() {
    try {
        navigator.vibrate?.(500);
    } catch (e) {
        // ignore
    }
}

function alertTick() {
    playBeep();
    vibrateAlert();
}

// Local notification (not real push - see unlockAudio() for where the
// permission was requested). ServiceWorkerRegistration.showNotification()
// works without a remote push server: the registration just needs to
// exist (registered below) and permission needs to be granted. Note: this
// silently no-ops over file:// (no secure context, service workers can't
// register there at all) - sound/vibration/the in-page alarm still work
// fine either way.
async function showRestBanner() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification('⏰ レスト終了！', {
            body: '次のセットを始めよう',
            tag: 'training-rest-alarm',
        });
    } catch (e) {
        console.error('Rest timer notification failed:', e);
    }
}

function formatRestTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ボタンの数・並び・役割は据え置き。末尾の進捗バーだけが新しい装飾要素で、
// カウントダウンを書き換えるのと同じ場所(startRestTimerのrender)で幅を
// 更新する - タイマーのロジック自体には手を入れていない。
function restTimerHtml(exIndex, remainingSeconds) {
    return `
        <div class="training-rest-timer" data-ex="${exIndex}">
            <button type="button" class="action-btn training-rest-adjust" data-action="ex-rest-minus" data-ex="${exIndex}">-15秒</button>
            <span class="training-rest-remaining">残り ${formatRestTime(remainingSeconds)}</span>
            <button type="button" class="action-btn training-rest-adjust" data-action="ex-rest-plus" data-ex="${exIndex}">+15秒</button>
            <button type="button" class="action-btn training-rest-cancel" data-action="ex-rest-cancel" data-ex="${exIndex}" aria-label="レストを中止">${icon('close')}</button>
            <span class="training-rest-progress"><span class="training-rest-progress-fill" style="width:100%"></span></span>
        </div>
    `;
}

function restAlarmHtml(exIndex) {
    return `
        <div class="training-rest-alarm" data-ex="${exIndex}">
            <span class="training-rest-alarm-label">${icon('bell')} レスト終了！</span>
            <button type="button" class="action-btn training-rest-stop" data-action="ex-rest-stop" data-ex="${exIndex}">停止</button>
        </div>
    `;
}

function restStartButtonHtml(exIndex) {
    return `<button type="button" class="action-btn training-rest-btn" data-action="ex-rest-start" data-ex="${exIndex}">レスト開始</button>`;
}

// Shared by the "開始" click handler and resumePersistedRestTimers() (an
// exercise with a rest already running needs to come back up expanded, not
// collapsed, when the app reopens). Returns the actions element so the
// caller can immediately hand it to startRestTimer().
function expandExerciseBlock(block, exIndex, exercise) {
    const header = block.querySelector('.training-exercise-header');
    const actions = header.querySelector('.training-exercise-actions');
    const badge = header.querySelector('.training-exercise-done-badge');
    const body = block.querySelector('.training-exercise-body');

    block.dataset.status = 'expanded';
    body.innerHTML = exerciseSetRowsHtml(exercise, exIndex);
    // Swapped for a way back rather than hidden outright - "開始" with no
    // undo was the exact complaint this fixes. 完了 moves here too (see
    // exerciseActionsHtml) - it only makes sense once the exercise is
    // actually open.
    actions.innerHTML = `
        <button type="button" class="action-btn training-complete-btn" data-action="ex-complete" data-ex="${exIndex}">完了</button>
        <button type="button" class="action-btn training-collapse-btn" data-action="ex-collapse" data-ex="${exIndex}">閉じる</button>
        ${restStartButtonHtml(exIndex)}
    `;
    badge.classList.add('hidden');
    return actions;
}

// Called once per loadTraining() render, after the card and its click
// handlers exist - resumes any rest that was still counting down (or
// already ringing) the last time this app ran, however long ago that was.
// This is what makes "close the app mid-rest, reopen it later" behave
// correctly: the deadline survived in localStorage as a wall-clock
// timestamp, so startRestTimer() below just recomputes from it.
function resumePersistedRestTimers(form, routineExercises) {
    const persisted = loadPersistedRestTimers();
    routineExercises.forEach((exercise, exIndex) => {
        const endTimestamp = persisted[exIndex];
        if (endTimestamp === undefined) return;
        const block = form.querySelector(`.training-exercise-block[data-ex="${exIndex}"]`);
        if (!block) return;
        const actions = expandExerciseBlock(block, exIndex, exercise);
        startRestTimer(exIndex, actions, endTimestamp);
    });
}

// A single "レスト終了" badge is easy to miss, especially on iOS where
// vibration never works (see vibrateAlert()) and the notification banner
// only fires reliably while the page's JS is still alive - not guaranteed
// once the app is fully backgrounded/screen-locked. Flashing the whole card
// is the one alert channel with no such caveats, as long as the screen is
// on and the page is in view.
function syncCardAlarmClass() {
    const anyAlarming = [...restTimers.values()].some((t) => t.phase === 'alarm');
    const cardEl = document.getElementById('trainingCard');
    if (cardEl) cardEl.classList.toggle('rest-alarming', anyAlarming);
}

// Interval-only cleanup - deliberately does not touch localStorage. This
// runs on every loadTraining() re-render (a save just happened, or the app
// was reopened) as well as on genuine cancellation, and only the latter
// should forget the user's rest. Call sites that mean "the user is
// discarding this rest" (✕, 停止, 閉じる) clear the persisted entry
// themselves right alongside calling this.
function stopRestTimer(exIndex) {
    const timer = restTimers.get(exIndex);
    if (!timer) return;
    clearInterval(timer.intervalId);
    restTimers.delete(exIndex);
    syncCardAlarmClass();
}

function stopAllRestTimers() {
    teardownAudioPipeline();
    restTimers.forEach((timer) => clearInterval(timer.intervalId));
    restTimers.clear();
    syncCardAlarmClass();
}

// The overall session timer's live JS interval - only ever one at a time
// (unlike restTimers' per-exercise Map), ticking the トレーニング時間
// metric while a workout is in progress. Interval-only, like stopRestTimer:
// localStorage (ACTIVE_SESSION_STORAGE_KEY) stays the source of truth for
// "is a session running and when did it start" so it survives a re-render
// or a reload.
let sessionTimerIntervalId = null;

function stopSessionTimerDisplay() {
    if (sessionTimerIntervalId !== null) {
        clearInterval(sessionTimerIntervalId);
        sessionTimerIntervalId = null;
    }
}

function startSessionTimer(startedAt, durationEl) {
    stopSessionTimerDisplay();
    if (!durationEl) return;
    const tick = () => {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        durationEl.textContent = formatRestTime(elapsedSeconds);
    };
    tick();
    sessionTimerIntervalId = setInterval(tick, 1000);
}

// The one place "the user wants this exercise's rest to stop" is actually
// carried out - used by ✕, 停止, and 閉じる alike. Deliberately does NOT
// go through restTimers.get(exIndex)?.cancel(): that silently no-ops if the
// Map entry is ever missing or stale. This instead always clears whatever
// interval IS registered (safe/no-op if there isn't one), always
// broadcasts the stop, and always resets the DOM from whatever markup is
// actually showing (countdown or alarm) back to the plain start button.
function stopRestForExercise(exIndex, actionsEl) {
    teardownAudioPipeline();
    stopRestTimer(exIndex);
    clearPersistedRestTimer(exIndex);
    broadcastRestStop(exIndex);
    const liveEl = actionsEl.querySelector(
        `.training-rest-timer[data-ex="${exIndex}"], .training-rest-alarm[data-ex="${exIndex}"]`
    );
    if (liveEl) liveEl.outerHTML = restStartButtonHtml(exIndex);
}

// Countdown hit zero (naturally, or via +/-15秒 adjustment landing on 0).
// Rather than a single fire-and-forget beep, this keeps ringing - sound +
// vibration every ALARM_REPEAT_MS - until 停止 is pressed, since a single
// beep is too easy to miss mid-workout.
function enterAlarmState(exIndex, actionsEl) {
    stopRestTimer(exIndex);

    const timerEl = actionsEl.querySelector(`.training-rest-timer[data-ex="${exIndex}"]`);
    if (timerEl) timerEl.outerHTML = restAlarmHtml(exIndex);

    alertTick();
    showRestBanner();
    let intervalId;
    const tick = () => {
        if (restTimers.get(exIndex)?.intervalId !== intervalId) return;
        alertTick();
    };
    intervalId = setInterval(tick, ALARM_REPEAT_MS);
    restTimers.set(exIndex, {
        intervalId,
        phase: 'alarm',
        adjust: () => {}, // no-op once ringing - +/-15秒 no longer applies
        cancel: () => stopRestForExercise(exIndex, actionsEl),
    });
    syncCardAlarmClass();
}

// endTimestamp is a wall-clock deadline (Date.now() + seconds), not a tick
// count, specifically so this can be resumed correctly - both from a
// save-triggered loadTraining() re-render and, via
// resumePersistedRestTimers(), from reopening the app after closing it
// mid-rest. The caller always supplies this explicitly - a fresh "レスト
// 開始" tap computes it from the configured rest_seconds, a resume replays
// the persisted deadline.
function startRestTimer(exIndex, actionsEl, endTimestamp) {
    unlockAudio();
    stopRestTimer(exIndex);

    let end = endTimestamp;
    persistRestTimer(exIndex, end);
    const computeRemaining = () => Math.max(0, Math.ceil((end - Date.now()) / 1000));

    const startBtn = actionsEl.querySelector(`[data-action="ex-rest-start"][data-ex="${exIndex}"]`);
    if (startBtn) startBtn.outerHTML = restTimerHtml(exIndex, computeRemaining());

    // 進捗バーの基準。再開時は「再開した時点の残り」が満タンになるが、
    // 表示の意味は常に「このレストの残り時間」で一貫しているので問題ない。
    // ±15秒で残りが基準を超えることがあるため100%で頭打ちにする。
    const totalSeconds = Math.max(1, computeRemaining());

    const render = () => {
        const remaining = computeRemaining();
        const timerEl = actionsEl.querySelector(`.training-rest-timer[data-ex="${exIndex}"]`);
        if (!timerEl) return;
        const label = timerEl.querySelector('.training-rest-remaining');
        if (label) label.textContent = `残り ${formatRestTime(remaining)}`;
        const fill = timerEl.querySelector('.training-rest-progress-fill');
        if (fill) fill.style.width = `${Math.min(100, (remaining / totalSeconds) * 100).toFixed(1)}%`;
    };

    // Reaching zero hands off to the alarm loop rather than reverting
    // straight back to "レスト開始" - that's now only what the ✕ (manual
    // early-cancel) path does.
    const reachZero = () => {
        stopRestTimer(exIndex);
        clearPersistedRestTimer(exIndex);
        enterAlarmState(exIndex, actionsEl);
    };

    const cancelCountdown = () => stopRestForExercise(exIndex, actionsEl);

    // Resuming (app reopened) after the deadline already passed while
    // nothing was running to notice - catch up immediately instead of
    // rendering a "0:00" that would otherwise sit there forever.
    if (computeRemaining() <= 0) {
        reachZero();
        return;
    }

    let intervalId;
    const tick = () => {
        if (restTimers.get(exIndex)?.intervalId !== intervalId) return;
        if (computeRemaining() <= 0) {
            reachZero();
            return;
        }
        render();
    };
    intervalId = setInterval(tick, 1000);

    restTimers.set(exIndex, {
        intervalId,
        phase: 'countdown',
        adjust: (deltaSeconds) => {
            end = Math.max(Date.now(), end + deltaSeconds * 1000);
            persistRestTimer(exIndex, end);
            if (computeRemaining() <= 0) {
                reachZero();
            } else {
                render();
            }
        },
        cancel: cancelCountdown,
    });
    syncCardAlarmClass();
}

// Which routine to show is derived purely from how many workouts have been
// logged so far, cycling 1 -> 2 -> ... -> dayCount -> 1. No separate
// "current day" pointer is persisted - reordering routines in the editor
// takes effect immediately on the next load, since this is recomputed
// fresh every time rather than carried forward.
function dayForSessionCount(totalWorkoutCount, dayCount) {
    return (totalWorkoutCount % dayCount) + 1;
}

function heaviestSet(sets) {
    // Ties broken by higher reps, not just "first seen" - the harder set is
    // the one worth crediting for the 1RM estimate.
    return sets.reduce((best, s) => {
        if (!best) return s;
        if (s.weight > best.weight) return s;
        if (s.weight === best.weight && s.reps > best.reps) return s;
        return best;
    }, null);
}

// Epley formula. "扱った重量" and "最大レップ数" describe the same set, not two
// independently-chosen maxima across different sets - 最大 just marks this as
// the real working set rather than a warm-up.
function estimated1RM(sets) {
    const top = heaviestSet(sets);
    if (!top) return 0;
    return top.weight * (1 + top.reps / 30);
}

// --- メトリクス用の集計 ---------------------------------------------------
// どれもログ(training_logs)から導けるものだけで組み立てている。ログには
// 「どのメニュー(day)を・いつ・どの種目を何kg何回」が残っているので、
// 前回比や自己ベストの判定に必要な情報は全部そろっている。

// 同じメニューの、今日より前の最新の記録。前回比と「何日ぶり」の基準になる。
function previousLogForDay(logs, day, todayStr) {
    return logs.filter((l) => l.day === day && l.date < todayStr).pop() || null;
}

// 今日、過去の最高重量を上回った種目の数。その種目の履歴が無い場合は
// 数えない - 初回は必ず「自己ベスト」になってしまい数字が意味を持たないため。
function personalBestCount(logs, todayLog) {
    if (!todayLog) return null;
    const bestBefore = new Map();
    for (const log of logs.filter((l) => l.date < todayLog.date)) {
        for (const ex of log.exercises) {
            const max = ex.sets.reduce((m, s) => Math.max(m, s.weight), 0);
            bestBefore.set(ex.name, Math.max(bestBefore.get(ex.name) ?? 0, max));
        }
    }
    return todayLog.exercises.reduce((count, ex) => {
        const prev = bestBefore.get(ex.name);
        if (prev === undefined) return count;
        const max = ex.sets.reduce((m, s) => Math.max(m, s.weight), 0);
        return max > prev ? count + 1 : count;
    }, 0);
}

function sessionsThisWeek(logs, todayStr) {
    const week = new Set(jstWeekDates(todayStr));
    return logs.filter((l) => week.has(l.date)).length;
}

function sessionVolume(exercises) {
    return exercises.reduce(
        (sum, ex) => sum + ex.sets.reduce((s, set) => s + set.weight * set.reps, 0),
        0
    );
}

function renderError(container) {
    container.innerHTML = `
        <div class="training-toggle" role="status">
            <span class="training-title">筋トレ記録</span>
            <span class="training-count">読み込めませんでした</span>
        </div>
    `;
    container.classList.remove('hidden');
}

// Same "always include the current value, even off-grid" safety net as
// routineRestSelectHtml below - old 0.5kg-step data, or any legacy/hand-
// edited value outside the normal range, still shows up correctly instead
// of silently snapping to the nearest option.
const WEIGHT_SELECT_MAX_KG = 200;
function weightSelectHtml(value, attrs) {
    const options = new Set(Array.from({ length: WEIGHT_SELECT_MAX_KG + 1 }, (_, i) => i));
    options.add(value);
    const sorted = [...options].sort((a, b) => a - b);
    return `<select ${attrs}>${sorted.map((w) => `<option value="${w}" ${w === value ? 'selected' : ''}>${w}</option>`).join('')}</select>`;
}

const REPS_SELECT_MAX = 30;
function repsSelectHtml(value, attrs) {
    const options = new Set(Array.from({ length: REPS_SELECT_MAX }, (_, i) => i + 1));
    options.add(value);
    const sorted = [...options].sort((a, b) => a - b);
    return `<select ${attrs}>${sorted.map((r) => `<option value="${r}" ${r === value ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
}

const SET_COUNT_SELECT_MAX = 10;
function setCountSelectHtml(value, attrs) {
    const options = new Set(Array.from({ length: SET_COUNT_SELECT_MAX }, (_, i) => i + 1));
    options.add(value);
    const sorted = [...options].sort((a, b) => a - b);
    return `<select ${attrs}>${sorted.map((c) => `<option value="${c}" ${c === value ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
}

// Display-only transform - the saved shape (ex.sets, a flat array) never
// changes. Consecutive sets with identical weight/reps collapse into one
// group; editing a group's weight/reps splits it back apart on the next
// render the moment its values diverge from its neighbor.
function groupSets(sets) {
    const groups = [];
    for (const s of sets) {
        const last = groups[groups.length - 1];
        if (last && last.weight === s.weight && last.reps === s.reps) {
            last.count += 1;
        } else {
            groups.push({ weight: s.weight, reps: s.reps, count: 1 });
        }
    }
    return groups;
}

function exerciseSetRowsHtml(exercise, exIndex) {
    return exercise.sets.map((set, setIndex) => `
        <div class="training-set-row">
            <span class="training-set-label">${setIndex + 1}セット目</span>
            ${weightSelectHtml(set.weight, `class="training-weight-input" data-ex="${exIndex}" data-set="${setIndex}"`)}
            <span class="training-set-unit">kg ×</span>
            ${repsSelectHtml(set.reps, `class="training-reps-input" data-ex="${exIndex}" data-set="${setIndex}"`)}
            <span class="training-set-unit">回</span>
        </div>
    `).join('');
}

// Shared between the initial render and "閉じる" (collapse-back-to-pending) -
// both need to produce the same starting single button. "ワークアウト開始"
// belongs only to the card-level toggle (see buildCardHtml) - each
// individual exercise's own start button is just plain "開始". 完了 only
// appears once the exercise is actually expanded (see expandExerciseBlock) -
// showing it alongside 開始 up front implied it could be pressed before any
// data was entered.
function exerciseActionsHtml(i) {
    return `<button type="button" class="action-btn training-start-btn" data-action="ex-start" data-ex="${i}">開始</button>`;
}

// Collapsed by default so opening the panel doesn't dump every exercise's
// full set of inputs on screen at once. "完了" needs no DOM to insert - it's
// a pure display-state flip, since readFormExercises() already falls back to
// the routine's planned values for any exercise whose body was never opened.
function exerciseBlockHtml(ex, i) {
    return `
        <div class="training-exercise-block" data-ex="${i}" data-status="pending">
            <div class="training-exercise-header">
                <span class="training-exercise-chip">${icon('dumbbell')}</span>
                <span class="training-exercise-name">${escapeHtml(ex.name)}</span>
                <div class="training-exercise-actions">${exerciseActionsHtml(i)}</div>
                <span class="training-exercise-done-badge hidden">${icon('check')} 予定通り <a href="#" class="training-undo-link" data-action="ex-undo" data-ex="${i}">取り消す</a></span>
            </div>
            <div class="training-exercise-body"></div>
        </div>
    `;
}

// ワークアウトの前後で中身が入れ替わる。前は「これから何をやるか」、後は
// 「今日どれだけ伸びたか」。種目数/セット数のような、見ても行動が変わらない
// 数字はやめた(ルーティーンを見れば分かる情報なので、ここに置く価値が薄い)。
//
//            ワークアウト前            ワークアウト後
//  1枠目     トレーニング時間(計測中)   トレーニング時間
//  2枠目     今日の予定ボリューム       前回比
//  3枠目     このメニューは何日ぶりか   自己ベスト更新
//  4枠目     今週のトレーニング回数     今週のトレーニング回数
//
// 数値と単位を分けて持つのは、数値だけを大きく・単位を小さく組んで桁を
// 揃えるため(カウントアップ中に揺れないよう、CSS側で tabular-nums 指定)。
function trainingMetricsRowHtml({ todayLog, logs, routine, day, todayStr }) {
    const jp = (n) => n.toLocaleString('ja-JP');
    const prevLog = previousLogForDay(logs, day, todayStr);

    const duration = {
        key: 'duration', label: 'トレーニング時間', icon: 'clock',
        text: todayLog?.duration_minutes ? jp(todayLog.duration_minutes) : null, unit: '分',
    };
    const week = {
        key: 'week', label: '今週のトレーニング', icon: 'calendar',
        text: jp(sessionsThisWeek(logs, todayStr)), unit: '回',
    };

    let volumeSlot;
    let progressSlot;
    if (todayLog) {
        const delta = prevLog ? todayLog.volume - prevLog.volume : null;
        volumeSlot = {
            key: 'delta', label: '前回のこのメニュー比', icon: 'flame',
            text: delta === null ? '初回' : `${delta >= 0 ? '+' : '−'}${jp(Math.abs(delta))}`,
            unit: delta === null ? '' : 'kg',
            tone: delta === null ? null : (delta > 0 ? 'up' : delta < 0 ? 'down' : null),
        };
        const pb = personalBestCount(logs, todayLog);
        progressSlot = {
            key: 'pb', label: '自己ベスト更新', icon: 'flag',
            text: jp(pb), unit: '種目', tone: pb > 0 ? 'up' : null,
        };
    } else {
        volumeSlot = {
            key: 'plan', label: '今日の予定ボリューム', icon: 'flame',
            text: jp(sessionVolume(routine.exercises)), unit: 'kg',
        };
        const interval = prevLog ? jstDaysBetween(prevLog.date, todayStr) : null;
        progressSlot = {
            key: 'interval', label: 'このメニューは', icon: 'repeat',
            text: interval === null ? '初回' : jp(interval),
            unit: interval === null ? '' : '日ぶり',
        };
    }

    const metrics = [duration, volumeSlot, progressSlot, week];
    return `
        <div class="training-metrics-row">
            ${metrics.map((m) => `
                <div class="training-metric" data-metric-key="${m.key}">
                    <span class="training-metric-chip">${icon(m.icon)}</span>
                    <span class="training-metric-value${m.tone ? ` is-${m.tone}` : ''}" data-metric="${m.key}">${m.text === null
                        ? '<span class="training-metric-empty">-</span>'
                        : `${escapeHtml(m.text)}${m.unit ? `<span class="training-metric-unit">${escapeHtml(m.unit)}</span>` : ''}`}</span>
                    <span class="training-metric-label">${escapeHtml(m.label)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function buildCardHtml({ label, pendingSessionNumber, isOverdue, overdueDays, exercises, exerciseNames, chartExercise, todayLog, logs, routine, day, todayStr }) {
    const countHtml = isOverdue
        ? `${icon('flag')}<span>${overdueDays}日以上お休み中</span>`
        : `${icon('play')}<span>ワークアウト開始</span>`;

    const exerciseBlocks = exercises.map((ex, i) => exerciseBlockHtml(ex, i)).join('');

    const selectOptions = exerciseNames
        .map((name) => `<option value="${escapeHtml(name)}" ${name === chartExercise ? 'selected' : ''}>${escapeHtml(name)}</option>`)
        .join('');

    return `
        <div class="training-header">
            <div class="training-header-top">
                <span class="training-title">${escapeHtml(label)} ・ 通算${pendingSessionNumber}日目</span>
            </div>
            ${trainingMetricsRowHtml({ todayLog, logs, routine, day, todayStr })}
            <div class="training-header-actions">
                <button type="button" class="training-start-toggle training-status-pill ${isOverdue ? 'is-overdue' : ''}" aria-expanded="false">
                    ${countHtml} <span class="training-chevron">${icon('chevronDown')}</span>
                </button>
            </div>
        </div>
        <div class="training-list hidden">
            <form class="training-form">
                ${exerciseBlocks}
                <button type="submit" class="btn-primary training-save-btn">ワークアウト終了</button>
            </form>
            <div class="training-chart-section">
                <div class="training-section-head">
                    <span class="training-section-title">${icon('chart')} 成長トレンド</span>
                    <select class="training-exercise-select">${selectOptions}</select>
                </div>
                <div class="training-chart-wrap"></div>
            </div>
        </div>
    `;
}

// A week's worth of day cells (JST Sun-Sat), today highlighted, with a dot
// under any day that already has a training_logs entry. Purely informational
// - unlike a real calendar app there's no per-day drilldown to click into,
// since this app only ever shows "today"'s session.
function weekStripHtml(logs, todayStr) {
    const loggedDates = new Set(logs.map((l) => l.date));
    const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    return jstWeekDates(todayStr).map((dateStr, i) => {
        const dayNum = Number(dateStr.split('-')[2]);
        const isToday = dateStr === todayStr;
        const hasLog = loggedDates.has(dateStr);
        return `
            <div class="week-strip-day ${isToday ? 'is-today' : ''} ${hasLog ? 'is-logged' : ''}">
                <span class="week-strip-weekday">${weekdayLabels[i]}</span>
                <span class="week-strip-date">${dayNum}</span>
                <span class="week-strip-dot" style="visibility:${hasLog ? 'visible' : 'hidden'}"></span>
            </div>
        `;
    }).join('');
}

// --- Routine editor (add/remove/reorder days & exercises, edit
// name/weight/reps/sets/labels). Plain up/down buttons rather than
// drag-and-drop: a day realistically holds a handful of exercises, so
// pointer-based DnD isn't worth the risk for what two buttons already do.

// Mirrors exerciseActionsHtml's 開始 button - shown only while collapsed
// (the expanded/閉じる counterpart now lives at the bottom of the body, see
// routineExerciseRowHtml), same neutral training-start-btn color so the
// routine editor's accordion reads as visually identical to the real
// workout card's.
function routineExerciseToggleBtnHtml(dayIndex, exIndex) {
    return `<button type="button" class="action-btn training-start-btn" data-action="ex-toggle" data-day="${dayIndex}" data-ex="${exIndex}">編集</button>`;
}

// 削除ボタンはデフォルト非表示で、行を左にスワイプした時だけ
// .swipe-row-actions が露出する(initSwipeToRevealが担当)。「+」は逆に
// 常時表示で、削除ボタンが元々あった行の右端の位置に置く。どの行の+を
// 押しても常に末尾に新セットを追加する(既存のset-add実装のまま)。
// Only rendered when expanded - mirrors .training-exercise-body, which stays
// empty (no DOM at all) while collapsed rather than just visually hidden.
function routineSetRowHtml(group, dayIndex, exIndex, groupIndex, removable) {
    return `
        <div class="training-routine-editor-set-row swipe-row" data-group="${groupIndex}">
            <div class="swipe-row-actions">
                <button type="button" class="swipe-row-delete-btn training-routine-editor-remove-set" data-action="set-remove" data-day="${dayIndex}" data-ex="${exIndex}" data-group="${groupIndex}" ${removable ? '' : 'disabled'}>${icon('trash')}<span>削除</span></button>
            </div>
            <div class="swipe-row-content training-routine-editor-set-row-content">
                ${setCountSelectHtml(group.count, `class="training-routine-editor-count-select" data-group="${groupIndex}"`)}
                <span class="training-routine-editor-set-label">セット:</span>
                ${weightSelectHtml(group.weight, `class="training-routine-editor-weight-select" data-group="${groupIndex}"`)}
                <span class="training-routine-editor-unit">kg ×</span>
                ${repsSelectHtml(group.reps, `class="training-routine-editor-reps-select" data-group="${groupIndex}"`)}
                <span class="training-routine-editor-unit">回</span>
                <button type="button" class="action-btn training-routine-editor-add-set" data-action="set-add" data-day="${dayIndex}" data-ex="${exIndex}" title="セットを追加" aria-label="セットを追加">${icon('plus')}</button>
            </div>
        </div>
    `;
}

// セットごとに重量・回数を分ける人(ピラミッドセット等)のため、"重量×回数×
// セット数"という単一の組ではなく、セット単位の行のリストにした - セット数
// という独立した概念は無くなり、行の数がそのままセット数になる。同じ重量・
// 回数のセットはgroupSets()で1行にまとめて表示し(ワークアウト中の画面は
// 元々セットごとの個別行のままなので混同しないよう注意)、値を変えた瞬間に
// 自動的に別行へ分かれる。
function routineExerciseBodyHtml(ex, dayIndex, exIndex) {
    const groups = groupSets(ex.sets);
    const rows = groups.map((g, i) => routineSetRowHtml(g, dayIndex, exIndex, i, groups.length > 1)).join('');
    return `
        <div class="training-routine-editor-exercise-body">
            <div class="training-routine-editor-set-list">${rows}</div>
        </div>
    `;
}

// 種目名は(折りたたみ中かどうかに関わらず)ヘッダーの入力欄1箇所だけで
// 表示・編集する - 以前は折りたたみ中はヘッダーに読み取り専用のラベル、
// 展開中は本文にも同じ名前の入力欄が出て二重表示になっていたのを解消。
function routineExerciseRowHtml(ex, dayIndex, exIndex) {
    const expanded = !!ex.expanded;
    return `
        <div class="training-routine-editor-exercise-row" data-day="${dayIndex}" data-ex="${exIndex}" data-expanded="${expanded}">
            <div class="training-routine-editor-exercise-header swipe-row">
                <div class="swipe-row-actions">
                    <button type="button" class="swipe-row-delete-btn training-routine-editor-remove-ex" data-action="ex-remove" data-day="${dayIndex}" data-ex="${exIndex}">${icon('trash')}<span>削除</span></button>
                </div>
                <div class="swipe-row-content training-routine-editor-exercise-header-content">
                    <input type="text" class="training-routine-editor-name-input training-routine-editor-exercise-name-input" value="${escapeHtml(ex.name)}" placeholder="種目名">
                    ${expanded ? '' : `<div class="training-routine-editor-exercise-actions">${routineExerciseToggleBtnHtml(dayIndex, exIndex)}</div>`}
                </div>
            </div>
            ${expanded ? routineExerciseBodyHtml(ex, dayIndex, exIndex) : ''}
            ${expanded ? `
            <div class="training-routine-editor-exercise-footer">
                <button type="button" class="action-btn training-collapse-btn" data-action="ex-toggle" data-day="${dayIndex}" data-ex="${exIndex}">閉じる</button>
            </div>` : ''}
        </div>
    `;
}

function defaultDraft() {
    return { name: '', sets: Array.from({ length: 3 }, () => ({ weight: 0, reps: 8 })) };
}

// ここで受け取るdraftは「まだリストに確定登録されていない新規種目」の
// 下書き。ここに直接入力し「+ 種目を追加」を押すと確定してリストへ移動し
// (折りたたみ済みの通常の種目として表示)、この欄自体は空の状態に
// リセットされて次の入力に備える - 常に画面下部に常駐する点が既存の
// 種目(展開/折りたたみ切り替え可能)との違い。
function routineExerciseDraftHtml(draft, dayIndex) {
    const groups = groupSets(draft.sets);
    const rows = groups.map((g, i) => routineSetRowHtml(g, dayIndex, 'draft', i, groups.length > 1)).join('');
    return `
        <div class="training-routine-editor-exercise-draft">
            <input type="text" class="training-routine-editor-name-input" value="${escapeHtml(draft.name)}" placeholder="種目名">
            <div class="training-routine-editor-set-list">${rows}</div>
        </div>
    `;
}

function routineDayBlockHtml(day, dayIndex, days) {
    const rows = day.exercises.map((ex, i) => routineExerciseRowHtml(ex, dayIndex, i)).join('');
    return `
        <div class="training-routine-editor-day" data-day="${dayIndex}">
            <div class="training-routine-editor-day-header swipe-row">
                <div class="swipe-row-actions">
                    <button type="button" class="swipe-row-delete-btn training-routine-editor-remove-day" data-action="day-remove" data-day="${dayIndex}" ${days.length <= 1 ? 'disabled' : ''}>${icon('trash')}<span>削除</span></button>
                </div>
                <div class="swipe-row-content training-routine-editor-day-header-content">
                    <span class="training-routine-editor-day-label-tag">ルーティーン${dayIndex + 1}</span>
                    <input type="text" class="training-routine-editor-label-input" value="${escapeHtml(day.label)}" placeholder="ラベル (例: 胸・三頭)">
                    <button type="button" class="action-btn training-routine-editor-day-drag-handle" aria-label="ドラッグして並び替え" title="ドラッグして並び替え">${icon('grip')}</button>
                </div>
            </div>
            <div class="training-routine-editor-exercise-list">${rows}</div>
            ${routineExerciseDraftHtml(day.draft, dayIndex)}
            <button type="button" class="action-btn training-routine-editor-add-ex" data-action="ex-add" data-day="${dayIndex}">+ 種目を追加</button>
        </div>
    `;
}

// A closed set of presets rather than free-form input, so there's nothing
// to validate - reuses the same "M:SS" formatting already shown on the live
// countdown (formatRestTime) instead of inventing a second time format.
const REST_DURATION_OPTIONS_SECONDS = [30, 45, 60, 90, 120, 150, 180, 240, 300];

function routineRestSelectHtml(restSeconds) {
    const options = REST_DURATION_OPTIONS_SECONDS
        // Always include whatever's actually saved even if it's not one of
        // the presets, so opening the editor never silently shows the
        // wrong selection.
        .concat(REST_DURATION_OPTIONS_SECONDS.includes(restSeconds) ? [] : [restSeconds])
        .sort((a, b) => a - b)
        .map((s) => `<option value="${s}" ${s === restSeconds ? 'selected' : ''}>${formatRestTime(s)}</option>`)
        .join('');
    return `
        <label class="training-routine-editor-rest-label">デフォルトのレスト時間:
            <select class="training-routine-editor-rest-select">${options}</select>
        </label>
    `;
}

function routineEditorHtml(days, restSeconds) {
    const dayBlocks = days.map((day, i) => routineDayBlockHtml(day, i, days)).join('');
    return `
        <div class="training-routine-editor-days">${dayBlocks}</div>
        <div class="training-routine-editor-settings">
            ${routineRestSelectHtml(restSeconds)}
        </div>
        <div class="training-routine-editor-footer">
            <button type="button" class="action-btn training-routine-editor-add-day" data-action="day-add">+ ルーティーンを追加</button>
            <button type="button" class="btn-primary training-routine-editor-save-btn" data-action="routine-save">ルーティーンを保存する</button>
        </div>
    `;
}

// Rendered in place of the normal card when there are zero routine days
// yet. The actual routine-creation UI lives entirely on the ルーティーン
// 管理 tab (see loadRoutineManagement()) - this card just points there.
// Step 1 (home-screen install) is shown here, before any routine exists,
// because it's cheapest to do before there's data worth protecting - once a
// routine/log exists, this onboarding message is gone for good (no routine
// count ever goes back to zero on its own).
function noRoutineMessageHtml() {
    return `
        <div class="training-header">
            <span class="training-title">筋トレルーティーン</span>
        </div>
        <div class="training-onboarding">
            <div class="training-empty-art">${icon('dumbbell')}</div>
            <p class="training-onboarding-step">
                <span class="training-onboarding-step-num">1</span>
                <strong>ホーム画面に追加(推奨)</strong><br>
                Safari下部の共有ボタン(□に↑)→「ホーム画面に追加」→右上の「追加」の順にタップしてください。データがこの端末に残りやすくなります(追加しない場合、7日間開かないとデータが消えることがあります)。
            </p>
            <p class="training-onboarding-step">
                <span class="training-onboarding-step-num">2</span>
                <strong>ルーティーンを作成</strong><br>
                上の「ルーティーン管理」タブから、トレーニングメニューを作成してください。
            </p>
        </div>
    `;
}

// Reads the editor's current DOM state back into the plain-object shape
// used everywhere else in this file - called both to build the payload to
// save and, before any structural mutation (add/remove/move), to capture
// whatever's been typed into OTHER rows so it isn't lost when the whole
// editor gets re-rendered.
// Each group row expands back into its `count` identical flat sets - the
// saved shape (ex.sets) is always the flat array, grouping is purely a
// rendering/editing convenience. Shared between real exercises and the
// always-open draft row, which use the exact same set-row markup.
function readSetsFromGroupRows(groupRows, fallbackSets) {
    return groupRows.length > 0
        ? Array.from(groupRows).flatMap((groupRow) => {
            const weight = Number(groupRow.querySelector('.training-routine-editor-weight-select').value);
            const reps = Number(groupRow.querySelector('.training-routine-editor-reps-select').value);
            const count = Number(groupRow.querySelector('.training-routine-editor-count-select').value);
            return Array.from({ length: count }, () => ({ weight, reps }));
        })
        : (fallbackSets ?? [{ weight: 0, reps: 8 }]);
}

function readEditorStateFromDom(editorEl, fallbackDays) {
    return Array.from(editorEl.querySelectorAll('.training-routine-editor-day')).map((dayEl, dayIndex) => {
        const fallbackDay = fallbackDays?.[dayIndex];
        // The draft is always in the DOM (never collapsed), but fall back
        // defensively the same way exercises do.
        const draftEl = dayEl.querySelector('.training-routine-editor-exercise-draft');
        const draft = draftEl
            ? {
                name: draftEl.querySelector('.training-routine-editor-name-input').value,
                sets: readSetsFromGroupRows(draftEl.querySelectorAll('.training-routine-editor-set-row'), fallbackDay?.draft?.sets),
            }
            : (fallbackDay?.draft ?? defaultDraft());
        return {
            label: dayEl.querySelector('.training-routine-editor-label-input').value,
            exercises: Array.from(dayEl.querySelectorAll('.training-routine-editor-exercise-row')).map((row, exIndex) => {
                // A collapsed row has no input fields in the DOM at all - fall
                // back to whatever this exercise already held rather than
                // reading from nodes that don't exist.
                const fallback = fallbackDay?.exercises?.[exIndex];
                const nameInput = row.querySelector('.training-routine-editor-name-input');
                const groupRows = row.querySelectorAll('.training-routine-editor-set-row');
                return {
                    name: nameInput ? nameInput.value : (fallback?.name ?? ''),
                    sets: readSetsFromGroupRows(groupRows, fallback?.sets),
                    expanded: row.dataset.expanded === 'true',
                };
            }),
            draft,
        };
    });
}

// 削除ボタンをデフォルトでは隠し、行(.swipe-row)を左にスワイプした時だけ
// .swipe-row-actions を露出させる汎用ジェスチャーコントローラ。container
// (initRoutineEditorのeditorEl)へPointer Eventをdelegateするだけなので、
// render()がinnerHTMLを丸ごと差し替えても再アタッチ不要 - 差し替え後は
// 単に「今は何も開いていない」状態から始まるだけで実害はない。
const SWIPE_DRAG_THRESHOLD_PX = 10;
// .swipe-row-content の transition (0.2s) より少しだけ長く取る。
const SWIPE_CLOSE_HIDE_DELAY_MS = 260;

function initSwipeToReveal(container) {
    let openRowEl = null;
    let drag = null;
    let justDragged = false;

    // 閉じるアニメーション(0.2s)が終わってから赤パネルを消す。すぐ消すと
    // 行が戻りきる前に赤だけ瞬間的に消えて不自然に見える。
    function hideActionsWhenClosed(rowEl) {
        window.setTimeout(() => {
            if (openRowEl !== rowEl) rowEl.classList.remove('is-swiping');
        }, SWIPE_CLOSE_HIDE_DELAY_MS);
    }

    function closeRow(rowEl) {
        if (!rowEl) return;
        const content = rowEl.querySelector(':scope > .swipe-row-content');
        if (content) content.style.transform = 'translateX(0)';
        if (openRowEl === rowEl) openRowEl = null;
        hideActionsWhenClosed(rowEl);
    }

    container.addEventListener('pointerdown', (e) => {
        // タッチ操作ではスワイプ直後にclickイベントが発火しないことが多く、
        // その場合justDraggedがconsumeされないまま残ってしまい、次の本当の
        // タップ(露出した削除ボタンを押す操作)まで誤って握りつぶしてしまう
        // - 新しい操作の開始時点で必ずリセットし、あくまで「直前の操作の
        // 直後に来たclick」だけを対象にする。
        justDragged = false;
        if (openRowEl && !openRowEl.contains(e.target)) {
            closeRow(openRowEl);
        }
        const rowEl = e.target.closest('.swipe-row');
        if (!rowEl) return;
        const contentEl = rowEl.querySelector(':scope > .swipe-row-content');
        const actionsEl = rowEl.querySelector(':scope > .swipe-row-actions');
        if (!contentEl || !actionsEl) return;
        drag = {
            rowEl,
            contentEl,
            actionsWidth: actionsEl.offsetWidth,
            startX: e.clientX,
            startY: e.clientY,
            baseOffset: rowEl === openRowEl ? -actionsEl.offsetWidth : 0,
            dragging: false,
            pointerId: e.pointerId,
        };
    });

    container.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.dragging) {
            if (Math.abs(dx) < SWIPE_DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
            drag.dragging = true;
            // 赤いパネルは普段 visibility:hidden。スワイプが始まって初めて
            // 描画する - 常時描画していると角丸クリップのアンチエイリアスで
            // 行の右端に赤い線がにじんで見えてしまうため。
            drag.rowEl.classList.add('is-swiping');
            drag.contentEl.style.transition = 'none';
            drag.contentEl.setPointerCapture?.(drag.pointerId);
        }
        e.preventDefault();
        const next = Math.min(0, Math.max(-drag.actionsWidth, drag.baseOffset + dx));
        drag.contentEl.style.transform = `translateX(${next}px)`;
    });

    function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.pointerId)) return;
        const current = drag;
        drag = null;
        if (!current.dragging) return;
        current.contentEl.style.transition = '';
        const dx = e ? e.clientX - current.startX : 0;
        const finalOffset = Math.min(0, Math.max(-current.actionsWidth, current.baseOffset + dx));
        const shouldOpen = finalOffset <= -current.actionsWidth / 2;
        if (openRowEl && openRowEl !== current.rowEl) closeRow(openRowEl);
        if (shouldOpen) {
            current.contentEl.style.transform = `translateX(-${current.actionsWidth}px)`;
            current.rowEl.classList.add('is-swiping');
            openRowEl = current.rowEl;
        } else {
            current.contentEl.style.transform = 'translateX(0)';
            if (openRowEl === current.rowEl) openRowEl = null;
            hideActionsWhenClosed(current.rowEl);
        }
        justDragged = true;
    }

    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    // キャプチャフェーズで登録 - 同じcontainerに付いている既存の(バブル
    // フェーズの)data-actionディスパッチより必ず先に評価される。ドラッグの
    // 副産物として発火する1回だけのclickを握りつぶし、開いた行の本体
    // (削除ボタン自体は除く)への単純タップはその行を閉じるだけの動作にする。
    container.addEventListener('click', (e) => {
        if (justDragged) {
            justDragged = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (openRowEl) {
            const content = e.target.closest('.swipe-row-content');
            const rowEl = content ? content.closest('.swipe-row') : null;
            const inActions = e.target.closest('.swipe-row-actions');
            if (rowEl === openRowEl && !inActions) {
                e.preventDefault();
                e.stopPropagation();
                closeRow(openRowEl);
            }
        }
    }, true);
}

// 行が増える・減る・動く操作。これらは画面から即座に消えたり増えたりする
// ぶん「保存したつもり」になりやすく、保存ボタンを押さずに離れると元に
// 戻ってしまうのが分かりにくかったため、その場で永続化する。名前・重量・
// 回数といった値の編集は従来どおり「ルーティーンを保存する」で確定する。
const STRUCTURAL_ACTIONS = new Set([
    'day-add', 'day-remove', 'ex-add', 'ex-remove', 'set-add', 'set-remove',
]);

function initRoutineEditor(editorEl, { initialDays, trainingState }) {
    let days = JSON.parse(JSON.stringify(initialDays));
    let restSeconds = trainingState.rest_seconds;

    // 自動保存では検証(種目名が空など)をしない - 入力の途中で警告を出すのは
    // 邪魔なうえ、検証で弾いて保存しないと「消したのに戻る」が再発するため。
    // 明示的な保存ボタン側の検証はそのまま残してある。
    // エディタ自身は既に描画済みなので再構築はせず、反対のタブ(今日の
    // トレーニング)の表示だけ最新に合わせる。
    function persistStructuralChange() {
        try {
            saveRoutines(days);
            loadTraining();
        } catch (e) {
            console.error('Routine auto-save error:', e);
        }
    }

    function render() {
        editorEl.innerHTML = routineEditorHtml(days, restSeconds);
    }

    async function saveRoutine() {
        const proposed = readEditorStateFromDom(editorEl, days);
        // routine-save short-circuits before the click handler's usual
        // "sync from DOM" step below, so this has to read the select's
        // live value directly rather than trust the closure variable.
        const restSecondsValue = Number(editorEl.querySelector('.training-routine-editor-rest-select').value);

        if (proposed.length < 1) {
            alert('少なくとも1つはルーティーンが必要です。');
            return;
        }
        for (let dayIndex = 0; dayIndex < proposed.length; dayIndex++) {
            const day = proposed[dayIndex];
            if (day.exercises.length < 1) {
                alert('各ルーティーンに1つ以上の種目が必要です。');
                return;
            }
            for (let exIndex = 0; exIndex < day.exercises.length; exIndex++) {
                const ex = day.exercises[exIndex];
                let message = null;
                if (!ex.name.trim()) {
                    message = '種目名を入力してください。';
                } else if (ex.sets.length < 1) {
                    message = '少なくとも1つはセットが必要です。';
                } else if (ex.sets.some((s) => !Number.isFinite(s.weight) || s.weight < 0)) {
                    message = '重量は0以上の数値で入力してください。';
                } else if (ex.sets.some((s) => !Number.isInteger(s.reps) || s.reps < 1)) {
                    message = '回数は1以上の整数で入力してください。';
                }
                if (message) {
                    // A collapsed row's invalid value would otherwise be
                    // invisible - force it open so the alert points at
                    // something visible to fix.
                    days = proposed;
                    days[dayIndex].exercises[exIndex].expanded = true;
                    render();
                    alert(message);
                    return;
                }
            }
        }

        const saveBtn = editorEl.querySelector('[data-action="routine-save"]');
        saveBtn.disabled = true;
        try {
            saveRoutines(proposed);
            saveState({ rest_seconds: restSecondsValue });

            // Both refresh: the workout card (day count/day1 content/
            // rest_seconds may have changed) and the editor itself.
            loadTraining();
            loadRoutineManagement();
            showQuickToast('保存しました');
        } catch (err) {
            console.error('Routine save error:', err);
            alert('ルーティーンの保存に失敗しました。');
            saveBtn.disabled = false;
        }
    }

    editorEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.preventDefault();
        const { action } = btn.dataset;
        if (action === 'routine-save') {
            saveRoutine();
            return;
        }

        const dayIndex = Number(btn.dataset.day);
        // The persistent draft composer's own set-rows carry data-ex="draft"
        // instead of a real exercise index (readSetsFromGroupRows/set-add/
        // set-remove don't care which exercise they're touching, only
        // whether it's the draft or a committed one).
        const isDraft = btn.dataset.ex === 'draft';
        const exIndex = isDraft ? null : Number(btn.dataset.ex);
        const groupIndex = Number(btn.dataset.group);
        // Capture whatever's currently typed into every row before mutating
        // the structure, so an add/remove/move elsewhere doesn't blow away
        // an in-progress edit in an unrelated row. Same reasoning for the
        // rest-duration select, which lives outside the per-day blocks.
        days = readEditorStateFromDom(editorEl, days);
        const restSelectEl = editorEl.querySelector('.training-routine-editor-rest-select');
        if (restSelectEl) restSeconds = Number(restSelectEl.value);

        if (action === 'day-add') {
            days.push({ label: '', exercises: [], draft: defaultDraft() });
        } else if (action === 'day-remove') {
            if (days.length <= 1) {
                alert('少なくとも1つはルーティーンが必要です。');
                return;
            }
            days.splice(dayIndex, 1);
        } else if (action === 'ex-add') {
            // 常時表示の下書き(draft)をそのままリストへ確定登録し(折りた
            // たみ済みの通常の種目として表示)、下書き欄自体は空の状態に
            // リセットして次の入力に備える。
            days[dayIndex].exercises.push({ ...days[dayIndex].draft, expanded: false });
            days[dayIndex].draft = defaultDraft();
        } else if (action === 'ex-remove') {
            days[dayIndex].exercises.splice(exIndex, 1);
        } else if (action === 'ex-toggle') {
            days[dayIndex].exercises[exIndex].expanded = !days[dayIndex].exercises[exIndex].expanded;
        } else if (action === 'set-add') {
            // 直前のセットとほぼ同じ値(重量だけ-1kg)で追加する - 完全に
            // 同じ値だと表示上すぐ直前のグループへ統合されてしまい、
            // ピラミッドセットの新しい段として独立編集できなくなるため。
            // 単に同じセットを増やしたいだけなら、追加後に重量を1つ戻せば
            // 元のグループへまとまる。
            const sets = isDraft ? days[dayIndex].draft.sets : days[dayIndex].exercises[exIndex].sets;
            const prev = sets[sets.length - 1];
            sets.push({ weight: Math.max(0, prev.weight - 1), reps: prev.reps });
        } else if (action === 'set-remove') {
            // グループ単位の削除 - そのグループが占めるフラット配列の区間
            // (それより前のグループのcount合計〜自身のcount分)を丸ごと消す。
            const target = isDraft ? days[dayIndex].draft : days[dayIndex].exercises[exIndex];
            const groups = groupSets(target.sets);
            if (groups.length <= 1) return; // ボタン自体もdisabledだが念のため
            let start = 0;
            for (let i = 0; i < groupIndex; i++) start += groups[i].count;
            target.sets.splice(start, groups[groupIndex].count);
        }
        render();
        if (STRUCTURAL_ACTIONS.has(action)) persistStructuralChange();
    });

    initSwipeToReveal(editorEl);

    // ルーティーンの並び替え: ↑↓ボタンではなく、ドラッグハンドル(↕)を
    // 掴んで上下にドラッグする方式。隣のルーティーン枠の中央を超えた瞬間に
    // DOM上のノードをinsertBeforeで直接入れ替え、days配列も同じタイミング
    // で同期させる(枠自体がポインターに追従してその場でグッと動く見た目
    // になる - CSSトランジションは意図的に付けていない)。離した時点で
    // 最終確定してrender()する。
    let dayDrag = null;
    const DAY_LIST_GAP_PX = 16; // .training-routine-editor-daysのgapと一致させる

    editorEl.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.training-routine-editor-day-drag-handle');
        if (!handle) return;
        const dayEl = handle.closest('.training-routine-editor-day');
        if (!dayEl) return;
        const listEl = dayEl.parentElement;
        // ドラッグ開始前に、他の行で入力中の値を全て取り込んでおく - 直後に
        // days配列を直接いじるため、これを怠ると未反映の編集がrender()で
        // 失われてしまう(既存のクリックハンドラと同じ理由)。
        days = readEditorStateFromDom(editorEl, days);
        const siblings = Array.from(listEl.children);
        dayDrag = {
            dayEl,
            listEl,
            siblings,
            index: siblings.indexOf(dayEl),
            startY: e.clientY,
            pointerId: e.pointerId,
        };
        dayEl.classList.add('is-dragging');
        handle.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    });

    editorEl.addEventListener('pointermove', (e) => {
        if (!dayDrag || e.pointerId !== dayDrag.pointerId) return;
        e.preventDefault();
        dayDrag.dayEl.style.transform = `translateY(${e.clientY - dayDrag.startY}px)`;

        while (true) {
            const dayRect = dayDrag.dayEl.getBoundingClientRect();
            const dayCenter = dayRect.top + dayRect.height / 2;

            const prev = dayDrag.siblings[dayDrag.index - 1];
            if (prev) {
                const prevRect = prev.getBoundingClientRect();
                if (dayCenter < prevRect.top + prevRect.height / 2) {
                    dayDrag.listEl.insertBefore(dayDrag.dayEl, prev);
                    dayDrag.siblings[dayDrag.index] = prev;
                    dayDrag.siblings[dayDrag.index - 1] = dayDrag.dayEl;
                    [days[dayDrag.index - 1], days[dayDrag.index]] = [days[dayDrag.index], days[dayDrag.index - 1]];
                    dayDrag.index -= 1;
                    dayDrag.startY -= (prevRect.height + DAY_LIST_GAP_PX);
                    dayDrag.dayEl.style.transform = `translateY(${e.clientY - dayDrag.startY}px)`;
                    continue;
                }
            }

            const next = dayDrag.siblings[dayDrag.index + 1];
            if (next) {
                const nextRect = next.getBoundingClientRect();
                if (dayCenter > nextRect.top + nextRect.height / 2) {
                    dayDrag.listEl.insertBefore(next, dayDrag.dayEl);
                    dayDrag.siblings[dayDrag.index] = next;
                    dayDrag.siblings[dayDrag.index + 1] = dayDrag.dayEl;
                    [days[dayDrag.index], days[dayDrag.index + 1]] = [days[dayDrag.index + 1], days[dayDrag.index]];
                    dayDrag.index += 1;
                    dayDrag.startY += (nextRect.height + DAY_LIST_GAP_PX);
                    dayDrag.dayEl.style.transform = `translateY(${e.clientY - dayDrag.startY}px)`;
                    continue;
                }
            }
            break;
        }
    });

    function endDayDrag(e) {
        if (!dayDrag || (e && e.pointerId !== dayDrag.pointerId)) return;
        dayDrag.dayEl.style.transform = '';
        dayDrag.dayEl.classList.remove('is-dragging');
        dayDrag = null;
        render();
        persistStructuralChange();
    }
    editorEl.addEventListener('pointerup', endDayDrag);
    editorEl.addEventListener('pointercancel', endDayDrag);

    render();
}

// An exercise left collapsed - whether "完了" was tapped or it was simply
// never opened - has no input elements in the DOM at all. Both cases mean
// the same thing: record it exactly as planned, using the routine's own
// numbers rather than reading anything from the page.
function readFormExercises(form, routineExercises) {
    return routineExercises.map((ex, exIndex) => {
        const body = form.querySelector(`.training-exercise-block[data-ex="${exIndex}"] .training-exercise-body`);
        const opened = body && body.querySelector('.training-weight-input');
        const sets = opened
            ? ex.sets.map((_, setIndex) => ({
                weight: Number(body.querySelector(`.training-weight-input[data-set="${setIndex}"]`).value) || 0,
                reps: Number(body.querySelector(`.training-reps-input[data-set="${setIndex}"]`).value) || 0,
            }))
            : ex.sets.map((s) => ({ weight: s.weight, reps: s.reps }));
        return { name: ex.name, sets };
    });
}

function drawChart(container, logs, exerciseName) {
    const points = logs
        .map((log) => {
            const match = log.exercises.find((e) => e.name === exerciseName);
            return match ? { date: log.date, value: match.estimated1RM } : null;
        })
        // estimated1RM を持たない記録(この項目を書き出すより前の古いログ等)は
        // 描かずに飛ばす。1件混ざっただけで描画が落ち、カード全体が
        // 「読み込めませんでした」になってしまうため。
        .filter((p) => p && Number.isFinite(p.value))
        .slice(-12);
    container.innerHTML = buildTrendSvgMarkup(points);
}

// Populates the ルーティーン管理 tab, independent of loadTraining() - this
// runs eagerly on boot so the tab is already rendered the instant someone
// clicks it, and again after every successful save.
async function loadRoutineManagement() {
    let container = document.getElementById('routineManagementEditor');
    if (!container) return;
    // This runs many times over the page's life (boot, and again after
    // every successful save) but initRoutineEditor() attaches its click
    // listener directly to this persistent container rather than to a
    // freshly-built child - a second call would otherwise stack a second
    // listener on top of the first (and a third, ...), so every click
    // fires all of them at once and e.g. ex-toggle's flip ends up
    // cancelling itself out. Cloning-and-replacing drops any listener a
    // previous call attached, while keeping the same id for the next
    // lookup.
    const freshContainer = container.cloneNode(false);
    container.replaceWith(freshContainer);
    container = freshContainer;
    try {
        const trainingState = loadState();
        const routines = loadRoutines();
        const initialDays = routines.length > 0
            ? routines.map((r) => ({ label: r.label || '', exercises: r.exercises.map((ex) => ({ ...ex, expanded: false })), draft: defaultDraft() }))
            : [{ label: '', exercises: [], draft: defaultDraft() }];
        initRoutineEditor(container, { initialDays, trainingState });
    } catch (e) {
        console.error('Routine management load error:', e);
        container.innerHTML = '<p class="training-no-routine-message">読み込めませんでした。</p>';
    }
}

async function loadTraining() {
    const container = document.getElementById('trainingCard');
    if (!container) return;

    // Any rest timer from a previous render (e.g. this is the re-render
    // loadTraining() triggers right after a save) is about to lose its DOM
    // to the innerHTML rebuild below - stop it explicitly rather than
    // leaving an orphaned interval ticking against detached nodes. Same for
    // the overall session timer's display interval.
    stopAllRestTimers();
    stopSessionTimerDisplay();

    try {
        const trainingState = loadState();
        const routines = loadRoutines();
        const logs = loadLogs();
        const todayStr = jstDateString();

        // Rendered unconditionally, even with zero routines - purely
        // informational, doesn't depend on there being a routine to show.
        const weekStripEl = document.getElementById('weekStrip');
        if (weekStripEl) weekStripEl.innerHTML = weekStripHtml(logs, todayStr);

        if (routines.length === 0) {
            // No routine created yet - point at the ルーティーン管理 tab,
            // which handles bootstrapping the first routine on its own.
            container.innerHTML = noRoutineMessageHtml();
            container.classList.remove('hidden');
            return;
        }

        const day = dayForSessionCount(trainingState.total_workout_count, routines.length);
        const pendingSessionNumber = trainingState.total_workout_count + 1;
        const routine = routines[day - 1];

        const isOverdue = trainingState.last_workout_date !== null
            && jstDaysBetween(trainingState.last_workout_date, todayStr) >= trainingState.alert_threshold_days;
        const overdueDays = isOverdue ? jstDaysBetween(trainingState.last_workout_date, todayStr) : 0;

        const exerciseNames = [...new Set(routines.flatMap((r) => r.exercises.map((e) => e.name)))];
        const chartExercise = routine.exercises[0]?.name || exerciseNames[0];

        const todayLog = logs.filter((l) => l.date === todayStr).pop() || null;

        container.innerHTML = buildCardHtml({
            label: routine.label || `ルーティーン${day}`, pendingSessionNumber, isOverdue, overdueDays,
            exercises: routine.exercises, exerciseNames, chartExercise, todayLog,
            logs, routine, day, todayStr,
        });
        container.classList.remove('hidden');

        const toggleBtn = container.querySelector('.training-start-toggle');
        const list = container.querySelector('.training-list');
        const durationEl = container.querySelector('.training-metric-value[data-metric="duration"]');
        toggleBtn.addEventListener('click', () => {
            const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            const nowExpanded = !expanded;
            toggleBtn.setAttribute('aria-expanded', String(nowExpanded));
            list.classList.toggle('hidden', expanded);
            container.classList.toggle('expanded', nowExpanded);
            // カードを開くだけではセッションは始まらない - 実際に種目の
            // 「開始」を押した時点が「トレーニング開始」(下のex-start参照)。
        });

        const chartWrap = container.querySelector('.training-chart-wrap');
        const select = container.querySelector('.training-exercise-select');
        if (chartExercise) drawChart(chartWrap, logs, chartExercise);
        select.addEventListener('change', () => drawChart(chartWrap, logs, select.value));

        const form = container.querySelector('.training-form');

        form.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action], a[data-action]');
            if (!btn) return;
            e.preventDefault();

            const { action, ex } = btn.dataset;
            const exIndex = Number(ex);

            // 停止/キャンセルはボタン自身から辿れるDOMだけで完結させ、他の
            // ブロック/ヘッダーのルックアップより先に処理する - block等の
            // どれかがnullで以降の行が例外を投げても、アラームを止める操作
            // だけは絶対にそこで巻き込まれて止まらないようにするため。
            if (action === 'ex-rest-stop' || action === 'ex-rest-cancel') {
                const actionsEl = btn.closest('.training-exercise-actions');
                if (actionsEl) stopRestForExercise(exIndex, actionsEl);
                if (action === 'ex-rest-stop') {
                    // 停止は押した種目だけでなく、その時点で本当に鳴って
                    // いる他の種目も一緒に止める。複数種目を開始していると
                    // 同時期にアラーム状態になり得るため、ユーザー視点では
                    // 「音」は1つであり、どのボタンを押しても鳴り止むべき。
                    [...restTimers.entries()]
                        .filter(([otherEx, timer]) => otherEx !== exIndex && timer.phase === 'alarm')
                        .forEach(([alarmingEx]) => {
                            const targetActions = form.querySelector(
                                `.training-exercise-block[data-ex="${alarmingEx}"] .training-exercise-actions`
                            );
                            if (targetActions) stopRestForExercise(alarmingEx, targetActions);
                        });
                }
                return;
            }

            const block = form.querySelector(`.training-exercise-block[data-ex="${ex}"]`);
            const header = block.querySelector('.training-exercise-header');
            const actions = header.querySelector('.training-exercise-actions');
            const badge = header.querySelector('.training-exercise-done-badge');
            const body = block.querySelector('.training-exercise-body');

            if (action === 'ex-start') {
                expandExerciseBlock(block, exIndex, routine.exercises[exIndex]);
                // 「トレーニング開始」は種目の開始ボタンを押した瞬間 - カードを
                // 開いただけ(トグル)ではまだ始まらない。2つ目以降の種目を
                // 開始してもセッションは1つのまま(既存セッションがあれば
                // 何もしない)。
                if (!loadActiveSession()) {
                    startActiveSession();
                    startSessionTimer(Date.now(), durationEl);
                }
            } else if (action === 'ex-collapse') {
                stopRestTimer(exIndex);
                clearPersistedRestTimer(exIndex);
                broadcastRestStop(exIndex);
                block.dataset.status = 'pending';
                body.innerHTML = '';
                actions.innerHTML = exerciseActionsHtml(exIndex);
            } else if (action === 'ex-complete') {
                block.dataset.status = 'done';
                actions.classList.add('hidden');
                badge.classList.remove('hidden');
            } else if (action === 'ex-undo') {
                block.dataset.status = 'pending';
                actions.classList.remove('hidden');
                badge.classList.add('hidden');
            } else if (action === 'ex-rest-start') {
                startRestTimer(exIndex, actions, Date.now() + trainingState.rest_seconds * 1000);
            } else if (action === 'ex-rest-minus') {
                restTimers.get(exIndex)?.adjust(-REST_ADJUST_SECONDS);
            } else if (action === 'ex-rest-plus') {
                restTimers.get(exIndex)?.adjust(REST_ADJUST_SECONDS);
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const exercises = readFormExercises(form, routine.exercises);

            const hasAnyReps = exercises.some((ex) => ex.sets.some((s) => s.reps > 0));
            if (!hasAnyReps) {
                alert('少なくとも1セットは回数を入力してください。');
                return;
            }

            const sessionDate = jstDateString();
            const now = new Date().toLocaleString('ja-JP');
            const logExercises = exercises.map((ex) => ({
                name: ex.name,
                sets: ex.sets,
                estimated1RM: Math.round(estimated1RM(ex.sets) * 10) / 10,
            }));
            const volume = sessionVolume(exercises);
            const newCount = pendingSessionNumber;

            const activeSession = loadActiveSession();
            const elapsedMs = activeSession ? Date.now() - activeSession.startedAt : 0;
            const duration_minutes = elapsedMs > 0 ? Math.max(1, Math.round(elapsedMs / 60000)) : 0;

            try {
                appendLog({
                    day,
                    date: sessionDate,
                    createdAt: now,
                    total_workout_count: newCount,
                    exercises: logExercises,
                    volume,
                    duration_minutes,
                });

                saveState({
                    total_workout_count: newCount,
                    last_workout_date: sessionDate,
                    alert_threshold_days: trainingState.alert_threshold_days,
                });

                // "以上" (at-or-above) the current planned weight still counts
                // as a new best worth remembering, per the spec - now applied
                // per set rather than to one shared default, since each set
                // can have its own planned weight/reps.
                const updatedExercises = routine.exercises.map((ex, i) => ({
                    ...ex,
                    sets: ex.sets.map((plannedSet, setIndex) => {
                        const actual = exercises[i].sets[setIndex];
                        return actual && actual.weight >= plannedSet.weight
                            ? { weight: actual.weight, reps: plannedSet.reps }
                            : plannedSet;
                    }),
                }));
                const anyChanged = updatedExercises.some((ex, i) =>
                    ex.sets.some((s, si) => s.weight !== routine.exercises[i].sets[si].weight));
                if (anyChanged) {
                    updateRoutineDayExercises(day, updatedExercises);
                }

                clearAllPersistedRestTimers();
                clearActiveSession();
                loadTraining();
                showQuickToast('お疲れ様でした！');
            } catch (err) {
                console.error('Training save error:', err);
                alert('記録の保存に失敗しました。');
            }
        });

        resumePersistedRestTimers(form, routine.exercises);

        // ページを開き直した/再レンダーされた時点でまだセッション進行中なら
        // (=保存せずにリロードした)、カードを展開状態に復元し、経過時間は
        // 永続化されたstartedAtから正しく再計算して続行する。
        const activeSession = loadActiveSession();
        if (activeSession) {
            toggleBtn.setAttribute('aria-expanded', 'true');
            list.classList.remove('hidden');
            container.classList.add('expanded');
            startSessionTimer(activeSession.startedAt, durationEl);
        }
    } catch (e) {
        console.error('Training load error:', e);
        renderError(container);
    }
}

// --- Tabs (今日のトレーニング / ルーティーン管理) ---
function initTabs() {
    const tabs = [
        { btnId: 'tabTodayBtn', viewId: 'todayView' },
        { btnId: 'tabRoutinesBtn', viewId: 'routinesView' },
    ];
    function activate(tabName) {
        tabs.forEach(({ btnId, viewId }) => {
            const btn = document.getElementById(btnId);
            const view = document.getElementById(viewId);
            const isActive = btn.dataset.tab === tabName;
            btn.setAttribute('aria-selected', String(isActive));
            view.classList.toggle('hidden', !isActive);
        });
    }
    document.querySelectorAll('.app-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => activate(btn.dataset.tab));
    });
}

// --- Boot ---
function registerServiceWorker() {
    // Needed only so the rest-timer can call
    // ServiceWorkerRegistration.showNotification() - no push, no caching.
    // Best-effort: silently no-ops over file:// (no secure context) or in
    // older browsers without support - sound/vibration/the in-page alarm
    // still work regardless.
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch((e) => {
        console.error('Service worker registration failed:', e);
    });
}

function unlockAudioOnFirstTap() {
    // A rest-timer alarm resumed automatically on page load (the app was
    // reopened after being closed mid-rest) can't play sound on its first
    // attempt - there's been no user gesture yet this session, so the
    // browser blocks it. It keeps ringing regardless, so unlocking here on
    // literally the first tap anywhere gives the very next ring a real
    // chance to be heard.
    document.addEventListener('pointerdown', unlockAudio, { once: true });
}

// ヘッダーの日付。jstDateString()は既に全画面で使っている日付の正(しょう)
// なので、表示もそこから組み立てて「今日」の定義がズレないようにする。
function renderHeaderDate() {
    const el = document.getElementById('appHeaderDate');
    if (!el) return;
    const [year, month, day] = jstDateString().split('-').map(Number);
    // UTCで組み立ててUTCで曜日を読む - ローカルタイムゾーンを経由しないので
    // 端末の設定に関係なくJSTの日付に対応した曜日が出る。
    const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][weekdayIndex];
    el.textContent = `${month}月${day}日(${weekday})`;
}

function boot() {
    initTabs();
    renderHeaderDate();
    loadTraining();
    loadRoutineManagement();
    registerServiceWorker();
    unlockAudioOnFirstTap();
    window.__appBooted = true;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
