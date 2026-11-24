import gzip
from pathlib import Path
import shutil
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
TEMPLATE = ROOT / "templates" / "index.html"
ASSETS = ROOT / "static"
NODE_MODULES = ROOT / "node_modules"
TESSDATA_URL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main"


def download_tessdata(language: str) -> bytes:
    target = PUBLIC / "static" / "lang" / f"{language}.traineddata.gz"
    if target.exists() and target.stat().st_size:
        return target.read_bytes()

    request = Request(
        f"{TESSDATA_URL}/{language}.traineddata",
        headers={"User-Agent": "WebDSB-static-build"},
    )
    with urlopen(request, timeout=90) as response:
        model = response.read()
    if len(model) < 10_000:
        raise RuntimeError(f"Tesseract model download is incomplete: {language}")
    compressed = gzip.compress(model, compresslevel=9, mtime=0)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(compressed)
    return compressed


def copy_ocr_assets() -> None:
    vendor = PUBLIC / "static" / "vendor"
    vendor.mkdir(parents=True, exist_ok=True)
    tesseract_dist = NODE_MODULES / "tesseract.js" / "dist"
    core = NODE_MODULES / "tesseract.js-core"
    for filename in ("tesseract.min.js", "worker.min.js"):
        shutil.copy2(tesseract_dist / filename, vendor / filename)
    for asset in core.iterdir():
        if asset.name.endswith((".wasm.js", ".wasm")):
            shutil.copy2(asset, vendor / asset.name)

    shutil.copy2(NODE_MODULES / "fflate" / "esm" / "browser.js", vendor / "fflate.js")
    (vendor / "THIRD_PARTY_LICENSES.txt").write_text(
        "\n\n--- Tesseract.js (Apache-2.0) ---\n\n"
        + (NODE_MODULES / "tesseract.js" / "LICENSE.md").read_text(encoding="utf-8")
        + "\n\n--- Tesseract.js Core (Apache-2.0) ---\n\n"
        + (core / "LICENSE").read_text(encoding="utf-8")
        + "\n\n--- fflate (MIT) ---\n\n"
        + (NODE_MODULES / "fflate" / "LICENSE").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    for language in ("vie", "eng"):
        download_tessdata(language)


def build():
    (PUBLIC / "static").mkdir(parents=True, exist_ok=True)
    html = TEMPLATE.read_text(encoding="utf-8")
    insertion = (
        '    <div class="deployment-notice" role="status">'
        "<strong>Riêng tư:</strong> Ảnh được nhận diện ngay trên thiết bị của bạn, "
        "không tải lên máy chủ. Lần đầu cần tải mô hình ngôn ngữ về trình duyệt."
        "</div>\n"
    )
    html = html.replace('    <section class="upload-card"', insertion + '    <section class="upload-card"', 1)
    (PUBLIC / "index.html").write_text(html, encoding="utf-8")
    for asset in ASSETS.iterdir():
        if asset.is_file():
            shutil.copy2(asset, PUBLIC / "static" / asset.name)
    copy_ocr_assets()


if __name__ == "__main__":
    build()
