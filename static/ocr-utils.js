import { strToU8, zipSync } from "./vendor/fflate.js";

export const COLUMNS = ["STT", "Tên Người Chơi", "Phái"];
export const CLASSES = [
  "Long Ngâm", "Tố Vấn", "Huyền Cơ", "Thiết Y",
  "Toái Mộng", "Cửu Linh", "Huyết Hà", "Thần Tương",
];

const REFERENCE_SIZE = { width: 1708, height: 768 };
const ROW_SCAN_COLUMNS = [
  [835, 915], [950, 1095], [1120, 1250], [1290, 1430], [1460, 1650],
];
const CELL_COLUMNS = {
  STT: [260, 315],
  "Tên Người Chơi": [455, 640],
  Phái: [950, 1095],
};

export function detectRows(imageData, width, height, threshold = 170) {
  const sx = width / REFERENCE_SIZE.width;
  const sy = height / REFERENCE_SIZE.height;
  const counts = new Uint32Array(height);
  const pixels = imageData.data;
  const yStart = Math.max(0, Math.round(180 * sy));
  const yEnd = Math.min(height, Math.round(680 * sy));
  const columns = ROW_SCAN_COLUMNS.map(([left, right]) => [
    Math.max(0, Math.round(left * sx)),
    Math.min(width, Math.round(right * sx)),
  ]);

  for (let y = yStart; y < yEnd; y += 1) {
    let bright = 0;
    for (const [left, right] of columns) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= threshold) {
          bright += 1;
        }
      }
    }
    counts[y] = bright;
  }

  const runs = [];
  let start = -1;
  let previous = -1;
  const gap = Math.max(2, Math.round(5 * sy));
  for (let y = yStart; y < yEnd; y += 1) {
    if (!counts[y]) continue;
    if (start < 0 || y - previous > gap) {
      if (start >= 0) runs.push([start, previous]);
      start = y;
    }
    previous = y;
  }
  if (start >= 0) runs.push([start, previous]);

  return runs
    .filter(([top, bottom]) => {
      const runHeight = bottom - top + 1;
      return 18 * sy <= runHeight && runHeight <= 50 * sy;
    })
    .map(([top, bottom]) => Math.round((top + bottom) / 2))
    .filter((center) => (
      center - 28 * sy >= yStart - 2
      && center + 28 * sy <= yEnd + 2
    ));
}

function textBounds(imageData, width, height, threshold, sy) {
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const stack = [];
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      if (visited[index]) continue;
      visited[index] = 1;
      const offset = index * 4;
      if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < threshold) continue;

      stack.push(index);
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length) {
        const current = stack.pop();
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        area += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nextX = currentX + dx;
            const nextY = currentY + dy;
            if (nextX < 1 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const next = nextY * width + nextX;
            if (visited[next]) continue;
            visited[next] = 1;
            const nextOffset = next * 4;
            if (Math.min(data[nextOffset], data[nextOffset + 1], data[nextOffset + 2]) >= threshold) {
              stack.push(next);
            }
          }
        }
      }

      const centerY = (minY + maxY) / 2;
      if (area >= 3 && Math.abs(centerY - height / 2) <= 22 * sy) {
        left = Math.min(left, minX);
        right = Math.max(right, maxX);
        top = Math.min(top, minY);
        bottom = Math.max(bottom, maxY);
      }
    }
  }

  if (right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

export function prepareCell(source, width, height, sx, sy, centerY, column, threshold = 170) {
  const [refLeft, refRight] = CELL_COLUMNS[column];
  const left = Math.max(0, Math.round(refLeft * sx));
  const right = Math.min(width, Math.round(refRight * sx));
  const halfHeight = Math.round(28 * sy);
  const top = Math.max(0, centerY - halfHeight);
  const bottom = Math.min(height, centerY + halfHeight + 1);
  const cellWidth = right - left;
  const cellHeight = bottom - top;
  const cell = document.createElement("canvas");
  cell.width = cellWidth;
  cell.height = cellHeight;
  const cellContext = cell.getContext("2d", { willReadFrequently: true });
  cellContext.drawImage(source, left, top, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);

  const sourceData = cellContext.getImageData(0, 0, cellWidth, cellHeight);
  const bounds = textBounds(sourceData, cellWidth, cellHeight, threshold, sy)
    || { left: 0, top: 0, right: cellWidth - 1, bottom: cellHeight - 1 };
  const paddingX = Math.max(2, Math.round(3 * sx));
  const paddingY = Math.max(2, Math.round(3 * sy));
  const cropLeft = Math.max(0, bounds.left - paddingX);
  const cropTop = Math.max(0, bounds.top - paddingY);
  const cropRight = Math.min(cellWidth, bounds.right + paddingX + 1);
  const cropBottom = Math.min(cellHeight, bounds.bottom + paddingY + 1);
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;
  const raw = cellContext.getImageData(cropLeft, cropTop, cropWidth, cropHeight);
  const histogram = new Uint32Array(256);
  const gray = new Uint8Array(cropWidth * cropHeight);

  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    const value = Math.round(
      raw.data[offset] * 0.299
      + raw.data[offset + 1] * 0.587
      + raw.data[offset + 2] * 0.114,
    );
    gray[i] = value;
    histogram[value] += 1;
  }

  const percentile = (fraction) => {
    const target = Math.floor(gray.length * fraction);
    let sum = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      sum += histogram[value];
      if (sum > target) return value;
    }
    return 255;
  };
  const low = percentile(0.02);
  const high = percentile(0.98);
  const range = Math.max(1, high - low);
  const scale = 4;
  const padding = 24;
  const output = document.createElement("canvas");
  output.width = cropWidth * scale + padding * 2;
  output.height = cropHeight * scale + padding * 2;
  const outputContext = output.getContext("2d", { willReadFrequently: true });
  outputContext.fillStyle = "#fff";
  outputContext.fillRect(0, 0, output.width, output.height);
  const processed = outputContext.createImageData(cropWidth, cropHeight);
  for (let i = 0; i < gray.length; i += 1) {
    const value = 255 - Math.max(0, Math.min(255, Math.round(((gray[i] - low) / range) * 255)));
    const offset = i * 4;
    processed.data[offset] = value;
    processed.data[offset + 1] = value;
    processed.data[offset + 2] = value;
    processed.data[offset + 3] = 255;
  }
  const small = document.createElement("canvas");
  small.width = cropWidth;
  small.height = cropHeight;
  small.getContext("2d").putImageData(processed, 0, 0);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(small, padding, padding, cropWidth * scale, cropHeight * scale);
  return output;
}

