# -*- coding: utf-8 -*-
r"""
QUÉT DANH SÁCH THÀNH VIÊN BANG HỘI TỪ ẢNH CHỤP MÀN HÌNH  ->  FILE EXCEL
=======================================================================

Đọc mọi ảnh trong thư mục `images`, tự nhận dạng chữ (EasyOCR, tiếng Việt) và
xuất ra Excel đúng 3 cột:

    STT | Tên Người Chơi | Phái

(Cần thêm cột khác - Chức Vụ, Cấp, Lực Chiến, Ngày Vào Bang, Trạng Thái - thì sửa
 CAC_COT_XUAT ở phần CẤU HÌNH bên dưới.)

File kết quả: Danh_Sach_Bang_giờ-phút-giây_ngày-tháng-năm.xlsx (mỗi lần chạy một file mới),
ví dụ Danh_Sach_Bang_14-30-05_23-11-2026.xlsx

Cách làm:
  * Tự dò vị trí từng hàng bằng điểm ảnh, không cắt theo tỉ lệ cố định -> ảnh cuộn
    lệch bao nhiêu cũng đúng, và lấy được cả hàng cuối (bản cũ làm rơi STT 7, 16, 24...).
  * Chỉ đọc hàng nhìn thấy TRỌN VẸN; hàng bị cắt nửa ở mép sẽ lấy từ ảnh kế tiếp.
  * Mỗi ô được cắt sát chữ, đọc nhiều lần (nhiều cách xử lý ảnh) rồi bỏ phiếu.
  * Cột Phái chỉ có 8 giá trị nên được đối chiếu với danh sách phái để sửa lỗi dấu
    tiếng Việt (vd "Huyên Co" -> "Huyền Cơ").
  * Ảnh chụp chồng nhau được gộp theo STT, không xoá nhầm người trùng tên.
  * Tên dài bị game rút gọn bằng "…" được nhận biết (ảnh không chứa tên đầy đủ).
  * Báo STT bị thiếu và đối chiếu với "Thành viên bang: x/60" ở chân bảng.
  * Sheet "Kiểm tra" liệt kê các ô OCR cần đối chiếu.

Cài thư viện (một lần):
    pip install easyocr opencv-python numpy openpyxl

Chạy:
    python quet_bang_hoi.py
    python quet_bang_hoi.py "D:\thu_muc_anh" "D:\thu_muc_xuat"      (tuỳ chọn)
"""

from __future__ import annotations

import difflib
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ============================================================================
# 1. CẤU HÌNH - thường chỉ cần sửa phần này
# ============================================================================
THU_MUC_ANH = Path(r"C:\Users\ngoda\CrossDevice\Redmi Note 13 Pro 5G\storage\Pictures\Gallery\owner\DanhSachBang")       # thư mục chứa ảnh chụp màn hình
THU_MUC_XUAT = Path(r"D:\NTH_BangHoi\danhsach")    # thư mục lưu file Excel
# Mỗi lần chạy tạo một file mới (không ghi đè file cũ), tên dạng:
#   Danh_Sach_Bang_giờ-phút-giây_ngày-tháng-năm.xlsx    vd: Danh_Sach_Bang_14-30-05_23-11-2026.xlsx
TIEN_TO_TEN_FILE = "Danh_Sach_Bang_a"

# Các cột đưa vào Excel. STT và Tên luôn có (dùng để ghép các ảnh chồng nhau).
# Muốn thêm cột: "Chức Vụ", "Cấp", "Lực Chiến", "Ngày Vào Bang", "Trạng Thái".
CAC_COT_XUAT = ["STT", "Tên Người Chơi", "Phái"]

LUU_ANH_KIEM_TRA = True   # True: lưu ảnh đã vẽ khung hàng/cột vào thư mục "kiem_tra"
DUNG_GPU = False          # True nếu máy có card NVIDIA và đã cài torch bản GPU

DUOI_ANH = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# ============================================================================
# 2. BỐ CỤC BẢNG (đo trên ảnh Android 1708x768)
# ============================================================================
# Kích thước ảnh Android trong ảnh mẫu: 1708x768.
ANH_CHUAN = (1708, 768)
VUNG_BANG_Y = (180, 680)   # thân bảng, bao trọn hàng cuối gần chân bảng
NUA_HANG = 28              # nửa chiều cao nội dung một hàng
NGUONG_SANG = 170          # điểm ảnh có min(B,G,R) >= ngưỡng này được coi là "chữ trắng"

# Toạ độ thực trên ảnh Android 1708x768.
CAC_COT = {
    "STT":            (260, 315),
    "Tên Người Chơi": (455, 640),
    "Chức Vụ":        (640, 835),
    "Cấp":            (835, 915),
    "Phái":           (950, 1095),
    "Lực Chiến":      (1120, 1250),
    "Ngày Vào Bang":  (1290, 1430),
    "Trạng Thái":     (1460, 1650),
}
# Các cột luôn chỉ có 1 dòng chữ nằm giữa hàng -> dùng để dò vị trí từng hàng.
COT_DO_HANG = ["Cấp", "Phái", "Lực Chiến", "Ngày Vào Bang", "Trạng Thái"]
VUNG_TONG_SO = (450, 688, 530, 724)   # ô "49/60" ở chân bảng

# Các cột sẽ đọc và xuất (STT, Tên luôn đứng đầu).
TEN_COT_XUAT = ["STT", "Tên Người Chơi"] + [c for c in CAC_COT_XUAT
                                           if c not in ("STT", "Tên Người Chơi")]

# ============================================================================
# 3. TỪ VỰNG - dùng để sửa lỗi dấu. Nếu game có giá trị mới, thêm vào đây.
#    Giá trị không có trong danh sách vẫn được giữ nguyên và liệt kê để xem lại.
# ============================================================================
DANH_SACH_PHAI = [
    "Long Ngâm", "Tố Vấn", "Huyền Cơ", "Thiết Y",
    "Toái Mộng", "Cửu Linh", "Huyết Hà", "Thần Tương",
]

DANH_SACH_CHUC_VU = [
    "Bang Chúng", "Đại Đương Gia", "Nhị Đương Gia", "Tam Đương Gia", "Tứ Đương Gia",
    "Quân Sư", "Nhã Công",
] + [f"{huong} {ten}" for huong in ("Đông", "Tây", "Nam", "Bắc")
     for ten in ("Đường Chủ", "Phó Đường Chủ", "Đường Chúng")]

