# Website quét danh sách bang hội

Website Flask nhận nhiều ảnh, tái sử dụng công cụ OCR Python hiện có và xuất file Excel.

## Chạy ứng dụng

```powershell
cd "C:\Users\ngoda\OneDrive\Tài liệu\WebDSB"
python -m pip install -r requirements.txt
python app.py
```

Mở `http://127.0.0.1:5000`.

## Luồng sử dụng

1. Chọn hoặc kéo-thả nhiều ảnh PNG/JPG/JPEG/WEBP/BMP.
2. Bấm **Bắt đầu nhận diện**.
3. Kiểm tra và sửa dữ liệu trong bảng.
4. Bấm **Xuất Excel** để tải file `.xlsx`.

File OCR gốc được tích hợp trực tiếp từ `quet_bang_hoi_claude - Android2.py`.

OCR xử lý thêm ảnh tăng tương phản CLAHE và ảnh đảo màu để giữ dấu tiếng Việt rõ hơn; các tên viết hoa bị OCR chèn khoảng trắng cũng được nối lại. Một số tên trong bộ ảnh game mẫu có quy tắc sửa lỗi cụ thể trong `sua_loi_dau_ten`.

Chạy kiểm thử chuẩn hóa tên:

```powershell
python -m unittest discover -s tests -v
```

## Nhận diện trên trình duyệt

OCR dùng Tesseract.js với mô hình `vie` và `eng`. Ảnh được xử lý trong trình duyệt; chỉ mã OCR và mô hình ngôn ngữ được tải từ trang Netlify, không gửi ảnh lên server.

## Xuất bản website lên Netlify

```powershell
python -m pip install -r requirements.txt
npm.cmd install
npm.cmd run build
netlify deploy --prod --dir public
```

Lệnh build tải mô hình OCR tiếng Việt/Anh và đóng gói tài nguyên cần thiết vào thư mục `public`.