export function normalizeClass(value) {
  const folded = normalizeVietnamese(value).replace(/\s+/g, " ").trim();
  if (!folded) return "";
  let best = "";
  let bestScore = 0;
  for (const candidate of CLASSES) {
    const score = similarity(folded, normalizeVietnamese(candidate));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 0.68 ? best : value.trim();
}

export function normalizeName(value) {
  let name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  name = name.replace(/^[)\]}>|]+\s*/, "").replace(/^\d+\s+/, "");
  const key = normalizeVietnamese(name).replace(/\s/g, "");
  const corrections = {
    hongtri: "HồngTrì",
    hongtr: "HồngTrì",
    tongvankhanh: "Tống Vân Khanh",
    hachy: "Hắc Hy",
    vekienduc: "VệKiệnĐức",
    thanhduong: "ThanhĐường",
    duhinhangia: "du hí nhân gia",
    chammien: "Chẩm Miên",
    hopdoa123: "HợpĐoa123",
  };
  if (corrections[key]) return corrections[key];
  const parts = name.split(/\s+/);
  if (
    parts.some((part) => part.length === 1)
    && /^[A-Z0-9 ]+$/.test(name)
    && /[A-Z]/.test(name)
  ) {
    return name.replace(/\s+/g, "");
  }
  return name;
}

function normalizeVietnamese(value) {
  return value
    .toLowerCase()
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ");
}

function similarity(left, right) {
  const a = left.replace(/\s/g, "");
  const b = right.replace(/\s/g, "");
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

export function mergeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = row.STT ? `stt:${row.STT}` : `unknown:${row.imageIndex}:${row.rowIndex}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...row, votes: [row], conflict: false });
    } else {
      byKey.get(key).votes.push(row);
    }
  }

  const merged = [...byKey.values()].map((record) => {
    const nameGroups = groupVotes(record.votes, "Tên Người Chơi");
    const classGroups = groupVotes(record.votes, "Phái");
    const nameWinner = nameGroups.sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];
    const classWinner = classGroups.sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];
    const conflict = record.STT && nameGroups.length > 1;
    const review = [...new Set(record.votes.flatMap((vote) => vote.review || []))];
    if (conflict) review.push("Tên khác nhau giữa các ảnh chụp");
    return {
      STT: record.STT,
      "Tên Người Chơi": nameWinner?.value || "",
      Phái: classWinner?.value || "",
      confidence: Math.min(
        nameWinner?.confidence ?? 0,
        classWinner?.confidence ?? 0,
      ),
      review,
      conflict,
    };
  });
  return merged.sort((a, b) => (a.STT || Number.MAX_SAFE_INTEGER) - (b.STT || Number.MAX_SAFE_INTEGER));
}

function groupVotes(votes, field) {
  const groups = new Map();
  for (const vote of votes) {
    const value = vote[field];
    if (!value) continue;
    const key = normalizeVietnamese(value).replace(/\s/g, "");
    const group = groups.get(key) || { value, count: 0, confidence: 0 };
    group.count += 1;
    group.confidence = Math.max(group.confidence, vote[`${field}Confidence`] || 0);
    if ((vote[`${field}Confidence`] || 0) > (group.bestConfidence || 0)) {
      group.value = value;
      group.bestConfidence = vote[`${field}Confidence`] || 0;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

const xmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${reference}"><v>${value}</v></c>`;
      }
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildExcel(rows, missing, conflicts, imageCount, createdAt = new Date()) {
  const review = rows.flatMap((row) => row.review.map((reason) => [
    `STT ${row.STT || "?"} - ${row["Tên Người Chơi"]}`,
    reason,
  ]));
  const checkRows = [
    ["Chỉ tiêu", "Giá trị"],
    ["Số thành viên đọc được", rows.filter((row) => row.STT).length],
    ["Số ảnh đã xử lý", imageCount],
    ["STT bị thiếu", missing.length ? missing.join(", ") : "Không thiếu"],
    ["STT trùng người", conflicts.length ? conflicts.join(", ") : "Không có"],
    ["Số ô cần xem lại", review.length],
    ["Thời điểm chạy", createdAt.toLocaleString("vi-VN")],
    [],
    ["Ô cần xem lại", "Lý do"],
    ...(review.length ? review : [["Không có ô nào cần xem lại", ""]]),
  ];
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Danh sách" sheetId="1" r:id="rId1"/><sheet name="Kiểm tra" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": worksheetXml([
      COLUMNS,
      ...rows.map((row) => [row.STT, row["Tên Người Chơi"], row.Phái]),
    ]),
    "xl/worksheets/sheet2.xml": worksheetXml(checkRows),
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
    { level: 6 },
  );
}
