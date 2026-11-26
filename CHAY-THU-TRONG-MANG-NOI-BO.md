# Chạy web HoHai VN trong mạng nội bộ / 在局域网内运行网站

## Tiếng Việt

**Cần có:** Node.js bản LTS (https://nodejs.org) — cài 1 lần.

1. Tải code về: trên GitHub bấm **Code → Download ZIP** rồi giải nén (hoặc `git clone`).
2. **Windows:** nhấp đúp `CHAY-WEB.bat`. **Mac:** nhấp đúp `chay-web.command` (lần đầu: chuột phải → Open).
3. Cửa sổ đen hiện địa chỉ, ví dụ:
   - Trên máy này: `http://localhost:8080`
   - Máy khác cùng mạng: `http://192.168.1.88:8080`
   - Trang giám sát: `http://192.168.1.88:8080/analytics.html`
4. **Máy khác không vào được?**
   - Lần đầu chạy, Windows có thể hỏi "Cho phép Node.js truy cập mạng" → tick **Private networks** → **Allow**.
   - Nếu đã lỡ bấm Cancel: chạy `MO-TUONG-LUA.bat` (bấm Yes khi Windows hỏi quyền quản trị). Chỉ mở cổng 8080 cho mạng nội bộ.
   - Kiểm tra Wi-Fi/LAN của máy chạy web đang là **Private** (Settings → Network → Wi-Fi → Network profile type).
   - Hai máy phải cùng một mạng (cùng Wi-Fi/router). Wi-Fi khách (guest) thường chặn các máy nhìn thấy nhau.
5. Giữ cửa sổ đen mở trong lúc dùng. Đóng cửa sổ là tắt web.

**Thống kê:** lượt vào qua IP mạng nội bộ đang được tính là khách thật (`lanIsLive: true` trong `js/monitor-config.js`).
Khi web lên tên miền thật, đổi thành `false`.
Trong mạng nội bộ mọi lượt đều được ghi, kể cả trình duyệt đã mở trang giám sát.

## 中文

**需要：** Node.js LTS 版本（https://nodejs.org），只需安装一次。

1. 下载代码：在 GitHub 点击 **Code → Download ZIP** 并解压（或使用 `git clone`）。
2. **Windows：** 双击 `CHAY-WEB.bat`。**Mac：** 双击 `chay-web.command`（第一次：右键 → 打开）。
3. 黑色窗口会显示访问地址，例如：
   - 本机：`http://localhost:8080`
   - 局域网其他电脑：`http://192.168.1.88:8080`
   - 监控页面：`http://192.168.1.88:8080/analytics.html`
4. **其他电脑打不开？**
   - 第一次运行时 Windows 可能询问是否允许 Node.js 访问网络 → 勾选 **专用网络** → **允许**。
   - 如果之前点了取消：运行 `MO-TUONG-LUA.bat`（Windows 请求管理员权限时点“是”）。只为局域网开放 8080 端口。
   - 确认运行网站的电脑的网络类型为 **专用（Private）**（设置 → 网络 → Wi-Fi → 网络配置文件类型）。
   - 两台电脑必须在同一网络（同一 Wi-Fi/路由器）。访客 Wi-Fi 通常禁止设备互相访问。
5. 使用期间请保持黑色窗口打开，关闭窗口即停止网站。

**统计：** 通过局域网 IP 的访问目前计为真实访客（`js/monitor-config.js` 中 `lanIsLive: true`）。网站上线正式域名后改为 `false`。
在局域网内所有访问都会被记录，包括打开过监控页面的浏览器。
