/**
 * monitor.js — Dashboard giám sát truy cập cho web HoHai Việt Nam (analytics.html)
 * ---------------------------------------------------------------------------------
 * - Không cần đăng nhập (giống monitor cũ của web US). Xoá dữ liệu phải nhập mã PIN; PIN lưu dạng mã băm SHA-256.
 *   Lưu ý: đây chỉ là chặn ở giao diện — database Firebase vẫn để mở như web US.
 * - Đọc realtime: sessions (lọc theo startedAt), presence (đang online), events (khi mở chi tiết).
 * - Mọi mốc giờ hiển thị theo giờ Việt Nam (GMT+7), không phụ thuộc múi giờ máy đang xem.
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

    /* ---------- Ngôn ngữ: Tiếng Việt / 中文 (giản thể) ----------
     * T('chữ Việt', '中文') trả về đúng ngôn ngữ đang chọn. Chữ cố định trong analytics.html
     * được dịch qua thuộc tính data-zh (xem applyStaticLang). Lựa chọn lưu theo từng máy. */
    const LS_LANG = 'hohai_vn_monitor_lang';
    let LANG = (() => { try { return localStorage.getItem(LS_LANG) === 'zh' ? 'zh' : 'vi'; } catch (e) { return 'vi'; } })();
    const T = (vi, zh) => (LANG === 'zh' ? zh : vi);

    const PAGE_NAMES = {
        'index': ['Trang chủ', '首页'],
        'khay-ve-sinh-co': ['Khay vệ sinh cỏ', '草坪宠物厕所'],
        'tham-co-ban-cong': ['Thảm cỏ ban công', '阳台草坪垫'],
        'cuon-co-trai-cho': ['Cuộn cỏ trại chó', '犬舍草坪卷'],
        'gioi-thieu': ['Giới thiệu', '关于我们'],
        'lien-he': ['Liên hệ', '联系我们'],
        'chinh-sach-bao-hanh': ['Chính sách bảo hành', '保修政策'],
        'chinh-sach-bao-mat': ['Chính sách bảo mật', '隐私政策']
    };
    const DEVICE_NAMES = { Mobile: ['Điện thoại', '手机'], Desktop: ['Máy tính', '电脑'], Tablet: ['Máy tính bảng', '平板'] };
    const RANGE_TEXT = {
        today: { title: ['Hôm nay', '今天'], cmp: ['so với cùng giờ hôm qua', '对比昨天同一时段'], bucket: 'hour' },
        yesterday: { title: ['Hôm qua', '昨天'], cmp: ['so với hôm kia', '对比前天'], bucket: 'hour' },
        '7d': { title: ['7 ngày qua', '最近 7 天'], cmp: ['so với 7 ngày trước đó', '对比前 7 天'], bucket: 'day' },
        '30d': { title: ['30 ngày qua', '最近 30 天'], cmp: ['so với 30 ngày trước đó', '对比前 30 天'], bucket: 'day' }
    };
    // Nút Zalo trên web gắn mã (data-msg) ở cuối nhãn: "Gửi ảnh ban công, nhận báo giá · hero"
    const ZALO_KEYS_ZH = {
        chat: '咨询', claim: '申请保修', data: '索取资料', form: '提交信息', partner: '代理/合作洽谈', photo: '发照片求报价',
        price: '询价', program: '了解合作计划', quote: '按面积获取报价', sample: '索取试用样品', size: '咨询尺寸选择',
        support: '售后支持', wizard: '发送推荐结果', hero: '发阳台照片求报价', fit: '发送测量结果求报价', order: '下单'
    };
    // Nhãn nút liên hệ khách đã bấm, theo ngôn ngữ đang chọn
    function viaText(v) {
        v = String(v || '');
        const m = v.match(/^(.*) · ([a-z]+)$/);
        if (LANG !== 'zh') return m ? m[1] : v;
        if (m && ZALO_KEYS_ZH[m[2]]) return ZALO_KEYS_ZH[m[2]];
        if (/^Gọi /.test(v)) return '拨打 ' + v.slice(4);
        return m ? m[1] : v;
    }
    const srcName = (s) => !s ? '—' : s === 'Trực tiếp' ? T('Trực tiếp', '直接访问') : s;

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtN = (n) => Number(n || 0).toLocaleString('vi-VN');

    /* =====================================================================
     * 1. Định dạng thời gian theo giờ Việt Nam
     * ===================================================================== */
    const vnDayStart = (ts) => Math.floor((ts + VN) / DAY) * DAY - VN;
    const vnDate = (ts) => new Date(ts + VN); // đọc bằng getUTC*
    const pad = (n) => String(n).padStart(2, '0');
    const WD_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const WD_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const wd = (ts) => T(WD_VI, WD_ZH)[vnDate(ts).getUTCDay()];

    function hhmm(ts) { const d = vnDate(ts); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    function hhmmss(ts) { const d = vnDate(ts); return hhmm(ts) + ':' + pad(d.getUTCSeconds()); }
    // Tiếng Việt: 26/11 · 26/11/2026 — 中文: 11-26 · 2026-11-26
    function ddmm(ts) { const d = vnDate(ts); return T(pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1), pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())); }
    function fullDate(ts) { const d = vnDate(ts); return T(ddmm(ts) + '/' + d.getUTCFullYear(), d.getUTCFullYear() + '-' + ddmm(ts)); }
    function dayLabel(ts) {
        const t0 = vnDayStart(now());
        if (ts >= t0) return T('Hôm nay', '今天');
        if (ts >= t0 - DAY) return T('Hôm qua', '昨天');
        return wd(ts) + ', ' + ddmm(ts);
    }
    function relTime(ts) {
        const diff = now() - ts;
        if (diff < 60e3) return T('vừa xong', '刚刚');
        if (diff < HOUR) return Math.floor(diff / 60e3) + T(' phút trước', ' 分钟前');
        if (diff < 6 * HOUR) return Math.floor(diff / HOUR) + T(' giờ trước', ' 小时前');
        return dayLabel(ts) + ' ' + hhmm(ts);
    }
    // Luôn giữ đủ số giây: 45 giây · 3 phút 05 giây · 1 giờ 02 phút 07 giây (中文: 45秒 · 3分05秒 · 1小时02分07秒)
    function fmtDur(sec) {
        sec = Math.max(0, Math.round(sec || 0));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (LANG === 'zh') return sec < 60 ? sec + '秒' : (h ? h + '小时' + pad(m) + '分' : m + '分') + pad(s) + '秒';
        if (sec < 60) return sec + ' giây';
        if (h) return h + ' giờ ' + pad(m) + ' phút ' + pad(s) + ' giây';
        return m + ' phút ' + pad(s) + ' giây';
    }
    // Ngày giờ đầy đủ tới giây: 26/11/2026 14:05:09
    const fullTime = (ts) => fullDate(ts) + ' ' + hhmmss(ts);

    const pick = (pair) => (Array.isArray(pair) ? T(pair[0], pair[1]) : pair);
    const pageName = (k) => (PAGE_NAMES[k] ? pick(PAGE_NAMES[k]) : k || '—');
    const deviceName = (d) => (DEVICE_NAMES[d] ? pick(DEVICE_NAMES[d]) : d || T('Không rõ', '未知'));
    const ZH_PLACES = {
        'TP. Hồ Chí Minh': '胡志明市', 'Hà Nội': '河内', 'Đà Nẵng': '岘港', 'Hải Phòng': '海防', 'Cần Thơ': '芹苴', 'Biên Hòa': '边和',
        'Thủ Dầu Một': '土龙木', 'Thủ Đức': '守德', 'Dĩ An': '夷安', 'Thuận An': '顺安', 'Nha Trang': '芽庄', 'Huế': '顺化', 'Vũng Tàu': '头顿',
        'Đà Lạt': '大叻', 'Buôn Ma Thuột': '邦美蜀', 'Quy Nhơn': '归仁', 'Vinh': '荣市', 'Long Xuyên': '龙川', 'Mỹ Tho': '美萩', 'Rạch Giá': '迪石',
        'Bắc Ninh': '北宁', 'Hải Dương': '海阳', 'Nam Định': '南定', 'Thái Nguyên': '太原', 'Hạ Long': '下龙', 'Thanh Hóa': '清化',
        'Bình Dương': '平阳', 'Đồng Nai': '同奈', 'Long An': '隆安', 'Khánh Hòa': '庆和', 'Lâm Đồng': '林同', 'Quảng Ninh': '广宁',
        'Bà Rịa - Vũng Tàu': '巴地头顿', 'Tây Ninh': '西宁', 'Pleiku': '波来古', 'Phan Thiết': '藩切', 'Việt Nam': '越南'
    };
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
    const viPlace = (n) => {
        const v = (n && VI_PLACES[String(n).toLowerCase().replace(/^(thanh pho|tinh)\s+/, '')]) || n || '';
        return LANG === 'zh' ? (ZH_PLACES[v] || v) : v;
    };
    function place(s) {
        if (!s) return T('Chưa rõ vị trí', '位置未知');
        let p = viPlace(s.city) || viPlace(s.region) || '';
        if (s.cc && s.cc !== 'VN') p = p ? p + ', ' + (s.country || s.cc) : (s.country || s.cc);
        return p || (s.ip ? T('Chưa rõ vị trí', '位置未知') : T('Đang xác định vị trí…', '正在定位…'));
    }

    /* =====================================================================
     * 2. Nguồn dữ liệu: Firebase
     * ===================================================================== */
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
            // Sao lưu: đọc 1 lần các lượt bắt đầu trong [from, to] và toàn bộ hành động của 1 lượt
            fetchSessionsBetween(from, to) {
                return r('sessions').orderByChild('startedAt').startAt(from).endAt(to).once('value').then((s) => s.val() || {});
            },
            fetchEvents(sid) { return r('events/' + sid).once('value').then((s) => s.val() || {}); },
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
        const RT = RANGE_TEXT[state.range];
        return { start: R[0], end: R[1], prevStart: R[2], prevEnd: R[3], title: pick(RT.title), cmp: pick(RT.cmp), bucket: RT.bucket };
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
            ? wd(R.start) + ', ' + fullDate(R.start)
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
        if (!prev) return '<span class="delta flat">' + T('Kỳ trước chưa có dữ liệu', '上一周期暂无数据') + '</span>';
        const pct = Math.round((cur - prev) / prev * 100);
        if (pct === 0) return '<span class="delta flat">' + T('Không đổi', '持平') + '</span> ' + R.cmp;
        const good = invert ? pct < 0 : pct > 0;
        return '<span class="delta ' + (good ? 'up' : 'down') + '">' + (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%</span> ' + R.cmp;
    }

    function renderKpis(rows, prevRows, R) {
        const m = metrics(rows), p = metrics(prevRows);
        $('k-sessions').textContent = fmtN(m.sessions);
        $('k-sessions-sub').innerHTML = delta(m.sessions, p.sessions, R);
        $('k-visitors').textContent = fmtN(m.visitors);
        $('k-visitors-sub').textContent = m.visitors ? Math.round(m.newVisitors / m.visitors * 100) + T('% khách lần đầu ghé', '% 为首次访问') : '';
        $('k-contacts').textContent = fmtN(m.contacts);
        $('k-contacts-sub').innerHTML = m.sessions
            ? T('Tỉ lệ ' + (m.rate * 100).toFixed(1).replace('.', ',') + '% · Zalo ' + m.zalo + ' · Gọi ' + m.phone,
                '咨询率 ' + (m.rate * 100).toFixed(1) + '% · Zalo ' + m.zalo + ' · 电话 ' + m.phone)
            : T('Chưa có lượt truy cập', '暂无访问');
        $('k-time').textContent = m.sessions ? fmtDur(m.avgTime) : '—';
        $('k-time-sub').textContent = m.sessions ? Math.round(m.bounce * 100) + T('% thoát nhanh (dưới 10 giây, 1 trang)', '% 快速跳出（不足 10 秒且只看 1 页）') : '';
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
        $('chart-title').textContent = hourly ? T('Lượt truy cập theo giờ', '每小时访问量') : T('Lượt truy cập theo ngày', '每日访问量');

        const W = Math.max(280, el.clientWidth), H = el.clientHeight || 280;
        const pl = 34, pr = 6, pt = 10, pb = 28;
        const cw = W - pl - pr, ch = H - pt - pb;
        const max = niceMax(Math.max(1, ...visits));
        const bw = cw / n;
        const barW = Math.max(3, Math.min(18, bw * 0.36));
        const y = (v) => pt + ch - (v / max) * ch;
        const nowIdx = state.range === 'today' ? Math.floor((now() - R.start) / size) : n;

        let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + T('Biểu đồ lượt truy cập', '访问量图表') + '">';
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
                const head = hourly ? pad(i) + ':00 – ' + pad(i + 1) + ':00' : wd(R.start + i * DAY) + ', ' + ddmm(R.start + i * DAY);
                tip.innerHTML = '<b>' + head + '</b><br>' + T('Lượt truy cập', '访问') + ': <b>' + visits[i] + '</b><br>' + T('Liên hệ', '咨询') + ': <b>' + contacts[i] + '</b>';
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
            ? (active ? active + T(' khách đang xem', ' 位访客正在浏览') : T('Không ai đang xem', '无人正在浏览')) + (bg ? ' · ' + bg + T(' mở ở tab nền', ' 个后台标签页') : '')
            : T('Chưa có ai', '暂无访客');
        $('online-pill').textContent = all.length ? active + T(' đang xem', ' 人在看') : '0';
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
                '<span class="o-sub">' + (o.active ? T('Đang xem ', '正在看 ') : T('Tab nền · ', '后台标签页 · ')) + esc(pageName(o.page)) + (s.source ? ' · ' + esc(srcName(s.source)) : '') + '</span></span>' +
                '<span class="o-time">' + esc(since) + '</span></li>';
        }).join('') : '<li class="empty">' + T('Hiện không có ai trên web.', '当前网站上没有访客。') + '</li>';
    }

    /* ---------- Khách đã liên hệ ---------- */
    function renderContacts(rows) {
        const c = rows.filter((s) => s.contacted).sort((a, b) => (b.contactAt || b.startedAt) - (a.contactAt || a.startedAt));
        const shown = c.slice(0, 12);
        $('contacts-count').textContent = c.length ? c.length + T(' lượt', ' 次') + (c.length > shown.length ? T(' · hiện ' + shown.length + ' gần nhất, xem hết ở bảng bên dưới', ' · 显示最近 ' + shown.length + ' 条，完整记录见下方表格') : '') : '';
        $('contact-list').innerHTML = shown.length ? shown.map((s) => {
            const isPhone = !s.zaloClicks && s.phoneClicks;
            const via = viaText(s.contactVia) || (isPhone ? T('Gọi điện', '打电话') : 'Zalo');
            return '<li data-sid="' + esc(s.sid) + '">' +
                '<span class="c-ico' + (isPhone ? ' phone' : '') + '">' + (isPhone ? ICON.phone : ICON.zalo) + '</span>' +
                '<span class="c-main"><span class="c-top"><span class="c-title">' + esc(place(s)) + '</span><span class="c-when">' + esc(relTime(s.contactAt || s.startedAt)) + '</span></span>' +
                '<div class="c-via">' + (isPhone ? T('Bấm gọi', '点击电话') : T('Bấm Zalo', '点击 Zalo')) + ': “' + esc(via) + '”' + (s.contactPage ? T(' ở ', ' · 页面：') + esc(pageName(s.contactPage)) : '') + '</div>' +
                '<div class="c-meta">' + esc(deviceName(s.device)) + ' · ' + esc(srcName(s.source)) + T(' · xem ', ' · 浏览 ') + esc(fmtDur(s.activeSec)) + ' · ' + (s.pageViews || 1) + T(' trang', ' 页') + '</div></span></li>';
        }).join('') : '<li class="empty">' + T('Chưa có khách nào bấm Zalo hoặc gọi điện trong khoảng thời gian này.', '该时间段内还没有访客点击 Zalo 或电话。') + '</li>';
    }

    /* ---------- Tỉ lệ theo nhóm ---------- */
    function bars(id, entries, unit, limit) {
        limit = limit || 6;
        const el = $(id);
        if (!entries.length) { el.innerHTML = '<li class="empty">' + T('Chưa có dữ liệu', '暂无数据') + '</li>'; return; }
        entries.sort((a, b) => b.v - a.v);
        let top = entries.slice(0, limit);
        if (entries.length > limit) {
            const rest = entries.slice(limit);
            top.push({ name: T('Khác', '其他'), v: rest.reduce((a, e) => a + e.v, 0), x: '' });
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
        const cx = (e) => (e.c ? e.c + T(' liên hệ', ' 次咨询') : '');
        bars('b-source', group(rows, (s) => (s.source ? srcName(s.source) : T('Không rõ', '未知'))).map((e) => ({ name: e.name, v: e.v, x: cx(e) })));
        const pv = {}, ppl = {};
        rows.forEach((s) => {
            const pages = s.pages || (s.landing ? { [s.landing]: 1 } : {});
            Object.keys(pages).forEach((p) => { pv[p] = (pv[p] || 0) + (pages[p] || 0); ppl[p] = (ppl[p] || 0) + 1; });
        });
        bars('b-pages', Object.keys(pv).map((p) => ({ name: pageName(p), v: pv[p], x: ppl[p] + T(' lượt', ' 次访问') })), '', 8);
        bars('b-device', group(rows, (s) => deviceName(s.device)).map((e) => ({ name: e.name, v: e.v, x: cx(e) })));
        bars('b-city', group(rows, (s) => viPlace(s.city) || viPlace(s.region) || (s.ip ? T('Không rõ', '未知') : T('Đang xác định', '定位中'))).map((e) => ({ name: e.name, v: e.v, x: '' })));
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
            const hay = [s.city, s.region, s.country, viPlace(s.city), viPlace(s.region), s.ip, s.source, srcName(s.source), s.campaign, pageName(s.landing), s.landing, s.contactVia, viaText(s.contactVia), deviceName(s.device), s.os, s.browser]
                .concat(Object.keys(s.pages || {}).map(pageName)).join(' ').toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    function renderTable(rows) {
        const on = onlineMap();
        const counts = { all: rows.length, contacted: 0, online: 0, returning: 0, mobile: 0 };
        rows.forEach((s) => { if (s.contacted) counts.contacted++; if (on[s.sid]) counts.online++; if (s.returning) counts.returning++; if (s.device === 'Mobile') counts.mobile++; });
        document.querySelectorAll('#chips .chip').forEach((b) => {
            const label = T(b.dataset.label, b.dataset.labelZh);
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
                (s.phoneClicks ? '<span class="tag tag-phone">' + T('Gọi', '电话') + (s.phoneClicks > 1 ? ' ×' + s.phoneClicks : '') + '</span>' : '')
                : '<span class="tag tag-none">—</span>';
            return '<tr data-sid="' + esc(s.sid) + '">' +
                '<td><div class="t-main">' + hhmmss(s.startedAt) + '</div><div class="t-sub">' + esc(dayLabel(s.startedAt)) + '</div></td>' +
                '<td><div class="t-main">' + (on[s.sid] ? '<span class="on-dot" title="' + T('Đang online', '在线') + '"></span>' : '') + esc(place(s)) + '</div>' +
                '<div class="t-sub"><span class="tag ' + (s.returning ? 'tag-back">' + T('Quay lại', '回访') : 'tag-new">' + T('Mới', '新访客')) + '</span></div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(deviceName(s.device)) + '</div><div class="t-sub">' + esc([s.os, s.browser].filter(Boolean).join(' · ')) + '</div></td>' +
                '<td><div class="t-main">' + esc(srcName(s.source)) + '</div><div class="t-sub">' + esc(s.campaign || '') + '</div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(pageName(s.landing)) + '</div><div class="t-sub">' + (s.pageViews || 1) + T(' trang', ' 页') + '</div></td>' +
                '<td class="num">' + esc(fmtDur(s.activeSec)) + '</td>' +
                '<td>' + contact + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty">' + (rows.length ? T('Không có lượt nào khớp bộ lọc.', '没有符合筛选条件的访问。') : T('Chưa có lượt truy cập trong khoảng thời gian này.', '该时间段内暂无访问。')) + '</td></tr>';

        const from = state.page * PAGE_SIZE + 1, to = state.page * PAGE_SIZE + slice.length;
        $('pager').innerHTML = data.length
            ? '<span>' + T('Hiển thị ' + from + '–' + to + ' trong ' + fmtN(data.length) + ' lượt', '显示第 ' + from + '–' + to + ' 条，共 ' + fmtN(data.length) + ' 条') + '</span>' +
            (pages > 1 ? '<span class="pg"><button class="btn btn-ghost btn-sm" data-pg="-1"' + (state.page ? '' : ' disabled') + '>' + T('← Trước', '← 上一页') + '</button>' +
                '<button class="btn btn-ghost btn-sm" data-pg="1"' + (state.page < pages - 1 ? '' : ' disabled') + '>' + T('Sau →', '下一页 →') + '</button></span>' : '')
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
        if (unEvents) unEvents();
        let evs = null, visits = null;
        const redraw = () => { if (state.openSid === sid) renderDrawer(sid, sessionOf(sid), evs, visits); };
        state.redrawDrawer = redraw; // dùng khi đổi ngôn ngữ lúc đang mở chi tiết
        const loadVisits = (x) => {
            if (!x || !x.visitorId) { visits = {}; redraw(); return; }
            DS.visitorSessions(x.visitorId).then((v) => { visits = v; redraw(); }).catch(() => { visits = {}; redraw(); });
        };
        if (s) { renderDrawer(sid, s, null, null); loadVisits(s); }
        else {
            $('d-body').innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
            DS.fetchSession(sid).then((x) => { if (x) { state.extra[sid] = x; renderDrawer(sid, x, evs, null); loadVisits(x); } else $('d-body').innerHTML = '<p class="empty">' + T('Không tìm thấy dữ liệu (có thể đã bị xoá).', '找不到数据（可能已被删除）。') + '</p>'; });
        }
        unEvents = DS.watchEvents(sid, (v) => { evs = v; redraw(); });
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
        $('d-sub').innerHTML = esc(dayLabel(s.startedAt) + T(' lúc ', ' ') + hhmmss(s.startedAt)) + (on ? ' · <b style="color:var(--up)">' + (on.active ? T('Đang xem web', '正在浏览') : T('Mở ở tab nền', '在后台标签页打开')) + '</b>' : '');

        let refHost = '';
        try { refHost = s.referrer ? new URL(s.referrer).hostname : ''; } catch (e) { refHost = ''; }
        const fact = (k, v, wide) => '<div' + (wide ? ' class="wide"' : '') + '><dt>' + k + '</dt><dd>' + v + '</dd></div>';
        let html = '<dl class="facts">' +
            fact(T('Nguồn', '来源'), esc(srcName(s.source)) + (refHost && refHost !== s.source ? '<div class="small muted">' + esc(refHost) + '</div>' : '') + (s.campaign ? '<div class="small muted">' + T('Chiến dịch: ', '推广活动：') + esc(s.campaign) + '</div>' : '')) +
            fact(T('Khách', '访客'), s.returning ? T('Quay lại', '回访') : T('Lần đầu ghé', '首次访问')) +
            fact(T('Trang vào đầu tiên', '首个进入页面'), esc(pageName(s.landing))) +
            fact(T('Số trang đã xem', '浏览页数'), (s.pageViews || 1) + T(' trang', ' 页')) +
            fact(T('Thời gian xem thực', '实际浏览时长'), esc(fmtDur(s.activeSec))) +
            fact(T('Hoạt động cuối', '最后活动'), s.lastSeen ? esc(hhmmss(s.lastSeen) + ', ' + dayLabel(s.lastSeen)) : '—') +
            fact(T('Thiết bị', '设备'), esc(deviceName(s.device)) + '<div class="small muted">' + esc([s.os, s.browser, s.screen].filter(Boolean).join(' · ')) + '</div>') +
            fact(T('Vị trí (theo IP)', '位置（按 IP）'), esc([viPlace(s.city), viPlace(s.region), viPlace(s.country)].filter(Boolean).join(', ') || '—') + '<div class="small muted">IP ' + esc(s.ip || T('chưa có', '暂无')) + '</div>') +
            (s.contacted ? fact(T('Liên hệ', '咨询'), '<b>' + esc(viaText(s.contactVia) || T('Có', '有')) + '</b><div class="small muted">' + esc(s.contactAt ? hhmmss(s.contactAt) : '') + (s.contactPage ? T(' · ở ', ' · 页面：') + esc(pageName(s.contactPage)) : '') + '</div>', true) : '') +
            '</dl>';

        // Lịch sử ghé thăm của cùng 1 khách (cùng trình duyệt/thiết bị): vào lúc nào, mấy lần
        html += '<section><div class="section-title">' + T('Lịch sử ghé thăm', '访问历史') + '</div>';
        if (!visits) html += '<p class="muted small">' + T('Đang tải…', '加载中…') + '</p>';
        else {
            const vs = Object.keys(visits).map((k) => Object.assign({ sid: k }, visits[k])).filter((v) => v.startedAt);
            if (!vs.some((v) => v.sid === sid)) vs.push(Object.assign({ sid }, s));
            vs.sort((a, b) => a.startedAt - b.startedAt);
            vs.forEach((v, i) => { v.n = i + 1; });
            const idx = vs.findIndex((v) => v.sid === sid) + 1;
            const total = vs.length;
            const sumSec = vs.reduce((a, v) => a + (v.activeSec || 0), 0);
            const contacts = vs.filter((v) => v.contacted).length;
            const first = vs[0], last = vs[total - 1];
            html += '<div class="visit-sum">' +
                '<div><b>' + total + '</b><span>' + T('lần vào web', '次访问网站') + '</span></div>' +
                '<div><b>' + esc(fmtDur(sumSec)) + '</b><span>' + T('tổng thời gian xem', '总浏览时长') + '</span></div>' +
                '<div><b>' + contacts + '</b><span>' + T('lần có liên hệ', '次有咨询') + '</span></div>' +
                '</div>' +
                '<p class="small muted visit-range">' + (total > 1
                    ? T('Lần đầu: <b>', '首次：<b>') + esc(fullTime(first.startedAt)) + T('</b> · Gần nhất: <b>', '</b> · 最近：<b>') + esc(fullTime(last.startedAt)) +
                    T('</b> · Lượt đang xem là <b>lần thứ ' + idx + '</b>.', '</b> · 当前查看的是<b>第 ' + idx + ' 次</b>访问。')
                    : T('Đây là lần đầu khách này vào web (<b>', '这是该访客第一次访问网站（<b>') + esc(fullTime(s.startedAt)) + T('</b>).', '</b>）。')) + '</p>';
            if (total > 1) {
                html += '<ol class="other-visits">' + vs.slice().reverse().map((v) => '<li data-sid="' + esc(v.sid) + '"' + (v.sid === sid ? ' class="cur"' : '') + '>' +
                    '<span class="v-n">' + T('Lần ' + v.n, '第 ' + v.n + ' 次') + '</span>' +
                    '<span class="v-main"><b>' + esc(fullTime(v.startedAt)) + '</b>' +
                    '<span class="small muted">' + esc([srcName(v.source), pageName(v.landing), (v.pageViews || 1) + T(' trang', ' 页'), T('xem ', '浏览 ') + fmtDur(v.activeSec)].join(' · ')) + '</span></span>' +
                    (v.contacted ? '<span class="tag tag-zalo">' + T('Đã liên hệ', '已咨询') + '</span>' : '') +
                    (v.sid === sid ? '<span class="tag tag-new">' + T('Đang xem', '当前') + '</span>' : '') + '</li>').join('') + '</ol>';
                if (total >= 50) html += '<p class="small muted">' + T('Chỉ hiện 50 lượt gần nhất.', '仅显示最近 50 次访问。') + '</p>';
            }
        }
        html += '</section>';

        html += '<section><div class="section-title">' + T('Hành trình lượt này', '本次访问路径') + '</div>';
        if (!evs) html += '<p class="muted small">' + T('Đang tải…', '加载中…') + '</p>';
        else {
            const list = Object.values(evs).filter((e) => e && e.at).sort((a, b) => a.at - b.at);
            html += list.length ? '<ul class="timeline">' + list.map((e) => {
                const after = e.at - s.startedAt;
                let label = e.label || e.t;
                if (e.t === 'page_view') label = T('Xem trang ', '浏览页面：') + pageName(e.page);
                else if (e.t === 'click_zalo') label = T('Bấm Zalo: “', '点击 Zalo：“') + viaText(e.label) + '”';
                else if (e.t === 'click_phone') label = T('Bấm ' + (e.label || 'gọi điện'), '点击' + (viaText(e.label) || '打电话'));
                else if (e.t === 'click') label = T('Bấm “', '点击按钮“') + (e.label || T('nút', '按钮')) + '”';
                else if (e.t === 'click_out') label = T('Mở liên kết ngoài: ', '打开外部链接：') + e.label;
                else if (e.t === 'click_email') label = T('Bấm email ', '点击邮箱 ') + e.label;
                else if (e.t === 'scroll') { const m = /(\d+)%/.exec(e.label || ''); if (m) label = T('Cuộn ' + m[1] + '% trang', '页面滚动到 ' + m[1] + '%'); }
                const strong = e.t === 'click_zalo' || e.t === 'click_phone';
                return '<li><span class="tl-ico k-' + esc(e.t) + '">' + (ICON[e.t] || ICON.click) + '</span><div class="tl-body">' +
                    '<div class="tl-label' + (strong ? ' strong' : '') + '">' + esc(label) + '</div>' +
                    '<div class="tl-meta">' + hhmmss(e.at) + (after > 1000 ? T(' · sau ', ' · 进入后 ') + esc(fmtDur(after / 1000)) : '') + (e.t !== 'page_view' && e.page ? ' · ' + esc(pageName(e.page)) : '') + '</div></div></li>';
            }).join('') + '</ul>' : '<p class="muted small">' + T('Không có hành động nào được ghi lại.', '没有记录到任何操作。') + '</p>';
        }
        html += '</section>';

        html += '<div class="danger-zone"><span class="small muted">' + T('Xoá vĩnh viễn lượt truy cập này và hành trình của nó.', '永久删除此次访问及其访问路径。') + '</span>' +
            '<form class="pin-form" id="d-delete-form" autocomplete="off"><input class="pin-input" id="d-pin" type="password" inputmode="numeric" maxlength="8" placeholder="' + T('Mã PIN', 'PIN 码') + '" aria-label="' + T('Mã PIN để xoá', '删除所需的 PIN 码') + '">' +
            '<button class="btn btn-danger btn-sm" type="submit">' + T('Xoá lượt này', '删除此次访问') + '</button></form><p class="form-msg" id="d-pin-msg" role="alert"></p></div>';
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
        if (!pin) { msg.textContent = T('Nhập mã PIN để xoá.', '请输入 PIN 码以删除。'); input.focus(); return; }
        let ok = false;
        try { ok = (await sha256('hohai-vn:' + pin)) === PIN_HASH; } catch (e) { ok = false; }
        if (!ok) { msg.textContent = T('Mã PIN không đúng.', 'PIN 码错误。'); input.value = ''; input.focus(); return; }
        btn.disabled = true;
        btn.textContent = T('Đang xoá…', '正在删除…');
        DS.deleteSession(sid).then(() => {
            delete state.sessions[sid]; delete state.extra[sid];
            closeDrawer(); toast(T('Đã xoá lượt truy cập.', '已删除该访问记录。')); scheduleRender();
        }).catch(() => { btn.disabled = false; btn.textContent = T('Xoá lượt này', '删除此次访问'); msg.textContent = T('Không xoá được (mất mạng hoặc bị chặn quyền).', '删除失败（网络断开或没有权限）。'); });
    }

    /* =====================================================================
     * 6. Xuất CSV (mở được bằng Excel / Google Sheets)
     * ===================================================================== */
    // Cột dùng chung cho file CSV (theo ngôn ngữ đang chọn) và file Excel sao lưu (luôn tiếng Việt)
    const exportHead = () => T(
        ['Ngày', 'Giờ bắt đầu', 'Hoạt động cuối', 'Mã khách', 'Khách', 'Thành phố', 'Vùng', 'Quốc gia', 'IP', 'Thiết bị', 'Hệ điều hành', 'Trình duyệt',
            'Nguồn', 'Chiến dịch', 'Trang vào', 'Số trang', 'Thời gian xem (giây)', 'Đã liên hệ', 'Số lần bấm Zalo', 'Số lần bấm gọi', 'Liên hệ qua nút'],
        ['日期', '开始时间', '最后活动', '访客编号', '访客类型', '城市', '地区', '国家', 'IP', '设备', '操作系统', '浏览器',
            '来源', '推广活动', '进入页面', '浏览页数', '浏览时长（秒）', '是否咨询', 'Zalo 点击次数', '电话点击次数', '咨询按钮']);
    const exportRow = (s) => [
        fullDate(s.startedAt), hhmmss(s.startedAt), s.lastSeen ? hhmmss(s.lastSeen) : '', s.visitorId, s.returning ? T('Quay lại', '回访') : T('Mới', '新访客'),
        s.city, s.region, s.country, s.ip, deviceName(s.device), s.os, s.browser, srcName(s.source), s.campaign, pageName(s.landing),
        s.pageViews || 1, Math.round(s.activeSec || 0), s.contacted ? T('Có', '是') : T('Không', '否'), s.zaloClicks || 0, s.phoneClicks || 0, viaText(s.contactVia)
    ];
    // Chạy fn với ngôn ngữ tạm thời (vd. file sao lưu luôn xuất tiếng Việt)
    function withLang(lang, fn) { const old = LANG; LANG = lang; try { return fn(); } finally { LANG = old; } }

    function downloadBlob(content, fileName, mime) {
        const blob = new Blob([content], { type: mime + ';charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    }

    function exportCsv() {
        const R = rangeInfo();
        const data = filtered(list(R.start, R.end + 1));
        if (!data.length) { toast(T('Không có dữ liệu để xuất.', '没有可导出的数据。')); return; }
        const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const lines = [exportHead().join(',')].concat(data.map((s) => exportRow(s).map(cell).join(',')));
        downloadBlob('﻿' + lines.join('\r\n'), T('truy-cap-hohai-vn_', 'hohai-vn-visits_') + isoDay(R.start) + '_' + state.range + '.csv', 'text/csv');
        toast(T('Đã xuất ' + data.length + ' lượt truy cập.', '已导出 ' + data.length + ' 条访问记录。'));
    }

    /* =====================================================================
     * 6b. Sao lưu tự động mỗi ngày (Excel + JSON)
     * ---------------------------------------------------------------------
     * - Chạy trong trình duyệt: chỉ chạy khi trang giám sát này đang mở trên một máy đã BẬT sao lưu.
     *   Mở trang sau giờ hẹn mà hôm nay chưa sao lưu thì chạy bù ngay.
     * - Nếu có server sao lưu (CFG.backup.server) → gửi file lên thư mục backups/ của server.
     *   Không có / không kết nối được → tải file về thư mục Downloads của máy.
     * - File JSON giữ nguyên cấu trúc Firebase (sessions + events) để nhập lại được khi cần.
     * ===================================================================== */
    const BK = Object.assign({ hour: 13, minute: 0, daysAgo: 1, server: '', filePrefix: 'hohai-vn', historyMax: 30 }, CFG.backup || {});
    const LS_BK = 'hohai_vn_monitor_backup';
    const BK_SERVER = String(BK.server || '').replace(/\/+$/, '');
    let bkBusy = false, bkServerOk = null;

    const isoDay = (ts) => { const d = vnDate(ts); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
    const fromIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) - VN; };
    const viDay = (iso) => iso.split('-').reverse().join('/');

    function bkLoad() {
        try { return Object.assign({ enabled: false, lastRunDay: '', history: [] }, JSON.parse(localStorage.getItem(LS_BK) || '{}')); }
        catch (e) { return { enabled: false, lastRunDay: '', history: [] }; }
    }
    function bkSave(st) { try { localStorage.setItem(LS_BK, JSON.stringify(st)); } catch (e) { } }

    // Mốc giờ sao lưu của ngày chứa ts (giờ VN)
    const bkTimeOf = (ts) => vnDayStart(ts) + (BK.hour * 60 + BK.minute) * 60e3;
    function bkNextRun() {
        const t = bkTimeOf(now());
        return bkLoad().lastRunDay === isoDay(now()) || now() >= t ? t + DAY : t;
    }

    async function bkCheckServer() {
        if (!BK_SERVER) { bkServerOk = null; return null; }
        try {
            const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
            const res = await fetch(BK_SERVER + '/api/backup/health', { signal: ctl.signal, cache: 'no-store' });
            clearTimeout(tm);
            bkServerOk = res.ok && (await res.json()).status === 'ok';
        } catch (e) { bkServerOk = false; }
        return bkServerOk;
    }

    async function bkSaveToServer(files) {
        const res = await fetch(BK_SERVER + '/api/backup/save-batch', {
            method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ files: files.map((f) => ({ fileName: f.name, content: f.content, mimeType: f.mime })) })
        });
        const out = await res.json();
        if (!res.ok || !out.success || (out.files || []).some((f) => !f.success)) throw new Error(out.error || T('Server không lưu được file', '服务器无法保存文件'));
    }

    function bkExcel(sessions, iso) {
        // File sao lưu luôn xuất tiếng Việt để các file lưu trữ giống nhau, không phụ thuộc người đang xem chọn ngôn ngữ nào
        return withLang('vi', () => {
            const th = 'background:#1d5236;color:#fff;font-weight:bold;border:1px solid #16402a;padding:6px 10px;';
            const td = 'border:1px solid #d5ddd4;padding:4px 8px;mso-number-format:"\\@";';
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>';
            html += '<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px">';
            html += '<caption style="font-weight:bold;font-size:14px;text-align:left;padding:6px 0">Truy cập web HoHai VN · ngày ' + viDay(iso) + ' · ' + sessions.length + ' lượt</caption>';
            html += '<thead><tr>' + exportHead().map((h) => '<th style="' + th + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>';
            sessions.forEach((s) => { html += '<tr>' + exportRow(s).map((v) => '<td style="' + td + '">' + esc(v) + '</td>').join('') + '</tr>'; });
            return html + '</tbody></table></body></html>';
        });
    }

    // Ghi chú trong lịch sử lưu dạng mã để hiển thị được cả 2 ngôn ngữ
    function bkNote(h) {
        const out = [];
        if (h.srvFail) out.push(T('Server lỗi, đã tải về máy thay thế', '服务器出错，已改为下载到本机'));
        if (h.ok && !h.count) out.push(T('Không có lượt truy cập nào trong ngày', '当天没有访问记录'));
        if (h.err) out.push(T('Lỗi: ', '错误：') + h.err);
        if (h.note) out.push(h.note); // bản ghi cũ
        return out.join(' · ');
    }

    async function bkRun(iso, manual) {
        if (bkBusy) return;
        bkBusy = true; bkRender(iso);
        const st = bkLoad();
        const entry = { day: iso, at: now(), manual: !!manual, count: 0, files: [], where: '', ok: false };
        try {
            const from = fromIso(iso), to = from + DAY - 1;
            const raw = await DS.fetchSessionsBetween(from, to);
            const sids = Object.keys(raw).filter((k) => raw[k] && raw[k].startedAt);
            const events = {};
            for (let i = 0; i < sids.length; i += 20) { // đọc theo nhóm để không dồn quá nhiều request
                const chunk = sids.slice(i, i + 20);
                const vals = await Promise.all(chunk.map((sid) => DS.fetchEvents(sid).catch(() => ({}))));
                chunk.forEach((sid, k) => { if (Object.keys(vals[k]).length) events[sid] = vals[k]; });
            }
            entry.count = sids.length;
            const sessions = {}; sids.forEach((k) => { sessions[k] = raw[k]; });
            const rows = sids.map((k) => Object.assign({ id: k }, raw[k])).sort((a, b) => a.startedAt - b.startedAt);
            const base = BK.filePrefix + '_' + iso;
            const files = [
                { name: base + '.xls', mime: 'application/vnd.ms-excel', content: bkExcel(rows, iso) },
                {
                    name: base + '.json', mime: 'application/json', content: JSON.stringify({
                        site: 'HoHai VN', root: CFG.root, day: iso, timezone: 'GMT+7', from, to, exportedAt: new Date(now()).toISOString(),
                        counts: { sessions: sids.length, sessionsWithEvents: Object.keys(events).length }, sessions, events
                    }, null, 2)
                }
            ];
            entry.files = files.map((f) => f.name);
            let saved = false;
            if (BK_SERVER && (await bkCheckServer())) {
                try { await bkSaveToServer(files); saved = true; entry.where = 'server'; }
                catch (e) { entry.srvFail = true; }
            }
            if (!saved) { files.forEach((f) => downloadBlob(f.content, f.name, f.mime)); entry.where = 'download'; }
            entry.ok = true;
            toast(T('Đã sao lưu ' + sids.length + ' lượt ngày ' + viDay(iso) + (entry.where === 'server' ? ' lên server.' : ' (tải về máy).'),
                '已备份 ' + iso + ' 的 ' + sids.length + ' 条访问' + (entry.where === 'server' ? '，已保存到服务器。' : '（已下载到本机）。')));
        } catch (e) {
            entry.err = String(e && (e.message || e.code) || T('không rõ', '未知'));
            toast(T('Sao lưu thất bại. ', '备份失败。') + bkNote(entry));
        }
        if (!manual) st.lastRunDay = isoDay(now());
        st.history = [entry].concat(st.history || []).slice(0, BK.historyMax);
        bkSave(st);
        bkBusy = false; bkRender();
    }

    function bkTick() {
        const st = bkLoad();
        if (!st.enabled || bkBusy) return bkRender();
        const today = isoDay(now());
        if (st.lastRunDay !== today && now() >= bkTimeOf(now())) bkRun(isoDay(now() - BK.daysAgo * DAY), false);
        else bkRender();
    }

    let bkBusyDay = '';
    function bkRender(busyDay) {
        if (busyDay !== undefined) bkBusyDay = busyDay || '';
        if (!bkBusy) bkBusyDay = busyDay || '';
        const busyText = bkBusyDay ? T('Đang sao lưu dữ liệu ngày ' + viDay(bkBusyDay) + '…', '正在备份 ' + bkBusyDay + ' 的数据…') : '';
        const dayTxt = (iso) => T(viDay(iso), iso);
        const st = bkLoad();
        const tog = $('bk-toggle');
        tog.setAttribute('aria-pressed', String(st.enabled));
        tog.querySelector('span').textContent = st.enabled ? T('Đang bật', '已开启') : T('Đã tắt', '已关闭');
        $('bk-state').className = 'pill ' + (st.enabled ? 'pill-live' : '');
        $('bk-state').textContent = busyText ? T('Đang chạy', '运行中') : (st.enabled ? T('Đã bật', '已开启') : T('Đã tắt', '已关闭'));
        $('bk-next').textContent = st.enabled ? dayLabel(bkNextRun()) + ' ' + hhmm(bkNextRun()) : T('— (đang tắt)', '—（已关闭）');
        const last = (st.history || [])[0];
        $('bk-last').textContent = busyText || (last ? dayLabel(last.at) + ' ' + hhmm(last.at) + T(' · ngày ', ' · 数据日期 ') + dayTxt(last.day) + ' · ' + fmtN(last.count) + T(' lượt', ' 条') : T('Chưa sao lưu lần nào', '尚未备份'));
        const sv = $('bk-server');
        if (!BK_SERVER) { sv.className = 'pill'; sv.textContent = T('Không dùng server · tải về máy', '未使用服务器 · 下载到本机'); }
        else if (bkServerOk === null) { sv.className = 'pill'; sv.textContent = T('Server: đang kiểm tra…', '服务器：检查中…'); }
        else if (bkServerOk) { sv.className = 'pill pill-live'; sv.textContent = T('Server: đang chạy', '服务器：运行中'); }
        else { sv.className = 'pill pill-warn'; sv.textContent = T('Server: không kết nối được · tải về máy', '服务器：无法连接 · 下载到本机'); }
        $('bk-manual').disabled = bkBusy;
        $('bk-time').textContent = pad(BK.hour) + ':' + pad(BK.minute) + T(' (giờ VN)', '（越南时间）');
        $('bk-day').textContent = BK.daysAgo === 0 ? T('của hôm nay', '当天') : BK.daysAgo === 1 ? T('của ngày hôm trước', '前一天') : T('của ' + BK.daysAgo + ' ngày trước', BK.daysAgo + ' 天前');
        $('bk-where').textContent = BK_SERVER ? T('thư mục backups/ trên server (không được thì tải về máy)', '服务器的 backups/ 目录（失败时下载到本机）') : T('thư mục Downloads của máy đang mở trang này', '打开本页面的电脑的“下载”文件夹');
        const hist = st.history || [];
        $('bk-history').innerHTML = hist.length ? hist.slice(0, 10).map((h) => {
            const note = bkNote(h);
            return '<li class="' + (h.ok ? '' : 'bad') + '">' +
                '<div><b>' + T('Ngày ', '数据日期 ') + esc(dayTxt(h.day)) + '</b> · ' + fmtN(h.count) + T(' lượt · ', ' 条 · ') + (h.manual ? T('thủ công', '手动') : T('tự động', '自动')) + '<div class="muted small">' +
                esc(h.files.join(', ') || '—') + (note ? ' · ' + esc(note) : '') + '</div></div>' +
                '<span class="muted small">' + (h.ok ? (h.where === 'server' ? T('Lên server', '已存到服务器') : T('Tải về máy', '已下载到本机')) : T('Thất bại', '失败')) + ' · ' + esc(dayLabel(h.at) + ' ' + hhmm(h.at)) + '</span></li>';
        }).join('') : '<li class="empty muted">' + T('Chưa có lịch sử', '暂无记录') + '</li>';
    }

    function initBackup() {
        $('bk-toggle').addEventListener('click', () => {
            const st = bkLoad(); st.enabled = !st.enabled;
            bkSave(st); bkRender();
            toast(st.enabled ? T('Đã bật sao lưu tự động trên máy này.', '已在本机开启自动备份。') : T('Đã tắt sao lưu tự động.', '已关闭自动备份。'));
            if (st.enabled) setTimeout(bkTick, 500); // đã qua giờ hẹn mà hôm nay chưa sao lưu → chạy bù luôn
        });
        $('bk-manual').addEventListener('click', () => bkRun(isoDay(now() - DAY), true));
        bkRender();
        bkCheckServer().then(() => bkRender());
        setTimeout(bkTick, 4000);           // chờ Firebase kết nối rồi mới kiểm tra
        setInterval(bkTick, 60e3);          // kiểm tra mỗi phút (phòng khi tab bị ngủ lúc tới giờ)
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
            setConn('read');
            toast(err && /permission/i.test(err.message || err.code || '') ? T('Firebase từ chối quyền đọc dữ liệu.', 'Firebase 拒绝了读取权限。') : T('Lỗi tải dữ liệu.', '数据加载出错。'));
        });
    }

    // Trạng thái kết nối: '' đang kết nối · ok trực tiếp · bad mất kết nối · read không đọc được dữ liệu
    let connState = '';
    function setConn(st) {
        if (st !== undefined) connState = st;
        const txt = {
            '': T('Đang kết nối…', '正在连接…'), ok: T('Trực tiếp', '实时'),
            bad: T('Mất kết nối', '连接断开'), read: T('Không đọc được dữ liệu', '无法读取数据')
        }[connState];
        $('conn').className = 'conn ' + (connState === 'read' ? 'bad' : connState);
        $('conn-text').textContent = txt;
    }

    /* ---------- Đổi ngôn ngữ ---------- */
    // Chữ cố định trong analytics.html: phần tử có data-zh (nội dung), data-zh-placeholder, data-zh-aria, data-zh-tip, data-zh-title.
    // Bản tiếng Việt gốc được giữ lại ở data-vi* khi đổi lần đầu.
    function applyStaticLang() {
        document.documentElement.lang = T('vi', 'zh-CN');
        document.title = T('Giám sát truy cập · HoHai VN', '访问监控 · HoHai 越南站');
        document.querySelectorAll('[data-zh]').forEach((el) => {
            if (el.dataset.vi === undefined) el.dataset.vi = el.innerHTML;
            el.innerHTML = T(el.dataset.vi, el.dataset.zh);
        });
        [['placeholder', 'placeholder'], ['aria', 'aria-label'], ['tip', 'data-tip'], ['title', 'title']].forEach(([k, attr]) => {
            const zhKey = 'zh' + k[0].toUpperCase() + k.slice(1), viKey = 'vi' + k[0].toUpperCase() + k.slice(1);
            document.querySelectorAll('[data-zh-' + k + ']').forEach((el) => {
                if (el.dataset[viKey] === undefined) el.dataset[viKey] = el.getAttribute(attr) || '';
                el.setAttribute(attr, T(el.dataset[viKey], el.dataset[zhKey]));
            });
        });
        document.querySelectorAll('#lang-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === LANG)));
    }

    function setLang(lang) {
        if (lang === LANG) return;
        LANG = lang;
        try { localStorage.setItem(LS_LANG, lang); } catch (e) { }
        applyStaticLang();
        setConn();
        renderAll();
        bkRender();
        if (state.openSid && state.redrawDrawer) state.redrawDrawer();
    }

    let appStarted = false;
    function startApp() {
        show('screen-app');
        if (appStarted) return;
        appStarted = true;
        try { localStorage.setItem(LS_OFF, '1'); } catch (e) { } // máy đã mở dashboard thì không tính vào thống kê web

        applyStaticLang();
        setConn();
        $('lang-seg').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-lang]');
            if (b) setLang(b.dataset.lang);
        });
        DS.onConn((ok) => setConn(ok ? 'ok' : 'bad'));
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
        initBackup();

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

    if (!window.firebase || !CFG) {
        $('screen-loading').innerHTML = '<p class="muted">' + T('Không tải được Firebase. Kiểm tra kết nối mạng hoặc tắt trình chặn quảng cáo rồi tải lại trang.', '无法加载 Firebase。请检查网络或关闭广告拦截插件后刷新页面。') + '</p>';
    } else {
        bootFirebase();
    }
})();
