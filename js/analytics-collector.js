/**
 * analytics-collector.js — Bộ thu thập lượt truy cập cho web HoHai Việt Nam
 * ---------------------------------------------------------------------------
 * Cần nạp js/monitor-config.js trước file này.
 *
 * Ghi vào Firebase Realtime Database, nhánh HOHAI_MONITOR.root:
 *   sessions/{sid}         tóm tắt 1 lượt truy cập (nguồn, thiết bị, vị trí, số trang, thời gian xem, đã liên hệ chưa)
 *   events/{sid}/{id}      từng hành động: xem trang, bấm Zalo, bấm gọi, cuộn trang, bấm nút
 *   presence/{tabId}       tab đang mở (tự xoá khi đóng tab, nhờ onDisconnect)
 *
 * Độ chính xác:
 *   - Mốc thời gian dùng giờ máy chủ Firebase (không phụ thuộc đồng hồ máy khách).
 *   - "Thời gian xem" chỉ cộng khi tab đang hiển thị VÀ khách có thao tác trong 90 giây gần nhất.
 *   - 1 lượt truy cập = chuỗi hoạt động không nghỉ quá 30 phút, dùng chung giữa các tab.
 *   - Bỏ qua bot / trình duyệt tự động, và bỏ qua trình duyệt của admin
 *     (tự bật khi đăng nhập dashboard, hoặc mở trang bất kỳ với ?monitor=off; bật lại bằng ?monitor=on).
 * ---------------------------------------------------------------------------
 */
