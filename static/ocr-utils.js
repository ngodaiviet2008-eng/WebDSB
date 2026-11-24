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

export function prepareCell(source, width, height, sx, sy, centerY, column, threshold = 170, wide = false) {
  const [refLeft, refRight] = column === "STT" && wide
    ? [248, 322]
    : CELL_COLUMNS[column];
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
  let otsuThreshold = 0;
  if (column === "STT") {
    let totalBrightness = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      totalBrightness += value * histogram[value];
    }
    let backgroundWeight = 0;
    let backgroundBrightness = 0;
    let maxVariance = -1;
    for (let value = 0; value < histogram.length; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = gray.length - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundBrightness += value * histogram[value];
      const backgroundMean = backgroundBrightness / backgroundWeight;
      const foregroundMean = (totalBrightness - backgroundBrightness) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight
        * (backgroundMean - foregroundMean) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        otsuThreshold = value;
      }
    }
  }
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
    const value = column === "STT"
      ? (gray[i] > otsuThreshold ? 0 : 255)
      : 255 - Math.max(0, Math.min(255, Math.round(((gray[i] - low) / range) * 255)));
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
    ethan: "E T H A N",
    hongtri: "HồngTrì",
    hongtr: "HồngTrì",
    bongtrung: "Đông Trùng",
    tongvankhanh: "Tống Vân Khanh",
    hachy: "Hắc Hy",
    hancuacua: "Hàn Cua Cua",
    lambucbao: "LâmĐứcBảo",
    qviet83t: "Qviet83",
    qwiet83t: "Qviet83",
    vekienduc: "VệKiệnĐức",
    vekienbuc: "VệKiệnĐức",
    vegiangamcanh: "VệGiàNgắmCảnh",
    thanhduong: "ThanhĐường",
    lamducbao: "LâmĐứcBảo",
    lamduucbao: "LâmĐứcBảo",
    zogemzuogsinh: "ZôGêmZươngSinh",
    duhinhangia: "du hí nhân gia",
    chammien: "Chẩm Miên",
    hopdoa123: "HợpĐoa123",
    hopboal23: "HợpĐoa123",
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
  const preparedRows = recoverSequentialStt(rows);
  recoverOverlappingStt(preparedRows);
  const records = [];
  for (const row of preparedRows) {
    const matches = row.STT == null ? [] : records.filter((record) => (
      record.STT === row.STT
      && record.votes.some((vote) => sameMember(vote, row))
    ));
    if (matches.length === 1) matches[0].votes.push(row);
    else records.push({ ...row, votes: [row], duplicateStt: false });
  }

  const recordsByStt = new Map();
  for (const record of records) {
    if (record.STT == null) continue;
    recordsByStt.set(record.STT, (recordsByStt.get(record.STT) || 0) + 1);
  }
  for (const record of records) {
    if (record.STT != null && recordsByStt.get(record.STT) > 1) {
      record.duplicateStt = true;
    }
  }

  const merged = records.map((record) => {
    const nameGroups = groupVotes(record.votes, "Tên Người Chơi");
    const classGroups = groupVotes(record.votes, "Phái");
    const nameWinner = nameGroups.sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];
    const classWinner = classGroups.sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];
    const nameConflict = Boolean(record.STT && nameGroups.length > 1);
    const conflict = Boolean(record.duplicateStt || nameConflict);
    const review = [];
    if (!record.STT) review.push("Không đọc được STT");
    if (!nameWinner?.value) {
      review.push("Không đọc được tên");
    } else if (nameWinner.confidence > 0 && nameWinner.confidence < 45) {
      review.push(`Độ tin cậy tên thấp (${Math.round(nameWinner.confidence)}%)`);
    }
    if (!classWinner?.value) {
      review.push("Không đọc được phái");
    } else if (classWinner.confidence > 0 && classWinner.confidence < 45) {
      review.push(`Độ tin cậy phái thấp (${Math.round(classWinner.confidence)}%)`);
    }
    if (nameConflict) review.push("Tên khác nhau giữa các ảnh chụp");
    if (record.duplicateStt) review.push("STT trùng với thành viên khác");
    if (record.STT && classGroups.length > 1) review.push("Phái khác nhau giữa các ảnh chụp");
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
  recoverSingleMissingStt(merged);
  return merged.sort((a, b) => (a.STT || Number.MAX_SAFE_INTEGER) - (b.STT || Number.MAX_SAFE_INTEGER));
}

function recoverSingleMissingStt(rows) {
  const unknownRows = rows.filter((row) => row.STT == null);
  if (unknownRows.length !== 1 || !unknownRows[0]["Tên Người Chơi"] || !unknownRows[0].Phái) return;

  const known = rows.filter((row) => row.STT != null);
  const counts = new Map();
  for (const row of known) counts.set(row.STT, (counts.get(row.STT) || 0) + 1);
  if ([...counts.values()].some((count) => count > 1)) return;

  const max = Math.max(0, ...counts.keys());
  if (!max || rows.length !== max) return;
  const present = new Set(counts.keys());
  const missing = Array.from({ length: max }, (_, index) => index + 1)
    .filter((number) => !present.has(number));
  if (missing.length !== 1) return;

  unknownRows[0].STT = missing[0];
  unknownRows[0].review = unknownRows[0].review
    .filter((reason) => reason !== "Không đọc được STT");
}

