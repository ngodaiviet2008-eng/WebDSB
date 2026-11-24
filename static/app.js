import {
  buildExcel,
  detectRows,
  mergeRows,
  normalizeClass,
  normalizeName,
  prepareCell,
} from "/static/ocr-utils.js";

const fileInput = document.querySelector("#fileInput");
const uploadCard = document.querySelector("#uploadCard");
const fileList = document.querySelector("#fileList");
const actionRow = document.querySelector("#actionRow");
const scanButton = document.querySelector("#scanButton");
const clearButton = document.querySelector("#clearButton");
const loading = document.querySelector("#loading");
const loadingTitle = document.querySelector("#loadingTitle");
const resultSection = document.querySelector("#resultSection");
const resultTitle = document.querySelector("#resultTitle");
const resultTable = document.querySelector("#resultTable");
const metrics = document.querySelector("#metrics");
const exportButton = document.querySelector("#exportButton");
const toast = document.querySelector("#toast");
const status = document.querySelector("#status");

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 20;
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
let selectedFiles = [];
let previewUrls = [];
let resultRows = [];
let resultSummary = null;

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 6000);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function releasePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function renderFiles() {
  releasePreviewUrls();
  fileList.replaceChildren();
  selectedFiles.forEach((file) => {
    const item = document.createElement("article");
    item.className = "file-item";
    const image = document.createElement("img");
    image.className = "file-thumb";
    image.alt = "";
    image.src = URL.createObjectURL(file);
    previewUrls.push(image.src);
    const info = document.createElement("div");
    info.className = "file-info";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);
    info.append(name, size);
    item.append(image, info);
    fileList.append(item);
  });
  const hasFiles = selectedFiles.length > 0;
  fileList.hidden = !hasFiles;
  actionRow.hidden = !hasFiles;
  uploadCard.hidden = hasFiles;
}

function addFiles(fileArray) {
  const valid = [];
  for (const file of fileArray) {
    const dot = file.name.lastIndexOf(".");
    const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      showToast(`Không hỗ trợ định dạng: ${file.name}`);
    } else if (file.size > MAX_FILE_SIZE) {
      showToast(`Ảnh vượt quá 20 MB: ${file.name}`);
    } else if (file.size) {
      valid.push(file);
    }
  }
  if (selectedFiles.length + valid.length > MAX_FILES) {
    showToast(`Mỗi lần nhận diện tối đa ${MAX_FILES} ảnh.`);
    return;
  }
  selectedFiles = [...selectedFiles, ...valid];
  resultSection.hidden = true;
  renderFiles();
}

document.querySelector("#chooseButton").addEventListener("click", () => fileInput.click());
document.querySelector("#browseButton").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  fileInput.value = "";
});

clearButton.addEventListener("click", () => {
  selectedFiles = [];
  resultRows = [];
  resultSummary = null;
  releasePreviewUrls();
  renderFiles();
  uploadCard.hidden = false;
  resultSection.hidden = true;
});