(function (window, document) {
    'use strict';

    var CFG = window.HOHAI_MONITOR;
    if (!CFG || !CFG.firebase) return;

    var LS_OFF = 'hohai_vn_monitor_off';
    var LS_VISITOR = 'hohai_vn_vid';
    var LS_SESSION = 'hohai_vn_session';
    var SS_TAB = 'hohai_vn_tab';
    var SS_GEO = 'hohai_vn_geo';
    var SESSION_TIMEOUT = 30 * 60 * 1000;
    var IDLE_LIMIT = 90 * 1000;
    var TICK = 15 * 1000;

    /* ---------- 0. Có nên ghi nhận không ---------- */
    function store(kind) { try { return window[kind]; } catch (e) { return null; } }
    var LS = store('localStorage'), SS = store('sessionStorage');
    function lsGet(k) { try { return LS && LS.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { LS && LS.setItem(k, v); } catch (e) { } }
    function ssGet(k) { try { return SS && SS.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { SS && SS.setItem(k, v); } catch (e) { } }

    var qs = new URLSearchParams(window.location.search || '');
    if (qs.get('monitor') === 'off') lsSet(LS_OFF, '1');
    if (qs.get('monitor') === 'on') { try { LS && LS.removeItem(LS_OFF); } catch (e) { } }

    var path = (window.location.pathname || '').toLowerCase();
    var ua = navigator.userAgent || '';
    var isBot = navigator.webdriver ||
        /bot|crawl|spider|slurp|lighthouse|headless|pagespeed|preview|facebookexternalhit|zalo.*link|monitor|curl|wget|python|node-fetch/i.test(ua);
    if (isBot || lsGet(LS_OFF) === '1' || path.indexOf('analytics') !== -1) return;

    /* ---------- 1. Thông tin cơ bản ---------- */
    // ID khó đoán: mốc thời gian + 10 ký tự ngẫu nhiên (khớp quy tắc /^x_[a-z0-9]{10,30}$/ trong database.rules.json)
    function rid(p) {
        var chars = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '', buf = new Uint8Array(10);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
        else for (var j = 0; j < 10; j++) buf[j] = Math.floor(Math.random() * 256);
        for (var i = 0; i < 10; i++) out += chars[buf[i] % 36];
        return p + Date.now().toString(36) + out;
    }
    function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }

    function pageKey() {
        var p = (window.location.pathname.split('/').pop() || 'index').replace(/\.html?$/i, '');
        return cut(p.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'index', 60);
    }

    function systemInfo() {
        var iPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
        var device = iPad || /Tablet|PlayBook|Silk/i.test(ua) ? 'Tablet'
            : (/iPhone|iPod/i.test(ua) || (/Android/i.test(ua) && /Mobi/i.test(ua))) ? 'Mobile' : 'Desktop';
        var os = /iPhone|iPod/i.test(ua) ? 'iOS' : iPad ? 'iPadOS' : /Android/i.test(ua) ? 'Android'
            : /Win/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /CrOS/i.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'Khác';
        var browser = /Zalo/i.test(ua) ? 'Zalo' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook App'
            : /CocCoc|coc_coc/i.test(ua) ? 'Cốc Cốc' : /Edg\//i.test(ua) ? 'Edge' : /OPR|Opera/i.test(ua) ? 'Opera'
            : /SamsungBrowser/i.test(ua) ? 'Samsung' : /Chrome\//i.test(ua) ? 'Chrome'
            : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : 'Khác';
        return { device: device, os: os, browser: browser, screen: screen.width + 'x' + screen.height, lang: cut(navigator.language || '', 20) };
    }

    // Nguồn truy cập: ưu tiên tham số link (utm_source / ref / fbclid / gclid), sau đó tới trang giới thiệu
    function detectSource() {
        var u = (qs.get('utm_source') || qs.get('ref') || qs.get('src') || '').toLowerCase();
        var name = function (s) {
            if (/instagram|\big\b/.test(s)) return 'Instagram';
            if (/\bfb\b|facebook|fb\.com/.test(s)) return 'Facebook';
            if (/zalo/.test(s)) return 'Zalo';
            if (/tiktok/.test(s)) return 'TikTok';
            if (/google/.test(s)) return 'Google';
            if (/coccoc/.test(s)) return 'Cốc Cốc';
            if (/youtube|youtu\.be/.test(s)) return 'YouTube';
            if (/bing/.test(s)) return 'Bing';
            return '';
        };
        if (u) return name(u) || cut(u, 40);
        if (qs.get('fbclid')) return 'Facebook';
        if (qs.get('gclid')) return 'Google';
        var ref = document.referrer || '';
        if (!ref) return 'Trực tiếp';
        var host = '';
        try { host = new URL(ref).hostname.replace(/^www\./, ''); } catch (e) { }
        if (!host || host === window.location.hostname.replace(/^www\./, '')) return 'Trực tiếp';
        return name(host) || cut(host, 40);
    }

    /* ---------- 2. Khách & lượt truy cập ---------- */
    var now = Date.now();
    var visitorId = lsGet(LS_VISITOR);
    var returning = !!visitorId;
    if (!visitorId) { visitorId = rid('v_'); lsSet(LS_VISITOR, visitorId); }

    var sess = null;
    try { sess = JSON.parse(lsGet(LS_SESSION) || 'null'); } catch (e) { sess = null; }
    var isNewSession = !sess || !sess.id || (now - (sess.last || 0) > SESSION_TIMEOUT);
    if (isNewSession) {
        sess = { id: rid('s_'), last: now, active: 0, contacted: false };
    }
    sess.last = now;
    lsSet(LS_SESSION, JSON.stringify(sess));

    var tabId = ssGet(SS_TAB);
    if (!tabId) { tabId = rid('t_'); ssSet(SS_TAB, tabId); }

    var sys = systemInfo();
    var page = pageKey();

    /* ---------- 3. Firebase (nạp sau khi trang đã hiển thị để không làm chậm web) ---------- */
    var db = null, TS = null, INC = null, queue = [];
    function run(fn) { if (db) { try { fn(); } catch (e) { } } else queue.push(fn); }

    function loadScript(src) {
        return new Promise(function (ok, fail) {
            var s = document.createElement('script');
            s.src = src; s.async = true; s.onload = ok; s.onerror = fail;
            document.head.appendChild(s);
        });
    }
    function boot() {
        var p = window.firebase && window.firebase.database ? Promise.resolve()
            : loadScript(CFG.sdk + 'firebase-app-compat.js').then(function () { return loadScript(CFG.sdk + 'firebase-database-compat.js'); });
        p.then(function () {
            var fb = window.firebase;
            var app = fb.apps.length ? fb.app() : fb.initializeApp(CFG.firebase);
            db = app.database();
            TS = fb.database.ServerValue.TIMESTAMP;
            INC = fb.database.ServerValue.increment;
            while (queue.length) { try { queue.shift()(); } catch (e) { } }
        }).catch(function () { /* mạng chặn Firebase: bỏ qua, không ảnh hưởng web */ });
    }
    if (document.readyState === 'complete') setTimeout(boot, 300);
    else window.addEventListener('load', function () { setTimeout(boot, 300); });

    function ref(p) { return db.ref(CFG.root + '/' + p); }

    /* ---------- 4. Ghi lượt truy cập ---------- */
    run(function () {
        var upd = {
            visitorId: visitorId,
            lastSeen: TS,
            page: page,
            origin: cut(window.location.origin, 100)
        };
        upd['pages/' + page] = INC(1);
        upd.pageViews = INC(1);
        if (isNewSession) {
            upd.startedAt = TS;
            upd.returning = returning;
            upd.landing = page;
            upd.source = detectSource();
            upd.referrer = cut(document.referrer || '', 300);
            upd.campaign = cut(qs.get('utm_campaign') || '', 100);
            upd.device = sys.device; upd.os = sys.os; upd.browser = sys.browser;
            upd.screen = sys.screen; upd.lang = sys.lang;
            upd.activeSec = 0;
        }
        ref('sessions/' + sess.id).update(upd);
        logEvent('page_view', document.title ? cut(document.title.split('|')[0].trim(), 120) : page);
        setPresence();
        fetchGeo();
    });

    function logEvent(type, label) {
        run(function () {
            ref('events/' + sess.id).push({ t: type, label: cut(label || '', 200), page: page, at: TS });
        });
    }

    /* ---------- 5. Vị trí (theo IP) — chỉ tra 1 lần mỗi lượt truy cập ---------- */
    function fetchGeo() {
        if (ssGet(SS_GEO) === sess.id) return;
        var apis = [
            ['https://freeipapi.com/api/json', function (d) { return { ip: d.ipAddress, country: d.countryName, cc: d.countryCode, city: d.cityName, region: d.regionName }; }],
            ['https://ipapi.co/json/', function (d) { return { ip: d.ip, country: d.country_name, cc: d.country_code, city: d.city, region: d.region }; }]
        ];
        (function tryApi(i) {
            if (i >= apis.length) return;
            var ctrl = window.AbortController ? new AbortController() : null;
            var timer = setTimeout(function () { ctrl && ctrl.abort(); }, 5000);
            fetch(apis[i][0], ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (d) {
                clearTimeout(timer);
                var g = apis[i][1](d || {});
                if (!g.ip) throw new Error('no ip');
                ref('sessions/' + sess.id).update({
                    ip: cut(g.ip, 60), country: cut(g.country || '', 60), cc: cut(g.cc || '', 4),
                    city: cut(g.city || '', 80), region: cut(g.region || '', 80)
                });
                ssSet(SS_GEO, sess.id);
            }).catch(function () { clearTimeout(timer); tryApi(i + 1); });
        })(0);
    }

    /* ---------- 6. Đang online ---------- */
    function setPresence() {
        var r = ref('presence/' + tabId);
        r.onDisconnect().remove();
        r.set({ sid: sess.id, page: page, lastSeen: TS, visible: document.visibilityState === 'visible' });
    }

    /* ---------- 7. Thời gian xem thực ---------- */
    var lastInput = Date.now();
    var lastTick = Date.now();
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
        window.addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true, capture: true });
    });

    function accrue() {
        var t = Date.now();
        var gap = t - lastTick;
        lastTick = t;
        var visible = document.visibilityState === 'visible';
        // đọc lại từ localStorage để cộng dồn đúng khi khách mở nhiều tab
        try { var cur = JSON.parse(lsGet(LS_SESSION) || 'null'); if (cur && cur.id === sess.id) sess.active = Math.max(sess.active, cur.active || 0); } catch (e) { }
        if (visible && t - lastInput < IDLE_LIMIT && gap > 0) {
            sess.active += Math.min(gap, TICK + 5000) / 1000;
        }
        if (visible) sess.last = t;
        lsSet(LS_SESSION, JSON.stringify(sess));
        return visible;
    }

    function heartbeat() {
        var visible = accrue();
        run(function () {
            var upd = { activeSec: Math.round(sess.active) };
            if (visible) upd.lastSeen = TS;
            ref('sessions/' + sess.id).update(upd);
            ref('presence/' + tabId).update({ lastSeen: TS, visible: visible, page: page });
        });
    }
    setInterval(function () { if (document.visibilityState === 'visible') heartbeat(); }, TICK);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') { lastTick = Date.now(); lastInput = Date.now(); }
        heartbeat();
    });
    window.addEventListener('pagehide', heartbeat);

    /* ---------- 8. Hành động ---------- */
    function btnText(el) {
        var s = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().replace(/^Zalo\s*/, '');
        return cut(s, 80);
    }
    var lastContact = 0;
    function contact(kind, label) {
        var t = Date.now();
        if (t - lastContact < 1500) return; // chống bấm đúp
        lastContact = t;
        logEvent(kind, label);
        run(function () {
            var upd = { lastSeen: TS };
            upd[kind === 'click_zalo' ? 'zaloClicks' : 'phoneClicks'] = INC(1);
            if (!sess.contacted) { upd.contacted = true; upd.contactAt = TS; upd.contactVia = cut(label, 120); upd.contactPage = page; }
            sess.contacted = true;
            lsSet(LS_SESSION, JSON.stringify(sess));
            ref('sessions/' + sess.id).update(upd);
        });
    }

    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target : null;
        if (!el) return;
        var zalo = el.closest('.js-zalo, a[href*="zalo.me"]');
        if (zalo) {
            var key = zalo.getAttribute('data-msg');
            return contact('click_zalo', (btnText(zalo) || 'Zalo') + (key ? ' · ' + key : ''));
        }
        var tel = el.closest('a[href^="tel:"]');
        if (tel) return contact('click_phone', 'Gọi ' + tel.getAttribute('href').slice(4));
        var mail = el.closest('a[href^="mailto:"]');
        if (mail) return logEvent('click_email', mail.getAttribute('href').slice(7));
        var a = el.closest('a[href]');
        if (a && a.hostname && a.hostname !== window.location.hostname) return logEvent('click_out', btnText(a) + ' → ' + a.hostname);
        var btn = el.closest('button, .btn, summary, [role="button"]');
        if (btn) logEvent('click', btnText(btn));
    }, true);

    var marks = { 50: false, 90: false };
    window.addEventListener('scroll', function () {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        if (h <= 200) return;
        var pct = window.scrollY / h * 100;
        [50, 90].forEach(function (m) {
            if (!marks[m] && pct >= m) { marks[m] = true; logEvent('scroll', 'Cuộn ' + m + '% trang'); }
        });
    }, { passive: true });

    /* ---------- 9. Yêu cầu tư vấn (nhánh CFG.leads.path, dùng chung với Zalo Mini App) ----------
     * ds.js gọi HohaiMonitor.lead(...) khi khách bấm nút Zalo có nội dung soạn sẵn.
     * Chỉ ghi khi CFG.leads.web === true (xem ghi chú trong monitor-config.js). */
    var LEAD_SKIP = { chat: 1, hero: 1 }; // nút chat chung, không mang thông tin cụ thể
    var lastLead = '';
    function lead(kind, message, opts) {
        var L = CFG.leads || {};
        if (!L.web || !L.path || !message || LEAD_SKIP[kind]) return;
        if (message === lastLead) return; // bấm lại cùng nội dung thì không ghi trùng
        lastLead = message;
        var o = {};
        ['size', 'color', 'qty', 'weight', 'count'].forEach(function (k) { if (opts && opts[k] != null) o[k] = cut(opts[k], 40); });
        run(function () {
            db.ref(L.path).push({
                channel: 'web', status: 'new', createdAt: TS,
                kind: cut(kind || '', 30), page: page, message: cut(message, 1500), opts: o,
                sid: sess.id, vid: visitorId
            });
        });
    }

    window.HohaiMonitor = { log: logEvent, lead: lead, sessionId: function () { return sess.id; } };
})(window, document);
