/**
 * monitor.js — Dashboard giám sát truy cập cho web HoHai Việt Nam (analytics.html)
 * ---------------------------------------------------------------------------------
 * - Không cần đăng nhập (giống monitor cũ của web US). Xoá dữ liệu phải nhập mã PIN; PIN lưu dạng mã băm SHA-256.
 *   Lưu ý: đây chỉ là chặn ở giao diện — database Firebase vẫn để mở như web US.
 * - Đọc realtime: sessions (lọc theo startedAt), presence (đang online), events (khi mở chi tiết).
 * - Mọi mốc giờ hiển thị theo giờ Việt Nam (GMT+7), không phụ thuộc múi giờ máy đang xem.
 * - Xem trước giao diện bằng dữ liệu mẫu: mở http://localhost:<port>/analytics.html?demo=1 (chỉ chạy trên máy).
 * ---------------------------------------------------------------------------------
 */
(function () {
    'use strict';

    const CFG = window.HOHAI_MONITOR;
    const DAY = 864e5, HOUR = 36e5, VN = 7 * HOUR;
    const ONLINE_FRESH = 75e3;           // tab đang hiển thị phải báo hiệu trong 75 giây gần nhất
    const PAGE_SIZE = 25;
    const LS_OFF = 'hohai_vn_monitor_off';
    // SHA-256 của 'hohai-vn:' + PIN. Đổi PIN: chạy  printf '%s' 'hohai-vn:<PIN_MỚI>' | shasum -a 256  rồi dán kết quả vào đây.
    const PIN_HASH = '1c27bf2815fd0f4a37fa4c9c9b5ca42997d9468657546d5fb8c370913bd55c6a';

    const PAGE_NAMES = {
        'index': 'Trang chủ',
        'khay-ve-sinh-co': 'Khay vệ sinh cỏ',
        'tham-co-ban-cong': 'Thảm cỏ ban công',
        'cuon-co-trai-cho': 'Cuộn cỏ trại chó',
        'gioi-thieu': 'Giới thiệu',
        'lien-he': 'Liên hệ',
        'chinh-sach-bao-hanh': 'Chính sách bảo hành',
        'chinh-sach-bao-mat': 'Chính sách bảo mật'
    };
    const DEVICE_NAMES = { Mobile: 'Điện thoại', Desktop: 'Máy tính', Tablet: 'Máy tính bảng' };
    const RANGE_TEXT = {
        today: { title: 'Hôm nay', cmp: 'so với cùng giờ hôm qua', bucket: 'hour' },
        yesterday: { title: 'Hôm qua', cmp: 'so với hôm kia', bucket: 'hour' },
        '7d': { title: '7 ngày qua', cmp: 'so với 7 ngày trước đó', bucket: 'day' },
        '30d': { title: '30 ngày qua', cmp: 'so với 30 ngày trước đó', bucket: 'day' }
    };

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtN = (n) => Number(n || 0).toLocaleString('vi-VN');

    /* =====================================================================
     * 1. Định dạng thời gian theo giờ Việt Nam
     * ===================================================================== */
    const vnDayStart = (ts) => Math.floor((ts + VN) / DAY) * DAY - VN;
    const vnDate = (ts) => new Date(ts + VN); // đọc bằng getUTC*
    const pad = (n) => String(n).padStart(2, '0');
    const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    function hhmm(ts) { const d = vnDate(ts); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    function hhmmss(ts) { const d = vnDate(ts); return hhmm(ts) + ':' + pad(d.getUTCSeconds()); }
    function ddmm(ts) { const d = vnDate(ts); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1); }
    function fullDate(ts) { const d = vnDate(ts); return ddmm(ts) + '/' + d.getUTCFullYear(); }
    function dayLabel(ts) {
        const t0 = vnDayStart(now());
        if (ts >= t0) return 'Hôm nay';
        if (ts >= t0 - DAY) return 'Hôm qua';
        return WD[vnDate(ts).getUTCDay()] + ', ' + ddmm(ts);
    }
    function relTime(ts) {
        const diff = now() - ts;
        if (diff < 60e3) return 'vừa xong';
        if (diff < HOUR) return Math.floor(diff / 60e3) + ' phút trước';
        if (diff < 6 * HOUR) return Math.floor(diff / HOUR) + ' giờ trước';
        return dayLabel(ts) + ' ' + hhmm(ts);
    }
    function fmtDur(sec) {
        sec = Math.max(0, Math.round(sec || 0));
        if (sec < 60) return sec + ' giây';
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (h) return h + ' giờ ' + (m ? m + ' phút' : '');
        if (m >= 10 || !s) return m + ' phút';
        return m + ' phút ' + s + ' giây';
    }

    const pageName = (k) => PAGE_NAMES[k] || k || '—';
    const deviceName = (d) => DEVICE_NAMES[d] || d || 'Không rõ';
    // Dịch vụ tra IP trả tên không dấu tiếng Anh — đổi về tên tiếng Việt cho các nơi hay gặp
    const VI_PLACES = {
        'ho chi minh city': 'TP. Hồ Chí Minh', 'ho chi minh': 'TP. Hồ Chí Minh', 'ho chi minh city (hcmc)': 'TP. Hồ Chí Minh', 'saigon': 'TP. Hồ Chí Minh',
        'hanoi': 'Hà Nội', 'ha noi': 'Hà Nội', 'da nang': 'Đà Nẵng', 'haiphong': 'Hải Phòng', 'hai phong': 'Hải Phòng', 'can tho': 'Cần Thơ',
        'bien hoa': 'Biên Hòa', 'thu dau mot': 'Thủ Dầu Một', 'thu duc': 'Thủ Đức', 'di an': 'Dĩ An', 'thuan an': 'Thuận An', 'nha trang': 'Nha Trang',
        'hue': 'Huế', 'vung tau': 'Vũng Tàu', 'da lat': 'Đà Lạt', 'dalat': 'Đà Lạt', 'buon ma thuot': 'Buôn Ma Thuột', 'quy nhon': 'Quy Nhơn',
        'vinh': 'Vinh', 'long xuyen': 'Long Xuyên', 'my tho': 'Mỹ Tho', 'rach gia': 'Rạch Giá', 'bac ninh': 'Bắc Ninh', 'hai duong': 'Hải Dương',
        'nam dinh': 'Nam Định', 'thai nguyen': 'Thái Nguyên', 'ha long': 'Hạ Long', 'thanh hoa': 'Thanh Hóa', 'binh duong': 'Bình Dương',
        'dong nai': 'Đồng Nai', 'long an': 'Long An', 'khanh hoa': 'Khánh Hòa', 'lam dong': 'Lâm Đồng', 'quang ninh': 'Quảng Ninh',
        'ba ria-vung tau': 'Bà Rịa - Vũng Tàu', 'tay ninh': 'Tây Ninh', 'pleiku': 'Pleiku', 'phan thiet': 'Phan Thiết', 'vietnam': 'Việt Nam'
    };
    const viPlace = (n) => (n && VI_PLACES[String(n).toLowerCase().replace(/^(thanh pho|tinh)\s+/, '')]) || n || '';
    function place(s) {
        if (!s) return 'Chưa rõ vị trí';
        let p = viPlace(s.city) || viPlace(s.region) || '';
        if (s.cc && s.cc !== 'VN') p = p ? p + ', ' + (s.country || s.cc) : (s.country || s.cc);
        return p || (s.ip ? 'Chưa rõ vị trí' : 'Đang xác định vị trí…');
    }

    /* =====================================================================
     * 2. Nguồn dữ liệu: Firebase thật, hoặc dữ liệu mẫu khi xem trước
     * ===================================================================== */
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const isDemo = isLocal && new URLSearchParams(location.search).get('demo') === '1';
    let serverOffset = 0;
    const now = () => Date.now() + serverOffset;

    function firebaseSource(app) {
        const db = app.database();
        const r = (p) => db.ref(CFG.root + '/' + p);
        db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
        return {
            onConn(cb) { db.ref('.info/connected').on('value', (s) => cb(!!s.val())); },
            watchSessions(from, cb, err) {
                const q = r('sessions').orderByChild('startedAt').startAt(from);
                const h = q.on('value', (s) => cb(s.val() || {}), err);
                return () => q.off('value', h);
            },
            watchPresence(cb, err) {
                const ref = r('presence');
                const h = ref.on('value', (s) => cb(s.val() || {}), err);
                return () => ref.off('value', h);
            },
            fetchSession(sid) { return r('sessions/' + sid).once('value').then((s) => s.val()); },
            watchEvents(sid, cb) {
                const ref = r('events/' + sid);
                const h = ref.on('value', (s) => cb(s.val() || {}), () => cb({}));
                return () => ref.off('value', h);
            },
            visitorSessions(vid) {
                return r('sessions').orderByChild('visitorId').equalTo(vid).limitToLast(50).once('value').then((s) => s.val() || {});
            },
            deleteSession(sid) {
                const u = {};
                u['sessions/' + sid] = null;
                u['events/' + sid] = null;
                return db.ref(CFG.root).update(u);
            }
        };
    }

    /* ---------- Dữ liệu mẫu (chỉ để xem trước giao diện trên máy) ---------- */
    function demoSource() {
        let seed = 7;
        const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
        const pick = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = rnd() * tot; for (const p of pairs) { if ((x -= p[1]) <= 0) return p[0]; } return pairs[0][0]; };
        const T = Date.now();
        const sessions = {}, events = {}, visitors = [];
        const cities = [['Ho Chi Minh City', 45], ['Hanoi', 25], ['Da Nang', 8], ['Thu Dau Mot', 7], ['Can Tho', 5], ['Bien Hoa', 5], ['Haiphong', 5]];
        const sources = [['Facebook', 40], ['Trực tiếp', 20], ['Zalo', 15], ['Google', 15], ['TikTok', 10]];
        const landings = [['index', 45], ['khay-ve-sinh-co', 25], ['tham-co-ban-cong', 18], ['cuon-co-trai-cho', 12]];
        const vias = ['Gửi ảnh ban công, nhận báo giá · hero', 'Tư vấn · chat', 'Đặt hàng qua Zalo · order', 'Xin mẫu dùng thử · sample', 'Gọi 0847131400'];
        let n = 0;
        for (let d = 59; d >= 0; d--) {
            const day0 = vnDayStart(T) - d * DAY;
            const dow = vnDate(day0).getUTCDay();
            const count = Math.round((10 + rnd() * 14) * (dow === 0 || dow === 6 ? 1.3 : 1) * (1 + (59 - d) / 120));
            for (let i = 0; i < count; i++) {
                const hour = pick([[7, 2], [8, 3], [9, 4], [10, 4], [11, 5], [12, 6], [13, 4], [14, 4], [15, 4], [16, 4], [17, 5], [18, 6], [19, 8], [20, 10], [21, 10], [22, 7], [23, 3], [0, 1], [6, 1]]);
                const start = day0 + hour * HOUR + Math.floor(rnd() * HOUR);
                if (start > T - 60e3) continue;
                const back = visitors.length > 5 && rnd() < 0.22;
                const vid = back ? visitors[Math.floor(rnd() * visitors.length)] : 'v_demo' + (n++).toString(36) + 'xxxxxxxx';
                if (!back) visitors.push(vid);
                const sid = 's_demo' + start.toString(36) + i + 'aaaaaa';
                const landing = pick(landings);
                const pv = pick([[1, 40], [2, 25], [3, 15], [4, 10], [5, 6], [6, 4]]);
                const active = Math.round(pv === 1 && rnd() < 0.5 ? rnd() * 12 : 15 + Math.exp(rnd() * 5.6));
                const contacted = rnd() < 0.05 + pv * 0.025;
                const via = vias[Math.floor(rnd() * vias.length)];
                const pages = {}; pages[landing] = 1;
                const all = Object.keys(PAGE_NAMES);
                for (let k = 1; k < pv; k++) { const p = all[Math.floor(rnd() * 5)]; pages[p] = (pages[p] || 0) + 1; }
                const device = pick([['Mobile', 72], ['Desktop', 22], ['Tablet', 6]]);
                sessions[sid] = {
                    visitorId: vid, startedAt: start, lastSeen: Math.min(T, start + active * 1000 + 20e3), returning: back,
                    landing, page: landing, pages, pageViews: pv, activeSec: active, source: pick(sources), campaign: rnd() < 0.2 ? 'khay-ve-sinh-thang11' : '',
                    referrer: '', device, os: device === 'Desktop' ? pick([['Windows', 7], ['macOS', 3]]) : pick([['Android', 6], ['iOS', 4]]),
                    browser: pick([['Chrome', 5], ['Safari', 3], ['Facebook App', 3], ['Zalo', 2], ['Cốc Cốc', 1]]), screen: '390x844', lang: 'vi',
                    ip: '113.161.' + Math.floor(rnd() * 255) + '.' + Math.floor(rnd() * 255), country: 'Vietnam', cc: 'VN', city: pick(cities), region: '',
                    contacted, contactAt: contacted ? start + Math.round(active * 800) : undefined, contactVia: contacted ? via : undefined,
                    contactPage: contacted ? landing : undefined, zaloClicks: contacted && !/^Gọi/.test(via) ? 1 : 0, phoneClicks: contacted && /^Gọi/.test(via) ? 1 : 0
                };
            }
        }
        const recent = Object.keys(sessions).sort((a, b) => sessions[b].startedAt - sessions[a].startedAt).slice(0, 4);
        const presence = {};
        recent.forEach((sid, i) => {
            sessions[sid].lastSeen = T; sessions[sid].startedAt = T - (i + 1) * 4 * 60e3;
            presence['t_demo' + i] = { sid, page: sessions[sid].landing, lastSeen: T - i * 5e3, visible: i < 3 };
        });
        function makeEvents(sid) {
            const s = sessions[sid]; if (!s) return {};
            const ev = {}; let t = s.startedAt, k = 0;
            const add = (o) => { ev['e' + (k++)] = o; };
            const pages = []; Object.keys(s.pages).forEach((p) => { for (let i = 0; i < s.pages[p]; i++) pages.push(p); });
            pages.sort((a, b) => (a === s.landing ? -1 : b === s.landing ? 1 : 0));
            const step = Math.max(8e3, (s.activeSec * 1000) / Math.max(1, pages.length));
            pages.forEach((p, i) => {
                add({ t: 'page_view', label: pageName(p), page: p, at: t });
                if (i === 0 && s.activeSec > 20) add({ t: 'scroll', label: 'Cuộn 50% trang', page: p, at: t + step * 0.5 });
                t += step;
            });
            if (s.contacted) add({ t: s.phoneClicks ? 'click_phone' : 'click_zalo', label: s.contactVia, page: s.contactPage, at: s.contactAt });
            return ev;
        }
        let sessCb = null, sessFrom = 0, presCb = null;
        const emit = () => {
            if (sessCb) { const o = {}; Object.keys(sessions).forEach((k) => { if (sessions[k].startedAt >= sessFrom) o[k] = sessions[k]; }); sessCb(o); }
            if (presCb) presCb(presence);
        };
        return {
            onConn(cb) { setTimeout(() => cb(true), 200); },
            watchSessions(from, cb) { sessFrom = from; sessCb = cb; setTimeout(emit, 150); return () => { sessCb = null; }; },
            watchPresence(cb) { presCb = cb; setTimeout(emit, 150); return () => { presCb = null; }; },
            fetchSession(sid) { return Promise.resolve(sessions[sid] || null); },
            watchEvents(sid, cb) { setTimeout(() => cb(makeEvents(sid)), 80); return () => { }; },
            visitorSessions(vid) { const o = {}; Object.keys(sessions).forEach((k) => { if (sessions[k].visitorId === vid) o[k] = sessions[k]; }); return Promise.resolve(o); },
            deleteSession(sid) {
                delete sessions[sid];
                Object.keys(presence).forEach((k) => { if (presence[k].sid === sid) delete presence[k]; });
                emit(); return Promise.resolve();
            }
        };
    }

    /* =====================================================================
     * 3. Trạng thái & tính toán
     * ===================================================================== */
    const state = {
        range: 'today', filter: 'all', q: '', page: 0,
        sessions: {}, presence: {}, extra: {}, // extra: phiên online bắt đầu trước kỳ đang xem
        openSid: null
    };
    let DS = null, unSessions = null, unPresence = null, unEvents = null;
    const fetching = new Set();

    function rangeInfo() {
        const t = now(), t0 = vnDayStart(t);
        const R = {
            today: [t0, t, t0 - DAY, t - DAY],
            yesterday: [t0 - DAY, t0, t0 - 2 * DAY, t0 - DAY],
            '7d': [t0 - 6 * DAY, t, t0 - 13 * DAY, t - 7 * DAY],
            '30d': [t0 - 29 * DAY, t, t0 - 59 * DAY, t - 30 * DAY]
        }[state.range];
        return { start: R[0], end: R[1], prevStart: R[2], prevEnd: R[3], ...RANGE_TEXT[state.range] };
    }

    function list(from, to) {
        const out = [];
        for (const sid in state.sessions) {
            const s = state.sessions[sid];
            if (s && typeof s.startedAt === 'number' && s.startedAt >= from && s.startedAt < to) out.push(Object.assign({ sid }, s));
        }
        return out.sort((a, b) => b.startedAt - a.startedAt);
    }

    function metrics(rows) {
        const vids = new Set(), newV = new Set();
        let contacts = 0, zalo = 0, phone = 0, time = 0, bounce = 0;
        rows.forEach((s) => {
            vids.add(s.visitorId);
            if (!s.returning) newV.add(s.visitorId);
            if (s.contacted) contacts++;
            if (s.zaloClicks) zalo++;
            if (s.phoneClicks) phone++;
            time += s.activeSec || 0;
            if ((s.pageViews || 1) <= 1 && (s.activeSec || 0) < 10) bounce++;
        });
        const n = rows.length;
        return { sessions: n, visitors: vids.size, newVisitors: newV.size, contacts, zalo, phone, avgTime: n ? time / n : 0, bounce: n ? bounce / n : 0, rate: n ? contacts / n : 0 };
    }

    function onlineMap() {
        const t = now(), by = {};
        for (const k in state.presence) {
            const p = state.presence[k];
            if (!p || !p.sid) continue;
            const active = p.visible !== false && t - (p.lastSeen || 0) < ONLINE_FRESH;
            const cur = by[p.sid];
            if (!cur || (active && !cur.active)) by[p.sid] = { sid: p.sid, page: p.page, active, lastSeen: p.lastSeen };
        }
        return by;
    }
    const sessionOf = (sid) => state.sessions[sid] || state.extra[sid] || null;

    /* =====================================================================
     * 4. Vẽ giao diện
     * ===================================================================== */
    let renderQueued = false;
    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => { renderQueued = false; renderAll(); });
    }

    function renderAll() {
        const R = rangeInfo();
        const rows = list(R.start, R.end + 1);
        const prev = list(R.prevStart, R.prevEnd + 1);
        $('range-title').textContent = R.title;
        $('range-sub').textContent = state.range === 'today' || state.range === 'yesterday'
            ? WD[vnDate(R.start).getUTCDay()] + ', ' + fullDate(R.start)
            : fullDate(R.start) + ' – ' + fullDate(R.end - 1);
        renderKpis(rows, prev, R);
        renderChart(rows, R);
        renderOnline();
        renderContacts(rows);
        renderBreakdowns(rows);
        renderTable(rows);
    }

    function delta(cur, prev, R, invert) {
        if (!prev && !cur) return '';
        if (!prev) return '<span class="delta flat">Kỳ trước chưa có dữ liệu</span>';
        const pct = Math.round((cur - prev) / prev * 100);
        if (pct === 0) return '<span class="delta flat">Không đổi</span> ' + R.cmp;
        const good = invert ? pct < 0 : pct > 0;
        return '<span class="delta ' + (good ? 'up' : 'down') + '">' + (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%</span> ' + R.cmp;
    }

    function renderKpis(rows, prevRows, R) {
        const m = metrics(rows), p = metrics(prevRows);
        $('k-sessions').textContent = fmtN(m.sessions);
        $('k-sessions-sub').innerHTML = delta(m.sessions, p.sessions, R);
        $('k-visitors').textContent = fmtN(m.visitors);
        $('k-visitors-sub').textContent = m.visitors ? Math.round(m.newVisitors / m.visitors * 100) + '% khách lần đầu ghé' : '';
        $('k-contacts').textContent = fmtN(m.contacts);
        $('k-contacts-sub').innerHTML = m.sessions
            ? 'Tỉ lệ ' + (m.rate * 100).toFixed(1).replace('.', ',') + '% · Zalo ' + m.zalo + ' · Gọi ' + m.phone
            : 'Chưa có lượt truy cập';
        $('k-time').textContent = m.sessions ? fmtDur(m.avgTime) : '—';
        $('k-time-sub').textContent = m.sessions ? Math.round(m.bounce * 100) + '% thoát nhanh (dưới 10 giây, 1 trang)' : '';
    }

    /* ---------- Biểu đồ cột ---------- */
    function niceMax(v) {
        if (v <= 4) return 4;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const n = v / p;
        return (n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p;
    }

    function renderChart(rows, R) {
        const el = $('chart');
        const hourly = R.bucket === 'hour';
        const n = hourly ? 24 : Math.round((vnDayStart(R.end - 1) - R.start) / DAY) + 1;
        const size = hourly ? HOUR : DAY;
        const visits = new Array(n).fill(0), contacts = new Array(n).fill(0);
        rows.forEach((s) => {
            const i = Math.floor((s.startedAt - R.start) / size);
            if (i >= 0 && i < n) visits[i]++;
            if (s.contacted) {
                const j = Math.floor(((s.contactAt || s.startedAt) - R.start) / size);
                if (j >= 0 && j < n) contacts[j]++;
            }
        });
        $('chart-title').textContent = hourly ? 'Lượt truy cập theo giờ' : 'Lượt truy cập theo ngày';

        const W = Math.max(280, el.clientWidth), H = el.clientHeight || 280;
        const pl = 34, pr = 6, pt = 10, pb = 28;
        const cw = W - pl - pr, ch = H - pt - pb;
        const max = niceMax(Math.max(1, ...visits));
        const bw = cw / n;
        const barW = Math.max(3, Math.min(18, bw * 0.36));
        const y = (v) => pt + ch - (v / max) * ch;
        const nowIdx = state.range === 'today' ? Math.floor((now() - R.start) / size) : n;

        let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Biểu đồ lượt truy cập">';
        for (let g = 0; g <= 4; g++) {
            const v = max / 4 * g, yy = y(v);
            svg += '<line class="grid-line" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '"/>';
            svg += '<text class="axis" x="' + (pl - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtN(v) + '</text>';
        }
        const every = hourly ? (W < 520 ? 6 : 3) : Math.ceil(n / (W < 520 ? 5 : 10));
        for (let i = 0; i < n; i++) {
            const x0 = pl + i * bw, cx = x0 + bw / 2;
            const future = i > nowIdx;
            svg += '<g class="col" data-i="' + i + '"' + (future ? ' opacity=".35"' : '') + '>';
            svg += '<rect class="hit" x="' + x0 + '" y="' + pt + '" width="' + bw + '" height="' + ch + '" rx="6"/>';
            if (visits[i]) svg += '<rect class="bar-v" x="' + (cx - barW - 1) + '" y="' + y(visits[i]) + '" width="' + barW + '" height="' + (pt + ch - y(visits[i])) + '" rx="3"/>';
            if (contacts[i]) svg += '<rect class="bar-c" x="' + (cx + 1) + '" y="' + y(contacts[i]) + '" width="' + barW + '" height="' + (pt + ch - y(contacts[i])) + '" rx="3"/>';
            svg += '</g>';
            if (i % every === 0) {
                const lab = hourly ? i + 'h' : ddmm(R.start + i * DAY);
                svg += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + lab + '</text>';
            }
        }
        svg += '</svg><div class="chart-tip" hidden></div>';
        el.innerHTML = svg;

        const tip = el.querySelector('.chart-tip');
        el.querySelectorAll('.col').forEach((g) => {
            const show = () => {
                const i = +g.dataset.i;
                const head = hourly ? pad(i) + ':00 – ' + pad(i + 1) + ':00' : WD[vnDate(R.start + i * DAY).getUTCDay()] + ', ' + ddmm(R.start + i * DAY);
                tip.innerHTML = '<b>' + head + '</b><br>Lượt truy cập: <b>' + visits[i] + '</b><br>Liên hệ: <b>' + contacts[i] + '</b>';
                tip.hidden = false;
                const cx = pl + i * bw + bw / 2;
                tip.style.left = Math.min(Math.max(cx, 80), W - 80) + 'px';
                tip.style.top = Math.max(y(Math.max(visits[i], contacts[i])) - 8, 60) + 'px';
            };
            g.addEventListener('mouseenter', show);
            g.addEventListener('touchstart', show, { passive: true });
            g.addEventListener('mouseleave', () => { tip.hidden = true; });
        });
    }

    /* ---------- Đang online ---------- */
    const ICON = {
        Mobile: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/></svg>',
        Desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
        Tablet: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M11 18h2"/></svg>',
        zalo: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
        phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
        page_view: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
        click_zalo: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
        click_phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
        scroll: '<svg viewBox="0 0 24 24"><path d="M12 4v16m0 0-5-5m5 5 5-5"/></svg>',
        click: '<svg viewBox="0 0 24 24"><path d="M9 9l10 4-4 1.5L13.5 19z"/><path d="M5 5l2 2M9 3v2M3 9h2"/></svg>',
        click_out: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
        click_email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>'
    };

    function renderOnline() {
        const map = onlineMap();
        const all = Object.values(map).sort((a, b) => (b.active - a.active) || (b.lastSeen - a.lastSeen));
        const active = all.filter((o) => o.active).length;
        const bg = all.length - active;
        $('k-online').textContent = active;
        $('k-online-sub').textContent = active || bg
            ? (active ? active + ' khách đang xem' : 'Không ai đang xem') + (bg ? ' · ' + bg + ' mở ở tab nền' : '')
            : 'Chưa có ai';
        $('online-pill').textContent = all.length ? active + ' đang xem' : '0';
        all.forEach((o) => {
            if (sessionOf(o.sid) || fetching.has(o.sid)) return;
            fetching.add(o.sid); // phiên bắt đầu trước kỳ đang xem: tải riêng 1 lần
            DS.fetchSession(o.sid).then((s) => { if (s) { state.extra[o.sid] = s; scheduleRender(); } }).catch(() => { });
        });
        $('online-list').innerHTML = all.length ? all.map((o) => {
            const s = sessionOf(o.sid) || {};
            const since = s.startedAt ? fmtDur((now() - s.startedAt) / 1000) : '';
            return '<li data-sid="' + esc(o.sid) + '">' +
                '<span class="o-ico' + (o.active ? '' : ' bg') + '">' + (ICON[s.device] || ICON.Desktop) + '</span>' +
                '<span class="o-main"><span class="o-title">' + esc(place(s)) + '</span>' +
                '<span class="o-sub">' + (o.active ? 'Đang xem ' : 'Tab nền · ') + esc(pageName(o.page)) + (s.source ? ' · ' + esc(s.source) : '') + '</span></span>' +
                '<span class="o-time">' + esc(since) + '</span></li>';
        }).join('') : '<li class="empty">Hiện không có ai trên web.</li>';
    }

    /* ---------- Khách đã liên hệ ---------- */
    function renderContacts(rows) {
        const c = rows.filter((s) => s.contacted).sort((a, b) => (b.contactAt || b.startedAt) - (a.contactAt || a.startedAt));
        const shown = c.slice(0, 12);
        $('contacts-count').textContent = c.length ? c.length + ' lượt' + (c.length > shown.length ? ' · hiện ' + shown.length + ' gần nhất, xem hết ở bảng bên dưới' : '') : '';
        $('contact-list').innerHTML = shown.length ? shown.map((s) => {
            const isPhone = !s.zaloClicks && s.phoneClicks;
            const via = (s.contactVia || (isPhone ? 'Gọi điện' : 'Zalo')).replace(/ · [a-z]+$/, '');
            return '<li data-sid="' + esc(s.sid) + '">' +
                '<span class="c-ico' + (isPhone ? ' phone' : '') + '">' + (isPhone ? ICON.phone : ICON.zalo) + '</span>' +
                '<span class="c-main"><span class="c-top"><span class="c-title">' + esc(place(s)) + '</span><span class="c-when">' + esc(relTime(s.contactAt || s.startedAt)) + '</span></span>' +
                '<div class="c-via">' + (isPhone ? 'Bấm gọi' : 'Bấm Zalo') + ': “' + esc(via) + '”' + (s.contactPage ? ' ở ' + esc(pageName(s.contactPage)) : '') + '</div>' +
                '<div class="c-meta">' + esc(deviceName(s.device)) + ' · ' + esc(s.source || '—') + ' · xem ' + esc(fmtDur(s.activeSec)) + ' · ' + (s.pageViews || 1) + ' trang</div></span></li>';
        }).join('') : '<li class="empty">Chưa có khách nào bấm Zalo hoặc gọi điện trong khoảng thời gian này.</li>';
    }

    /* ---------- Tỉ lệ theo nhóm ---------- */
    function bars(id, entries, unit, limit) {
        limit = limit || 6;
        const el = $(id);
        if (!entries.length) { el.innerHTML = '<li class="empty">Chưa có dữ liệu</li>'; return; }
        entries.sort((a, b) => b.v - a.v);
        let top = entries.slice(0, limit);
        if (entries.length > limit) {
            const rest = entries.slice(limit);
            top.push({ name: 'Khác', v: rest.reduce((a, e) => a + e.v, 0), x: '' });
        }
        const total = entries.reduce((a, e) => a + e.v, 0);
        const max = Math.max(...top.map((e) => e.v));
        el.innerHTML = top.map((e) => '<li><div class="b-row"><span class="b-name" title="' + esc(e.name) + '">' + esc(e.name) + '</span>' +
            '<span class="b-val">' + fmtN(e.v) + '<small>' + Math.round(e.v / total * 100) + '%' + (e.x ? ' · ' + esc(e.x) : '') + '</small></span></div>' +
            '<div class="b-track"><div class="b-fill" style="width:' + (e.v / max * 100).toFixed(1) + '%"></div></div></li>').join('');
    }

    function group(rows, keyFn) {
        const m = {};
        rows.forEach((s) => { const k = keyFn(s); if (!m[k]) m[k] = { name: k, v: 0, c: 0 }; m[k].v++; if (s.contacted) m[k].c++; });
        return Object.values(m);
    }

    function renderBreakdowns(rows) {
        bars('b-source', group(rows, (s) => s.source || 'Không rõ').map((e) => ({ name: e.name, v: e.v, x: e.c ? e.c + ' liên hệ' : '' })));
        const pv = {}, ppl = {};
        rows.forEach((s) => {
            const pages = s.pages || (s.landing ? { [s.landing]: 1 } : {});
            Object.keys(pages).forEach((p) => { pv[p] = (pv[p] || 0) + (pages[p] || 0); ppl[p] = (ppl[p] || 0) + 1; });
        });
        bars('b-pages', Object.keys(pv).map((p) => ({ name: pageName(p), v: pv[p], x: ppl[p] + ' lượt' })), 'lượt xem', 8);
        bars('b-device', group(rows, (s) => deviceName(s.device)).map((e) => ({ name: e.name, v: e.v, x: e.c ? e.c + ' liên hệ' : '' })));
        bars('b-city', group(rows, (s) => viPlace(s.city) || viPlace(s.region) || (s.ip ? 'Không rõ' : 'Đang xác định')).map((e) => ({ name: e.name, v: e.v, x: '' })));
    }

    /* ---------- Bảng ---------- */
    function filtered(rows) {
        const on = onlineMap();
        const q = state.q.trim().toLowerCase();
        const f = state.filter;
        return rows.filter((s) => {
            if (f === 'contacted' && !s.contacted) return false;
            if (f === 'online' && !on[s.sid]) return false;
            if (f === 'returning' && !s.returning) return false;
            if (f === 'mobile' && s.device !== 'Mobile') return false;
            if (!q) return true;
            const hay = [s.city, s.region, s.country, s.ip, s.source, s.campaign, pageName(s.landing), s.landing, s.contactVia, deviceName(s.device), s.os, s.browser]
                .concat(Object.keys(s.pages || {}).map(pageName)).join(' ').toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    function renderTable(rows) {
        const on = onlineMap();
        const counts = { all: rows.length, contacted: 0, online: 0, returning: 0, mobile: 0 };
        rows.forEach((s) => { if (s.contacted) counts.contacted++; if (on[s.sid]) counts.online++; if (s.returning) counts.returning++; if (s.device === 'Mobile') counts.mobile++; });
        document.querySelectorAll('#chips .chip').forEach((b) => {
            const label = b.dataset.label || (b.dataset.label = b.textContent);
            b.innerHTML = esc(label) + '<span class="n">' + counts[b.dataset.f] + '</span>';
            b.classList.toggle('on', b.dataset.f === state.filter);
        });

        const data = filtered(rows);
        const pages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
        if (state.page >= pages) state.page = pages - 1;
        const slice = data.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

        $('tbody').innerHTML = slice.length ? slice.map((s) => {
            const contact = s.contacted
                ? (s.zaloClicks ? '<span class="tag tag-zalo">Zalo' + (s.zaloClicks > 1 ? ' ×' + s.zaloClicks : '') + '</span> ' : '') +
                (s.phoneClicks ? '<span class="tag tag-phone">Gọi' + (s.phoneClicks > 1 ? ' ×' + s.phoneClicks : '') + '</span>' : '')
                : '<span class="tag tag-none">—</span>';
            return '<tr data-sid="' + esc(s.sid) + '">' +
                '<td><div class="t-main">' + hhmm(s.startedAt) + '</div><div class="t-sub">' + esc(dayLabel(s.startedAt)) + '</div></td>' +
                '<td><div class="t-main">' + (on[s.sid] ? '<span class="on-dot" title="Đang online"></span>' : '') + esc(place(s)) + '</div>' +
                '<div class="t-sub"><span class="tag ' + (s.returning ? 'tag-back">Quay lại' : 'tag-new">Mới') + '</span></div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(deviceName(s.device)) + '</div><div class="t-sub">' + esc([s.os, s.browser].filter(Boolean).join(' · ')) + '</div></td>' +
                '<td><div class="t-main">' + esc(s.source || '—') + '</div><div class="t-sub">' + esc(s.campaign || '') + '</div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(pageName(s.landing)) + '</div><div class="t-sub">' + (s.pageViews || 1) + ' trang</div></td>' +
                '<td class="num">' + esc(fmtDur(s.activeSec)) + '</td>' +
                '<td>' + contact + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty">' + (rows.length ? 'Không có lượt nào khớp bộ lọc.' : 'Chưa có lượt truy cập trong khoảng thời gian này.') + '</td></tr>';

        $('pager').innerHTML = data.length
            ? '<span>Hiển thị ' + (state.page * PAGE_SIZE + 1) + '–' + (state.page * PAGE_SIZE + slice.length) + ' trong ' + fmtN(data.length) + ' lượt</span>' +
            (pages > 1 ? '<span class="pg"><button class="btn btn-ghost btn-sm" data-pg="-1"' + (state.page ? '' : ' disabled') + '>← Trước</button>' +
                '<button class="btn btn-ghost btn-sm" data-pg="1"' + (state.page < pages - 1 ? '' : ' disabled') + '>Sau →</button></span>' : '')
            : '';
    }

    /* =====================================================================
     * 5. Chi tiết 1 lượt truy cập
     * ===================================================================== */
    function openDrawer(sid) {
        state.openSid = sid;
        $('scrim').hidden = false;
        $('drawer').classList.add('open');
        $('drawer').setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        const s = sessionOf(sid);
        if (s) renderDrawer(sid, s, null, null);
        else {
            $('d-body').innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
            DS.fetchSession(sid).then((x) => { if (x) { state.extra[sid] = x; renderDrawer(sid, x, null, null); } else $('d-body').innerHTML = '<p class="empty">Không tìm thấy dữ liệu (có thể đã bị xoá).</p>'; });
        }
        if (unEvents) unEvents();
        let evs = null, visits = null;
        unEvents = DS.watchEvents(sid, (v) => { evs = v; if (state.openSid === sid) renderDrawer(sid, sessionOf(sid), evs, visits); });
        if (s && s.visitorId) DS.visitorSessions(s.visitorId).then((v) => { visits = v; if (state.openSid === sid) renderDrawer(sid, sessionOf(sid), evs, visits); }).catch(() => { });
        setTimeout(() => $('d-close').focus(), 50);
    }

    function closeDrawer() {
        state.openSid = null;
        $('drawer').classList.remove('open');
        $('drawer').setAttribute('aria-hidden', 'true');
        $('scrim').hidden = true;
        document.body.style.overflow = '';
        if (unEvents) { unEvents(); unEvents = null; }
    }

    function renderDrawer(sid, s, evs, visits) {
        if (!s) return;
        const on = onlineMap()[sid];
        $('d-title').textContent = place(s);
        $('d-sub').innerHTML = esc(dayLabel(s.startedAt) + ' lúc ' + hhmm(s.startedAt)) + (on ? ' · <b style="color:var(--up)">' + (on.active ? 'Đang xem web' : 'Mở ở tab nền') + '</b>' : '');

        let refHost = '';
        try { refHost = s.referrer ? new URL(s.referrer).hostname : ''; } catch (e) { refHost = ''; }
        const fact = (k, v, wide) => '<div' + (wide ? ' class="wide"' : '') + '><dt>' + k + '</dt><dd>' + v + '</dd></div>';
        let html = '<dl class="facts">' +
            fact('Nguồn', esc(s.source || '—') + (refHost && refHost !== s.source ? '<div class="small muted">' + esc(refHost) + '</div>' : '') + (s.campaign ? '<div class="small muted">Chiến dịch: ' + esc(s.campaign) + '</div>' : '')) +
            fact('Khách', s.returning ? 'Quay lại' : 'Lần đầu ghé') +
            fact('Trang vào đầu tiên', esc(pageName(s.landing))) +
            fact('Số trang đã xem', (s.pageViews || 1) + ' trang') +
            fact('Thời gian xem thực', esc(fmtDur(s.activeSec))) +
            fact('Hoạt động cuối', s.lastSeen ? esc(hhmm(s.lastSeen) + ', ' + dayLabel(s.lastSeen)) : '—') +
            fact('Thiết bị', esc(deviceName(s.device)) + '<div class="small muted">' + esc([s.os, s.browser, s.screen].filter(Boolean).join(' · ')) + '</div>') +
            fact('Vị trí (theo IP)', esc([viPlace(s.city), viPlace(s.region), viPlace(s.country)].filter(Boolean).join(', ') || '—') + '<div class="small muted">IP ' + esc(s.ip || 'chưa có') + '</div>') +
            (s.contacted ? fact('Liên hệ', '<b>' + esc((s.contactVia || '').replace(/ · [a-z]+$/, '') || 'Có') + '</b><div class="small muted">' + esc(s.contactAt ? hhmm(s.contactAt) : '') + (s.contactPage ? ' · ở ' + esc(pageName(s.contactPage)) : '') + '</div>', true) : '') +
            '</dl>';

        html += '<section><div class="section-title">Hành trình</div>';
        if (!evs) html += '<p class="muted small">Đang tải…</p>';
        else {
            const list = Object.values(evs).filter((e) => e && e.at).sort((a, b) => a.at - b.at);
            html += list.length ? '<ul class="timeline">' + list.map((e) => {
                const after = e.at - s.startedAt;
                let label = e.label || e.t;
                if (e.t === 'page_view') label = 'Xem trang ' + pageName(e.page);
                else if (e.t === 'click_zalo') label = 'Bấm Zalo: “' + (e.label || '').replace(/ · [a-z]+$/, '') + '”';
                else if (e.t === 'click_phone') label = 'Bấm ' + (e.label || 'gọi điện');
                else if (e.t === 'click') label = 'Bấm “' + (e.label || 'nút') + '”';
                else if (e.t === 'click_out') label = 'Mở liên kết ngoài: ' + e.label;
                else if (e.t === 'click_email') label = 'Bấm email ' + e.label;
                const strong = e.t === 'click_zalo' || e.t === 'click_phone';
                return '<li><span class="tl-ico k-' + esc(e.t) + '">' + (ICON[e.t] || ICON.click) + '</span><div class="tl-body">' +
                    '<div class="tl-label' + (strong ? ' strong' : '') + '">' + esc(label) + '</div>' +
                    '<div class="tl-meta">' + hhmmss(e.at) + (after > 1000 ? ' · sau ' + esc(fmtDur(after / 1000)) : '') + (e.t !== 'page_view' && e.page ? ' · ' + esc(pageName(e.page)) : '') + '</div></div></li>';
            }).join('') + '</ul>' : '<p class="muted small">Không có hành động nào được ghi lại.</p>';
        }
        html += '</section>';

        if (visits) {
            const vs = Object.keys(visits).map((k) => Object.assign({ sid: k }, visits[k])).filter((v) => v.startedAt).sort((a, b) => b.startedAt - a.startedAt);
            if (vs.length > 1) {
                html += '<section><div class="section-title">Các lượt ghé của khách này (' + vs.length + ')</div><ul class="other-visits">' +
                    vs.map((v) => '<li data-sid="' + esc(v.sid) + '"' + (v.sid === sid ? ' class="cur"' : '') + '><span>' + esc(dayLabel(v.startedAt) + ' ' + hhmm(v.startedAt)) + ' · ' + (v.pageViews || 1) + ' trang · ' + esc(fmtDur(v.activeSec)) + '</span>' +
                        (v.contacted ? '<span class="tag tag-zalo">Đã liên hệ</span>' : '') + '</li>').join('') + '</ul></section>';
            }
        }

        html += '<div class="danger-zone"><span class="small muted">Xoá vĩnh viễn lượt truy cập này và hành trình của nó.</span>' +
            '<form class="pin-form" id="d-delete-form" autocomplete="off"><input class="pin-input" id="d-pin" type="password" inputmode="numeric" maxlength="8" placeholder="Mã PIN" aria-label="Mã PIN để xoá">' +
            '<button class="btn btn-danger btn-sm" type="submit">Xoá lượt này</button></form><p class="form-msg" id="d-pin-msg" role="alert"></p></div>';
        $('d-body').innerHTML = html;
    }

    async function sha256(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function handleDelete(form) {
        const sid = state.openSid;
        if (!sid) return;
        const input = $('d-pin'), msg = $('d-pin-msg'), btn = form.querySelector('button');
        const pin = input.value.trim();
        if (!pin) { msg.textContent = 'Nhập mã PIN để xoá.'; input.focus(); return; }
        let ok = false;
        try { ok = (await sha256('hohai-vn:' + pin)) === PIN_HASH; } catch (e) { ok = false; }
        if (!ok) { msg.textContent = 'Mã PIN không đúng.'; input.value = ''; input.focus(); return; }
        btn.disabled = true;
        btn.textContent = 'Đang xoá…';
        DS.deleteSession(sid).then(() => {
            delete state.sessions[sid]; delete state.extra[sid];
            closeDrawer(); toast('Đã xoá lượt truy cập.'); scheduleRender();
        }).catch(() => { btn.disabled = false; btn.textContent = 'Xoá lượt này'; msg.textContent = 'Không xoá được (mất mạng hoặc bị chặn quyền).'; });
    }

    /* =====================================================================
     * 6. Xuất CSV (mở được bằng Excel / Google Sheets)
     * ===================================================================== */
    function exportCsv() {
        const R = rangeInfo();
        const data = filtered(list(R.start, R.end + 1));
        if (!data.length) { toast('Không có dữ liệu để xuất.'); return; }
        const head = ['Ngày', 'Giờ bắt đầu', 'Hoạt động cuối', 'Mã khách', 'Khách', 'Thành phố', 'Vùng', 'Quốc gia', 'IP', 'Thiết bị', 'Hệ điều hành', 'Trình duyệt',
            'Nguồn', 'Chiến dịch', 'Trang vào', 'Số trang', 'Thời gian xem (giây)', 'Đã liên hệ', 'Số lần bấm Zalo', 'Số lần bấm gọi', 'Liên hệ qua nút'];
        const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const lines = [head.join(',')].concat(data.map((s) => [
            fullDate(s.startedAt), hhmmss(s.startedAt), s.lastSeen ? hhmmss(s.lastSeen) : '', s.visitorId, s.returning ? 'Quay lại' : 'Mới',
            s.city, s.region, s.country, s.ip, deviceName(s.device), s.os, s.browser, s.source, s.campaign, pageName(s.landing),
            s.pageViews || 1, Math.round(s.activeSec || 0), s.contacted ? 'Có' : 'Không', s.zaloClicks || 0, s.phoneClicks || 0, (s.contactVia || '').replace(/ · [a-z]+$/, '')
        ].map(cell).join(',')));
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'truy-cap-hohai-vn_' + fullDate(R.start).split('/').reverse().join('-') + '_' + state.range + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Đã xuất ' + data.length + ' lượt truy cập.');
    }

    /* =====================================================================
     * 7. Khởi động
     * ===================================================================== */
    let toastTimer = null;
    function toast(msg) {
        const t = $('toast');
        t.textContent = msg; t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
    }

    function show(screen) {
        ['screen-loading', 'screen-app'].forEach((id) => { $(id).hidden = id !== screen; });
    }

    function subscribe() {
        if (unSessions) unSessions();
        const R = rangeInfo();
        state.sessions = {};
        scheduleRender();
        unSessions = DS.watchSessions(R.prevStart, (val) => { state.sessions = val; scheduleRender(); }, (err) => {
            setConn('bad', 'Không đọc được dữ liệu');
            toast(err && /permission/i.test(err.message || err.code || '') ? 'Firebase từ chối quyền đọc dữ liệu.' : 'Lỗi tải dữ liệu.');
        });
    }

    function setConn(cls, text) {
        $('conn').className = 'conn ' + cls;
        $('conn-text').textContent = text;
    }

    let appStarted = false;
    function startApp() {
        show('screen-app');
        if (appStarted) return;
        appStarted = true;
        try { localStorage.setItem(LS_OFF, '1'); } catch (e) { } // máy đã mở dashboard thì không tính vào thống kê web

        DS.onConn((ok) => setConn(ok ? 'ok' : 'bad', ok ? 'Trực tiếp' : 'Mất kết nối'));
        unPresence = DS.watchPresence((val) => { state.presence = val; scheduleRender(); }, () => { });
        subscribe();

        $('range-seg').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-range]');
            if (!b || b.dataset.range === state.range) return;
            state.range = b.dataset.range; state.page = 0;
            document.querySelectorAll('#range-seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
            subscribe();
        });
        $('chips').addEventListener('click', (e) => {
            const b = e.target.closest('.chip');
            if (!b) return;
            state.filter = b.dataset.f; state.page = 0; scheduleRender();
        });
        let qTimer = null;
        $('search').addEventListener('input', (e) => {
            clearTimeout(qTimer);
            qTimer = setTimeout(() => { state.q = e.target.value; state.page = 0; scheduleRender(); }, 150);
        });
        $('pager').addEventListener('click', (e) => {
            const b = e.target.closest('[data-pg]');
            if (!b) return;
            state.page += +b.dataset.pg; scheduleRender();
            document.querySelector('.card-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        document.addEventListener('click', (e) => {
            const row = e.target.closest('[data-sid]');
            if (row) {
                if (row.closest('.drawer') && row.classList.contains('cur')) return;
                openDrawer(row.dataset.sid);
            }
        });
        document.addEventListener('submit', (e) => {
            if (e.target.id !== 'd-delete-form') return;
            e.preventDefault();
            handleDelete(e.target);
        });
        $('d-close').addEventListener('click', closeDrawer);
        $('scrim').addEventListener('click', closeDrawer);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openSid) closeDrawer(); });
        $('export-btn').addEventListener('click', exportCsv);

        let rTimer = null;
        window.addEventListener('resize', () => { clearTimeout(rTimer); rTimer = setTimeout(scheduleRender, 120); });
        // làm mới "đang online", thời gian tương đối; qua 0h thì tự chuyển sang ngày mới
        let day = vnDayStart(now());
        setInterval(() => {
            const d = vnDayStart(now());
            if (d !== day) { day = d; subscribe(); } else scheduleRender();
        }, 20e3);
    }

    function bootFirebase() {
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG.firebase);
        DS = firebaseSource(app);
        startApp();
    }

    if (isDemo) {
        DS = demoSource();
        $('demo-bar').hidden = false;
        startApp();
    } else if (!window.firebase || !CFG) {
        $('screen-loading').innerHTML = '<p class="muted">Không tải được Firebase. Kiểm tra kết nối mạng hoặc tắt trình chặn quảng cáo rồi tải lại trang.</p>';
    } else {
        bootFirebase();
    }
})();
