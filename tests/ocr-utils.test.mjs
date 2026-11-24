import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildExcel,
  detectRows,
  mergeRows,
  normalizeClass,
  normalizeName,
} from "../public/static/ocr-utils.js";

test("normalizes Vietnamese class names without dropping accents", () => {
  assert.equal(normalizeClass("Huyen Co"), "Huyền Cơ");
  assert.equal(normalizeClass("Toai Mong"), "Toái Mộng");
});

test("repairs spaced uppercase and recurring Vietnamese OCR errors", () => {
  assert.equal(normalizeName("ETHA N"), "ETHAN");
  assert.equal(normalizeName("Tõng Vãn Khanh"), "Tống Vân Khanh");
  assert.equal(normalizeName("HổngTr"), "HồngTrì");
});

test("detects complete rows from bright pixels in fixed table columns", () => {
  const width = 1708;
  const height = 768;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  for (const center of [220, 276]) {
    for (const [left, right] of [[835, 915], [950, 1095], [1120, 1250], [1290, 1430], [1460, 1650]]) {
      for (let y = center - 12; y <= center + 12; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = 240;
          data[offset + 1] = 240;
          data[offset + 2] = 240;
        }
      }
    }
  }
  assert.deepEqual(detectRows({ data }, width, height), [220, 276]);
});

test("merges overlapping screenshots by STT and flags conflicting names", () => {
  const rows = mergeRows([
    { STT: 3, "Tên Người Chơi": "HồngTrì", Phái: "Huyền Cơ", "Tên Người ChơiConfidence": 80, "PháiConfidence": 80, review: [], imageIndex: 0, rowIndex: 1 },
    { STT: 3, "Tên Người Chơi": "HongTri", Phái: "Huyen Co", "Tên Người ChơiConfidence": 90, "PháiConfidence": 85, review: [], imageIndex: 1, rowIndex: 0 },
    { STT: 4, "Tên Người Chơi": "Tên khác", Phái: "Tố Vấn", "Tên Người ChơiConfidence": 75, "PháiConfidence": 80, review: [], imageIndex: 1, rowIndex: 1 },
    { STT: 4, "Tên Người Chơi": "Người khác", Phái: "Tố Vấn", "Tên Người ChơiConfidence": 82, "PháiConfidence": 80, review: [], imageIndex: 2, rowIndex: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Tên Người Chơi"], "HongTri");
  assert.equal(rows[0].Phái, "Huyen Co");
  assert.equal(rows[1].conflict, true);
});

test("exports an xlsx with both expected sheets and Vietnamese text", () => {
  const rows = [{
    STT: 1,
    "Tên Người Chơi": "HồngTrì",
    Phái: "Huyền Cơ",
    review: [],
  }];
  const archive = unzipSync(buildExcel(rows, [], [], 1, new Date("2026-01-01T00:00:00Z")));
  const workbook = new TextDecoder().decode(archive["xl/workbook.xml"]);
  const sheet = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
  assert.match(workbook, /Danh sách/);
  assert.match(workbook, /Kiểm tra/);
  assert.match(sheet, /HồngTrì/);
});