function sameMember(left, right) {
  const leftName = normalizeVietnamese(left["Tên Người Chơi"] || "").replace(/\s/g, "");
  const rightName = normalizeVietnamese(right["Tên Người Chơi"] || "").replace(/\s/g, "");
  if (!leftName || !rightName) return false;
  if (leftName === rightName) return true;
  const leftClass = normalizeVietnamese(left.Phái || "").replace(/\s/g, "");
  const rightClass = normalizeVietnamese(right.Phái || "").replace(/\s/g, "");
  return leftClass && leftClass === rightClass && similarity(leftName, rightName) >= 0.9;
}

function recoverSequentialStt(rows) {
  const prepared = rows.map((row) => ({ ...row, review: [...(row.review || [])] }));
  const byImage = new Map();
  for (const row of prepared) {
    if (row.imageIndex == null || row.rowIndex == null) continue;
    const imageRows = byImage.get(row.imageIndex) || [];
    imageRows.push(row);
    byImage.set(row.imageIndex, imageRows);
  }

  for (const imageRows of byImage.values()) {
    imageRows.sort((a, b) => a.rowIndex - b.rowIndex);
    for (let index = 1; index < imageRows.length - 1; index += 1) {
      const previous = imageRows[index - 1];
      const current = imageRows[index];
      const next = imageRows[index + 1];
      if (
        previous.STT != null
        && next.STT === previous.STT + 2
        && current.STT !== previous.STT + 1
      ) {
        current.STT = previous.STT + 1;
        current.review = current.review.filter((reason) => reason !== "Không đọc được STT");
      }
    }

    for (let start = 0; start < imageRows.length;) {
      if (imageRows[start].STT != null) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < imageRows.length && imageRows[end].STT == null) end += 1;
      const previous = imageRows[start - 1];
      const next = imageRows[end];
      if (
        previous?.STT != null
        && next?.STT != null
        && next.STT > previous.STT
        && next.STT - previous.STT === next.rowIndex - previous.rowIndex
      ) {
        for (let index = start; index < end; index += 1) {
          imageRows[index].STT = previous.STT + imageRows[index].rowIndex - previous.rowIndex;
          imageRows[index].review = imageRows[index].review
            .filter((reason) => reason !== "Không đọc được STT");
        }
      }
      start = end;
    }

    for (let start = 0; start < imageRows.length;) {
      if (imageRows[start].STT != null) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < imageRows.length && imageRows[end].STT == null) end += 1;
      const previous = imageRows[start - 1];
      const next = imageRows[end];
      let runEnd = end;
      while (
        runEnd + 1 < imageRows.length
        && imageRows[runEnd + 1].STT === imageRows[runEnd].STT + 1
      ) {
        runEnd += 1;
      }
      if (
        next?.STT != null
        && runEnd - end >= 2
        && (previous?.STT == null || previous.STT > next.STT)
        && next.STT - (end - start) === 1
      ) {
        for (let index = start; index < end; index += 1) {
          imageRows[index].STT = index - start + 1;
          imageRows[index].review = imageRows[index].review
            .filter((reason) => reason !== "Không đọc được STT");
        }
      }
      start = end;
    }

    let trailingStart = imageRows.length;
    while (trailingStart > 0 && imageRows[trailingStart - 1].STT == null) trailingStart -= 1;
    if (trailingStart < imageRows.length && trailingStart > 0) {
      let runStart = trailingStart - 1;
      while (
        runStart > 0
        && imageRows[runStart - 1].STT === imageRows[runStart].STT - 1
      ) {
        runStart -= 1;
      }
      if (trailingStart - runStart >= 3) {
        for (let index = trailingStart; index < imageRows.length; index += 1) {
          imageRows[index].STT = imageRows[index - 1].STT + 1;
          imageRows[index].review = imageRows[index].review
            .filter((reason) => reason !== "Không đọc được STT");
        }
      }
    }
  }
  recoverImageSequenceStt(prepared);
  return prepared;
}

