/**
 * monitor-config.js — Cấu hình chung cho bộ thu thập (analytics-collector.js) và dashboard (analytics.html).
 *
 * Cấu hình web Firebase KHÔNG phải bí mật: ai mở trang cũng xem được. Dữ liệu được bảo vệ bằng
 * Firebase Rules (file firebase/database.rules.json) và đăng nhập Firebase Auth, không phải bằng việc giấu config.
 */
window.HOHAI_MONITOR = {
    firebase: {
        apiKey: 'AIzaSyBfobLTcFf1AvLKiWxdjaPDvu7WC6hB8D8',
        authDomain: 'analytics-grass-trho.firebaseapp.com',
        databaseURL: 'https://analytics-grass-triho-default-rtdb.firebaseio.com',
        projectId: 'anaytics-grass-triho',
        appId: '1:281595165078:web:9a4adb98ccd59fe05d45b7'
    },
    root: 'hohai_vn_analytics',      // nhánh dữ liệu của web VN (web US dùng 'hohai_analytics')
    adminsPath: 'hohai_vn_admins',   // danh sách UID được xem dashboard (chỉ sửa trong Firebase Console)
    sdk: 'https://www.gstatic.com/firebasejs/9.23.0/'
};
