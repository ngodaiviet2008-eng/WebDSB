# WebDSB

Website quét danh sách thành viên bang hội từ ảnh, nhận diện tên tiếng Việt và xuất kết quả sang Excel.

**Dùng thử:** [webdsb.netlify.app](https://webdsb.netlify.app/)

## Tính năng

- Chọn hoặc kéo-thả tối đa **20 ảnh** định dạng PNG, JPG, JPEG, WEBP hoặc BMP; mỗi ảnh tối đa **20 MB**.
- Nhận diện STT, tên người chơi và phái bằng OCR tiếng Việt và tiếng Anh.
- Xử lý ảnh ngay trên trình duyệt; ảnh không được tải lên máy chủ.
- Phát hiện STT thiếu hoặc trùng, giữ lại các thành viên khác nhau ngay cả khi OCR đọc trùng STT, và đánh dấu các ô cần kiểm tra.
- Xem và chỉnh sửa kết quả trước khi xuất Excel.
- Tạo workbook gồm trang danh sách và trang kiểm tra; danh sách có bộ lọc, tiêu đề cố định và màu hàng xen kẽ.

> Độ chính xác OCR phụ thuộc vào độ rõ và bố cục ảnh. Hãy xem lại các ô được đánh dấu trước khi dùng hoặc chia sẻ file Excel.

## Cách sử dụng

1. Mở [website](https://webdsb.netlify.app/).
2. Chọn hoặc kéo-thả ảnh chụp danh sách thành viên vào trang.
3. Bấm **Bắt đầu nhận diện** và chờ xử lý hoàn tất.
4. Kiểm tra các cảnh báo; có thể bấm vào ô để sửa nội dung.
5. Bấm **Xuất Excel** để tải workbook.

Lần đầu sử dụng, trình duyệt cần tải mô hình OCR. Các lần sau có thể dùng dữ liệu đã lưu trong bộ nhớ đệm của trình duyệt.

## Chạy trên máy tính

### Yêu cầu

- Node.js và npm
- Python 3
- Kết nối Internet trong lần build đầu tiên để tải mô hình OCR nếu chưa có sẵn

Mở PowerShell tại thư mục dự án và chạy:

```powershell
npm.cmd install
npm.cmd run build
python -m http.server 8000 --directory public
```

Sau đó mở <http://localhost:8000>. Dừng máy chủ bằng `Ctrl+C`.

Lệnh build tạo website tĩnh trong thư mục `public/`; thư mục này không được đưa vào Git vì có thể tạo lại.

### Chạy bằng Flask trên cổng 5000

Sau khi build `public/` như hướng dẫn trên, cài các gói Python và chạy Flask:

```powershell
python -m pip install -r requirements.txt
python app.py
```

Sau đó mở [http://127.0.0.1:5000/](http://127.0.0.1:5000/). Đây là địa chỉ cục bộ, chỉ truy cập được trên máy bạn khi Flask đang chạy. Dừng máy chủ bằng `Ctrl+C`.

## Kiểm thử

```powershell
npm.cmd test
```

## Cấu trúc dự án

| Đường dẫn | Vai trò |
| --- | --- |
| `templates/index.html` | Khung trang web |
| `static/app.js` | Chọn ảnh, chạy OCR và hiển thị kết quả |
| `static/ocr-utils.js` | Xử lý ảnh, chuẩn hóa và gộp kết quả, tạo Excel |
| `static/style.css` | Giao diện |
| `tests/` | Kiểm thử OCR và workbook |
| `build_static.py` | Đóng gói website và tài nguyên OCR vào `public/` |

OCR sử dụng [Tesseract.js](https://github.com/naptha/tesseract.js) với mô hình ngôn ngữ tiếng Việt (`vie`) và tiếng Anh (`eng`).

## Riêng tư

Ảnh được xử lý cục bộ trong trình duyệt, không gửi lên máy chủ. Trình duyệt tải mã OCR và mô hình ngôn ngữ để thực hiện nhận diện.
