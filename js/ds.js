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

    /* ---------- Reveal ---------- */
    var rvEls = $$('.rv, .rv-img');
    if ('IntersectionObserver' in window && !reduce) {
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        rvEls.forEach(function (el) { io.observe(el); });
    } else {
        rvEls.forEach(function (el) { el.classList.add('in'); });
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

    window.DS = { toast: toast, showG: showG, select: select, setQty: setQty, state: state, openLb: openLb };
})();
