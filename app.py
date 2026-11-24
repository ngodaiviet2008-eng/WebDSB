from __future__ import annotations

import importlib.util
import io
import sys
import uuid
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

from flask import Flask, jsonify, render_template, request, send_file


ROOT = Path(__file__).resolve().parent
OCR_FILE = ROOT / "quet_bang_hoi_claude - Android2.py"
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_FILE_SIZE = 20 * 1024 * 1024

app = Flask(
    __name__,
    static_folder=ROOT / "public" / "static",
    static_url_path="/static",
)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

ocr = None
ocr_lock = Lock()
ocr_error: str | None = None
sessions: dict[str, dict] = {}


def load_ocr_module():
    global ocr, ocr_error
    if ocr is not None:
        return ocr
    if ocr_error:
        raise RuntimeError(ocr_error)

    spec = importlib.util.spec_from_file_location("ocr_bang_hoi", OCR_FILE)
    if spec is None or spec.loader is None:
        raise RuntimeError("Không thể mở file OCR.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    ocr = module
    return module


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/ocr")
def run_ocr():
    uploaded = request.files.getlist("images")
    if not uploaded:
        return jsonify({"error": "Vui lòng chọn ít nhất một ảnh."}), 400

    files: list[tuple[str, bytes]] = []
    for item in uploaded:
        name = item.filename or "anh.png"
        suffix = Path(name).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            return jsonify({"error": f"File không hỗ trợ: {name}"}), 400
        content = item.read()
        if len(content) > MAX_FILE_SIZE:
            return jsonify({"error": f"Ảnh quá lớn (tối đa 20 MB): {name}"}), 400
        if not content:
            return jsonify({"error": f"File rỗng: {name}"}), 400
        files.append((name, content))

    try:
        module = load_ocr_module()
    except Exception as exc:
        return jsonify({"error": f"Không thể nạp công cụ OCR: {exc}"}), 500

    with ocr_lock:
        try:
            with TemporaryDirectory(prefix="ocr-bang-hoi-") as temp_dir:
                temp = Path(temp_dir)
                image_dir = temp / "images"
                output_dir = temp / "output"
                image_dir.mkdir()
                output_dir.mkdir()

                for name, content in files:
                    safe_name = Path(name).name
                    (image_dir / safe_name).write_bytes(content)

                module.THU_MUC_ANH = image_dir
                module.THU_MUC_XUAT = output_dir
                module.LUU_ANH_KIEM_TRA = True
                reader = module.MayOCR(False)

                records = []
                totals = []
                ordered_images = sorted(
                    (path for path in image_dir.iterdir() if path.suffix.lower() in module.DUOI_ANH),
                    key=lambda path: module.khoa_tu_nhien(path.name),
                )
                for path in ordered_images:
                    current_records, total = module.xu_ly_anh(path, reader)
                    records.extend(current_records)
                    if total:
                        totals.append(total)

                if not records:
                    return jsonify({
                        "error": "Không nhận dạng được hàng thành viên nào. Hãy kiểm tra ảnh hoặc thử ảnh rõ hơn."
                    }), 422

                merged, conflicts = module.gop_ban_ghi(records)
                missing = module.tim_stt_thieu(merged)
                game_total = __import__("collections").Counter(totals).most_common(1)[0][0] if totals else None
                review_cells = module.cac_o_can_xem(merged)

                rows = []
                for record in merged:
                    row = {}
                    for column in module.TEN_COT_XUAT:
                        field = record.cac_truong[column]
                        row[column] = field.gia_tri if field.gia_tri not in (None, "") else ""
                    rows.append(row)

                sessions_data = {
                    "module": module,
                    "records": merged,
                    "missing": missing,
                    "conflicts": conflicts,
                    "game_total": game_total,
                    "image_count": len(ordered_images),
                    "created_at": datetime.now(),
                }
                session_id = uuid.uuid4().hex
                sessions[session_id] = sessions_data

                return jsonify({
                    "session_id": session_id,
                    "columns": module.TEN_COT_XUAT,
                    "rows": rows,
                    "missing": missing,
                    "conflicts": conflicts,
                    "game_total": game_total,
                    "review_count": len(review_cells),
                    "image_count": len(ordered_images),
                })
        except Exception as exc:
            return jsonify({"error": f"Lỗi OCR: {exc}"}), 500


@app.post("/api/export")
def export_excel():
    payload = request.get_json(silent=True) or {}
    session_id = payload.get("session_id")
    edited_rows = payload.get("rows")
    state = sessions.get(session_id)
    if not state or not isinstance(edited_rows, list):
        return jsonify({"error": "Phiên xử lý đã hết hạn. Hãy nhận diện lại ảnh."}), 400

    module = state["module"]
    records = state["records"]
    if len(edited_rows) != len(records):
        return jsonify({"error": "Số dòng dữ liệu không hợp lệ."}), 400

    for record, row in zip(records, edited_rows):
        for column in module.TEN_COT_XUAT:
            field = record.cac_truong[column]
            value = row.get(column, "")
            if column == "STT":
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    value = None
            field.gia_tri = value

    with TemporaryDirectory(prefix="excel-bang-hoi-") as temp_dir:
        output = Path(temp_dir) / f"Danh_Sach_Bang_{datetime.now():%H-%M-%S_%d-%m-%Y}.xlsx"
        module.ghi_excel(
            records,
            state["missing"],
            state["conflicts"],
            state["game_total"],
            state["image_count"],
            output,
            state["created_at"],
        )
        excel_data = output.read_bytes()
        return send_file(
            io.BytesIO(excel_data),
            as_attachment=True,
            download_name=output.name,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


@app.get("/api/health")
def health():
    try:
        load_ocr_module()
        return jsonify({"status": "ready"})
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