function recoverImageSequenceStt(rows) {
  const byImage = new Map();
  for (const row of rows) {
    if (row.imageIndex == null || row.rowIndex == null || !Number.isFinite(row.centerY)) continue;
    const imageRows = byImage.get(row.imageIndex) || [];
    imageRows.push(row);
    byImage.set(row.imageIndex, imageRows);
  }

  for (const imageRows of byImage.values()) {
    if (imageRows.length < 3) continue;
    imageRows.sort((a, b) => a.rowIndex - b.rowIndex);
    const spacings = imageRows.slice(1)
      .map((row, index) => row.centerY - imageRows[index].centerY)
      .filter((spacing) => spacing > 0)
      .sort((a, b) => a - b);
    if (!spacings.length) continue;
    const typicalSpacing = spacings[Math.floor(spacings.length / 2)];
    const segments = [[]];
    for (let index = 0; index < imageRows.length; index += 1) {
      if (
        index
        && imageRows[index].centerY - imageRows[index - 1].centerY > typicalSpacing * 1.5
      ) {
        segments.push([]);
      }
      segments[segments.length - 1].push(imageRows[index]);
    }

    for (const segment of segments) {
      const offsets = new Map();
      for (const row of segment) {
        if (row.STT == null) continue;
        const offset = row.STT - row.rowIndex;
        offsets.set(offset, (offsets.get(offset) || 0) + 1);
      }
      const [offset, count] = [...offsets.entries()]
        .sort((left, right) => right[1] - left[1])[0] || [];
      const knownCount = [...offsets.values()].reduce((sum, value) => sum + value, 0);
      if (!Number.isInteger(offset) || count < 3 || count / knownCount < 0.75) continue;

      for (const row of segment) {
        const expected = offset + row.rowIndex;
        if (expected <= 0 || expected > 999 || row.STT === expected) continue;
        row.STT = expected;
        row.review = row.review.filter((reason) => reason !== "Không đọc được STT");
      }
    }
  }
}

function recoverOverlappingStt(rows) {
  const knownRows = rows.filter((row) => row.STT != null && row["Tên Người Chơi"] && row.Phái);
  for (const row of rows) {
    if (row.STT != null || !row["Tên Người Chơi"] || !row.Phái) continue;
    const nameKey = normalizeVietnamese(row["Tên Người Chơi"]).replace(/\s/g, "");
    const classKey = normalizeVietnamese(row.Phái).replace(/\s/g, "");
    const matches = new Map();
    for (const candidate of knownRows) {
      if (candidate.imageIndex === row.imageIndex) continue;
      if (normalizeVietnamese(candidate.Phái).replace(/\s/g, "") !== classKey) continue;
      const candidateName = normalizeVietnamese(candidate["Tên Người Chơi"]).replace(/\s/g, "");
      const score = similarity(nameKey, candidateName);
      if (score < 0.9) continue;
      matches.set(candidate.STT, Math.max(matches.get(candidate.STT) || 0, score));
    }
    const ranked = [...matches.entries()].sort((a, b) => b[1] - a[1]);
    if (
      ranked.length
      && (ranked.length === 1 || ranked[0][1] - ranked[1][1] >= 0.08)
    ) {
      row.STT = ranked[0][0];
      row.review = row.review.filter((reason) => reason !== "Không đọc được STT");
    }
  }
}

function groupVotes(votes, field) {
  const groups = new Map();
  for (const vote of votes) {
    const value = vote[field];
    if (!value) continue;
    const key = normalizeVietnamese(value).replace(/\s/g, "");
    const confidence = vote[`${field}Confidence`] || 0;
    const group = groups.get(key) || { value, count: 0, confidence: 0, confidenceTotal: 0 };
    group.count += 1;
    group.confidenceTotal += confidence;
    group.confidence = group.confidenceTotal / group.count;
    if (confidence > (group.bestConfidence || 0)) {
      group.value = value;
      group.bestConfidence = confidence;
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

const workbookStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><color rgb="FF1E293B"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FF263654"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF263654"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F6FC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function worksheetXml(rows, options = {}) {
  const headerRows = new Set(options.headerRows || []);
  const labelColumnRows = new Set(options.labelColumnRows || []);
  const columns = (options.widths || []).map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join("");
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = headerRows.has(rowIndex)
        ? 1
        : labelColumnRows.has(rowIndex) && columnIndex === 0
          ? 4
          : rowIndex % 2 ? 3 : 2;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
      }
      return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    const height = headerRows.has(rowIndex) ? 26 : 22;
    return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join("");
  const freeze = options.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${options.freezeRows}" topLeftCell="A${options.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${options.freezeRows + 1}" sqref="A${options.freezeRows + 1}"/></sheetView></sheetViews>`
    : "";
  const filters = options.autoFilterRef
    ? `<autoFilter ref="${options.autoFilterRef}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetFormatPr defaultRowHeight="22"/>${columns ? `<cols>${columns}</cols>` : ""}<sheetData>${body}</sheetData>${filters}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
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
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Danh sách" sheetId="1" r:id="rId1"/><sheet name="Kiểm tra" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": workbookStyles,
    "xl/worksheets/sheet1.xml": worksheetXml([
      COLUMNS,
      ...rows.map((row) => [row.STT, row["Tên Người Chơi"], row.Phái]),
    ], {
      widths: [9, 32, 22],
      headerRows: [0],
      freezeRows: 1,
      autoFilterRef: `A1:C${rows.length + 1}`,
    }),
    "xl/worksheets/sheet2.xml": worksheetXml(checkRows, {
      widths: [34, 64],
      headerRows: [0, 8],
      labelColumnRows: [1, 2, 3, 4, 5, 6],
      autoFilterRef: `A9:B${checkRows.length}`,
    }),
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
    { level: 6 },
  );
}
