/**
 * ds.js — JS cho bộ thiết kế mới (ds.css)
 * ---------------------------------------------------------
 * Cấu hình trang (khai báo trước khi nạp file này, tuỳ chọn):
 *   window.DS_PAGE = {
 *     gallery: [{ src, cap }],
 *     messages: { key: 'text' | function () { return 'text'; } }
 *   };
 * Nút Zalo: <a class="js-zalo" data-msg="key">  → copy tin nhắn + mở Zalo
 * Hiệu ứng: .rv (hiện dần), .rv-img (ảnh mở rộng), style="--d:.1s" để trễ
 * ---------------------------------------------------------
 */
(function () {
    'use strict';

    var ZALO_LINK = 'https://zalo.me/0847131400';
    var PAGE = window.DS_PAGE || {};
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var state = { qty: 1 };
    var G = PAGE.gallery || [];

    window.addEventListener('load', function () { document.body.classList.add('is-loaded'); });
    requestAnimationFrame(function () { setTimeout(function () { document.body.classList.add('is-loaded'); }, 60); });

    /* ---------- Header ---------- */
    var hd = $('.hd');
    var onScroll = function () { if (hd) hd.classList.toggle('scrolled', window.scrollY > 16); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- Menu mobile (chỉ hiện dưới 900px, desktop dùng .nav như cũ) ---------- */
    (function () {
        var wrap = hd && $('.wrap', hd);
        if (!wrap) return;
        var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
        var item = function (href, label, sub) {
            var on = href.toLowerCase() === here ? ' class="on" aria-current="page"' : '';
            return '<a href="' + esc(href) + '"' + on + '><span>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><i aria-hidden="true">→</i></a>';
        };
        var prod = [['index.html', 'Trang chủ', '']];
        $$('.nav a', hd).forEach(function (a) { prod.push([a.getAttribute('href'), a.textContent.trim(), '']); });
        var subs = { 'khay-ve-sinh-co.html': 'Thay tã lót cho căn hộ', 'tham-co-ban-cong.html': 'Trải là dùng, không cần thợ', 'cuon-co-trai-cho.html': 'Trại chó · pet hotel · spa', 'gioi-thieu.html': 'Nhà sản xuất tại TP.HCM' };
        var html = '<div class="mnav-in"><div class="mnav-l">Sản phẩm &amp; thông tin</div>';
        prod.forEach(function (p) { html += item(p[0], p[1], subs[p[0]] || ''); });
        html += '<div class="mnav-l">Hỗ trợ</div>' + item('lien-he.html', 'Liên hệ') + item('chinh-sach-bao-hanh.html', 'Bảo hành & đổi trả') + item('chinh-sach-bao-mat.html', 'Chính sách bảo mật');
        html += '<div class="mnav-cta"><a href="#" class="btn btn-zalo js-zalo" data-msg="chat"><span class="zalo-mark">Zalo</span>Nhắn Zalo tư vấn</a><a href="tel:0847131400" class="btn btn-ghost">Gọi 0847 131 400</a></div></div>';

        var panel = document.createElement('nav');
        panel.className = 'mnav'; panel.id = 'mnav'; panel.setAttribute('aria-label', 'Menu');
        panel.innerHTML = html;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'mnav-btn';
        btn.setAttribute('aria-controls', 'mnav'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'Mở menu');
        btn.innerHTML = '<span></span><span></span><span></span>';
        wrap.appendChild(btn);
        hd.parentNode.insertBefore(panel, hd.nextSibling);

        var set = function (open) {
            document.body.classList.toggle('mnav-open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
        };
        btn.addEventListener('click', function () { set(!document.body.classList.contains('mnav-open')); });
        panel.addEventListener('click', function (e) { if (e.target === panel || e.target.closest('a')) set(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
        window.addEventListener('resize', function () { if (window.innerWidth > 900) set(false); });
    })();

    /* ---------- Bộ biểu tượng: <svg class="i"><use href="#i-ten"/></svg> ---------- */
    (function () {
        var P = {
            check: '<path d="M4 12.5l5 5L20 6.5"/>',
            cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
            truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>',
            card: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
            swap: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
            shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
            scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
            roll: '<ellipse cx="7" cy="12" rx="3" ry="6"/><path d="M7 6h11a3 6 0 0 1 0 12H7"/><path d="M7 10.5a1 1.5 0 1 0 0 3"/>',
            gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 4 8 4.5 7 8 12 8zM12 8s1.5-4 4-3.5S17 8 12 8z"/>',
            pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
            clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="5.8" r="1.8"/><circle cx="15.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/><path d="M12.5 11.5c-2.6 0-5.5 3.6-5.5 6a2.6 2.6 0 0 0 3.6 2.3c1.2-.5 2.6-.5 3.8 0A2.6 2.6 0 0 0 18 17.5c0-2.4-2.9-6-5.5-6z"/>',
            drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
            factory: '<path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
            eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
            home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
            store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 12v8h14v-8M10 20v-4h4v4"/>',
            kennel: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-4a2.5 2.5 0 0 1 5 0v4"/>',
            layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5M3 17l9 5 9-5"/>',
            timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
            leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19 13 11"/>',
            sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
            chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
            ruler: '<path d="M3 16 16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
            star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
            grass: '<path d="M3 20h18M6 20c0-4-1-7-3-9M10 20c0-6 1-10 3-13M14 20c0-4 1.5-7 4-9M18 20c0-2 .5-4 2-5"/>'
        };
        var s = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">';
        for (var k in P) s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + '</symbol>';
        document.body.insertAdjacentHTML('afterbegin', s + '</svg>');
    })();

    /* ---------- Dải ảnh trượt: nhân đôi để chạy vòng liền mạch ---------- */
    $$('.strip-track').forEach(function (t) {
        $$('figure', t).forEach(function (f) { var c = f.cloneNode(true); c.setAttribute('aria-hidden', 'true'); t.appendChild(c); });
    });

    /* ---------- Reveal ---------- */
    var rvEls = $$('.rv, .rv-img, .steps');
    if ('IntersectionObserver' in window && !reduce) {
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        rvEls.forEach(function (el) { io.observe(el); });
    } else {
        rvEls.forEach(function (el) { el.classList.add('in'); });
    }

    /* ---------- Số đếm lên: <b data-count="18900">18.900</b>{hậu tố ngoài thẻ} ---------- */
    var cEls = $$('[data-count]');
    if (cEls.length && 'IntersectionObserver' in window && !reduce) {
        // Có dấu chấm ngăn cách chỉ khi ≥ 10.000 (năm 2022 giữ nguyên "2022")
        var fmt = function (n, big) { n = Math.round(n); return big ? n.toLocaleString('vi-VN') : String(n); };
        var cio = new IntersectionObserver(function (es) {
            es.forEach(function (e) {
                if (!e.isIntersecting) return;
                cio.unobserve(e.target);
                var el = e.target, to = parseFloat(el.getAttribute('data-count')), from = parseFloat(el.getAttribute('data-from') || 0), t0 = null, dur = 1600;
                var step = function (t) {
                    if (!t0) t0 = t;
                    var p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 4);
                    el.textContent = fmt(from + (to - from) * k, to >= 10000);
                    if (p < 1) requestAnimationFrame(step);
                };
                el.textContent = fmt(from, to >= 10000);
                setTimeout(function () { requestAnimationFrame(step); }, 250);
            });
        }, { threshold: 0.4 });
        cEls.forEach(function (el) { cio.observe(el); });
    }

    /* ---------- Ảnh trôi nhẹ khi cuộn + thanh tiến trình đọc ---------- */
    if (!reduce) {
        var pars = $$('.duo-img > img, .final > img, .promo-media > img');
        pars.forEach(function (im) { im.classList.add('par'); });
        var bar = document.createElement('div');
        bar.className = 'sprog'; bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);
        var ticking = false;
        var frame = function () {
            ticking = false;
            var vh = window.innerHeight, de = document.documentElement;
            bar.style.transform = 'scaleX(' + Math.min(1, window.scrollY / Math.max(1, de.scrollHeight - vh)) + ')';
            pars.forEach(function (im) {
                var r = im.parentNode.getBoundingClientRect();
                if (r.bottom < -100 || r.top > vh + 100) return;
                var p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2); // -1 → 1
                im.style.setProperty('--py', (p * -4).toFixed(2) + '%');
            });
        };
        var req = function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
        window.addEventListener('scroll', req, { passive: true });
        window.addEventListener('resize', req);
        frame();
    }

    /* ---------- Toast ---------- */
    var toastEl = $('.toast'), tt;
    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('on');
        clearTimeout(tt);
        tt = setTimeout(function () { toastEl.classList.remove('on'); }, 4200);
    }

    /* ---------- Zalo ---------- */
    function copy(text) {
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
        return new Promise(function (ok, no) {
            try {
                var ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                var r = document.execCommand('copy'); document.body.removeChild(ta);
                r ? ok() : no();
            } catch (e) { no(e); }
        });
    }
    document.addEventListener('click', function (e) {
        var a = e.target.closest('.js-zalo');
        if (!a) return;
        e.preventDefault();
        var m = (PAGE.messages || {})[a.getAttribute('data-msg')];
        if (typeof m === 'function') m = m(state);
        // Ghi yêu cầu tư vấn (chỉ khi bật trong monitor-config.js → leads.web)
        if (m && window.HohaiMonitor && window.HohaiMonitor.lead) { try { window.HohaiMonitor.lead(a.getAttribute('data-msg'), m, state); } catch (err) { } }
        var go = function () { window.open(ZALO_LINK, '_blank', 'noopener'); };
        if (!m) return go();
        copy(m).then(function () { toast('Đã copy nội dung. Trong Zalo, bạn chỉ cần Dán và Gửi.'); })
            .catch(function () { toast('Đang mở Zalo…'); }).then(go);
    });

    /* ---------- FAQ (mở/đóng mượt) ---------- */
    $$('.faq details').forEach(function (d) {
        var sum = $('summary', d), ans = $('.ans', d);
        if (!ans) return;
        if (d.open) ans.style.height = 'auto';
        sum.addEventListener('click', function (e) {
            e.preventDefault();
            if (reduce) { d.open = !d.open; ans.style.height = d.open ? 'auto' : '0'; return; }
            if (d.open) {
                ans.style.height = ans.scrollHeight + 'px';
                requestAnimationFrame(function () { ans.style.height = '0px'; });
                ans.addEventListener('transitionend', function f() { d.open = false; ans.removeEventListener('transitionend', f); });
            } else {
                d.open = true;
                ans.style.height = '0px';
                requestAnimationFrame(function () { ans.style.height = ans.scrollHeight + 'px'; });
                ans.addEventListener('transitionend', function f() { ans.style.height = 'auto'; ans.removeEventListener('transitionend', f); });
            }
        });
    });

    /* ---------- Gallery (chuyển mờ dần) ---------- */
    var gMain = $('.gal-main'), gCap = $('.gal-cap'), gThumbs = $('.gal-thumbs'), cur = 0;
    if (gMain && G.length) {
        gMain.innerHTML = '';
        G.forEach(function (g, i) {
            var im = new Image();
            im.src = g.src; im.alt = g.cap; if (i === 0) im.className = 'on'; else im.loading = 'lazy';
            gMain.appendChild(im);
            if (gThumbs) {
                var b = document.createElement('button');
                b.type = 'button'; b.setAttribute('aria-label', 'Ảnh ' + (i + 1));
                if (i === 0) b.className = 'on';
                b.innerHTML = '<img src="' + (g.thumb || g.src) + '" alt="" loading="lazy">';
                b.addEventListener('click', function () { showG(i); });
                gThumbs.appendChild(b);
            }
        });
        if (gCap) gCap.textContent = G[0].cap;
        gMain.addEventListener('click', function () { openLb(G, cur); });
        var sx = null;
        gMain.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
        gMain.addEventListener('touchend', function (e) {
            if (sx === null) return;
            var dx = e.changedTouches[0].clientX - sx;
            if (Math.abs(dx) > 40) showG(cur + (dx < 0 ? 1 : -1));
            sx = null;
        });
    }
    function showG(i) {
        cur = (i + G.length) % G.length;
        $$('img', gMain).forEach(function (im, k) { im.classList.toggle('on', k === cur); });
        if (gThumbs) $$('button', gThumbs).forEach(function (b, k) { b.classList.toggle('on', k === cur); });
        if (gCap) gCap.textContent = G[cur].cap;
    }

    /* ---------- Lightbox ---------- */
    var lb = $('.lb'), lbList = [], lbI = 0;
    function lbShow(i) {
        lbI = (i + lbList.length) % lbList.length;
        $('img', lb).src = lbList[lbI].src;
        $('img', lb).alt = lbList[lbI].cap;
        $('figcaption', lb).textContent = lbList[lbI].cap;
    }
    function openLb(list, i) { if (!lb) return; lbList = list; lbShow(i); lb.classList.add('on'); document.documentElement.style.overflow = 'hidden'; }
    function closeLb() { lb.classList.remove('on'); document.documentElement.style.overflow = ''; }
    if (lb) {
        $('.x', lb).addEventListener('click', closeLb);
        $('.p', lb).addEventListener('click', function () { lbShow(lbI - 1); });
        $('.n', lb).addEventListener('click', function () { lbShow(lbI + 1); });
        lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
        document.addEventListener('keydown', function (e) {
            if (!lb.classList.contains('on')) return;
            if (e.key === 'Escape') closeLb();
            if (e.key === 'ArrowLeft') lbShow(lbI - 1);
            if (e.key === 'ArrowRight') lbShow(lbI + 1);
        });
    }

    /* ---------- Thanh mua nhanh mobile ---------- */
    var anchor = $('[data-mbar-anchor]');
    if (anchor && 'IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
            var e = es[0];
            document.body.classList.toggle('mbar-on', !e.isIntersecting && e.boundingClientRect.top < 0);
        }).observe(anchor);
    }

    /* ---------- Chế độ nháp (?draft=1): đánh dấu ảnh cần thay ---------- */
    if (/[?&]draft=1\b/.test(location.search)) {
        document.body.classList.add('draft');
        $$('[data-slot]').forEach(function (s) {
            if (getComputedStyle(s).position === 'static') s.style.position = 'relative';
            var l = document.createElement('span');
            l.className = 'slot-lbl'; l.textContent = 'ẢNH TẠM: ' + s.getAttribute('data-slot');
            s.appendChild(l);
        });
    }

    /* ---------- Phân loại sản phẩm ----------
     * <div class="chips" data-opt="size"><button class="chip on" data-val="Vừa">…</button></div>
     * <span data-label="size"></span>  ·  số lượng: #qty + [data-qty="-1"] / [data-qty="1"]
     * Ảnh gallery có thuộc tính trùng tên opt (vd size: 'Vừa') sẽ tự hiện khi chọn.
     */
    function sync() {
        $$('[data-label]').forEach(function (el) {
            var k = el.getAttribute('data-label');
            if (state[k] !== undefined) el.textContent = state[k];
        });
        if (PAGE.onChange) PAGE.onChange(state);
    }
    function select(opt, val, silentGallery) {
        var g = $('.chips[data-opt="' + opt + '"]');
        if (g) $$('.chip', g).forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-val') === val); });
        state[opt] = val;
        if (!silentGallery) {
            for (var k = 0; k < G.length; k++) { if (G[k][opt] === val) { showG(k); break; } }
        }
        sync();
    }
    $$('.chips[data-opt]').forEach(function (g) {
        var opt = g.getAttribute('data-opt');
        var a = $('.chip.on', g);
        if (a) state[opt] = a.getAttribute('data-val');
        $$('.chip', g).forEach(function (c) {
            c.addEventListener('click', function () { select(opt, c.getAttribute('data-val')); });
        });
    });
    var qty = $('#qty');
    function setQty(n) {
        n = Math.max(1, Math.min(99, parseInt(n, 10) || 1));
        state.qty = n;
        if (qty) qty.value = n;
        sync();
    }
    if (qty) {
        state.qty = parseInt(qty.value, 10) || 1;
        $$('[data-qty]').forEach(function (b) {
            b.addEventListener('click', function () { setQty(state.qty + parseInt(b.getAttribute('data-qty'), 10)); });
        });
        qty.addEventListener('change', function () { setQty(qty.value); });
    }
    sync();

    /* ---------- Dải ảnh trượt → lightbox ---------- */
    $$('.strip-track').forEach(function (t) {
        var figs = $$('figure', t), n = figs.length / 2;
        var list = figs.slice(0, n).map(function (f) { return { src: $('img', f).src, cap: $('figcaption', f).textContent }; });
        figs.forEach(function (f, i) { f.addEventListener('click', function () { openLb(list, i % n); }); });
    });

    window.DS = { toast: toast, showG: showG, select: select, setQty: setQty, state: state, openLb: openLb };
})();
