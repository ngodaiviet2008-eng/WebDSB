# Website quét danh sách bang hội

Website Flask nhận nhiều ảnh, tái sử dụng công cụ OCR Python hiện có và xuất file Excel.

## Chạy ứng dụng

```powershell
cd "C:\Users\ngoda\OneDrive\Tài liệu\WebDSB"
python -m pip install -r requirements.txt
python app.py
```

Mở `http://127.0.0.1:5000` để chạy cục bộ. Bản công khai: `https://webdsb.netlify.app/`.

## Luồng sử dụng

1. Chọn hoặc kéo-thả nhiều ảnh PNG/JPG/JPEG/WEBP/BMP.
2. Bấm **Bắt đầu nhận diện**.
3. Kiểm tra và sửa dữ liệu trong bảng.
4. Bấm **Xuất Excel** để tải file `.xlsx`.

Excel có hai trang: danh sách thành viên được tô màu xen kẽ, cố định hàng tiêu đề và bật bộ lọc; trang kiểm tra tổng hợp STT thiếu/trùng và các ô cần xem lại.

File OCR gốc được tích hợp trực tiếp từ `quet_bang_hoi_claude - Android2.py`.

OCR xử lý thêm ảnh tăng tương phản CLAHE và ảnh đảo màu để giữ dấu tiếng Việt rõ hơn; các tên viết hoa bị OCR chèn khoảng trắng cũng được nối lại. Một số tên trong bộ ảnh game mẫu có quy tắc sửa lỗi cụ thể trong `sua_loi_dau_ten`.

Chạy kiểm thử chuẩn hóa tên:

```powershell
python -m unittest discover -s tests -v
```

## Nhận diện trên trình duyệt

OCR dùng Tesseract.js với mô hình `vie` và `eng`. Ảnh được xử lý trong trình duyệt; chỉ mã OCR và mô hình ngôn ngữ được tải từ trang Netlify, không gửi ảnh lên server. STT được nhận diện lại bằng vùng cắt rộng hơn khi kết quả chưa chắc chắn; tên và phái được thử lại với ngưỡng cắt ảnh thấp hơn nếu độ tin cậy thấp. Các ảnh chồng lặp chỉ được gộp khi tên đủ giống; nếu cùng STT nhưng tên chỉ ra thành viên khác, cả hai dòng được giữ lại và đánh dấu để tránh mất dữ liệu. STT sai hoặc trống chỉ được khôi phục khi nhiều số đọc được trong cùng đoạn ảnh xác nhận rõ thứ tự; nếu bằng chứng yếu, dòng được giữ để kiểm tra thay vì tự đoán. Hãy xem lại ô được đánh dấu trước khi xuất Excel.

## Xuất bản website lên Netlify

```powershell
python -m pip install -r requirements.txt
npm.cmd install
npm.cmd run build
netlify deploy --prod --dir public
```

Lệnh build tải mô hình OCR tiếng Việt/Anh và đóng gói tài nguyên cần thiết vào thư mục `public`.
