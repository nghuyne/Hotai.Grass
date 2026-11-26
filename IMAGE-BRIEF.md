> **Cập nhật 25/11/2026:** site VN đã chuyển sang thư mục riêng `web-vn/`, thiết kế mới (`css/ds.css`). Ảnh dùng trên web nằm trong `web-vn/assets/img/` và đã đổi tên tiếng Việt (vd `toilet-6.png` → `khay-trang-nha-tam.png`, `breeder-turf-roll.jpg` → `cuon-co-that-hcm.jpg`). File `minh-hoa-*` là ảnh AI/minh hoạ cần thay bằng ảnh thật. Ảnh stock Unsplash/Pexels đang được tải trực tiếp từ server của họ.

# Brief ảnh cho website VN (vi/index.html)

Ảnh hiện tại đang mượn từ site Mỹ (ảnh AI, bối cảnh Mỹ: skyline Mỹ, ban công rộng, sàn gỗ sồi).
Mở `vi/index.html?draft=1` để thấy viền cam + tên từng ô ảnh cần thay.

## Đặc điểm bối cảnh chung cư Việt Nam (để ảnh "thật")

- Ban công **hẹp** (sâu 1–1,5m), sàn **gạch men** sáng màu, có **lưới / khung sắt an toàn**, cửa kính lùa nhôm.
- Có **giàn phơi đồ**, chậu cây nhỏ, cục nóng máy lạnh.
- View: các tòa chung cư cao tầng VN (Landmark 81 xa xa, khu Q.7, Thủ Đức), trời nắng gắt hoặc mưa chiều.
- Trong nhà: sàn gạch hoặc sàn gỗ công nghiệp, căn hộ 2PN nhỏ gọn, nhà tắm lát gạch.
- Chó: **Poodle nâu đỏ, Phốc sóc, Chihuahua, Corgi, Shiba, chó Phú Quốc**. Ưu tiên chó nhỏ.
- Người (nếu có): người Việt trẻ, 25–35 tuổi, trang phục ở nhà.

## Danh sách ô ảnh

| Ô (data-img-slot) | Vị trí | Nội dung cần | Tỷ lệ |
|---|---|---|---|
| HERO | Ảnh nền đầu trang | Poodle/Phốc nằm trên thảm cỏ ở ban công chung cư VN, lưới an toàn, view cao tầng TP.HCM, ánh chiều. Khoảng trống bên trái để đặt chữ | 16:9, ≥ 1920px |
| WIZ-INDOOR | Wizard – Góc trong căn hộ | Khay vệ sinh cỏ ở góc nhà tắm / góc phòng khách căn hộ VN, chó nhỏ đứng trên khay | 4:3 |
| WIZ-BALCONY | Wizard – Ban công | Ban công hẹp sàn gạch, 1 tấm thảm cỏ 1,33×2m + 1 khay ở góc | 4:3 |
| WIZ-ROOFTOP | Wizard – Sân thượng | Sân thượng nhà phố VN (bồn nước inox, mái tôn hàng xóm), trải cuộn cỏ, chó chạy chơi | 4:3 |
| WIZ-BUSINESS | Wizard – Trại chó | Khu chuồng / pet hotel có cỏ, nhiều chó con | 4:3 |
| SP-KHAY | Thẻ sản phẩm khay | Khay 3 lớp, chó nhỏ trên khay, nền căn hộ VN (hoặc ảnh nền trắng chụp thật) | 4:3 |
| SP-THAM | Thẻ thảm ban công | Thảm Garden Soft 1,33×2m trải trên ban công gạch VN | 4:3 |
| SP-CUON | Thẻ cuộn 1×5m | Cuộn cỏ thật chụp tại kho/nhà máy (có nhãn), một phần trải ra | 4:3 |

Ảnh **giữ lại được** từ site Mỹ (trung tính, không lộ bối cảnh Mỹ): 3 lớp khay (`pet-toilet/layers/*`), ảnh cận sợi cỏ, ảnh thử đổ nước, ảnh cuộn cỏ nền trắng.

## Nguồn ảnh: thứ tự ưu tiên

