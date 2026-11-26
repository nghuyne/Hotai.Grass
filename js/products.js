/**
 * products.js — Đọc dữ liệu sản phẩm dùng chung (data/products.json) cho website.
 * Zalo Mini App đọc cùng file này, nên sửa sản phẩm / size / giá ở data/products.json là đủ.
 *
 *   HOHAI_DATA.ready.then(function (d) { ... })   // d = nội dung products.json
 *   HOHAI_DATA.get()                               // dữ liệu đã nạp hoặc null
 *   HOHAI_DATA.product(d, 'tham')                  // 1 sản phẩm theo id
 *   HOHAI_DATA.recommend(d, space, weight, many)   // gợi ý cho công cụ chọn giải pháp
 */
(function (window) {
    'use strict';
    var data = null;
    var ready = fetch('data/products.json?v=1', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { data = d; return d; });
    ready.catch(function (e) { if (window.console) console.warn('[products] Không đọc được data/products.json', e); });

    function product(d, id) {
        for (var i = 0; i < d.products.length; i++) if (d.products[i].id === id) return d.products[i];
        return null;
    }

    // Cùng luật với Mini App (zalo-miniapp/src/lib/data.js → recommend)
    function recommend(d, space, weight, many) {
        var r = d.recommend[space];
        if (!r) return null;
        var p = product(d, r.product);
        var key = many && r.title.many ? 'many' : weight;
        var desc = r.desc;
        if (r.descMany && many) desc += ' ' + r.descMany;
        else if (r.descOne && !many) desc += ' ' + r.descOne;
        if (r.descLarge && weight === 'large') desc += ' ' + r.descLarge;
        return { product: p, title: r.title[key] || r.title.medium, desc: desc, image: r.image, link: p ? p.page : 'index.html' };
    }

    window.HOHAI_DATA = { ready: ready, get: function () { return data; }, product: product, recommend: recommend };
})(window);