# Mẫu cột "Trạng Thái": '#' thay cho số, {n} là chỗ điền lại số.
MAU_TRANG_THAI = {
    "online":        "Online",
    "trong # gio":   "Trong {n} giờ",
    "# gio truoc":   "{n} giờ trước",
    "# ngay truoc":  "{n} ngày trước",
    "hon # ngay":    "Hơn {n} ngày",
    "# phut truoc":  "{n} phút trước",
}

# ============================================================================
# 4. THAM SỐ OCR
# ============================================================================
# Mỗi "biến thể" là một cách xử lý ảnh trước khi đọc: (kiểu, hệ số phóng to, bộ giải mã).
# Kết quả các biến thể được bỏ phiếu; biến thể lạc khỏi số đông bị loại.
BIEN_THE_TEN = [("xam", 3, "greedy"), ("clahe_dao", 3, "greedy"),
                ("clahe_dao", 4, "beamsearch")]
BIEN_THE_THUONG = [("xam", 3, "greedy"), ("clahe_dao", 3, "greedy")]

NGUONG_TIN_CAY = 0.40
NGUONG_DONG_THUAN = 0.65


# ============================================================================
# 5. KIỂU DỮ LIỆU
# ============================================================================
@dataclass
class Truong:
    """Một ô dữ liệu sau khi nhận dạng."""
    gia_tri: object = ""
    tin_cay: float = 0.0
    loi: list = field(default_factory=list)         # vấn đề cần xem lại
    chua_chac: list = field(default_factory=list)   # OCR chưa chắc chắn
    luu_y: list = field(default_factory=list)       # thông tin bổ sung, vd tên bị cắt


@dataclass
class BanGhi:
    """Một hàng thành viên đọc từ một ảnh."""
    anh: str
    y: int
    cac_truong: dict = field(default_factory=dict)

    @property
    def stt(self):
        t = self.cac_truong.get("STT")
        return t.gia_tri if t is not None and isinstance(t.gia_tri, int) else None


@dataclass
class HinhHoc:
    """Toạ độ bố cục đã quy đổi theo kích thước ảnh thật."""
    sx: float
    sy: float
    y_tren: int
    y_duoi: int
    nua_hang: int
    cot: dict
    nguong: int = NGUONG_SANG      # ngưỡng "chữ trắng"; tự thử mức khác nếu ảnh sáng/tối hơn mẫu

    @classmethod
    def tu_anh(cls, anh):
        cao, rong = anh.shape[:2]
        sx, sy = rong / ANH_CHUAN[0], cao / ANH_CHUAN[1]
        return cls(
            sx=sx, sy=sy,
            y_tren=int(round(VUNG_BANG_Y[0] * sy)),
            y_duoi=min(cao, int(round(VUNG_BANG_Y[1] * sy))),
            nua_hang=int(round(NUA_HANG * sy)),
            cot={ten: (int(round(a * sx)), min(rong, int(round(b * sx))))
                 for ten, (a, b) in CAC_COT.items()},
        )


# ============================================================================
# 6. TIỆN ÍCH ẢNH / TÊN FILE
# ============================================================================
def doc_anh(duong_dan: Path):
    """Đọc ảnh, an toàn với đường dẫn có tiếng Việt trên Windows."""
    try:
        du_lieu = np.fromfile(str(duong_dan), dtype=np.uint8)
        return cv2.imdecode(du_lieu, cv2.IMREAD_COLOR) if du_lieu.size else None
    except Exception:
        return None


def ghi_anh(duong_dan: Path, anh) -> None:
    ok, bo_dem = cv2.imencode(duong_dan.suffix or ".png", anh)
    if ok:
        bo_dem.tofile(str(duong_dan))