1. **Tự chụp thật** (tốt nhất, khách VN tin ảnh thật hơn ảnh AI): mượn 1–2 căn hộ của nhân viên/khách quen ở Q.7, Thủ Đức + 1 trại chó đối tác. Chụp bằng điện thoại cũng được, ánh sáng tự nhiên. Quay luôn video 15–30s (đổ nước, xịt rửa) để dùng cho Zalo/TikTok.
2. **Ảnh/video từ KOC và khách** (sau khi chạy chương trình): xin phép bằng tin nhắn trước khi đăng lên web.
3. **Ảnh AI** (Gemini/ChatGPT như site Mỹ đang làm) theo prompt bên dưới: dùng tạm trong lúc chờ ảnh thật. Kiểm tra kỹ chân chó và chữ trên ảnh.
4. **Ảnh stock có license** (Unsplash/Pexels: "Vietnam apartment balcony", "Saigon skyline"): dùng cho nền, không cần sản phẩm.

⚠️ Chỉ **tham khảo bố cục, góc chụp** từ fanpage, shop Shopee hay website khác ở VN. Không tải ảnh của họ về dùng (vi phạm bản quyền, dễ bị report trên sàn).

## Prompt AI mẫu (tiếng Anh cho kết quả tốt hơn)

**HERO**
> Photorealistic photo, small red-brown toy poodle lying on a bright green artificial grass mat on a narrow apartment balcony in Ho Chi Minh City, Vietnam. Light beige ceramic floor tiles, black metal safety grille, sliding aluminium glass door, a small clothes drying rack and a potted plant. Background: dense high-rise Vietnamese apartment towers, warm late-afternoon tropical light. Empty space on the left third for text. 16:9, natural, not luxury, shot on smartphone.

**WIZ-INDOOR**
> Photorealistic, a Pomeranian standing on a square artificial grass dog potty tray (grass mat on black plastic tray) placed in the corner of a small tiled bathroom in a Vietnamese apartment, clean, soft daylight, 4:3.

**WIZ-BALCONY**
> Photorealistic, narrow Vietnamese apartment balcony (1.2m deep) with ceramic tiles, a 1.3×2m artificial grass mat laid on the floor and a small grass potty tray in one corner, a corgi sitting on the grass, safety grille, city apartment blocks outside, 4:3.

**WIZ-ROOFTOP**
> Photorealistic, rooftop terrace of a Vietnamese tube house in Saigon, stainless steel water tank, neighbouring corrugated roofs, artificial grass laid on the concrete floor, a Shiba Inu playing, bright tropical sun, 4:3.

**WIZ-BUSINESS**
> Photorealistic, small dog kennel / pet hotel in Vietnam, indoor play area floored with artificial grass, several poodle and corgi puppies, staff in uniform in background, clean and bright, 4:3.

---

# Trang chi tiết: khay-ve-sinh-co.html

Ảnh khay hiện tại là ảnh AI có sẵn trong `assets/img/pet-toilet/`. Ảnh **chỉ có sản phẩm** (sơ đồ 3 lớp, đổ nước, cận sợi cỏ, nhấc khay) dùng được lâu dài. Ảnh **có người phương Tây hoặc nhà kiểu Mỹ** cần thay.

| Ô | Ảnh hiện tại | Cần thay bằng |
|---|---|---|
| GALLERY (ảnh 10, 11, 12) | toilet-4, pettoilet-image6, toilet-1 (có người phương Tây) | Người Việt xịt rửa khay trong nhà tắm lát gạch; khay đặt trong căn hộ VN |
| PAIN-BEFORE-AFTER | toilet-1.png | Before/after: tã lót bị xé trên sàn gạch căn hộ VN → khay cỏ sạch, bé Poodle/Phốc |
| STEP-DAT-KHAY | toilet-tray-room.jpg | Khay đặt ở góc ban công / nhà tắm căn hộ VN |
| STEP-BE-DI | image13.png | Chó nhỏ (Poodle/Phốc) đứng trên khay |
| STEP-XIT-RUA | toilet-4.png | Tay người xịt khay dưới vòi sen (không cần lộ mặt) |

## Bộ ảnh sản phẩm THẬT nên chụp (quan trọng nhất cho trang chi tiết)

Khách sẽ so sánh với ảnh thật trên Shopee, nên cần chụp hàng thật:

1. Khay trắng + khay đen trên **nền trắng**, góc 45° (ảnh bìa, ảnh Shopee).
2. 3 lớp **tách rời** xếp cạnh nhau, chụp từ trên xuống.
3. **Cận sợi cỏ** (macro) + **mặt đế đục lỗ**.
4. **Thước dây đo** từng size (khách VN rất hay hỏi kích thước thật).
5. 3 size xếp cạnh nhau, có một chai nước suối để so tỷ lệ.
6. Video 15s **đổ nước**: nước chảy xuống khay hứng.
7. Video 15s **nhấc, đổ, xịt rửa** trong nhà tắm.
8. Bé thật (Poodle / Phốc / Corgi) đứng trên khay tại căn hộ, mỗi size một bé.
9. Ảnh **hộp đóng gói** và đồ bên trong (tạo tin tưởng khi mua COD).

