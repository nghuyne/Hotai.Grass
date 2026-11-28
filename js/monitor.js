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
    const LEADS_PATH = (CFG && CFG.leads && CFG.leads.path) || '';
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
            // Yêu cầu tư vấn (web + Zalo Mini App) — nhánh riêng CFG.leads.path, không nằm trong CFG.root
            watchLeads(from, cb, err) {
                if (!LEADS_PATH) { cb({}); return () => { }; }
                const q = db.ref(LEADS_PATH).orderByChild('createdAt').startAt(from);
                const h = q.on('value', (s) => cb(s.val() || {}), err || (() => cb({})));
                return () => q.off('value', h);
            },
            fetchLeadsBetween(from, to) {
                if (!LEADS_PATH) return Promise.resolve({});
                return db.ref(LEADS_PATH).orderByChild('createdAt').startAt(from).endAt(to).once('value').then((s) => s.val() || {}).catch(() => ({}));
            },
            setLeadStatus(id, status) {
                return db.ref(LEADS_PATH + '/' + id).update({ status, statusAt: firebase.database.ServerValue.TIMESTAMP });
            },
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
        range: 'today', filter: 'all', q: '', page: 0, adv: {},
        sessions: {}, presence: {}, extra: {}, // extra: phiên online bắt đầu trước kỳ đang xem
        leads: {}, leadFilter: 'new',
        openSid: null
    };
    let DS = null, unSessions = null, unPresence = null, unEvents = null, unLeads = null;
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

    // Lượt chạy thử trên máy (Live Server, mở file, localhost…): bộ thu thập gắn env='dev';
    // dữ liệu cũ chưa có env thì nhận theo origin.
    const DEV_ORIGIN = /^(file:|vscode-webview:|https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]))/;
    const isTest = (s) => !!s && (s.env === 'dev' || (!s.env && DEV_ORIGIN.test(s.origin || '')));
    const LS_SHOW_TEST = 'hohai_vn_monitor_show_test';
    state.showTest = (() => { try { return localStorage.getItem(LS_SHOW_TEST) === '1'; } catch (e) { return false; } })();
    let hiddenTest = 0;

    function list(from, to) {
        const out = [];
        for (const sid in state.sessions) {
            const s = state.sessions[sid];
            if (!(s && typeof s.startedAt === 'number' && s.startedAt >= from && s.startedAt < to)) continue;
            if (!state.showTest && isTest(s)) continue;
            out.push(Object.assign({ sid }, s));
        }
        return out.sort((a, b) => b.startedAt - a.startedAt);
    }
    function countHiddenTest(from, to) {
        let n = 0;
        for (const sid in state.sessions) {
            const s = state.sessions[sid];
            if (s && s.startedAt >= from && s.startedAt < to && isTest(s)) n++;
        }
        return n;
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
            if (!state.showTest && isTest(sessionOf(p.sid))) continue;
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
        renderLeads(R);
        renderBreakdowns(rows);
        renderTable(rows);
        renderNotice(R);
    }

    /* ---------- Thông báo: lượt chạy thử đang ẩn, trình duyệt admin không được tính ---------- */
    function renderNotice(R) {
        const el = $('data-notice');
        if (!el) return;
        hiddenTest = state.showTest ? 0 : countHiddenTest(R.start, R.end + 1);
        const testOn = state.showTest ? countHiddenTest(R.start, R.end + 1) : 0;
        let off = false;
        try { off = localStorage.getItem(LS_OFF) === '1'; } catch (e) { }
        const parts = [];
        if (hiddenTest) parts.push('<span>' + T('Đang ẩn <b>' + hiddenTest + '</b> lượt chạy thử trên máy (Live Server, mở file, localhost).', '已隐藏 <b>' + hiddenTest + '</b> 条本机测试访问（Live Server、本地文件、localhost）。') +
            ' <button type="button" class="link-btn" data-act="show-test">' + T('Hiện', '显示') + '</button></span>');
        if (state.showTest) parts.push('<span>' + T('Đang hiện cả lượt chạy thử (' + testOn + ' lượt, có nhãn “Test”).', '正在显示测试访问（' + testOn + ' 条，标记为“测试”）。') +
            ' <button type="button" class="link-btn" data-act="hide-test">' + T('Chỉ xem khách thật', '只看真实访客') + '</button></span>');
        if (off) parts.push('<span>' + T('Trình duyệt này không được tính vào thống kê web thật vì đã mở trang giám sát.', '本浏览器打开过监控页面，因此不计入网站真实统计。') +
            ' <button type="button" class="link-btn" data-act="count-me">' + T('Tính cả trình duyệt này', '也统计本浏览器') + '</button></span>');
        el.hidden = !parts.length;
        el.innerHTML = parts.join('');
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

    /* ---------- Yêu cầu tư vấn (web + Zalo Mini App) ---------- */
    const LEAD_KIND = {
        consult: ['Tư vấn cho nhà tôi', '为我家推荐方案'], wizard: ['Gửi kết quả gợi ý', '发送推荐结果'], form: ['Form tư vấn', '咨询表单'],
        order: ['Đặt hàng', '下单'], price: ['Hỏi giá', '询价'], fit: ['Tính số tấm', '计算所需块数'], quote: ['Báo giá theo diện tích', '按面积报价'],
        sample: ['Xin mẫu dùng thử', '索取试用样品'], size: ['Hỏi chọn size', '咨询尺寸'], photo: ['Gửi ảnh báo giá', '发照片求报价'],
        partner: ['Hợp tác đại lý', '代理合作'], program: ['Chương trình hợp tác', '合作计划'], claim: ['Yêu cầu bảo hành', '保修申请'],
        support: ['Hỗ trợ sau mua', '售后支持'], data: ['Xin tài liệu', '索取资料']
    };
    const leadKind = (k) => (LEAD_KIND[k] ? pick(LEAD_KIND[k]) : k || T('Yêu cầu', '请求'));
    const leadChannel = (c) => (c === 'miniapp' ? T('Zalo Mini App', 'Zalo 小程序') : T('Website', '网站'));

    function renderLeads(R) {
        const el = $('lead-list');
        if (!el) return;
        const all = Object.keys(state.leads).map((id) => Object.assign({ id }, state.leads[id]))
            .filter((l) => l && typeof l.createdAt === 'number' && l.createdAt >= R.start && l.createdAt < R.end + 1)
            .sort((a, b) => b.createdAt - a.createdAt);
        const open = all.filter((l) => l.status !== 'done');
        const shown = state.leadFilter === 'new' ? open : all;
        $('lead-count').textContent = all.length ? T(open.length + ' chưa xử lý · ' + all.length + ' yêu cầu', open.length + ' 条待处理 · 共 ' + all.length + ' 条') : '';
        document.querySelectorAll('#lead-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lf === state.leadFilter)));
        if (!shown.length) {
            el.innerHTML = '<li class="empty">' + (all.length ? T('Đã xử lý hết yêu cầu trong khoảng thời gian này.', '该时间段内的请求已全部处理。')
                : T('Chưa có yêu cầu tư vấn trong khoảng thời gian này.', '该时间段内暂无咨询请求。')) + '</li>';
            return;
        }
        el.innerHTML = shown.map((l) => {
            const done = l.status === 'done';
            const who = [l.name, l.phone ? '<a class="lead-tel" href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a>' : ''].filter(Boolean);
            const optTxt = l.opts ? Object.keys(l.opts).map((k) => esc(l.opts[k])).join(' · ') : '';
            return '<li class="lead' + (done ? ' done' : '') + '">' +
                '<div class="lead-top"><span class="tag ' + (l.channel === 'miniapp' ? 'tag-zalo' : 'tag-new') + '">' + esc(leadChannel(l.channel)) + '</span>' +
                '<b>' + esc(leadKind(l.kind)) + '</b>' + (l.product ? '<span class="muted small">' + esc(l.product) + '</span>' : '') +
                '<span class="lead-when">' + esc(relTime(l.createdAt)) + ' · ' + esc(hhmmss(l.createdAt)) + '</span></div>' +
                (who.length ? '<div class="lead-who">' + who.map((w) => (w.indexOf('<a') === 0 ? w : esc(w))).join(' · ') + (l.phoneToken && !l.phone ? ' · <span class="muted small">' + T('SĐT Zalo: chờ giải mã', 'Zalo 手机号：待解析') + '</span>' : '') + '</div>' : '') +
                (optTxt ? '<div class="muted small">' + optTxt + '</div>' : '') +
                '<pre class="lead-msg">' + esc(l.message || '') + '</pre>' +
                '<div class="lead-act">' + (l.page ? '<span class="muted small">' + T('Trang: ', '页面：') + esc(pageName(l.page)) + '</span>' : '') +
                (l.sid ? '<button type="button" class="btn btn-ghost btn-sm" data-sid="' + esc(l.sid) + '">' + T('Xem lượt truy cập', '查看访问记录') + '</button>' : '') +
                '<button type="button" class="btn ' + (done ? 'btn-ghost' : 'btn-primary') + ' btn-sm" data-lead="' + esc(l.id) + '" data-st="' + (done ? 'new' : 'done') + '">' +
                (done ? T('Mở lại', '重新打开') : T('Đã liên hệ xong', '已联系完毕')) + '</button></div></li>';
        }).join('');
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
    // Yêu cầu tư vấn gắn với lượt truy cập (qua sid) — để hiện tên/SĐT khách ngay trong bảng và file Excel
    function leadsBySid(src) {
        src = src || state.leads;
        const m = {};
        for (const id in src) {
            const l = src[id];
            if (l && l.sid && (!m[l.sid] || (l.createdAt || 0) > (m[l.sid].createdAt || 0))) m[l.sid] = Object.assign({ id }, l);
        }
        return m;
    }
    const cityKey = (s) => s.city || s.region || '';
    const contactKind = (s) => (s.zaloClicks && s.phoneClicks ? 'both' : s.zaloClicks ? 'zalo' : s.phoneClicks ? 'phone' : s.contacted ? 'zalo' : 'none');

    /* ---------- Bộ lọc nâng cao (nút “Bộ lọc” cạnh ô tìm kiếm) ----------
     * opts(rows) trả về [[giá trị, nhãn], …]; dyn = true thì lấy danh sách từ dữ liệu đang xem và kèm số lượt. */
    const ADV = [
        {
            k: 'contact', label: ['Liên hệ', '咨询'],
            opts: () => [['any', T('Có liên hệ (Zalo hoặc gọi)', '有咨询（Zalo 或电话）')], ['zalo', T('Có bấm Zalo', '点击了 Zalo')], ['phone', T('Có bấm gọi điện', '点击了电话')],
                ['both', T('Bấm cả Zalo và gọi', 'Zalo 和电话都点了')], ['lead', T('Có gửi yêu cầu tư vấn', '提交了咨询请求')], ['none', T('Chưa liên hệ', '未咨询')]],
            test: (s, v, x) => v === 'any' ? !!s.contacted : v === 'zalo' ? !!s.zaloClicks : v === 'phone' ? !!s.phoneClicks
                : v === 'both' ? !!(s.zaloClicks && s.phoneClicks) : v === 'lead' ? !!x.leads[s.sid] : !s.contacted
        },
        { k: 'via', label: ['Nút liên hệ đã bấm', '点击的咨询按钮'], dyn: true, key: (s) => s.contactVia || '', name: (v) => viaText(v) },
        { k: 'source', label: ['Nguồn', '来源'], dyn: true, key: (s) => s.source || '', name: (v) => (v ? srcName(v) : T('Không rõ', '未知')) },
        { k: 'campaign', label: ['Chiến dịch', '推广活动'], dyn: true, key: (s) => s.campaign || '', name: (v) => v },
        { k: 'landing', label: ['Trang vào', '进入页面'], dyn: true, key: (s) => s.landing || '', name: pageName },
        { k: 'page', label: ['Có xem trang', '浏览过的页面'], dyn: true, keys: (s) => Object.keys(s.pages || (s.landing ? { [s.landing]: 1 } : {})), name: pageName },
        { k: 'city', label: ['Khu vực', '地区'], dyn: true, key: cityKey, name: (v) => viPlace(v) || T('Chưa rõ', '未知') },
        {
            k: 'country', label: ['Quốc gia', '国家'],
            opts: () => [['vn', T('Việt Nam', '越南')], ['foreign', T('Nước ngoài', '国外')], ['unknown', T('Chưa rõ vị trí', '位置未知')]],
            test: (s, v) => v === 'vn' ? s.cc === 'VN' : v === 'foreign' ? !!s.cc && s.cc !== 'VN' : !s.cc
        },
        { k: 'ip', label: ['IP', 'IP'], dyn: true, key: (s) => s.ip || '', name: (v) => v || T('Chưa có IP', '暂无 IP') },
        { k: 'device', label: ['Thiết bị', '设备'], dyn: true, key: (s) => s.device || '', name: deviceName },
        { k: 'os', label: ['Hệ điều hành', '操作系统'], dyn: true, key: (s) => s.os || '', name: (v) => v || T('Không rõ', '未知') },
        { k: 'browser', label: ['Trình duyệt', '浏览器'], dyn: true, key: (s) => s.browser || '', name: (v) => v || T('Không rõ', '未知') },
        {
            k: 'visitor', label: ['Loại khách', '访客类型'],
            opts: () => [['new', T('Khách mới', '新访客')], ['back', T('Khách quay lại', '回访客户')]],
            test: (s, v) => (v === 'back') === !!s.returning
        },
        {
            k: 'time', label: ['Thời gian xem', '浏览时长'],
            opts: () => [['lt10', T('Dưới 10 giây (thoát nhanh)', '不足 10 秒（快速跳出）')], ['30', T('Từ 30 giây', '30 秒以上')], ['60', T('Từ 1 phút', '1 分钟以上')],
                ['180', T('Từ 3 phút', '3 分钟以上')], ['600', T('Từ 10 phút', '10 分钟以上')]],
            test: (s, v) => v === 'lt10' ? (s.activeSec || 0) < 10 : (s.activeSec || 0) >= +v
        },
        {
            k: 'pv', label: ['Số trang đã xem', '浏览页数'],
            opts: () => [['1', T('Chỉ 1 trang', '仅 1 页')], ['2', T('Từ 2 trang', '2 页以上')], ['3', T('Từ 3 trang', '3 页以上')], ['5', T('Từ 5 trang', '5 页以上')]],
            test: (s, v) => v === '1' ? (s.pageViews || 1) <= 1 : (s.pageViews || 1) >= +v
        }
    ];
    // Giá trị rỗng (vd. chưa có IP) lưu thành '__empty' để chọn được trong dropdown
    const advKeys = (f, s) => (f.keys ? f.keys(s) : [f.key(s)]).map((v) => (v === '' || v == null ? '__empty' : String(v)));
    const advName = (f, v) => f.name(v === '__empty' ? '' : v);
    const advActive = () => ADV.filter((f) => state.adv[f.k] !== undefined && state.adv[f.k] !== '');

    let advSig = '';
    function renderFilterPanel(rows) {
        const n = advActive().length;
        $('filter-n').hidden = !n;
        $('filter-n').textContent = n;
        if ($('filter-panel').hidden) { advSig = ''; return; }
        const html = ADV.map((f) => {
            let opts;
            if (f.dyn) {
                const cnt = {};
                rows.forEach((s) => advKeys(f, s).forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; }));
                const cur = state.adv[f.k];
                if (cur !== undefined && cur !== '' && !(cur in cnt)) cnt[cur] = 0; // giữ lựa chọn đang chọn dù kỳ mới không còn
                opts = Object.keys(cnt).filter((v) => !(v === '__empty' && f.k === 'via'))
                    .sort((a, b) => cnt[b] - cnt[a] || String(advName(f, a)).localeCompare(String(advName(f, b))))
                    .map((v) => [v, advName(f, v) + ' (' + cnt[v] + ')']);
            } else opts = f.opts();
            const cur = state.adv[f.k] === undefined ? '' : state.adv[f.k];
            return '<label>' + esc(pick(f.label)) + '<select data-adv="' + f.k + '"' + (cur !== '' ? ' class="set"' : '') + (f.dyn && !opts.length ? ' disabled' : '') + '>' +
                '<option value="">' + T('Tất cả', '全部') + '</option>' +
                opts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
                '</select></label>';
        }).join('');
        // Chỉ vẽ lại khi danh sách thay đổi, để dropdown đang mở không bị đóng khi dữ liệu realtime cập nhật
        if (html !== advSig) { $('filter-grid').innerHTML = html; advSig = html; }
        $('filter-sum').textContent = n ? T('Đang lọc theo ' + n + ' điều kiện. File Excel xuất ra cũng theo bộ lọc này.', '当前使用 ' + n + ' 个筛选条件，导出的 Excel 也按此筛选。')
            : T('Chọn điều kiện để lọc bảng. File Excel xuất ra cũng theo bộ lọc này.', '选择条件筛选表格，导出的 Excel 也按此筛选。');
    }

    function filtered(rows) {
        const on = onlineMap();
        const x = { leads: leadsBySid() };
        const q = state.q.trim().toLowerCase();
        const f = state.filter;
        const adv = advActive();
        return rows.filter((s) => {
            if (f === 'contacted' && !s.contacted) return false;
            if (f === 'zalo' && !s.zaloClicks) return false;
            if (f === 'phone' && !s.phoneClicks) return false;
            if (f === 'online' && !on[s.sid]) return false;
            if (f === 'returning' && !s.returning) return false;
            if (f === 'mobile' && s.device !== 'Mobile') return false;
            for (const a of adv) {
                const v = state.adv[a.k];
                if (a.test) { if (!a.test(s, v, x)) return false; }
                else if (advKeys(a, s).indexOf(v) === -1) return false;
            }
            if (!q) return true;
            const ld = x.leads[s.sid] || {};
            const hay = [s.city, s.region, s.country, viPlace(s.city), viPlace(s.region), s.ip, s.source, srcName(s.source), s.campaign, s.referrer, pageName(s.landing), s.landing,
                s.contactVia, viaText(s.contactVia), pageName(s.contactPage), s.zaloClicks ? 'zalo' : '', s.phoneClicks ? T('gọi điện', '电话') : '',
                deviceName(s.device), s.os, s.browser, s.lang, ld.name, ld.phone, ld.message, s.visitorId, s.sid]
                .concat(Object.keys(s.pages || {}).map(pageName)).join(' ').toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    function renderTable(rows) {
        const on = onlineMap();
        const counts = { all: rows.length, contacted: 0, zalo: 0, phone: 0, online: 0, returning: 0, mobile: 0 };
        rows.forEach((s) => {
            if (s.contacted) counts.contacted++; if (s.zaloClicks) counts.zalo++; if (s.phoneClicks) counts.phone++;
            if (on[s.sid]) counts.online++; if (s.returning) counts.returning++; if (s.device === 'Mobile') counts.mobile++;
        });
        renderFilterPanel(rows);
        const leads = leadsBySid();
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
            // Liên hệ: nhãn Zalo/Gọi giữ màu cũ; thông tin thêm (nút đã bấm, giờ/trang bấm, yêu cầu tư vấn) nằm trong ô vàng nhạt
            const ld = leads[s.sid];
            const extra = (ld ? '<div class="c-lead">' + T('Yêu cầu tư vấn', '咨询请求') + (ld.name || ld.phone ? ': ' + esc([ld.name, ld.phone].filter(Boolean).join(' · ')) : '') + '</div>' : '') +
                (s.contactVia ? '<div class="c-btn" title="' + esc(viaText(s.contactVia)) + '">“' + esc(viaText(s.contactVia)) + '”</div>' : '') +
                (s.contactAt ? '<div class="c-info">' + T('lúc ', '') + esc(hhmmss(s.contactAt)) + (s.contactPage ? T(' · ở ', ' · ') + esc(pageName(s.contactPage)) : '') +
                    ' · ' + T('sau ', '进入后 ') + esc(fmtDur((s.contactAt - s.startedAt) / 1000)) + '</div>' : '');
            const contact = s.contacted || ld
                ? '<div class="c-cell"><div class="c-tags">' +
                (s.zaloClicks ? '<span class="tag tag-zalo">Zalo' + (s.zaloClicks > 1 ? ' ×' + s.zaloClicks : '') + '</span>' : '') +
                (s.phoneClicks ? '<span class="tag tag-phone">' + T('Gọi', '电话') + (s.phoneClicks > 1 ? ' ×' + s.phoneClicks : '') + '</span>' : '') + '</div>' +
                (extra ? '<div class="c-extra">' + extra + '</div>' : '') + '</div>'
                : '<span class="tag tag-none">—</span>';
            return '<tr data-sid="' + esc(s.sid) + '">' +
                '<td><div class="t-main">' + hhmmss(s.startedAt) + '</div><div class="t-sub">' + esc(dayLabel(s.startedAt)) + '</div></td>' +
                '<td><div class="t-main">' + (on[s.sid] ? '<span class="on-dot" title="' + T('Đang online', '在线') + '"></span>' : '') + esc(place(s)) + '</div>' +
                '<div class="t-sub"><span class="tag ' + (s.returning ? 'tag-back">' + T('Quay lại', '回访') : 'tag-new">' + T('Mới', '新访客')) + '</span>' +
                (isTest(s) ? ' <span class="tag tag-test" title="' + esc(s.origin || '') + '">' + T('Test', '测试') + '</span>' : '') + '</div></td>' +
                '<td class="hide-sm"><div class="t-ip">' + esc(s.ip || '—') + '</div><div class="t-sub">' + esc(s.cc || '') + '</div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(deviceName(s.device)) + '</div><div class="t-sub">' + esc([s.os, s.browser].filter(Boolean).join(' · ')) + '</div></td>' +
                '<td><div class="t-main">' + esc(srcName(s.source)) + '</div><div class="t-sub">' + esc(s.campaign || '') + '</div></td>' +
                '<td class="hide-sm"><div class="t-main">' + esc(pageName(s.landing)) + '</div><div class="t-sub">' + (s.pageViews || 1) + T(' trang', ' 页') + '</div></td>' +
                '<td class="num">' + esc(fmtDur(s.activeSec)) + '</td>' +
                '<td class="t-contact">' + contact + '</td></tr>';
        }).join('') : '<tr><td colspan="8" class="empty">' + (rows.length ? T('Không có lượt nào khớp bộ lọc.', '没有符合筛选条件的访问。') : T('Chưa có lượt truy cập trong khoảng thời gian này.', '该时间段内暂无访问。')) + '</td></tr>';

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

    // Mô tả 1 hành động của khách (dùng cho hành trình trong chi tiết và sheet “Hành trình” khi xuất Excel)
    function evLabel(e) {
        let label = e.label || e.t;
        if (e.t === 'page_view') label = T('Xem trang ', '浏览页面：') + pageName(e.page);
        else if (e.t === 'click_zalo') label = T('Bấm Zalo: “', '点击 Zalo：“') + viaText(e.label) + '”';
        else if (e.t === 'click_phone') label = T('Bấm ' + (e.label || 'gọi điện'), '点击' + (viaText(e.label) || '打电话'));
        else if (e.t === 'click') label = T('Bấm “', '点击按钮“') + (e.label || T('nút', '按钮')) + '”';
        else if (e.t === 'click_out') label = T('Mở liên kết ngoài: ', '打开外部链接：') + e.label;
        else if (e.t === 'click_email') label = T('Bấm email ', '点击邮箱 ') + e.label;
        else if (e.t === 'scroll') { const m = /(\d+)%/.exec(e.label || ''); if (m) label = T('Cuộn ' + m[1] + '% trang', '页面滚动到 ' + m[1] + '%'); }
        return label;
    }
    const EV_KIND = {
        page_view: ['Xem trang', '浏览页面'], click_zalo: ['Bấm Zalo', '点击 Zalo'], click_phone: ['Bấm gọi', '点击电话'], click: ['Bấm nút', '点击按钮'],
        click_out: ['Link ngoài', '外部链接'], click_email: ['Bấm email', '点击邮箱'], scroll: ['Cuộn trang', '滚动页面']
    };

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
                const label = evLabel(e);
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
     * 6. Xuất Excel (.xlsx có định dạng, nhiều sheet)
     * ---------------------------------------------------------------------
     * Dùng thư viện ExcelJS (chỉ tải khi bấm nút) để có màu, viền, cố định dòng tiêu đề, nút lọc,
     * ngày giờ / thời lượng là số thật của Excel (sắp xếp, cộng trừ được) và khổ in ngang.
     * Sheet: Tổng quan · Lượt truy cập · Khách · Hành trình · Yêu cầu tư vấn.
     * Theo đúng kỳ, ô tìm kiếm và bộ lọc đang chọn. Không tải được thư viện → xuất .xls dạng bảng HTML.
     * ===================================================================== */
    const EXCELJS_SRC = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    const contactChannel = (s) => [s.zaloClicks ? 'Zalo' : '', s.phoneClicks ? T('Gọi điện', '电话') : ''].filter(Boolean).join(' + ') || (s.contacted ? 'Zalo' : '');
    const pagesText = (s) => Object.keys(s.pages || {}).sort((a, b) => s.pages[b] - s.pages[a]).map((p) => pageName(p) + ' (' + s.pages[p] + ')').join(', ');
    const sidOf = (s) => s.sid || s.id || '';
    const leadOf = (s, c) => c.leads[sidOf(s)] || {};
    const secBetween = (a, b) => (a && b ? Math.max(0, Math.round((b - a) / 1000)) : null);

    // Nhóm cột (hàng tiêu đề trên cùng của sheet “Lượt truy cập”)
    const XGROUP = {
        time: ['Thời gian', '时间'], place: ['Vị trí & IP', '位置与 IP'], visitor: ['Khách', '访客'], device: ['Thiết bị', '设备'],
        source: ['Nguồn truy cập', '来源'], behave: ['Hành vi xem web', '浏览行为'], contact: ['Liên hệ Zalo / Gọi', 'Zalo / 电话咨询'],
        lead: ['Yêu cầu tư vấn', '咨询请求'], other: ['Thông tin khác', '其他信息']
    };
    // Kiểu ô: dt = ngày giờ · tm = giờ · dur = thời lượng (giây) · n = số · n0 = số, ẩn số 0 · s = chữ (mặc định) · c = chữ căn giữa
    const EXPORT_COLS = [
        { g: 'time', h: ['Bắt đầu', '开始时间'], t: 'dt', w: 19, v: (s) => s.startedAt },
        { g: 'time', h: ['Hoạt động cuối', '最后活动'], t: 'tm', w: 11, v: (s) => s.lastSeen || null },
        { g: 'time', h: ['Thời gian xem thực', '实际浏览时长'], t: 'dur', w: 12, v: (s) => Math.round(s.activeSec || 0) },
        { g: 'time', h: ['Thời gian mở trang', '页面打开时长'], t: 'dur', w: 12, v: (s) => secBetween(s.startedAt, s.lastSeen) },
        { g: 'place', h: ['IP', 'IP'], w: 16, v: (s) => s.ip || '' },
        { g: 'place', h: ['Thành phố', '城市'], w: 17, v: (s) => viPlace(s.city) || '' },
        { g: 'place', h: ['Tỉnh / Vùng', '省/地区'], w: 17, v: (s) => viPlace(s.region) || '' },
        { g: 'place', h: ['Quốc gia', '国家'], w: 13, v: (s) => viPlace(s.country) || '' },
        { g: 'visitor', h: ['Loại khách', '访客类型'], t: 'c', w: 11, v: (s) => (s.returning ? T('Quay lại', '回访') : T('Mới', '新访客')) },
        { g: 'visitor', h: ['Số lượt trong kỳ', '本期访问次数'], t: 'n', w: 10, v: (s, c) => c.visits[s.visitorId] || 1 },
        { g: 'device', h: ['Thiết bị', '设备'], w: 13, v: (s) => deviceName(s.device) },
        { g: 'device', h: ['Hệ điều hành', '操作系统'], w: 12, v: (s) => s.os || '' },
        { g: 'device', h: ['Trình duyệt', '浏览器'], w: 14, v: (s) => s.browser || '' },
        { g: 'device', h: ['Màn hình', '屏幕'], t: 'c', w: 11, v: (s) => s.screen || '' },
        { g: 'device', h: ['Ngôn ngữ máy', '浏览器语言'], t: 'c', w: 10, v: (s) => s.lang || '' },
        { g: 'source', h: ['Nguồn', '来源'], w: 14, v: (s) => srcName(s.source) },
        { g: 'source', h: ['Chiến dịch', '推广活动'], w: 14, v: (s) => s.campaign || '' },
        { g: 'source', h: ['Link giới thiệu', '来源链接'], w: 26, v: (s) => s.referrer || '' },
        { g: 'behave', h: ['Trang vào', '进入页面'], w: 19, v: (s) => pageName(s.landing) },
        { g: 'behave', h: ['Trang xem cuối', '最后浏览页面'], w: 19, v: (s) => (s.page ? pageName(s.page) : '') },
        { g: 'behave', h: ['Số trang', '浏览页数'], t: 'n', w: 8, v: (s) => s.pageViews || 1 },
        { g: 'behave', h: ['Các trang đã xem (số lần)', '浏览过的页面（次数）'], w: 38, v: pagesText },
        { g: 'contact', h: ['Đã liên hệ', '是否咨询'], t: 'c', w: 10, v: (s) => (s.contacted ? T('Có', '是') : '') },
        { g: 'contact', h: ['Kênh', '方式'], w: 12, v: contactChannel },
        { g: 'contact', h: ['Nút đã bấm', '点击的按钮'], w: 30, v: (s) => viaText(s.contactVia) },
        { g: 'contact', h: ['Giờ liên hệ', '咨询时间'], t: 'tm', w: 11, v: (s) => s.contactAt || null },
        { g: 'contact', h: ['Liên hệ sau khi vào', '进入后多久咨询'], t: 'dur', w: 12, v: (s) => secBetween(s.startedAt, s.contactAt) },
        { g: 'contact', h: ['Trang lúc liên hệ', '咨询时所在页面'], w: 19, v: (s) => (s.contactPage ? pageName(s.contactPage) : '') },
        { g: 'contact', h: ['Số lần bấm Zalo', 'Zalo 点击次数'], t: 'n0', w: 9, v: (s) => s.zaloClicks || 0 },
        { g: 'contact', h: ['Số lần bấm gọi', '电话点击次数'], t: 'n0', w: 9, v: (s) => s.phoneClicks || 0 },
        { g: 'lead', h: ['Loại yêu cầu', '请求类型'], w: 18, v: (s, c) => (leadOf(s, c).kind || leadOf(s, c).id ? leadKind(leadOf(s, c).kind) : '') },
        { g: 'lead', h: ['Tên khách', '客户姓名'], w: 16, v: (s, c) => leadOf(s, c).name || '' },
        { g: 'lead', h: ['SĐT', '电话'], w: 13, v: (s, c) => leadOf(s, c).phone || '' },
        { g: 'lead', h: ['Nội dung', '内容'], w: 36, v: (s, c) => leadOf(s, c).message || '' },
        { g: 'other', h: ['Đang online', '是否在线'], t: 'c', w: 10, v: (s, c) => (c.on[sidOf(s)] ? T('Có', '是') : '') },
        { g: 'other', h: ['Loại dữ liệu', '数据类型'], t: 'c', w: 11, v: (s) => (isTest(s) ? T('Chạy thử', '测试') : T('Khách thật', '真实访客')) },
        { g: 'other', h: ['Địa chỉ web', '网址'], w: 24, v: (s) => s.origin || '' },
        { g: 'other', h: ['Mã lượt', '访问编号'], w: 22, v: sidOf },
        { g: 'other', h: ['Mã khách', '访客编号'], w: 22, v: (s) => s.visitorId || '' }
    ];
    function exportCtx(rows, leads) {
        const visits = {};
        rows.forEach((s) => { visits[s.visitorId] = (visits[s.visitorId] || 0) + 1; });
        return { visits, leads: leadsBySid(leads), on: onlineMap() };
    }
    // Giá trị dạng chữ (cho file .xls dạng HTML / sao lưu)
    function txtVal(t, v) {
        if (v === null || v === undefined || v === '') return '';
        if (t === 'dt') return fullTime(v);
        if (t === 'tm') return hhmmss(v);
        if (t === 'dur') return fmtDur(v);
        if (t === 'n0' && !v) return '';
        return v;
    }
    const exportHead = () => EXPORT_COLS.map((c) => pick(c.h));
    const exportRow = (s, ctx) => EXPORT_COLS.map((c) => txtVal(c.t, c.v(s, ctx)));
    // Chạy fn với ngôn ngữ tạm thời (vd. file sao lưu luôn xuất tiếng Việt)
    function withLang(lang, fn) { const old = LANG; LANG = lang; try { return fn(); } finally { LANG = old; } }

    function downloadBlob(content, fileName, mime) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime + (typeof content === 'string' ? ';charset=utf-8' : '') });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    }

    let xlP = null;
    function loadExcelJs() {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (!xlP) xlP = new Promise((res, rej) => {
            const sc = document.createElement('script');
            sc.src = EXCELJS_SRC;
            sc.onload = () => (window.ExcelJS ? res(window.ExcelJS) : rej(new Error('exceljs')));
            sc.onerror = () => { xlP = null; sc.remove(); rej(new Error('exceljs')); };
            document.head.appendChild(sc);
        });
        return xlP;
    }

    // Đọc hành động của nhiều lượt, theo nhóm 20 để không dồn quá nhiều request
    async function fetchEventsFor(sids, onStep) {
        const out = {};
        for (let i = 0; i < sids.length; i += 20) {
            const chunk = sids.slice(i, i + 20);
            const vals = await Promise.all(chunk.map((sid) => DS.fetchEvents(sid).catch(() => ({}))));
            chunk.forEach((sid, k) => { out[sid] = vals[k] || {}; });
            if (onStep) onStep(Math.min(i + 20, sids.length), sids.length);
        }
        return out;
    }

    // Mô tả bộ lọc đang dùng
    function filterText() {
        const parts = [];
        const chip = document.querySelector('#chips .chip[data-f="' + state.filter + '"]');
        if (state.filter !== 'all' && chip) parts.push(T(chip.dataset.label, chip.dataset.labelZh));
        advActive().forEach((f) => {
            const v = state.adv[f.k];
            const name = f.dyn ? advName(f, v) : ((f.opts().find((o) => o[0] === v) || [])[1] || v);
            parts.push(pick(f.label) + ': ' + name);
        });
        if (state.q.trim()) parts.push(T('Tìm: “', '搜索：“') + state.q.trim() + '”');
        if (state.showTest) parts.push(T('Gồm cả lượt chạy thử', '包含测试访问'));
        return parts.join(' · ') || T('Không lọc — tất cả lượt truy cập', '未筛选 — 全部访问');
    }

    /* ---------- Bộ khung định dạng Excel ---------- */
    const XC = {
        brand: 'FF1D5236', brandSoft: 'FFE8F1EA', brandLine: 'FFC9DCCD', zebra: 'FFF7F9F6', line: 'FFE1E7DF', ink: 'FF1F2A24', muted: 'FF6B7A71',
        goldSoft: 'FFFDF8EA', goldLine: 'FFEFE3C2', goldInk: 'FF7D6526', up: 'FF17803D', down: 'FFB42318', white: 'FFFFFFFF'
    };
    const XFONT = 'Calibri';
    const xFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const xLine = (argb) => ({ style: 'thin', color: { argb } });
    const xFmt = (t) => ({ dt: T('dd/mm/yyyy hh:mm:ss', 'yyyy-mm-dd hh:mm:ss'), d: T('dd/mm/yyyy', 'yyyy-mm-dd'), tm: 'hh:mm:ss', dur: '[h]:mm:ss', n: '#,##0', n0: '#,##0;-#,##0;""', pct: '0.0%' }[t]);
    // Excel không có múi giờ: ghi thẳng giờ Việt Nam. Thời lượng ghi theo ngày (giây / 86400) để hiện dạng giờ:phút:giây.
    function xVal(t, v) {
        if (v === null || v === undefined || v === '') return null;
        if (t === 'dt' || t === 'tm' || t === 'd') return new Date(v + VN);
        if (t === 'dur') return v / 86400;
        return v;
    }
    const xAlign = (t, wrap) => ({ vertical: 'middle', wrapText: !!wrap, horizontal: ['n', 'n0', 'dur', 'pct'].indexOf(t) !== -1 ? 'right' : ['c', 'tm', 'dt', 'd'].indexOf(t) !== -1 ? 'center' : 'left' });
    const XPAGE = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 } };

    // 2 dòng đầu mỗi sheet: tên báo cáo (nền xanh) + dòng mô tả
    function xHead(ws, ncol, title, sub) {
        ws.mergeCells(1, 1, 1, ncol);
        const a = ws.getCell(1, 1);
        a.value = title;
        a.font = { name: XFONT, size: 15, bold: true, color: { argb: XC.white } };
        a.fill = xFill(XC.brand);
        a.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(1).height = 32;
        ws.mergeCells(2, 1, 2, ncol);
        const b = ws.getCell(2, 1);
        b.value = sub;
        b.font = { name: XFONT, size: 10, italic: true, color: { argb: XC.muted } };
        b.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        ws.getRow(2).height = 30;
    }
    function xHeaderCell(cell, txt) {
        cell.value = txt;
        cell.font = { name: XFONT, size: 10.5, bold: true, color: { argb: XC.white } };
        cell.fill = xFill(XC.brand);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: xLine(XC.brand), bottom: xLine(XC.brand), left: xLine('FF2E6A4A'), right: xLine('FF2E6A4A') };
    }
    function xBodyCell(cell, t, v, wrap, zebra) {
        cell.value = xVal(t, v);
        cell.font = { name: XFONT, size: 10.5, color: { argb: XC.ink } };
        cell.alignment = xAlign(t, wrap);
        cell.border = { bottom: xLine(XC.line) };
        if (xFmt(t)) cell.numFmt = xFmt(t);
        if (zebra) cell.fill = xFill(XC.zebra);
    }

    /* Sheet dạng bảng dữ liệu: tiêu đề, (nhóm cột), hàng tiêu đề cố định, nút lọc, sọc xen kẽ, in ngang lặp tiêu đề.
     * cols: [{h, t, w, wrap, g}] · rows: mảng giá trị gốc · o.style(row, i) để tô riêng từng dòng */
    function xDataSheet(wb, name, title, sub, cols, rows, o) {
        o = o || {};
        const hr = o.groups ? 4 : 3; // dòng tiêu đề cột
        const ws = wb.addWorksheet(name, {
            properties: { tabColor: { argb: o.tab || XC.brand } },
            views: [{ state: 'frozen', xSplit: o.xSplit || 0, ySplit: hr, showGridLines: false, zoomScale: 100 }],
            pageSetup: XPAGE
        });
        ws.columns = cols.map((c) => ({ width: c.w || 14 }));
        const n = cols.length;
        xHead(ws, n, title, sub);
        if (o.groups) {
            let i = 0;
            while (i < n) {
                let j = i;
                while (j + 1 < n && cols[j + 1].g === cols[i].g) j++;
                if (j > i) ws.mergeCells(3, i + 1, 3, j + 1);
                const cell = ws.getCell(3, i + 1);
                const gold = cols[i].g === 'contact' || cols[i].g === 'lead';
                cell.value = pick(XGROUP[cols[i].g]);
                cell.font = { name: XFONT, size: 10, bold: true, color: { argb: gold ? XC.goldInk : XC.brand } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                for (let k = i; k <= j; k++) {
                    const cc = ws.getCell(3, k + 1);
                    cc.fill = xFill(gold ? XC.goldSoft : XC.brandSoft);
                    cc.border = { top: xLine(gold ? XC.goldLine : XC.brandLine), left: k === i ? xLine(XC.white) : undefined, right: k === j ? xLine(XC.white) : undefined };
                }
                i = j + 1;
            }
            ws.getRow(3).height = 20;
        }
        cols.forEach((c, j) => xHeaderCell(ws.getCell(hr, j + 1), pick(c.h)));
        ws.getRow(hr).height = 34;
        if (!rows.length) {
            ws.mergeCells(hr + 1, 1, hr + 1, n);
            const e = ws.getCell(hr + 1, 1);
            e.value = o.empty || T('Không có dữ liệu trong khoảng thời gian / bộ lọc này.', '该时间段 / 筛选条件下没有数据。');
            e.font = { name: XFONT, size: 10.5, italic: true, color: { argb: XC.muted } };
            e.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getRow(hr + 1).height = 26;
        }
        rows.forEach((vals, i) => {
            const row = ws.getRow(hr + 1 + i);
            const zebra = o.zebra ? o.zebra(i) : i % 2 === 1;
            vals.forEach((v, j) => xBodyCell(row.getCell(j + 1), cols[j].t, v, cols[j].wrap, zebra));
            const lines = Math.max(1, ...cols.map((c, j) => (c.wrap && vals[j] ? Math.ceil(String(vals[j]).length / Math.max(6, (c.w || 14) - 2)) + (String(vals[j]).match(/\n/g) || []).length : 1)));
            row.height = Math.max(o.rowHeight || 20, Math.min(lines, 10) * 14 + 6);
            if (o.style) o.style(row, i);
        });
        if (rows.length) ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr + rows.length, column: n } };
        ws.pageSetup.printTitlesRow = '1:' + hr;
        ws.headerFooter.oddFooter = '&L&8' + T('HoHai Việt Nam', 'HoHai 越南站') + ' · ' + title.replace(/&/g, '&&') + '&R&8' + T('Trang ', '第 ') + '&P / &N' + T('', ' 页');
        return ws;
    }

    // Bảng nhỏ trong sheet Tổng quan. Trả về dòng kế tiếp còn trống.
    function xMiniTable(ws, r, c, title, head, types, rows) {
        const n = head.length;
        ws.mergeCells(r, c, r, c + n - 1);
        const t = ws.getCell(r, c);
        t.value = title;
        t.font = { name: XFONT, size: 12, bold: true, color: { argb: XC.brand } };
        t.alignment = { vertical: 'bottom' };
        ws.getRow(r).height = 24;
        head.forEach((h, j) => {
            const cell = ws.getCell(r + 1, c + j);
            cell.value = h;
            cell.font = { name: XFONT, size: 10, bold: true, color: { argb: XC.brand } };
            cell.fill = xFill(XC.brandSoft);
            cell.alignment = { vertical: 'middle', horizontal: j ? 'right' : 'left', indent: j ? 0 : 1 };
            cell.border = { bottom: xLine(XC.brandLine) };
        });
        if (!rows.length) {
            ws.mergeCells(r + 2, c, r + 2, c + n - 1);
            const e = ws.getCell(r + 2, c);
            e.value = T('Chưa có dữ liệu', '暂无数据');
            e.font = { name: XFONT, size: 10, italic: true, color: { argb: XC.muted } };
            return r + 4;
        }
        rows.forEach((vals, i) => vals.forEach((v, j) => {
            const cell = ws.getCell(r + 2 + i, c + j);
            xBodyCell(cell, j ? types[j] : 's', v, false, i % 2 === 1);
            if (!j) cell.alignment = { vertical: 'middle', indent: 1 };
        }));
        return r + 3 + rows.length;
    }

    // Gom nhóm cho bảng tổng hợp: [tên, lượt, liên hệ, tỉ lệ]
    function xBreak(rows, keyFn, limit) {
        const g = group(rows, keyFn).sort((a, b) => b.v - a.v || b.c - a.c);
        const top = g.slice(0, limit || 10);
        if (g.length > top.length) {
            const rest = g.slice(top.length);
            top.push({ name: T('Khác (' + rest.length + ')', '其他（' + rest.length + '）'), v: rest.reduce((a, e) => a + e.v, 0), c: rest.reduce((a, e) => a + e.c, 0) });
        }
        return top.map((e) => [e.name, e.v, e.c, e.v ? e.c / e.v : 0]);
    }

    function xOverview(wb, R, data, prev, leadRows, evCount, flt) {
        const ws = wb.addWorksheet(T('Tổng quan', '总览'), {
            properties: { tabColor: { argb: 'FFD9B44A' } },
            views: [{ showGridLines: false }],
            pageSetup: Object.assign({}, XPAGE, { orientation: 'portrait' })
        });
        ws.columns = [{ width: 34 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 3 }, { width: 34 }, { width: 13 }, { width: 13 }, { width: 13 }];
        const endTs = Math.min(R.end, now());
        xHead(ws, 9, T('BÁO CÁO TRUY CẬP WEBSITE HOHAI VIỆT NAM', 'HOHAI 越南站网站访问报告'),
            T('Kỳ báo cáo: ', '报告期间：') + R.title + ' (' + fullDate(R.start) + ' – ' + fullDate(endTs - 1) + ') · ' +
            T('Xuất lúc ', '导出时间 ') + fullTime(now()) + T(' (giờ Việt Nam, GMT+7)', '（越南时间 GMT+7）'));
        ws.mergeCells(3, 1, 3, 9);
        const f = ws.getCell(3, 1);
        f.value = T('Bộ lọc áp dụng: ', '筛选条件：') + flt;
        f.font = { name: XFONT, size: 10, color: { argb: XC.goldInk } };
        f.fill = xFill(XC.goldSoft);
        f.border = { top: xLine(XC.goldLine), bottom: xLine(XC.goldLine) };
        f.alignment = { vertical: 'middle', indent: 1, wrapText: true };
        ws.getRow(3).height = 22;

        // Chỉ số chính, so với kỳ trước
        const m = metrics(data), p = metrics(prev);
        const K = [
            [T('Lượt truy cập', '访问次数'), m.sessions, p.sessions, 'n'],
            [T('Khách (không trùng)', '访客数（去重）'), m.visitors, p.visitors, 'n'],
            [T('Khách mới', '新访客'), m.newVisitors, p.newVisitors, 'n'],
            [T('Lượt có liên hệ (Zalo / Gọi)', '有咨询的访问（Zalo / 电话）'), m.contacts, p.contacts, 'n'],
            [T('Tỉ lệ liên hệ', '咨询率'), m.rate, p.rate, 'pct'],
            [T('Lượt bấm Zalo', '点击 Zalo 的访问'), m.zalo, p.zalo, 'n'],
            [T('Lượt bấm gọi điện', '点击电话的访问'), m.phone, p.phone, 'n'],
            [T('Yêu cầu tư vấn', '咨询请求'), leadRows.length, null, 'n'],
            [T('Thời gian xem trung bình', '平均浏览时长'), Math.round(m.avgTime), Math.round(p.avgTime), 'dur'],
            [T('Tỉ lệ thoát nhanh (< 10 giây, 1 trang)', '快速跳出率（< 10 秒且 1 页）'), m.bounce, p.bounce, 'pct', true],
            [T('Số hành động ghi nhận', '记录的操作数'), evCount, null, 'n']
        ];
        let r = 5;
        ws.mergeCells(r, 1, r, 4);
        ws.getCell(r, 1).value = T('Chỉ số chính', '主要指标');
        ws.getCell(r, 1).font = { name: XFONT, size: 12, bold: true, color: { argb: XC.brand } };
        ws.getRow(r).height = 24;
        [T('Chỉ số', '指标'), T('Kỳ này', '本期'), T('Kỳ trước', '上期'), T('Thay đổi', '变化')].forEach((h, j) => {
            const c = ws.getCell(r + 1, j + 1);
            xHeaderCell(c, h);
            if (!j) c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });
        ws.getRow(r + 1).height = 22;
        K.forEach((k, i) => {
            const row = r + 2 + i;
            const z = i % 2 === 1;
            xBodyCell(ws.getCell(row, 1), 's', k[0], false, z);
            ws.getCell(row, 1).alignment = { vertical: 'middle', indent: 1 };
            ws.getCell(row, 1).font = { name: XFONT, size: 10.5, color: { argb: XC.ink }, bold: true };
            xBodyCell(ws.getCell(row, 2), k[3], k[1], false, z);
            ws.getCell(row, 2).font = { name: XFONT, size: 11, bold: true, color: { argb: XC.ink } };
            xBodyCell(ws.getCell(row, 3), k[3], k[2], false, z);
            ws.getCell(row, 3).font = { name: XFONT, size: 10.5, color: { argb: XC.muted } };
            const ch = k[2] ? (k[1] - k[2]) / k[2] : null;
            const cd = ws.getCell(row, 4);
            xBodyCell(cd, 'pct', ch, false, z);
            cd.numFmt = '+0%;-0%;0%';
            if (ch !== null && ch !== 0) cd.font = { name: XFONT, size: 10.5, bold: true, color: { argb: (ch > 0) !== !!k[4] ? XC.up : XC.down } };
            if (ch === null) { cd.value = '—'; cd.alignment = { horizontal: 'right', vertical: 'middle' }; cd.font = { name: XFONT, size: 10.5, color: { argb: XC.muted } }; }
            ws.getRow(row).height = 20;
        });
        // Ghi chú cạnh bảng chỉ số
        const notes = [
            T('Cách đọc báo cáo', '报告说明'),
            T('• “Kỳ trước” là khoảng thời gian dài bằng kỳ này, ngay trước đó, cùng bộ lọc.', '• “上期”为本期之前同样长度的时间段，筛选条件相同。'),
            T('• “Thời gian xem thực” chỉ tính lúc khách đang mở tab và có thao tác (cuộn, chạm, rê chuột).', '• “实际浏览时长”只统计访客打开页面并有操作的时间。'),
            T('• “Đã liên hệ” = khách đã bấm nút Zalo hoặc số điện thoại trên web.', '• “已咨询”= 访客点击了网站上的 Zalo 按钮或电话号码。'),
            T('• Vị trí suy ra từ IP nên chỉ đúng tới tỉnh/thành; mạng di động có thể hiện tỉnh khác.', '• 位置根据 IP 推断，只精确到省/市；移动网络可能显示其他省份。'),
            T('• “Khách quay lại” = cùng trình duyệt/thiết bị đã từng vào web trước đó.', '• “回访客户”= 同一浏览器/设备之前访问过网站。'),
            T('• Chi tiết từng lượt, từng khách, từng hành động xem ở các sheet kế bên.', '• 每次访问、每位访客、每个操作的明细见后面的工作表。')
        ];
        notes.forEach((t, i) => {
            ws.mergeCells(r + i, 6, r + i, 9);
            const c = ws.getCell(r + i, 6);
            c.value = t;
            c.font = i ? { name: XFONT, size: 10, color: { argb: XC.muted } } : { name: XFONT, size: 12, bold: true, color: { argb: XC.brand } };
            c.alignment = { vertical: 'middle', wrapText: true };
            if (i) { c.fill = xFill(XC.zebra); ws.getRow(r + i).height = Math.max(ws.getRow(r + i).height || 20, 28); }
        });
        r = r + 2 + K.length + 1;

        // Bảng tổng hợp, xếp 2 cột
        const BH = (name) => [name, T('Lượt', '访问'), T('Liên hệ', '咨询'), T('Tỉ lệ LH', '咨询率')];
        const BT = ['s', 'n', 'n', 'pct'];
        const pv = {}, ppl = {}, pc = {};
        data.forEach((s) => {
            const pages = s.pages || (s.landing ? { [s.landing]: 1 } : {});
            Object.keys(pages).forEach((pg) => { pv[pg] = (pv[pg] || 0) + (pages[pg] || 0); ppl[pg] = (ppl[pg] || 0) + 1; });
            if (s.contactPage) pc[s.contactPage] = (pc[s.contactPage] || 0) + 1;
        });
        const pageRows = Object.keys(pv).sort((a, b) => pv[b] - pv[a]).slice(0, 12).map((pg) => [pageName(pg), pv[pg], ppl[pg], pc[pg] || 0]);
        const viaRows = xBreak(data.filter((s) => s.contacted), (s) => viaText(s.contactVia) || contactChannel(s), 12).map((e) => [e[0], e[1]]);
        let a = xMiniTable(ws, r, 1, T('Theo nguồn truy cập', '按来源'), BH(T('Nguồn', '来源')), BT, xBreak(data, (s) => srcName(s.source)));
        let b = xMiniTable(ws, r, 6, T('Theo thiết bị', '按设备'), BH(T('Thiết bị', '设备')), BT, xBreak(data, (s) => deviceName(s.device)));
        r = Math.max(a, b);
        a = xMiniTable(ws, r, 1, T('Theo khu vực (top 10)', '按地区（前 10）'), BH(T('Khu vực', '地区')), BT, xBreak(data, (s) => viPlace(s.city) || viPlace(s.region) || T('Chưa rõ', '未知')));
        b = xMiniTable(ws, r, 6, T('Trang được xem nhiều nhất', '浏览最多的页面'), [T('Trang', '页面'), T('Lượt xem', '浏览量'), T('Số lượt vào', '访问次数'), T('Liên hệ tại trang', '在此页咨询')], ['s', 'n', 'n', 'n'], pageRows);
        r = Math.max(a, b);
        a = xMiniTable(ws, r, 1, T('Nút liên hệ được bấm', '被点击的咨询按钮'), [T('Nút', '按钮'), T('Số lượt', '次数')], ['s', 'n'], viaRows);
        b = xMiniTable(ws, r, 6, T('Khách mới / quay lại', '新访客 / 回访'), BH(T('Loại khách', '访客类型')), BT, xBreak(data, (s) => (s.returning ? T('Quay lại', '回访') : T('Mới', '新访客'))));
        r = Math.max(a, b);

        // Theo giờ / theo ngày
        const hourly = R.bucket === 'hour';
        const size = hourly ? HOUR : DAY;
        const nb = hourly ? 24 : Math.round((vnDayStart(R.end - 1) - R.start) / DAY) + 1;
        const vis = new Array(nb).fill(0), con = new Array(nb).fill(0), vid = Array.from({ length: nb }, () => new Set());
        data.forEach((s) => {
            const i = Math.floor((s.startedAt - R.start) / size);
            if (i >= 0 && i < nb) { vis[i]++; vid[i].add(s.visitorId); if (s.contacted) con[i]++; }
        });
        const tsRows = [];
        for (let i = 0; i < nb; i++) {
            if (R.start + i * size > now()) break;
            tsRows.push([hourly ? pad(i) + ':00 – ' + pad(i + 1 === 24 ? 0 : i + 1) + ':00' : wd(R.start + i * DAY) + ', ' + fullDate(R.start + i * DAY), vis[i], vid[i].size, con[i], vis[i] ? con[i] / vis[i] : 0]);
        }
        xMiniTable(ws, r, 1, hourly ? T('Theo giờ trong ngày', '按小时') : T('Theo ngày', '按日期'),
            [hourly ? T('Khung giờ', '时段') : T('Ngày', '日期'), T('Lượt', '访问'), T('Khách', '访客'), T('Liên hệ', '咨询'), T('Tỉ lệ LH', '咨询率')], ['s', 'n', 'n', 'n', 'pct'], tsRows);
        ws.headerFooter.oddFooter = '&L&8' + T('HoHai Việt Nam', 'HoHai 越南站') + '&R&8' + T('Trang ', '第 ') + '&P / &N' + T('', ' 页');
        return ws;
    }

    // Tổng hợp theo từng khách (visitorId)
    function xVisitors(data, ctx) {
        const by = {};
        data.forEach((s) => {
            const v = by[s.visitorId] || (by[s.visitorId] = { id: s.visitorId, n: 0, first: Infinity, last: 0, sec: 0, pages: 0, contacts: 0, zalo: 0, phone: 0, ips: new Set(), places: new Set(), devices: new Set(), sources: new Set(), lead: null, returning: false });
            v.n++; v.first = Math.min(v.first, s.startedAt); v.last = Math.max(v.last, s.startedAt);
            v.sec += s.activeSec || 0; v.pages += s.pageViews || 1;
            if (s.contacted) v.contacts++; v.zalo += s.zaloClicks || 0; v.phone += s.phoneClicks || 0;
            if (s.ip) v.ips.add(s.ip); if (place(s)) v.places.add(place(s)); v.devices.add([deviceName(s.device), s.os, s.browser].filter(Boolean).join(' · '));
            v.sources.add(srcName(s.source)); if (s.returning) v.returning = true;
            if (ctx.leads[sidOf(s)]) v.lead = ctx.leads[sidOf(s)];
        });
        return Object.values(by).sort((a, b) => (b.contacts - a.contacts) || (b.n - a.n) || (b.last - a.last)).map((v) => [
            v.id, v.returning ? T('Quay lại', '回访') : T('Mới', '新访客'), v.n, v.first, v.last, Math.round(v.sec), v.pages,
            v.contacts, v.zalo, v.phone, v.lead ? [v.lead.name, v.lead.phone].filter(Boolean).join(' · ') : '',
            [...v.ips].join(', '), [...v.places].join('; '), [...v.devices].join('; '), [...v.sources].join(', ')
        ]);
    }

    /* Tạo workbook báo cáo — dùng chung cho nút “Xuất Excel” và file sao lưu hằng ngày.
     * o: { R (kỳ: title, start, end, bucket), data, prev, evs (sid → hành động), leads (id → yêu cầu), filter (chữ mô tả bộ lọc), sessionById } */
    function buildWorkbook(X, o) {
        const R = o.R, data = o.data;
        const ctx = exportCtx(data, o.leads);
        const endTs = Math.min(R.end, now()) - 1;
        const period = R.title + ' (' + fullDate(R.start) + (isoDay(R.start) === isoDay(endTs) ? '' : ' – ' + fullDate(endTs)) + ')';
        const sub = (extra) => period + ' · ' + T('Bộ lọc: ', '筛选：') + o.filter + (extra ? ' · ' + extra : '');

        // Hành trình
        const jCols = [
            { h: ['Thời điểm', '时间'], t: 'dt', w: 19 }, { h: ['Sau khi vào', '进入后'], t: 'dur', w: 11 }, { h: ['Loại hành động', '操作类型'], t: 'c', w: 14 },
            { h: ['Chi tiết hành động', '操作详情'], w: 46, wrap: true }, { h: ['Trang', '页面'], w: 20 },
            { h: ['Lượt bắt đầu lúc', '访问开始时间'], t: 'dt', w: 19 }, { h: ['Khu vực', '地区'], w: 20 }, { h: ['IP', 'IP'], w: 16 },
            { h: ['Thiết bị', '设备'], w: 13 }, { h: ['Nguồn', '来源'], w: 13 }, { h: ['Mã lượt', '访问编号'], w: 22 }
        ];
        const jRows = [], jMeta = [];
        data.forEach((s, si) => {
            Object.values(o.evs[sidOf(s)] || {}).filter((e) => e && e.at).sort((x, y) => x.at - y.at).forEach((e) => {
                jRows.push([e.at, secBetween(s.startedAt, e.at), EV_KIND[e.t] ? pick(EV_KIND[e.t]) : e.t, evLabel(e), pageName(e.page),
                    s.startedAt, place(s), s.ip || '', deviceName(s.device), srcName(s.source), sidOf(s)]);
                jMeta.push({ band: si % 2 === 1, strong: e.t === 'click_zalo' || e.t === 'click_phone' });
            });
        });

        // Yêu cầu tư vấn trong kỳ
        const lCols = [
            { h: ['Thời điểm', '时间'], t: 'dt', w: 19 }, { h: ['Trạng thái', '状态'], t: 'c', w: 15 }, { h: ['Kênh', '渠道'], t: 'c', w: 14 },
            { h: ['Loại yêu cầu', '请求类型'], w: 20 }, { h: ['Tên khách', '客户姓名'], w: 18 }, { h: ['SĐT', '电话'], w: 14 },
            { h: ['Sản phẩm', '产品'], w: 18 }, { h: ['Lựa chọn', '选项'], w: 24, wrap: true }, { h: ['Nội dung', '内容'], w: 46, wrap: true },
            { h: ['Trang gửi', '提交页面'], w: 18 }, { h: ['IP', 'IP'], w: 16 }, { h: ['Khu vực', '地区'], w: 18 }, { h: ['Mã lượt', '访问编号'], w: 22 }
        ];
        const leadList = Object.keys(o.leads || {}).map((id) => Object.assign({ id }, o.leads[id]))
            .filter((l) => l && typeof l.createdAt === 'number' && l.createdAt >= R.start && l.createdAt < R.end + 1)
            .sort((a, b) => b.createdAt - a.createdAt);
        const lRows = leadList.map((l) => {
            const s = (l.sid && o.sessionById(l.sid)) || null;
            return [l.createdAt, l.status === 'done' ? T('Đã liên hệ xong', '已联系完毕') : T('Chưa xử lý', '待处理'), leadChannel(l.channel), leadKind(l.kind),
                l.name || '', l.phone || '', l.product || '', l.opts ? Object.keys(l.opts).map((k) => l.opts[k]).join(' · ') : '', l.message || '',
                l.page ? pageName(l.page) : '', s ? s.ip || '' : '', s ? place(s) : '', l.sid || ''];
        });

        const wb = new X.Workbook();
        wb.creator = 'HoHai Việt Nam'; wb.created = new Date(); wb.title = T('Báo cáo truy cập website', '网站访问报告');

        // 1. Tổng quan
        xOverview(wb, R, data, o.prev, lRows, jRows.length, o.filter);

        // 2. Lượt truy cập — ô liên hệ / yêu cầu tư vấn của khách đã liên hệ tô vàng nhạt
        const vRows = data.map((s) => EXPORT_COLS.map((c) => c.v(s, ctx)));
        const goldCols = EXPORT_COLS.map((c, j) => (c.g === 'contact' || c.g === 'lead' ? j + 1 : 0)).filter(Boolean);
        xDataSheet(wb, T('Lượt truy cập', '访问记录'), T('Chi tiết lượt truy cập', '访问明细'), sub(data.length + T(' lượt', ' 条')), EXPORT_COLS, vRows, {
            groups: true, xSplit: 0,
            style: (row, i) => {
                const s = data[i];
                if (!(s.contacted || ctx.leads[sidOf(s)])) return;
                goldCols.forEach((j) => {
                    const c = row.getCell(j);
                    c.fill = xFill(XC.goldSoft);
                    c.font = { name: XFONT, size: 10.5, color: { argb: XC.goldInk }, bold: j === goldCols[0] };
                });
            }
        });

        // 3. Khách
        const kCols = [
            { h: ['Mã khách', '访客编号'], w: 22 }, { h: ['Loại khách', '访客类型'], t: 'c', w: 11 }, { h: ['Số lượt', '访问次数'], t: 'n', w: 9 },
            { h: ['Lần đầu (trong kỳ)', '首次（本期）'], t: 'dt', w: 19 }, { h: ['Lần gần nhất', '最近一次'], t: 'dt', w: 19 },
            { h: ['Tổng thời gian xem', '总浏览时长'], t: 'dur', w: 12 }, { h: ['Tổng số trang', '总浏览页数'], t: 'n', w: 10 },
            { h: ['Lượt có liên hệ', '有咨询的访问'], t: 'n0', w: 10 }, { h: ['Bấm Zalo', 'Zalo 次数'], t: 'n0', w: 9 }, { h: ['Bấm gọi', '电话次数'], t: 'n0', w: 9 },
            { h: ['Tên / SĐT (yêu cầu tư vấn)', '姓名 / 电话（咨询请求）'], w: 24 }, { h: ['IP', 'IP'], w: 18, wrap: true }, { h: ['Khu vực', '地区'], w: 22, wrap: true },
            { h: ['Thiết bị', '设备'], w: 30, wrap: true }, { h: ['Nguồn', '来源'], w: 16, wrap: true }
        ];
        const kRows = xVisitors(data, ctx);
        xDataSheet(wb, T('Khách', '访客'), T('Tổng hợp theo khách', '按访客汇总'), sub(kRows.length + T(' khách · khách có liên hệ xếp trước', ' 位访客 · 有咨询的排在前面')), kCols, kRows, {
            xSplit: 1, tab: 'FF2B7A4B',
            style: (row, i) => { if (kRows[i][7]) [8, 9, 10, 11].forEach((j) => { const c = row.getCell(j); c.fill = xFill(XC.goldSoft); c.font = { name: XFONT, size: 10.5, color: { argb: XC.goldInk }, bold: j === 8 }; }); }
        });

        // 4. Hành trình — mỗi lượt một dải màu, hành động bấm Zalo / gọi tô vàng nhạt
        xDataSheet(wb, T('Hành trình', '访问路径'), T('Hành trình từng lượt truy cập', '每次访问的操作路径'), sub(jRows.length + T(' hành động', ' 个操作')), jCols, jRows, {
            tab: 'FF5B8C6E', zebra: (i) => jMeta[i].band,
            style: (row, i) => {
                if (!jMeta[i].strong) return;
                for (let j = 1; j <= 5; j++) { const c = row.getCell(j); c.fill = xFill(XC.goldSoft); c.font = { name: XFONT, size: 10.5, bold: true, color: { argb: XC.goldInk } }; }
            }
        });

        // 5. Yêu cầu tư vấn
        xDataSheet(wb, T('Yêu cầu tư vấn', '咨询请求'), T('Yêu cầu tư vấn (web + Zalo Mini App)', '咨询请求（网站 + Zalo 小程序）'),
            period + T(' · tất cả yêu cầu trong kỳ, không áp dụng bộ lọc · ', ' · 本期全部请求，不受筛选影响 · ') + lRows.length + T(' yêu cầu', ' 条'), lCols, lRows, {
            tab: 'FFD9B44A', rowHeight: 30,
            empty: T('Chưa có yêu cầu tư vấn trong khoảng thời gian này.', '该时间段内暂无咨询请求。'),
            style: (row, i) => {
                const c = row.getCell(2), done = leadList[i].status === 'done';
                c.font = { name: XFONT, size: 10.5, bold: true, color: { argb: done ? XC.up : XC.goldInk } };
                c.fill = xFill(done ? XC.brandSoft : XC.goldSoft);
            }
        });
        return wb;
    }
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    let exporting = false;
    async function exportExcel() {
        if (exporting) return;
        const R = rangeInfo();
        const data = filtered(list(R.start, R.end + 1));
        if (!data.length) { toast(T('Không có dữ liệu để xuất.', '没有可导出的数据。')); return; }
        exporting = true;
        const btn = $('export-btn');
        btn.disabled = true;
        const endTs = Math.min(R.end, now()) - 1;
        const fileBase = T('Bao-cao-truy-cap_HoHai-VN_', 'HoHai-VN_visit-report_') + isoDay(R.start) + (isoDay(R.start) === isoDay(endTs) ? '' : '_' + isoDay(endTs));
        try {
            toast(T('Đang chuẩn bị file Excel…', '正在生成 Excel 文件…'));
            const [X, evs] = await Promise.all([
                loadExcelJs().catch(() => null),
                fetchEventsFor(data.map((s) => s.sid), (n, t) => { if (t > 40) toast(T('Đang tải hành trình ' + n + '/' + t + ' lượt…', '正在加载访问路径 ' + n + '/' + t + '…')); }).catch(() => ({}))
            ]);
            if (!X) { // không tải được thư viện → xuất bảng Excel dạng HTML (.xls), vẫn đủ cột
                downloadBlob(xlsHtml(data, T('Truy cập web HoHai VN · ', 'HoHai 越南站访问 · ') + R.title), fileBase + '.xls', 'application/vnd.ms-excel');
                toast(T('Đã xuất ' + data.length + ' lượt (bản .xls đơn giản vì không tải được thư viện Excel).', '已导出 ' + data.length + ' 条（Excel 库加载失败，已导出简化 .xls）。'));
                return;
            }
            const wb = buildWorkbook(X, {
                R, data, prev: filtered(list(R.prevStart, R.prevEnd + 1)), evs, leads: state.leads, filter: filterText(), sessionById: sessionOf
            });
            const buf = await wb.xlsx.writeBuffer();
            downloadBlob(new Blob([buf], { type: XLSX_MIME }), fileBase + '.xlsx');
            toast(T('Đã xuất ' + data.length + ' lượt truy cập ra Excel.', '已导出 ' + data.length + ' 条访问记录到 Excel。'));
        } catch (e) {
            toast(T('Xuất Excel thất bại: ', '导出 Excel 失败：') + (e && e.message || e));
        } finally {
            exporting = false; btn.disabled = false;
        }
    }

    // Bảng Excel dạng HTML (.xls): dùng cho file sao lưu và khi không tải được thư viện .xlsx. Dòng có liên hệ tô vàng.
    function xlsHtml(rows, title) {
        const ctx = exportCtx(rows);
        const th = 'background:#1d5236;color:#fff;font-weight:bold;border:1px solid #16402a;padding:6px 10px;';
        const td = 'border:1px solid #d5ddd4;padding:4px 8px;mso-number-format:"\\@";';
        const tdC = td + 'background:#fdf8ea;';
        let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>';
        html += '<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px">';
        html += '<caption style="font-weight:bold;font-size:14px;text-align:left;padding:6px 0">' + esc(title) + ' · ' + rows.length + T(' lượt', ' 条') + '</caption>';
        html += '<thead><tr>' + exportHead().map((h) => '<th style="' + th + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>';
        rows.forEach((s) => { const st = s.contacted ? tdC : td; html += '<tr>' + exportRow(s, ctx).map((v) => '<td style="' + st + '">' + esc(v) + '</td>').join('') + '</tr>'; });
        return html + '</tbody></table></body></html>';
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
    // '' trong cấu hình = chính server web VN đang phục vụ trang này (tools/serve.js → web-vn/backups/)
    const BK_SERVER = String(BK.server || (/^https?:$/.test(location.protocol) ? location.origin : '')).replace(/\/+$/, '');
    let bkBusy = false, bkServerOk = null, bkServerInfo = null;

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
            const info = res.ok ? await res.json() : {};
            bkServerOk = info.status === 'ok';
            bkServerInfo = bkServerOk ? info : null;
        } catch (e) { bkServerOk = false; bkServerInfo = null; }
        return bkServerOk;
    }
    // Server bản mới (v2.2) báo features: ['base64', 'download'] — bản cũ chỉ lưu được file dạng chữ
    const bkHas = (f) => !!(bkServerInfo && Array.isArray(bkServerInfo.features) && bkServerInfo.features.indexOf(f) !== -1);

    async function bkSaveToServer(files) {
        const res = await fetch(BK_SERVER + '/api/backup/save-batch', {
            method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ files: files.map((f) => ({ fileName: f.name, content: f.content, mimeType: f.mime, encoding: f.encoding || 'utf8' })) })
        });
        const out = await res.json();
        if (!res.ok || !out.success || (out.files || []).some((f) => !f.success)) throw new Error(out.error || T('Server không lưu được file', '服务器无法保存文件'));
    }

    function bufToBase64(buf) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }

    /* File Excel sao lưu: báo cáo .xlsx giống nút “Xuất Excel” (luôn tiếng Việt, không lọc, kể cả lượt chạy thử).
     * Dùng .xls dạng bảng HTML khi không tải được thư viện, hoặc khi server còn là bản cũ (không nhận được file nhị phân). */
    async function bkExcelFile(base, iso, raw, prevRaw, events, leads) {
        const toRows = (m) => Object.keys(m).filter((k) => m[k] && m[k].startedAt).map((k) => Object.assign({ id: k, sid: k }, m[k])).sort((a, b) => b.startedAt - a.startedAt);
        const rows = toRows(raw);
        const canBinary = !BK_SERVER || !bkServerOk || bkHas('base64');
        const X = canBinary ? await loadExcelJs().catch(() => null) : null;
        if (!X) {
            return { name: base + '.xls', mime: 'application/vnd.ms-excel', content: withLang('vi', () => xlsHtml(rows.slice().reverse(), 'Truy cập web HoHai VN · ngày ' + viDay(iso))) };
        }
        const from = fromIso(iso);
        const wb = withLang('vi', () => buildWorkbook(X, {
            R: { title: 'Ngày ' + viDay(iso), start: from, end: from + DAY, bucket: 'hour' },
            data: rows, prev: toRows(prevRaw), evs: events, leads,
            filter: 'Không lọc — toàn bộ lượt truy cập trong ngày (kể cả lượt chạy thử, xem cột “Loại dữ liệu”)',
            sessionById: (sid) => raw[sid] || sessionOf(sid)
        }));
        const buf = await withLang('vi', () => wb.xlsx.writeBuffer());
        return { name: base + '.xlsx', mime: XLSX_MIME, content: bufToBase64(buf), encoding: 'base64', blob: new Blob([buf], { type: XLSX_MIME }) };
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
            if (BK_SERVER) await bkCheckServer(); // biết server có nhận file .xlsx không
            const [raw, prevRaw, leads] = await Promise.all([
                DS.fetchSessionsBetween(from, to), DS.fetchSessionsBetween(from - DAY, from - 1).catch(() => ({})), DS.fetchLeadsBetween(from, to)
            ]);
            const sids = Object.keys(raw).filter((k) => raw[k] && raw[k].startedAt);
            const evAll = await fetchEventsFor(sids);
            const events = {};
            sids.forEach((sid) => { if (Object.keys(evAll[sid] || {}).length) events[sid] = evAll[sid]; });
            entry.count = sids.length;
            const sessions = {}; sids.forEach((k) => { sessions[k] = raw[k]; });
            const base = BK.filePrefix + '_' + iso;
            const files = [
                await bkExcelFile(base, iso, sessions, prevRaw, events, leads),
                {
                    name: base + '.json', mime: 'application/json', content: JSON.stringify({
                        site: 'HoHai VN', root: CFG.root, day: iso, timezone: 'GMT+7', from, to, exportedAt: new Date(now()).toISOString(),
                        counts: { sessions: sids.length, sessionsWithEvents: Object.keys(events).length, leads: Object.keys(leads).length }, sessions, events, leads
                    }, null, 2)
                }
            ];
            entry.files = files.map((f) => f.name);
            let saved = false;
            if (BK_SERVER && bkServerOk) {
                try { await bkSaveToServer(files); saved = true; entry.where = 'server'; }
                catch (e) { entry.srvFail = true; }
            }
            if (!saved) { files.forEach((f) => downloadBlob(f.blob || f.content, f.name, f.mime)); entry.where = 'download'; }
            if (saved) bkListFiles();
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
        $('bk-where').textContent = BK_SERVER ? T('thư mục riêng web-vn/backups/ trên máy chạy web VN (không được thì tải về máy). Xem và tải ở mục “File sao lưu” bên dưới', '越南站自己的 web-vn/backups/ 目录（失败时下载到本机）。可在下方“备份文件”查看和下载') : T('thư mục Downloads của máy đang mở trang này', '打开本页面的电脑的“下载”文件夹');
        bkFilesRender();
        const hist = st.history || [];
        $('bk-history').innerHTML = hist.length ? hist.slice(0, 10).map((h) => {
            const note = bkNote(h);
            return '<li class="' + (h.ok ? '' : 'bad') + '">' +
                '<div><b>' + T('Ngày ', '数据日期 ') + esc(dayTxt(h.day)) + '</b> · ' + fmtN(h.count) + T(' lượt · ', ' 条 · ') + (h.manual ? T('thủ công', '手动') : T('tự động', '自动')) + '<div class="muted small">' +
                esc(h.files.join(', ') || '—') + (note ? ' · ' + esc(note) : '') + '</div></div>' +
                '<span class="muted small">' + (h.ok ? (h.where === 'server' ? T('Lên server', '已存到服务器') : T('Tải về máy', '已下载到本机')) : T('Thất bại', '失败')) + ' · ' + esc(dayLabel(h.at) + ' ' + hhmm(h.at)) + '</span></li>';
        }).join('') : '<li class="empty muted">' + T('Chưa có lịch sử', '暂无记录') + '</li>';
    }

    /* ---------- File đã sao lưu trên server: xem danh sách + tải về (cần mã PIN) ---------- */
    let bkFiles = null, bkFilesErr = '';
    const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
    async function bkListFiles() {
        if (!BK_SERVER) { bkFiles = null; bkFilesRender(); return; }
        try {
            const res = await fetch(BK_SERVER + '/api/backup/list', { cache: 'no-store' });
            const out = await res.json();
            bkFiles = (out.files || []).filter((f) => f.name.indexOf(BK.filePrefix + '_') === 0)
                .sort((a, b) => b.name.localeCompare(a.name) || new Date(b.modified) - new Date(a.modified));
            bkFilesErr = '';
        } catch (e) { bkFiles = null; bkFilesErr = T('Không đọc được danh sách file trên server.', '无法读取服务器上的文件列表。'); }
        bkFilesRender();
    }
    function bkFilesRender() {
        const el = $('bk-files');
        if (!el) return;
        const where = bkServerInfo && bkServerInfo.backupDir;
        const own = BK_SERVER === location.origin;
        $('bk-files-where').innerHTML = !BK_SERVER ? T('Trang đang mở trực tiếp từ file nên không có server: file sao lưu được tải về thư mục Downloads của máy đang mở trang.', '页面直接以文件打开，没有服务器：备份文件下载到本机“下载”文件夹。')
            : bkServerOk === false ? T('Không kết nối được server sao lưu' + (own ? ' của web VN (trang không được mở qua <b>CHAY-WEB.bat</b>)' : '') + ', nên file sao lưu được tải về thư mục Downloads của máy đang mở trang.',
                '无法连接' + (own ? '越南站的备份服务（页面不是通过 <b>CHAY-WEB.bat</b> 打开的）' : '备份服务器') + '，备份文件将下载到本机“下载”文件夹。')
                : T('Lưu riêng cho web VN trên máy đang chạy web', '越南站单独保存在运行网站的电脑上') + (where ? T(', thư mục ', '，目录 ') + '<code>' + esc(where) + '</code>' : '') + '.';
        const canDl = bkHas('download');
        $('bk-dl-form').hidden = !canDl || !bkFiles || !bkFiles.length;
        $('bk-files-note').textContent = BK_SERVER && bkServerOk && !canDl
            ? T('Server web VN đang chạy bản cũ: tắt cửa sổ CHAY-WEB.bat rồi mở lại để bật tải file + sao lưu .xlsx.', '越南站服务器为旧版本：关闭 CHAY-WEB.bat 窗口后重新打开，即可启用下载和 .xlsx 备份。') : '';
        if (BK_SERVER && bkServerOk === false) { el.innerHTML = ''; return; }
        if (bkFilesErr) { el.innerHTML = '<li class="empty muted">' + esc(bkFilesErr) + '</li>'; return; }
        if (!bkFiles) { el.innerHTML = BK_SERVER ? '<li class="empty muted">' + T('Đang tải…', '加载中…') + '</li>' : ''; return; }
        if (!bkFiles.length) { el.innerHTML = '<li class="empty muted">' + T('Chưa có file sao lưu nào trên server.', '服务器上还没有备份文件。') + '</li>'; return; }
        // Gom theo ngày: hohai-vn_2026-11-27.xlsx / .xls / .json
        const byDay = {};
        bkFiles.forEach((f) => { const m = /_(\d{4}-\d{2}-\d{2})\./.exec(f.name); const d = m ? m[1] : f.name; (byDay[d] = byDay[d] || []).push(f); });
        const days = Object.keys(byDay).sort().reverse();
        el.innerHTML = days.slice(0, state.bkShowAll ? days.length : 10).map((d) => {
            const files = byDay[d].sort((a, b) => (/\.json$/.test(a.name) ? 1 : 0) - (/\.json$/.test(b.name) ? 1 : 0) || (/\.xlsx$/.test(a.name) ? -1 : 1));
            return '<li><div><b>' + T('Ngày ', '数据日期 ') + esc(/^\d{4}/.test(d) ? T(viDay(d), d) : d) + '</b><div class="muted small">' +
                T('Lưu lúc ', '保存于 ') + esc(fullTime(new Date(files[0].modified).getTime())) + '</div></div><span class="bk-file-btns">' +
                files.map((f) => {
                    const ext = (f.name.split('.').pop() || '').toUpperCase();
                    return canDl ? '<button type="button" class="btn btn-ghost btn-sm" data-bkfile="' + esc(f.name) + '" title="' + esc(f.name) + '">' + esc(ext === 'JSON' ? 'JSON' : 'Excel (' + ext.toLowerCase() + ')') + ' · ' + fmtSize(f.size) + '</button>'
                        : '<span class="pill" title="' + esc(f.name) + '">' + esc(ext) + ' · ' + fmtSize(f.size) + '</span>';
                }).join('') + '</span></li>';
        }).join('') + (days.length > 10 && !state.bkShowAll ? '<li class="empty"><button type="button" class="link-btn" id="bk-more">' + T('Xem tất cả ' + days.length + ' ngày', '查看全部 ' + days.length + ' 天') + '</button></li>' : '');
    }
    async function bkDownload(name, btn) {
        const pinEl = $('bk-pin'), msg = $('bk-pin-msg');
        const pin = pinEl.value.trim();
        if (!pin) { msg.textContent = T('Nhập mã PIN rồi bấm vào file cần tải.', '请输入 PIN 码，然后点击要下载的文件。'); pinEl.focus(); return; }
        btn.disabled = true; msg.textContent = '';
        try {
            const res = await fetch(BK_SERVER + '/api/backup/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }) });
            if (res.status === 401) { msg.textContent = T('Mã PIN không đúng.', 'PIN 码错误。'); pinEl.value = ''; pinEl.focus(); return; }
            if (res.status === 429) { msg.textContent = T('Nhập sai quá nhiều lần, thử lại sau 15 phút.', '错误次数过多，请 15 分钟后再试。'); return; }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            downloadBlob(await res.blob(), name);
            msg.textContent = '';
            toast(T('Đang tải ', '正在下载 ') + name);
        } catch (e) {
            msg.textContent = T('Không tải được file (mất kết nối tới server).', '无法下载文件（与服务器的连接中断）。');
        } finally { btn.disabled = false; }
    }

    function initBackup() {
        $('bk-files').addEventListener('click', (e) => {
            const b = e.target.closest('[data-bkfile]');
            if (b) { bkDownload(b.dataset.bkfile, b); return; }
            if (e.target.id === 'bk-more') { state.bkShowAll = true; bkFilesRender(); }
        });
        $('bk-refresh').addEventListener('click', () => { bkCheckServer().then(() => { bkRender(); bkListFiles(); }); });
        $('bk-dl-form').addEventListener('submit', (e) => e.preventDefault());
        $('bk-toggle').addEventListener('click', () => {
            const st = bkLoad(); st.enabled = !st.enabled;
            bkSave(st); bkRender();
            toast(st.enabled ? T('Đã bật sao lưu tự động trên máy này.', '已在本机开启自动备份。') : T('Đã tắt sao lưu tự động.', '已关闭自动备份。'));
            if (st.enabled) setTimeout(bkTick, 500); // đã qua giờ hẹn mà hôm nay chưa sao lưu → chạy bù luôn
        });
        $('bk-manual').addEventListener('click', () => bkRun(isoDay(now() - DAY), true));
        bkRender();
        bkCheckServer().then(() => { bkRender(); bkListFiles(); });
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
        if (unLeads) unLeads();
        state.leads = {};
        unLeads = DS.watchLeads(R.start, (val) => { state.leads = val; scheduleRender(); });
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
        // Máy đã mở dashboard thì mặc định không tính vào thống kê web thật ('1').
        // Bấm "Tính cả trình duyệt này" sẽ lưu '0' và không bị ghi đè lại khi mở dashboard lần sau.
        try { if (localStorage.getItem(LS_OFF) === null) localStorage.setItem(LS_OFF, '1'); } catch (e) { }
        $('data-notice').addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b) return;
            const act = b.dataset.act;
            if (act === 'show-test' || act === 'hide-test') {
                state.showTest = act === 'show-test';
                try { localStorage.setItem(LS_SHOW_TEST, state.showTest ? '1' : '0'); } catch (err) { }
            } else if (act === 'count-me') {
                try { localStorage.setItem(LS_OFF, '0'); } catch (err) { }
                toast(T('Từ giờ trình duyệt này được tính vào thống kê.', '从现在起本浏览器计入统计。'));
            }
            scheduleRender();
        });

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
        $('export-btn').addEventListener('click', exportExcel);
        // Bộ lọc nâng cao
        $('filter-btn').addEventListener('click', () => {
            const p = $('filter-panel'), open = p.hidden;
            p.hidden = !open;
            $('filter-btn').setAttribute('aria-expanded', String(open));
            scheduleRender();
        });
        $('filter-grid').addEventListener('change', (e) => {
            const sel = e.target.closest('select[data-adv]');
            if (!sel) return;
            if (sel.value) state.adv[sel.dataset.adv] = sel.value; else delete state.adv[sel.dataset.adv];
            sel.classList.toggle('set', !!sel.value);
            state.page = 0; scheduleRender();
        });
        $('filter-clear').addEventListener('click', () => {
            state.adv = {}; state.filter = 'all'; state.q = ''; $('search').value = ''; state.page = 0; advSig = ''; scheduleRender();
        });
        $('lead-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-lf]');
            if (b) { state.leadFilter = b.dataset.lf; scheduleRender(); }
        });
        $('lead-list').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-lead]');
            if (!b) return;
            b.disabled = true;
            DS.setLeadStatus(b.dataset.lead, b.dataset.st)
                .then(() => toast(b.dataset.st === 'done' ? T('Đã đánh dấu đã liên hệ.', '已标记为已联系。') : T('Đã mở lại yêu cầu.', '已重新打开该请求。')))
                .catch(() => { b.disabled = false; toast(T('Không cập nhật được (mất mạng hoặc bị chặn quyền).', '更新失败（网络断开或没有权限）。')); });
        });
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
