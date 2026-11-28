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
    sdk: 'https://www.gstatic.com/firebasejs/9.23.0/',

    // true: lượt vào web qua IP mạng nội bộ (192.168.x.x, 10.x.x.x…, vd. chạy CHAY-WEB.bat rồi máy khác trong công ty vào)
    // được tính là khách thật. Đổi thành false khi web đã lên tên miền thật để lượt test trong công ty bị ẩn.
    // (localhost, 127.0.0.1, mở file trực tiếp luôn là lượt chạy thử.)
    lanIsLive: true,

    // Yêu cầu tư vấn (khung "Yêu cầu tư vấn" trong analytics.html). Mini App và web cùng ghi vào nhánh này.
    leads: {
        path: 'hohai_vn_leads',
        // Lưu yêu cầu khi khách bấm nút Zalo trên WEB. ĐANG TẮT vì chính sách bảo mật và ghi chú dưới form
        // đang cam kết "website không lưu thông tin bạn nhập". Chỉ bật (true) sau khi đã sửa các nội dung đó.
        web: false
    },

    // Sao lưu tự động (khung "Sao lưu tự động" trong analytics.html)
    backup: {
        hour: 13, minute: 0,          // giờ chạy mỗi ngày, theo giờ Việt Nam
        daysAgo: 1,                   // 1 = sao lưu dữ liệu ngày hôm trước
        // Nơi lưu file: '' = chính server web VN (tools/serve.js, chạy bằng CHAY-WEB.bat) → thư mục web-vn/backups/.
        // Web VN hoàn toàn tách khỏi web US: không gửi gì sang server / thư mục của web US.
        // Nếu mở trang không qua server web VN (mở file trực tiếp, Live Server…) thì file tải về thư mục Downloads.
        server: '',
        filePrefix: 'hohai-vn'        // tên file: hohai-vn_2026-11-25.xlsx / .json
    }
};