---

# Trang chi tiết: tham-co-ban-cong.html

## ⚠️ Ảnh KHÔNG dùng cho web VN (nghi lấy từ listing Amazon của người bán khác)
Có chữ tiếng Anh kiểu ảnh listing, dễ vi phạm bản quyền và bị báo cáo trên sàn:
`amazon-drain-holes.jpg`, `amazon-diy-cut-fit.png`, `amazon-materials-exploded.png`, `amazon-pet-corgi-mat.png`,
`turf-detail.jpg`, toàn bộ thư mục `like-amazon/`. (Trang chủ VN đã bỏ `amazon-pet-corgi-mat.png`.)

Một số file tên `amazon-*` khác (balcony-frenchie, turf-roll-whitebg, macro-pile-height, drainage-hose-demo) trông là ảnh AI team tự tạo
nên tạm dùng. **Cần xác nhận nguồn trước khi đưa lên mạng.**

## Ô ảnh cần thay
| Ô | Ảnh hiện tại | Vấn đề | Cần thay bằng |
|---|---|---|---|
| GALLERY 1 | amazon-us-balcony-frenchie.jpg | Skyline Mỹ, tường gạch đỏ | Tấm 1,33×2m trên ban công hẹp chung cư VN, Poodle nằm chơi |
| GALLERY 2 | balcony-turf.jpg | Ban công Mỹ rất rộng | Tấm 1,52×2,29m trên ban công rộng / lô gia căn 3PN |
| GALLERY 3 | pet-turf.jpg | Công viên chó kiểu Mỹ | Cuộn 1×5m trải sân thượng nhà phố VN |
| GALLERY 4 | amazon-turf-roll-whitebg.jpg | Nhãn ghi "1m x 4m", sai size | Ảnh cuộn thật trên nền trắng, nhãn HoHai đúng size |
| MACRO-SOI-CO | amazon-macro-pile-height.jpg | Thước ghi 35mm, không khớp size bán | Macro sợi cỏ thật + thước đo đúng chiều cao sợi |
| PAIN-BANCONG | balcony-turf.jpg | Bối cảnh Mỹ | Ban công gạch VN trước/sau khi trải cỏ |

## Shot list chụp thật cho thảm
1. Mỗi size trải phẳng trên nền trắng, có thước dây dọc 2 cạnh.
2. Cuộn tròn + đóng gói, đặt cạnh cửa thang máy (chứng minh "mang lên căn hộ dễ").
3. Macro sợi cỏ + thước (chiều cao sợi thật).
4. Lật mặt đế: thấy lỗ thoát nước và lưới gia cố.
5. Video 15s: cắt thảm bằng kéo theo góc ban công.
6. Video 15s: xịt nước, nước chảy qua đế.
7. Trước/sau: ban công gạch trống → trải cỏ, có bé chơi.
8. Combo: thảm + khay vệ sinh đặt ở góc ban công.

---

# Trang giới thiệu: gioi-thieu.html

Trang hiện dùng ảnh stock (cô gái với bé Shiba, chung cư Việt Nam, pet hotel, đàn golden) và ảnh thật cuộn cỏ.
Trang giới thiệu sẽ đáng tin hơn hẳn nếu có **ảnh thật của công ty**. Nên chụp:

1. Toàn cảnh nhà máy / xưởng (có biển tên công ty nếu được).
2. Máy dệt cỏ đang chạy, cận cảnh sợi cỏ đi vào máy.
3. Công nhân kiểm tra cuộn cỏ: đo chiều cao sợi, thử đổ nước (cho mục "Kiểm soát chất lượng").
4. Kho hàng với các cuộn cỏ xếp chồng, có nhãn HoHai.
5. Đội ngũ (3–5 người) chụp chung, mặc áo đồng phục nếu có. Có thể bế một bé chó.
6. Container / lô hàng đang đóng để xuất đi Mỹ (chứng minh "hàng xuất khẩu").

⚠️ Không dùng ảnh nhà máy lấy từ nguồn khác: khách sẽ hiểu đó là nhà máy của HoHai.