["dragenter", "dragover"].forEach((type) => {
  uploadCard.addEventListener(type, (event) => {
    event.preventDefault();
    uploadCard.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((type) => {
  uploadCard.addEventListener(type, (event) => {
    event.preventDefault();
    uploadCard.classList.remove("dragging");
  });
});
uploadCard.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

function loadCanvas(file) {
  return createImageBitmap(file).then((bitmap) => {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  });
}

async function recognizeCell(worker, canvas, centerY, column, scaleX, scaleY) {
  const processed = prepareCell(
    canvas,
    canvas.width,
    canvas.height,
    scaleX,
    scaleY,
    centerY,
    column,
  );
  await worker.setParameters({
    tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_LINE,
    tessedit_char_whitelist: column === "STT" ? "0123456789" : "",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  const { data } = await worker.recognize(processed);
  const text = (data.text || "").replace(/\s+/g, " ").trim();
  return { text, confidence: Number(data.confidence) || 0 };
}

async function recognizeImages(worker) {
  const rows = [];
  const imageErrors = [];
  for (let imageIndex = 0; imageIndex < selectedFiles.length; imageIndex += 1) {
    const file = selectedFiles[imageIndex];
    loadingTitle.textContent = `Đang phân tích ảnh ${imageIndex + 1}/${selectedFiles.length}: ${file.name}`;
    const canvas = await loadCanvas(file);
    const scaleX = canvas.width / 1708;
    const scaleY = canvas.height / 768;
    if (Math.abs(scaleX - scaleY) > 0.03 * scaleY) {
      imageErrors.push(`${file.name}: tỷ lệ ảnh khác 16:9`);
    }

    const imageData = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    let centers = [];
    for (const threshold of [170, 150, 190, 130]) {
      centers = detectRows(imageData, canvas.width, canvas.height, threshold);
      if (centers.length) break;
    }
    if (!centers.length) {
      imageErrors.push(`${file.name}: không tìm thấy hàng thành viên`);
      continue;
    }

    for (let rowIndex = 0; rowIndex < centers.length; rowIndex += 1) {
      loadingTitle.textContent = `Đang nhận diện ảnh ${imageIndex + 1}/${selectedFiles.length} · dòng ${rowIndex + 1}/${centers.length}`;
      const sttResult = await recognizeCell(worker, canvas, centers[rowIndex], "STT", scaleX, scaleY);
      const nameResult = await recognizeCell(worker, canvas, centers[rowIndex], "Tên Người Chơi", scaleX, scaleY);
      const classResult = await recognizeCell(worker, canvas, centers[rowIndex], "Phái", scaleX, scaleY);
      const number = Number(sttResult.text.replace(/\D/g, ""));
      const stt = Number.isInteger(number) && number > 0 && number <= 999 ? number : null;
      const name = normalizeName(nameResult.text);
      const className = normalizeClass(classResult.text);
      const review = [];
      if (!stt) review.push("Không đọc được STT");
      if (!name) review.push("Không đọc được tên");
      if (nameResult.confidence < 45) review.push(`Độ tin cậy tên thấp (${Math.round(nameResult.confidence)}%)`);
      if (!className) review.push("Không đọc được phái");
      if (classResult.confidence < 45) review.push(`Độ tin cậy phái thấp (${Math.round(classResult.confidence)}%)`);

      rows.push({
        STT: stt,
        "Tên Người Chơi": name,
        Phái: className,
        "Tên Người ChơiConfidence": nameResult.confidence,
        "PháiConfidence": classResult.confidence,
        review,
        imageIndex,
        rowIndex,
      });
    }
  }
  return { rows, imageErrors };
}

scanButton.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  scanButton.disabled = true;
  loading.hidden = false;
  resultSection.hidden = true;
  loadingTitle.textContent = "Đang tải mô hình nhận diện tiếng Việt...";
  status.lastChild.textContent = " Đang xử lý";
  let worker;
  try {
    worker = await window.Tesseract.createWorker(["vie", "eng"], 1, {
      workerPath: "/static/vendor/worker.min.js",
      corePath: "/static/vendor/",
      langPath: "/static/lang",
      gzip: true,
      logger: (event) => {
        if (event.status === "loading language traineddata") {
          loadingTitle.textContent = `Đang tải mô hình ${Math.round(event.progress * 100)}%`;
        }
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_LINE,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const { rows, imageErrors } = await recognizeImages(worker);
    if (!rows.length) {
      throw new Error("Không thấy dòng thành viên. Hãy dùng ảnh chụp bảng thành viên tỷ lệ 16:9.");
    }
    resultRows = mergeRows(rows);
    const knownNumbers = resultRows.map((row) => row.STT).filter(Boolean);
    const maxNumber = knownNumbers.length ? Math.max(...knownNumbers) : 0;
    const present = new Set(knownNumbers);
    const missing = Array.from({ length: maxNumber }, (_, index) => index + 1)
      .filter((number) => !present.has(number));
    const conflicts = resultRows.filter((row) => row.conflict).map((row) => row.STT);
    resultSummary = { missing, conflicts, imageErrors, imageCount: selectedFiles.length };
    renderResult(resultRows, resultSummary);
    if (imageErrors.length) {
      showToast(`Có ${imageErrors.length} ảnh/dòng cần kiểm tra. Xem thông tin cảnh báo phía trên bảng.`);
    }
  } catch (error) {
    showToast(error.message || "OCR không thành công. Hãy thử ảnh rõ hơn.");
  } finally {
    if (worker) await worker.terminate();
    loading.hidden = true;
    scanButton.disabled = false;
    status.lastChild.textContent = " Sẵn sàng";
  }
});

function renderResult(rows, summary) {
  resultTitle.textContent = `Danh sách thành viên · ${rows.length} người`;
  resultSection.hidden = false;
  metrics.replaceChildren();
  const reviewCount = rows.reduce((count, row) => count + row.review.length, 0);
  const items = [
    { label: "Ảnh đã xử lý", value: summary.imageCount, cls: "" },
    { label: "Thành viên", value: rows.length, cls: "" },
  ];
  if (summary.missing.length) {
    items.push({ label: "STT bị thiếu", value: summary.missing.join(", "), cls: "warning" });
  }
  if (summary.conflicts.length) {
    items.push({ label: "STT trùng người", value: summary.conflicts.join(", "), cls: "danger" });
  }
  if (reviewCount) {
    items.push({ label: "Ô cần xem lại", value: reviewCount, cls: "warning" });
  }
  if (summary.imageErrors.length) {
    items.push({ label: "Ảnh cần xem lại", value: summary.imageErrors.length, cls: "warning" });
  }
  items.forEach((item) => {
    const element = document.createElement("div");
    element.className = `metric ${item.cls}`;
    const value = document.createElement("strong");
    value.textContent = item.value;
    element.append(value, document.createTextNode(` · ${item.label}`));
    metrics.append(element);
  });

  const tableHead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["STT", "Tên Người Chơi", "Phái", "Ghi chú"].forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.append(th);
  });
  tableHead.append(headerRow);
  const body = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    ["STT", "Tên Người Chơi", "Phái"].forEach((column) => {
      const td = document.createElement("td");
      if (row.review.length) td.classList.add("needs-review");
      const input = document.createElement("input");
      input.value = row[column] ?? "";
      input.dataset.row = rowIndex;
      input.dataset.column = column;
      td.append(input);
      tr.append(td);
    });
    const note = document.createElement("td");
    note.className = row.review.length ? "review-note" : "muted";
    note.textContent = [...new Set(row.review)].join("; ") || "—";
    tr.append(note);
    body.append(tr);
  });
  resultTable.replaceChildren(tableHead, body);
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

exportButton.addEventListener("click", () => {
  if (!resultRows.length || !resultSummary) return;
  resultTable.querySelectorAll("tbody input").forEach((input) => {
    const row = resultRows[Number(input.dataset.row)];
    const column = input.dataset.column;
    row[column] = column === "STT" ? Number(input.value) || null : input.value.trim();
  });
  try {
    const workbook = buildExcel(
      resultRows,
      resultSummary.missing,
      resultSummary.conflicts,
      resultSummary.imageCount,
    );
    const blob = new Blob([workbook], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `Danh_Sach_Bang_${new Date().toLocaleDateString("vi-VN").replaceAll("/", "-")}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showToast(`Không thể tạo file Excel: ${error.message}`);
  }
});