def khoa_tu_nhien(ten: str):
    """Sắp xếp tự nhiên: 'Screenshot (9)' đứng trước 'Screenshot (10)'."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", ten)]


# ============================================================================
# 7. DÒ HÀNG VÀ PHÂN TÍCH Ô (chỉ dùng xử lý ảnh, chưa cần OCR)
# ============================================================================
def tim_cac_hang(anh, hh: HinhHoc) -> list:
    """Trả về toạ độ y (tâm) của các hàng nhìn thấy TRỌN VẸN trong ảnh.

    Ý tưởng: các cột Cấp/Phái/Lực Chiến/Ngày/Trạng Thái luôn có đúng 1 dòng chữ trắng
    nằm giữa hàng. Đếm số điểm ảnh trắng theo từng dòng ngang -> mỗi hàng là một "dải".
    """
    sang = anh.min(axis=2) >= hh.nguong
    chieu = np.zeros(anh.shape[0], dtype=np.int64)
    for ten in COT_DO_HANG:
        x1, x2 = hh.cot[ten]
        chieu += sang[:, x1:x2].sum(axis=1)
    chieu[:hh.y_tren] = 0
    chieu[hh.y_duoi:] = 0

    ys = np.flatnonzero(chieu)
    if ys.size == 0:
        return []
    khe = max(2, int(round(5 * hh.sy)))
    doan, dau, truoc = [], int(ys[0]), int(ys[0])
    for y in ys[1:]:
        y = int(y)
        if y - truoc > khe:
            doan.append((dau, truoc))
            dau = y
        truoc = y
    doan.append((dau, truoc))

    cac_hang = []
    for a, b in doan:
        if not (18 * hh.sy <= b - a + 1 <= 50 * hh.sy):
            continue    # quá thấp: hàng bị cắt ở mép bảng hoặc chỉ là nhiễu
        tam = int(round((a + b) / 2))
        if tam - hh.nua_hang < hh.y_tren - 2 or tam + hh.nua_hang > hh.y_duoi + 2:
            continue    # hàng chưa nhìn thấy trọn vẹn: sẽ lấy từ ảnh khác
        cac_hang.append(tam)
    return cac_hang


def cat_o(anh, hh: HinhHoc, ten_cot: str, y_tam: int):
    x1, x2 = hh.cot[ten_cot]
    return anh[max(0, y_tam - hh.nua_hang): y_tam + hh.nua_hang + 1, x1:x2]


def cac_thanh_phan(o, nguong: int) -> list:
    """Các mảng chữ trắng liên thông trong ô: [(x, y, rộng, cao, diện tích), ...]."""
    mat_na = (o.min(axis=2) >= nguong).astype(np.uint8)
    n, _, tk, _ = cv2.connectedComponentsWithStats(mat_na, connectivity=8)
    return [tuple(int(v) for v in tk[i]) for i in range(1, n)]


def hop_bao(thanh_phan) -> tuple:
    x1 = min(c[0] for c in thanh_phan)
    y1 = min(c[1] for c in thanh_phan)
    x2 = max(c[0] + c[2] for c in thanh_phan) - 1
    y2 = max(c[1] + c[3] for c in thanh_phan) - 1
    return x1, y1, x2, y2


def khung_mot_dong(o, hh: HinhHoc, cho_phep_cham_trai=False):
    """Khung sát chữ của ô chỉ có 1 dòng -> (khung, các thành phần) hoặc (None, [])."""
    tam_y = o.shape[0] / 2.0
    tp = [c for c in cac_thanh_phan(o, hh.nguong)
          if c[4] >= 3
          and (cho_phep_cham_trai or c[0] > 0)
          and abs(c[1] + c[3] / 2.0 - tam_y) <= 22 * hh.sy]
    if not tp:
        return None, []
    return hop_bao(tp), tp


def cham_lung(tp, hh: HinhHoc) -> list:
    """Các chấm của dấu '…' mà game thêm vào khi rút gọn tên dài.

    Nhận biết: ≥2 chấm nhỏ nằm sát đáy dòng, ngay bên phải chữ cuối cùng.
    Trả về danh sách chấm (rỗng nếu tên không bị cắt).
    """
    if not tp:
        return []
    nho = 6 * max(hh.sx, hh.sy)
    la_cham = lambda c: c[2] <= nho and c[3] <= nho
    chu = [c for c in tp if not la_cham(c)]
    if not chu:
        return []
    le_phai = max(c[0] + c[2] for c in chu)
    y1 = min(c[1] for c in tp)
    y2 = max(c[1] + c[3] for c in tp)
    cac_cham = [c for c in tp if la_cham(c) and c[0] >= le_phai - 1
                and (c[1] + c[3] / 2.0) > y1 + 0.55 * (y2 - y1)]
    return cac_cham if len(cac_cham) >= 2 else []


def xoa_cham(o, cac_cham):
    """Xoá dấu '…' khỏi ảnh (vá lại nền) để OCR không đọc nhầm 'C…' thành '€'."""
    mat_na = np.zeros(o.shape[:2], np.uint8)
    for (x, y, w, h, _) in cac_cham:
        mat_na[max(0, y - 2): y + h + 2, max(0, x - 2): x + w + 2] = 255
    return cv2.inpaint(o, mat_na, 3, cv2.INPAINT_TELEA)


def tach_dong(o, hh: HinhHoc) -> list:
    """Tách ô nhiều dòng (Chức Vụ có thể có 1-3 dòng) -> danh sách khung từng dòng.

    Gom các mảng chữ theo tâm dọc; chấm/dấu nhỏ được gắn vào dòng gần nhất.
    """
    tp = [c for c in cac_thanh_phan(o, hh.nguong) if c[4] >= 3 and c[0] > 0]
    if not tp:
        return []
    lon = [c for c in tp if c[4] >= 12] or tp
    tam = sorted((c[1] + c[3] / 2.0, c) for c in lon)
    cum = [[tam[0]]]
    for t in tam[1:]:
        tb = float(np.mean([x[0] for x in cum[-1]]))
        if t[0] - tb > 12 * hh.sy:
            cum.append([t])
        else:
            cum[-1].append(t)
    tam_cum = [float(np.mean([x[0] for x in g])) for g in cum]
    nhom = [[c for _, c in g] for g in cum]
    da_co = set(lon)
    for c in tp:
        if c in da_co:
            continue
        cy = c[1] + c[3] / 2.0
        k = int(np.argmin([abs(cy - t) for t in tam_cum]))
        if abs(cy - tam_cum[k]) <= 16 * hh.sy:
            nhom[k].append(c)
    return [hop_bao(g) for g in nhom]


def chuan_bi_anh(o, khung, bien_the):
    """Cắt sát chữ, phóng to, chuẩn hoá tương phản -> ảnh xám sẵn sàng cho OCR."""
    kieu, he_so, _ = bien_the
    x1, y1, x2, y2 = khung
    cao, rong = o.shape[:2]
    cat = o[max(0, y1 - 3): min(cao, y2 + 4), max(0, x1 - 2): min(rong, x2 + 3)]
    xam = cv2.cvtColor(cat, cv2.COLOR_BGR2GRAY)
    if kieu.startswith("clahe"):
        xam = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(xam)
    else:
        xam = cv2.normalize(xam, None, 0, 255, cv2.NORM_MINMAX)
    xam = cv2.resize(xam, None, fx=he_so, fy=he_so, interpolation=cv2.INTER_CUBIC)
    if kieu.endswith("dao"):    # chữ đen trên nền sáng
        xam = 255 - xam
    return cv2.copyMakeBorder(xam, 14, 14, 20, 20, cv2.BORDER_REPLICATE)


# ============================================================================
# 8. CHUẨN HOÁ VĂN BẢN (sửa lỗi dấu bằng từ vựng)
# ============================================================================
def bo_dau(s: str) -> str:
    """Bỏ dấu tiếng Việt, về chữ thường, chỉ giữ chữ-số."""
    s = (s or "").replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9#]+", " ", s.lower()).strip()


def diem_giong(a: str, b: str) -> float:
    a, b = bo_dau(a), bo_dau(b)
    if not a or not b:
        return 0.0
    d1 = difflib.SequenceMatcher(None, a, b).ratio()
    d2 = difflib.SequenceMatcher(None, " ".join(sorted(a.split())),
                                 " ".join(sorted(b.split()))).ratio()
    return max(d1, d2)      # d2: chịu được OCR đọc ngược thứ tự từ ("Ngâm Long")


def khop_tu_vung(van_ban: str, tu_vung: list, nguong: float):
    """Tìm mục từ vựng giống nhất (không phân biệt dấu) -> (mục, điểm) hoặc (None, điểm)."""
    if not bo_dau(van_ban):
        return None, 0.0
    diem, tot = max((diem_giong(van_ban, v), v) for v in tu_vung)
    return (tot if diem >= nguong else None), diem


def sua_so_nham(s: str) -> str:
    """OCR hay đọc số 1 thành l/I/| và số 0 thành O khi đứng cạnh số."""
    s = re.sub(r"(?<!\w)[lI|!](?!\w)", "1", s or "")
    s = re.sub(r"(?<=\d)[lI|!]", "1", s)
    s = re.sub(r"[lI|!](?=\d)", "1", s)
    s = re.sub(r"(?<=\d)[Oo]|[Oo](?=\d)", "0", s)
    return s


def chuan_hoa_so(van_ban: str, toi_thieu: int, toi_da: int):
    chu_so = re.sub(r"\D", "", van_ban or "")
    if not chu_so:
        return None, ["không đọc được số"]
    v = int(chu_so)
    if not toi_thieu <= v <= toi_da:
        return v, [f"giá trị bất thường ({v})"]
    return v, []


def chuan_hoa_phai(van_ban: str):
    if not (van_ban or "").strip():
        return "", []
    gt, diem = khop_tu_vung(van_ban, DANH_SACH_PHAI, 0.80)
    if gt is None:
        return van_ban.strip(), [f"không có trong danh sách phái ('{van_ban.strip()}')"]
    return gt, ([] if diem >= 0.9 else [f"đã tự chỉnh theo danh sách phái (giống {diem:.0%})"])


def chuan_hoa_chuc_vu_dong(van_ban: str):
    if not (van_ban or "").strip():
        return "", []
    gt, diem = khop_tu_vung(van_ban, DANH_SACH_CHUC_VU, 0.90)
    if gt is None:
        return van_ban.strip(), [f"chức vụ chưa có trong danh sách ('{van_ban.strip()}')"]
    return gt, ([] if diem >= 0.999 else [f"đã tự chỉnh theo danh sách chức vụ (giống {diem:.0%})"])


def chuan_hoa_trang_thai(van_ban: str):
    if not (van_ban or "").strip():
        return "", []
    r = bo_dau(sua_so_nham(van_ban))
    so = re.search(r"\d+", r)
    mau = re.sub(r"\s+", " ", re.sub(r"\d+", "#", r)).strip()
    diem, tot = max((difflib.SequenceMatcher(None, mau, m).ratio(), m) for m in MAU_TRANG_THAI)
    can_so = "#" in tot
    if diem >= 0.75 and (so or not can_so):
        gia_tri = MAU_TRANG_THAI[tot].replace("{n}", so.group() if so else "")
        return gia_tri, ([] if diem >= 0.9 else [f"đã tự chỉnh theo mẫu (giống {diem:.0%})"])
    return van_ban.strip(), [f"không nhận ra mẫu trạng thái ('{van_ban.strip()}')"]


def chuan_hoa_ngay(van_ban: str):
    """'25 ngày' -> 25 (số nguyên, để Excel sắp xếp/lọc được)."""
    if not (van_ban or "").strip():
        return None, ["không đọc được"]
    r = bo_dau(sua_so_nham(van_ban))
    if r.startswith("hom nay"):
        return 0, []
    so = re.search(r"\d+", r)
    mau = re.sub(r"\s+", " ", re.sub(r"\d+", "#", r)).strip()
    diem = difflib.SequenceMatcher(None, mau, "# ngay").ratio()
    if so and diem >= 0.6:
        return int(so.group()), ([] if diem >= 0.85 else [f"định dạng lạ ('{van_ban.strip()}')"])
    return None, [f"không đọc được ('{van_ban.strip()}')"]


def lam_sach_ten(van_ban: str, bi_cat: bool):
    """Dọn tên: bỏ rác do OCR đọc sai dấu '...' ở cuối, thêm '…' nếu tên bị game cắt."""
    t = unicodedata.normalize("NFC", van_ban or "").strip()
    co_cham = bool(re.search(r"(\.{2,}|…)\s*$", t))
    cat = bi_cat or co_cham
    if cat:
        t = t.rstrip(" \t.…_,;:·•'\"`~€£¢°*-–—")
    t = re.sub(r"\s+", " ", t).strip()
    ghi_chu = []
    tu = t.split(" ")
    so_ky_tu_don = sum(len(x) == 1 for x in tu)
    if len(tu) >= 4 and all(len(x) == 1 for x in tu):
        t = "".join(tu)        # tên viết giãn cách rộng "J i n b i i" -> "Jinbii"
        ghi_chu.append("đã nối các ký tự bị giãn cách rộng")
    elif len(tu) >= 2 and so_ky_tu_don >= 1 and t.replace(" ", "").isupper():
        t = "".join(tu)
        ghi_chu.append("đã nối các ký tự viết hoa bị giãn cách")
    if cat and t:
        t += "…"
    t = sua_loi_dau_ten(t)
    return t, ghi_chu


def sua_loi_dau_ten(van_ban: str) -> str:
    """Sửa một số tên dễ bị EasyOCR mất hoặc đổi dấu."""
    t = unicodedata.normalize("NFC", van_ban or "").strip()
    t = re.sub(r"^[)\]}>|]+\s*", "", t)
    t = re.sub(r"^\d+\s+", "", t)
    bang_sua = {
        "HôngTrì": "HồngTrì",
        "HồngTrì": "HồngTrì",
        "HổngTr": "HồngTrì",
        "HọngTrì": "HồngTrì",
        "HôngTri": "HồngTrì",
        "HongTri": "HồngTrì",
        "Tõng Vãn Khanh": "Tống Vân Khanh",
        "Hẳc Hy": "Hắc Hy",
        "VệKỉênĐức": "VệKiệnĐức",
        "3 du hí nhân gia": "du hí nhân gia",
        "3 du hi nhan gia": "du hí nhân gia",
        "du hi nhan gia": "du hí nhân gia",
        "du hí nhân gia": "du hí nhân gia",
        "9 Chẩm Miên": "Chẩm Miên",
        "Chẩm Miên": "Chẩm Miên",
        "Châm Miên": "Chẩm Miên",
        "Cham Miên": "Chẩm Miên",
        "Hợp Đoa123": "HợpĐoa123",
        "HợpDoa123": "HợpĐoa123",
        "Hợp Doa123": "HợpĐoa123",
        "HopĐoa123": "HợpĐoa123",
        "HợpĐoa123": "HợpĐoa123",
    }
    return bang_sua.get(t, t)


# ============================================================================
# 9. OCR: GỌI EASYOCR, BỎ PHIẾU GIỮA CÁC LẦN ĐỌC
# ============================================================================
class MayOCR:
    def __init__(self, dung_gpu: bool):
        try:
            import easyocr
        except ImportError:
            sys.exit("Chưa cài EasyOCR. Hãy chạy:  pip install easyocr opencv-python numpy openpyxl")
        print("Đang khởi tạo EasyOCR (lần đầu chạy sẽ tải model, cần có mạng)...")
        self.reader = easyocr.Reader(["vi", "en"], gpu=dung_gpu, verbose=False)

    def mot_dong(self, anh_xam, allowlist=None, giai_ma="greedy"):
        """Nhận dạng ảnh chứa đúng MỘT dòng chữ -> (văn bản, độ tin cậy 0..1)."""
        cac_giai_ma = [giai_ma] if giai_ma == "greedy" else [giai_ma, "greedy"]
        for ham in ("recognize", "readtext"):      # readtext: phương án dự phòng
            for gm in cac_giai_ma:
                tham_so = {"decoder": gm, "detail": 1}
                if allowlist:
                    tham_so["allowlist"] = allowlist
                if gm == "beamsearch":
                    tham_so["beamWidth"] = 5
                try:
                    kq = list(getattr(self.reader, ham)(anh_xam, **tham_so))
                    if len(kq) > 1:
                        kq.sort(key=lambda r: r[0][0][0])            # trái -> phải
                    cac_chu = [str(r[1]).strip() for r in kq if str(r[1]).strip()]
                    tin_cay = float(np.mean([r[2] for r in kq])) if kq else 0.0
                    return " ".join(cac_chu), tin_cay
                except Exception:
                    continue
        return "", 0.0


def bo_phieu(ung_vien: list, khoa=None):
    """ung_vien: [(giá trị, tin cậy, ghi chú)] ->
    (giá trị thắng, tin cậy cao nhất của nhóm thắng, ghi chú, tỉ lệ đồng thuận)."""
    khoa = khoa or (lambda v: v)
    nhom = defaultdict(list)
    for gt, tc, gc in ung_vien:
        if gt is None or gt == "":
            continue
        nhom[khoa(gt)].append((gt, tc, gc))
    if not nhom:
        return None, 0.0, [], 0.0
    tong = sum(t[1] for ds in nhom.values() for t in ds) or 1e-9
    k_thang = max(nhom, key=lambda k: (sum(t[1] for t in nhom[k]), len(nhom[k])))
    gt, tc, gc = max(nhom[k_thang], key=lambda t: t[1])
    return gt, tc, list(gc), sum(t[1] for t in nhom[k_thang]) / tong


def doc_truong(may, o, khung, bien_the, chuan_hoa, allowlist=None, khoa=None) -> Truong:
    """Đọc một ô: chạy nhiều biến thể, chuẩn hoá từng kết quả, bỏ phiếu."""
    ung_vien = []
    for bt in bien_the:
        van_ban, tin_cay = may.mot_dong(chuan_bi_anh(o, khung, bt), allowlist, bt[2])
        gia_tri, ghi_chu = chuan_hoa(van_ban)
        ung_vien.append((gia_tri, tin_cay, ghi_chu))
    gia_tri, tin_cay, ghi_chu, ti_le = bo_phieu(ung_vien, khoa)
    t = Truong(gia_tri if gia_tri is not None else "", tin_cay, list(dict.fromkeys(ghi_chu)))
    if gia_tri is None or gia_tri == "":
        t.loi.append("không đọc được")
    elif ti_le < NGUONG_DONG_THUAN:
        t.chua_chac.append("các lần đọc không thống nhất")
    elif tin_cay < NGUONG_TIN_CAY:
        t.chua_chac.append(f"độ tin cậy thấp ({tin_cay:.0%})")
    return t


def doc_cot_so(may, anh, hh, y, ten_cot, toi_thieu, toi_da) -> Truong:
    o = cat_o(anh, hh, ten_cot, y)
    khung, _ = khung_mot_dong(o, hh, cho_phep_cham_trai=(ten_cot == "STT"))
    if khung is None:
        return Truong(None, 0.0, ["ô trống"])
    return doc_truong(may, o, khung, BIEN_THE_THUONG,
                      lambda vb: chuan_hoa_so(vb, toi_thieu, toi_da), allowlist="0123456789")


def doc_cot_chu(may, anh, hh, y, ten_cot, chuan_hoa) -> Truong:
    o = cat_o(anh, hh, ten_cot, y)
    khung, _ = khung_mot_dong(o, hh)
    if khung is None:
        return Truong("", 0.0, ["ô trống"])
    return doc_truong(may, o, khung, BIEN_THE_THUONG, chuan_hoa)


def doc_ten(may, anh, hh, y) -> Truong:
    o = cat_o(anh, hh, "Tên Người Chơi", y)
    khung, tp = khung_mot_dong(o, hh)
    if khung is None:
        return Truong("", 0.0, ["ô trống"])
    cac_cham = cham_lung(tp, hh)
    bi_cat = bool(cac_cham)
    if bi_cat:      # xoá dấu "…" trước khi đọc, rồi tự thêm lại "…" vào kết quả
        o = xoa_cham(o, cac_cham)
        khung = hop_bao([c for c in tp if c not in cac_cham])
    t = doc_truong(may, o, khung, BIEN_THE_TEN,
                   lambda vb: lam_sach_ten(vb, bi_cat),
                   khoa=lambda v: re.sub(r"\s+", "", v).casefold())
    if str(t.gia_tri).endswith("…"):
        t.luu_y.append("tên bị game rút gọn (…)")
    return t


def doc_chuc_vu(may, anh, hh, y) -> Truong:
    """Chức vụ có thể gồm 1-3 dòng (một người giữ nhiều chức) -> nối bằng ' / '."""
    o = cat_o(anh, hh, "Chức Vụ", y)
    cac_dong = tach_dong(o, hh)
    if not cac_dong:
        return Truong("", 0.0, ["ô trống"])
    gia_tri, loi, chua_chac, tin_cay = [], [], [], 1.0
    for khung in cac_dong:
        t = doc_truong(may, o, khung, BIEN_THE_THUONG, chuan_hoa_chuc_vu_dong)
        if t.gia_tri:
            gia_tri.append(str(t.gia_tri))
        loi += t.loi
        chua_chac += t.chua_chac
        tin_cay = min(tin_cay, t.tin_cay)
    return Truong(" / ".join(gia_tri), tin_cay,
                  list(dict.fromkeys(loi)), list(dict.fromkeys(chua_chac)))


def doc_tong_so(may, anh, hh):
    """Đọc 'Thành viên bang: 50/60' ở chân bảng -> (hiện có, tối đa) hoặc None."""
    x1, y1, x2, y2 = VUNG_TONG_SO
    o = anh[int(y1 * hh.sy): int(y2 * hh.sy), int(x1 * hh.sx): int(x2 * hh.sx)]
    if o.size == 0:
        return None

    def chuan(vb):
        m = re.search(r"(\d+)\s*/\s*(\d+)", vb or "")
        return ((int(m.group(1)), int(m.group(2))), []) if m else (None, [])

    try:
        t = doc_truong(may, o, (0, 0, o.shape[1] - 1, o.shape[0] - 1),
                       BIEN_THE_THUONG, chuan, allowlist="0123456789/")
        return t.gia_tri if t.gia_tri else None
    except Exception:
        return None


def doc_mot_hang(may, anh, hh, y, ten_anh) -> BanGhi:
    """Đọc một hàng - chỉ đọc những cột nằm trong TEN_COT_XUAT."""
    cach_doc = {
        "STT":            lambda: doc_cot_so(may, anh, hh, y, "STT", 1, 999),
        "Tên Người Chơi": lambda: doc_ten(may, anh, hh, y),
        "Chức Vụ":        lambda: doc_chuc_vu(may, anh, hh, y),
        "Cấp":            lambda: doc_cot_so(may, anh, hh, y, "Cấp", 1, 150),
        "Phái":           lambda: doc_cot_chu(may, anh, hh, y, "Phái", chuan_hoa_phai),
        "Lực Chiến":      lambda: doc_cot_so(may, anh, hh, y, "Lực Chiến", 1000, 9_999_999),
        "Ngày Vào Bang":  lambda: doc_cot_chu(may, anh, hh, y, "Ngày Vào Bang", chuan_hoa_ngay),
        "Trạng Thái":     lambda: doc_cot_chu(may, anh, hh, y, "Trạng Thái", chuan_hoa_trang_thai),
    }
    return BanGhi(anh=ten_anh, y=y, cac_truong={c: cach_doc[c]() for c in TEN_COT_XUAT})


def doi_chieu_stt(ds: list) -> None:
    """Dùng các hàng kề để điền STT không đọc được hoặc sửa STT bị đọc sai (vd 41 -> 4).

    STT trong một ảnh thường tăng +1 mỗi hàng, NHƯNG có thể nhảy cóc: hàng "của mình"
    được ghim ở đầu ảnh đầu tiên nên ở ảnh sau dãy là ..., 12, 14, 15 (thiếu 13).
    Vì vậy chỉ sửa khi mọi bằng chứng cùng cho MỘT đáp án, và chỉ ghi đè STT đã đọc
    được khi cả hai hàng kề (trên và dưới) đều xác nhận.
    """
    def lay(i):
        return ds[i].stt if 0 <= i < len(ds) else None

    ke_hoach = []
    for i, bg in enumerate(ds):
        a, b = lay(i - 1), lay(i + 1)
        ung_vien, hai_phia = set(), False
        if a is not None and b is not None and b - a == 2:
            ung_vien.add(a + 1)
            hai_phia = True
        if a is not None and lay(i - 2) == a - 1:
            ung_vien.add(a + 1)
        if b is not None and lay(i + 2) == b + 1:
            ung_vien.add(b - 1)
        if len(ung_vien) != 1:
            continue                       # không có bằng chứng, hoặc các bằng chứng mâu thuẫn
        m = ung_vien.pop()
        if m < 1 or bg.stt == m:
            continue
        if bg.stt is not None and not hai_phia:
            continue                       # chỉ ghi đè khi cả 2 hàng kề xác nhận
        ke_hoach.append((bg, m))

    for bg, m in ke_hoach:                 # áp dụng sau cùng để không sửa dây chuyền
        cu = bg.stt if bg.stt is not None else "không đọc được"
        bg.cac_truong["STT"] = Truong(m, 0.0, [], [f"STT sửa theo các hàng kề (OCR đọc: {cu})"])


# ============================================================================
# 10. XỬ LÝ MỘT ẢNH
# ============================================================================
def luu_anh_kiem_tra(anh, hh, cac_y, ban_ghi, duong_dan: Path) -> None:
    """Vẽ khung cột + khung từng hàng đã nhận để bạn kiểm tra bằng mắt."""
    ve = anh.copy()
    mau = [(255, 200, 0), (0, 200, 255), (0, 255, 120), (255, 120, 255),
           (120, 255, 255), (80, 160, 255), (255, 255, 0), (200, 200, 200)]
    for i, ten in enumerate(TEN_COT_XUAT):
        x1, x2 = hh.cot[ten]
        cv2.rectangle(ve, (x1, hh.y_tren), (x2, hh.y_duoi), mau[i % len(mau)], 1)
    x_trai, x_phai = hh.cot["STT"][0] - 8, hh.cot["Trạng Thái"][1] + 8
    for y, bg in zip(cac_y, ban_ghi):
        cv2.rectangle(ve, (x_trai, y - hh.nua_hang), (x_phai, y + hh.nua_hang), (0, 255, 0), 2)
        nhan = f"#{bg.stt}" if bg.stt is not None else "#?"
        cv2.putText(ve, nhan, (int(hh.cot["STT"][1] + 46 * hh.sx), y + 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    x1, y1, x2, y2 = VUNG_TONG_SO
    cv2.rectangle(ve, (int(x1 * hh.sx), int(y1 * hh.sy)), (int(x2 * hh.sx), int(y2 * hh.sy)),
                  (0, 165, 255), 2)
    ghi_anh(duong_dan, ve)


def xu_ly_anh(duong_dan: Path, may: MayOCR):
    """Đọc một ảnh -> (danh sách BanGhi, tổng số thành viên đọc ở chân bảng)."""
    anh = doc_anh(duong_dan)
    if anh is None:
        print("   ! Không đọc được ảnh, bỏ qua.")
        return [], None
    hh = HinhHoc.tu_anh(anh)
    if abs(hh.sx - hh.sy) > 0.03 * hh.sy:
        print(f"   ! Ảnh {anh.shape[1]}x{anh.shape[0]} không phải tỉ lệ 16:9, vị trí cột có thể lệch.")

    cac_y = []
    for nguong in (NGUONG_SANG, 150, 190, 130):      # ảnh sáng/tối khác mẫu -> thử ngưỡng khác
        hh.nguong = nguong
        cac_y = tim_cac_hang(anh, hh)
        if cac_y:
            break
    if not cac_y:
        print("   ! Không thấy hàng thành viên nào (đây có phải ảnh bảng 'Thành Viên' không?).")
        return [], None

    ban_ghi = [doc_mot_hang(may, anh, hh, y, duong_dan.name) for y in cac_y]
    doi_chieu_stt(ban_ghi)
    tong = doc_tong_so(may, anh, hh)

    if LUU_ANH_KIEM_TRA:
        thu_muc = THU_MUC_XUAT / "kiem_tra"
        thu_muc.mkdir(parents=True, exist_ok=True)
        luu_anh_kiem_tra(anh, hh, cac_y, ban_ghi, thu_muc / f"{duong_dan.stem}_kiemtra.png")
    return ban_ghi, tong


# ============================================================================
# 11. GỘP NHIỀU ẢNH, KIỂM TRA STT
# ============================================================================
COT_SO_SANH = {"Tên Người Chơi", "Chức Vụ", "Cấp", "Phái", "Lực Chiến"}


def chon_truong(ten_cot: str, ung_vien: list) -> Truong:
    """Chọn giá trị tốt nhất của một ô từ các ảnh chụp trùng hàng đó."""
    co_gia_tri = [t for t in ung_vien if t.gia_tri not in (None, "")]
    if not co_gia_tri:
        return ung_vien[0]
    nhom = defaultdict(list)
    for t in co_gia_tri:
        nhom[str(t.gia_tri).casefold()].append(t)
    khoa = max(nhom, key=lambda k: (len(nhom[k]), max(t.tin_cay for t in nhom[k])))
    tot = max(nhom[khoa], key=lambda t: (not (t.loi or t.chua_chac), t.tin_cay))
    ket = Truong(tot.gia_tri, tot.tin_cay, list(tot.loi), list(tot.chua_chac), list(tot.luu_y))
    if len(nhom[khoa]) >= 2:
        ket.chua_chac = []          # nhiều ảnh đọc giống nhau -> đáng tin hơn
    elif len(nhom) > 1 and ten_cot in COT_SO_SANH:
        khac = " | ".join(str(ds[0].gia_tri) for k, ds in nhom.items() if k != khoa)
        ket.chua_chac.append(f"khác nhau giữa các ảnh (ảnh kia đọc: {khac})")
    return ket


def khoa_ten(bg: BanGhi) -> str:
    t = str(bg.cac_truong["Tên Người Chơi"].gia_tri or "")
    return bo_dau(t.replace("…", "")).replace(" ", "")


def cung_nguoi(a: BanGhi, b: BanGhi) -> bool:
    ta, tb = khoa_ten(a), khoa_ten(b)
    if not ta or not tb or ta.startswith(tb) or tb.startswith(ta):
        return True
    return difflib.SequenceMatcher(None, ta, tb).ratio() >= 0.6


def gop_ban_ghi(tat_ca: list):
    """Gộp theo STT. Trả về (danh sách đã gộp, các STT bị 2 người khác nhau cùng chiếm)."""
    theo_stt, khong_stt = defaultdict(list), []
    for bg in tat_ca:
        (theo_stt[bg.stt] if bg.stt is not None else khong_stt).append(bg)

    ket_qua, xung_dot = [], []
    for s in sorted(theo_stt):
        cac_cum = []
        for bg in theo_stt[s]:
            for cum in cac_cum:
                if cung_nguoi(cum[0], bg):
                    cum.append(bg)
                    break
            else:
                cac_cum.append([bg])
        for cum in cac_cum:
            if len(cum) == 1:
                gop = cum[0]
            else:
                gop = BanGhi(
                    anh=", ".join(sorted({b.anh for b in cum}, key=khoa_tu_nhien)), y=cum[0].y,
                    cac_truong={c: chon_truong(c, [b.cac_truong[c] for b in cum])
                                for c in TEN_COT_XUAT})
            if len(cac_cum) > 1:
                gop.cac_truong["STT"].loi.append("STT này xuất hiện ở 2 người khác nhau")
            ket_qua.append(gop)
        if len(cac_cum) > 1:
            xung_dot.append(s)

    for bg in khong_stt:
        bg.cac_truong["STT"].loi.append("không xác định được STT")
        ket_qua.append(bg)
    return ket_qua, xung_dot


def tim_stt_thieu(ds: list) -> list:
    co = {bg.stt for bg in ds if bg.stt is not None}
    return [s for s in range(1, max(co) + 1) if s not in co] if co else []


# ============================================================================
# 12. XUẤT EXCEL
# ============================================================================
XANH = PatternFill("solid", fgColor="1F4E78")
VIEN = Border(bottom=Side(style="thin", color="D9D9D9"))
KIEU_CHU = "Arial"

DO_RONG_COT = {"STT": 7, "Tên Người Chơi": 28, "Chức Vụ": 42, "Cấp": 7, "Phái": 14,
               "Lực Chiến": 12, "Ngày Vào Bang": 15, "Trạng Thái": 16}
CAN_GIUA = {"STT", "Cấp", "Phái", "Lực Chiến", "Ngày Vào Bang", "Trạng Thái"}
DINH_DANG_SO = {"Cấp": "0", "Lực Chiến": "#,##0", "Ngày Vào Bang": '0" ngày"'}


def cac_o_can_xem(ds: list) -> list:
    """Các ô cần đối chiếu: [(bản ghi, tên cột, giá trị, lý do)]."""
    ket = []
    for bg in ds:
        for c in TEN_COT_XUAT:
            t = bg.cac_truong[c]
            if t.loi or t.chua_chac:
                ket.append((bg, c, t.gia_tri, "; ".join(t.loi + t.chua_chac)))
    return ket


def ghi_excel(ds, thieu, xung_dot, tong_game, so_anh, duong_dan: Path, thoi_diem: datetime) -> Path:
    wb = Workbook()

    # ---- Sheet 1: danh sách (chỉ gồm các cột cần dùng, sạch để copy/dán)
    ws = wb.active
    ws.title = "Danh sách"
    ws.append(TEN_COT_XUAT)
    for bg in ds:
        ws.append([bg.cac_truong[c].gia_tri if bg.cac_truong[c].gia_tri not in (None, "") else None
                   for c in TEN_COT_XUAT])

    for c, ten in enumerate(TEN_COT_XUAT, start=1):
        o = ws.cell(row=1, column=c)
        o.font = Font(name=KIEU_CHU, size=10, bold=True, color="FFFFFF")
        o.fill = XANH
        o.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = DO_RONG_COT.get(ten, 16)
    ws.row_dimensions[1].height = 24

    for r, bg in enumerate(ds, start=2):
        for c, ten in enumerate(TEN_COT_XUAT, start=1):
            o = ws.cell(row=r, column=c)
            o.font = Font(name=KIEU_CHU, size=10)
            o.border = VIEN
            o.alignment = Alignment(horizontal="center" if ten in CAN_GIUA else "left",
                                    vertical="center")
            if ten in DINH_DANG_SO:
                o.number_format = DINH_DANG_SO[ten]
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(TEN_COT_XUAT))}{len(ds) + 1}"

    # ---- Sheet 2: số liệu đối chiếu + danh sách ô cần xem lại
    kt = wb.create_sheet("Kiểm tra")
    cuoi = max(len(ds) + 1, 2)
    o_vang = cac_o_can_xem(ds)
    for dong in [
        ["Chỉ tiêu", "Giá trị", "Ghi chú"],
        ["Số thành viên đọc được", f"=COUNT('Danh sách'!A2:A{cuoi})", "Đếm theo cột STT"],
        ["Số thành viên theo game (chân bảng)", tong_game[0] if tong_game else "Không đọc được",
         "Đọc từ dòng 'Thành viên bang: x/y' ở chân bảng"],
        ["Chênh lệch (game - đọc được)", '=IF(ISNUMBER(B3),B3-B2,"")',
         "Khác 0 nghĩa là còn thiếu hoặc thừa hàng"],
        ["STT lớn nhất", f"=MAX('Danh sách'!A2:A{cuoi})", ""],
        ["STT bị thiếu", ", ".join(map(str, thieu)) if thieu else "Không thiếu",
         "Nếu có: chụp thêm ảnh để các hàng đó nằm trọn trong khung bảng"],
        ["STT bị 2 người cùng chiếm", ", ".join(map(str, xung_dot)) if xung_dot else "Không có",
         "Thường do OCR đọc sai chữ số STT"],
        ["Số tên bị game rút gọn (…)", f"=COUNTIF('Danh sách'!B2:B{cuoi},\"*…\")",
         "Ảnh không có tên đầy đủ; xem trong game"],
        ["Số ô cần xem lại", len(o_vang), "Liệt kê ở bảng bên dưới"],
        ["Số ảnh đã xử lý", so_anh, ""],
        ["Thời điểm chạy", thoi_diem.strftime("%d/%m/%Y %H:%M:%S"), ""],
        [],
    ]:
        kt.append(dong)
    kt.append(["Ô cần xem lại", "Giá trị đang ghi", "Lý do  [ảnh nguồn]"])
    hang_ds = kt.max_row          # dòng tiêu đề của bảng "Ô cần xem lại"
    if o_vang:
        for bg, ten, gia_tri, ly_do in o_vang:
            stt = bg.stt if bg.stt is not None else "?"
            kt.append([f"STT {stt} - {ten}", "" if gia_tri in (None, "") else str(gia_tri),
                       f"{ly_do}  [{bg.anh}]"])
    else:
        kt.append(["Không có ô nào cần xem lại", "", ""])

    for r in range(1, kt.max_row + 1):
        la_tieu_de = r in (1, hang_ds)
        for c in range(1, 4):
            o = kt.cell(row=r, column=c)
            o.font = Font(name=KIEU_CHU, size=10, bold=la_tieu_de,
                          color="FFFFFF" if la_tieu_de else "000000")
            o.alignment = Alignment(vertical="center",
                                    horizontal="center" if la_tieu_de or (c == 2 and r < hang_ds) else "left")
            if la_tieu_de:
                o.fill = XANH
    for cot, rong in zip("ABC", (38, 28, 74)):
        kt.column_dimensions[cot].width = rong

    try:
        wb.save(duong_dan)
    except PermissionError:
        sys.exit(f"LỖI: không ghi được file {duong_dan}. Hãy kiểm tra quyền ghi của thư mục.")
    return duong_dan


# ============================================================================
# 13. CHƯƠNG TRÌNH CHÍNH
# ============================================================================
def main() -> None:
    global THU_MUC_ANH, THU_MUC_XUAT
    if len(sys.argv) >= 2:
        THU_MUC_ANH = Path(sys.argv[1])
    if len(sys.argv) >= 3:
        THU_MUC_XUAT = Path(sys.argv[2])
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    sai_cot = [c for c in TEN_COT_XUAT if c not in CAC_COT]
    if sai_cot:
        sys.exit(f"CAC_COT_XUAT có tên cột không hợp lệ: {sai_cot}. Chỉ được chọn trong: {list(CAC_COT)}")
    if not THU_MUC_ANH.exists():
        print(f"LỖI: không tìm thấy thư mục ảnh: {THU_MUC_ANH}")
        print("Hãy sửa THU_MUC_ANH ở phần CẤU HÌNH đầu file.")
        return
    cac_anh = sorted((p for p in THU_MUC_ANH.iterdir()
                      if p.is_file() and p.suffix.lower() in DUOI_ANH),
                     key=lambda p: khoa_tu_nhien(p.name))
    if not cac_anh:
        print(f"Không có ảnh nào trong: {THU_MUC_ANH}")
        return
    THU_MUC_XUAT.mkdir(parents=True, exist_ok=True)

    may = MayOCR(DUNG_GPU)
    print(f"Tìm thấy {len(cac_anh)} ảnh. Bắt đầu nhận dạng...\n")

    tat_ca, cac_tong = [], []
    for i, duong_dan in enumerate(cac_anh, start=1):
        print(f"[{i}/{len(cac_anh)}] {duong_dan.name}")
        ban_ghi, tong = xu_ly_anh(duong_dan, may)
        tat_ca += ban_ghi
        if tong:
            cac_tong.append(tong)
        if ban_ghi:
            stt = [str(b.stt) if b.stt is not None else "?" for b in ban_ghi]
            print(f"   đọc được {len(ban_ghi)} hàng, STT: {', '.join(stt)}")

    if not tat_ca:
        print("\nKhông nhận dạng được hàng nào. Hãy mở ảnh trong thư mục 'kiem_tra' để xem vị trí cột.")
        return

    ds, xung_dot = gop_ban_ghi(tat_ca)
    thieu = tim_stt_thieu(ds)
    tong_game = Counter(cac_tong).most_common(1)[0][0] if cac_tong else None

    bay_gio = datetime.now()
    ten_file = f"{TIEN_TO_TEN_FILE}_{bay_gio:%H-%M-%S_%d-%m-%Y}.xlsx"
    duong_dan_excel = ghi_excel(ds, thieu, xung_dot, tong_game, len(cac_anh),
                                THU_MUC_XUAT / ten_file, bay_gio)

    o_can_xem = len(cac_o_can_xem(ds))
    bi_cat = sum(1 for b in ds if b.cac_truong["Tên Người Chơi"].luu_y)
    print("\n" + "=" * 60)
    print("HOÀN TẤT")
    print(f"  Số thành viên đọc được : {len(ds)}" + (f"   (game báo {tong_game[0]}/{tong_game[1]})" if tong_game else ""))
    print(f"  STT bị thiếu           : {', '.join(map(str, thieu)) if thieu else 'không thiếu'}")
    if xung_dot:
        print(f"  STT bị 2 người chiếm   : {', '.join(map(str, xung_dot))}  (kiểm tra lại)")
    print(f"  Ô cần xem lại          : {o_can_xem}   (lý do ghi ở sheet 'Kiểm tra')")
    print(f"  Tên bị game rút gọn    : {bi_cat}")
    print(f"  File Excel             : {duong_dan_excel}")
    if LUU_ANH_KIEM_TRA:
        print(f"  Ảnh kiểm tra khung     : {THU_MUC_XUAT / 'kiem_tra'}")
    if thieu:
        print("\n  -> Còn thiếu STT: hãy chụp thêm ảnh sao cho các hàng đó nằm trọn trong khung bảng.")
    print("\nLưu ý: OCR có thể đọc sai dấu tên. Hãy đối chiếu các ô được liệt kê trong sheet 'Kiểm tra'.")


if __name__ == "__main__":
    main()