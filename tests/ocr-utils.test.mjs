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
  assert.equal(normalizeName("ETHA N"), "E T H A N");
  assert.equal(normalizeName("E T H A N"), "E T H A N");
  assert.equal(normalizeName("ETHAN"), "E T H A N");
  assert.equal(normalizeName("Tõng Vãn Khanh"), "Tống Vân Khanh");
  assert.equal(normalizeName("HổngTr"), "HồngTrì");
  assert.equal(normalizeName("Bong Trùng"), "Đông Trùng");
  assert.equal(normalizeName("HopBoal 23"), "HợpĐoa123");
  assert.equal(normalizeName("VệKiênBúc"), "VệKiệnĐức");
  assert.equal(normalizeName("Qwiet83 t"), "Qviet83");
  assert.equal(normalizeName("Qviet83 t"), "Qviet83");
  assert.equal(normalizeName("LâmĐúứcBảo"), "LâmĐứcBảo");
  assert.equal(normalizeName("LâmBúcBảo"), "LâmĐứcBảo");
  assert.equal(normalizeName("ZôGêmZuõøgSinh"), "ZôGêmZươngSinh");
  assert.equal(normalizeName("VềGiàNgắmCảnh"), "VệGiàNgắmCảnh");
  assert.equal(normalizeName("Hàn Cưa Cưa"), "Hàn Cua Cua");
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

test("merges matching members but preserves different members with a repeated STT", () => {
  const rows = mergeRows([
    { STT: 3, "Tên Người Chơi": "HồngTrì", Phái: "Huyền Cơ", "Tên Người ChơiConfidence": 80, "PháiConfidence": 80, review: [], imageIndex: 0, rowIndex: 1 },
    { STT: 3, "Tên Người Chơi": "HongTri", Phái: "Huyen Co", "Tên Người ChơiConfidence": 90, "PháiConfidence": 85, review: [], imageIndex: 1, rowIndex: 0 },
    { STT: 4, "Tên Người Chơi": "Tên khác", Phái: "Tố Vấn", "Tên Người ChơiConfidence": 75, "PháiConfidence": 80, review: [], imageIndex: 1, rowIndex: 1 },
    { STT: 4, "Tên Người Chơi": "Người khác", Phái: "Tố Vấn", "Tên Người ChơiConfidence": 82, "PháiConfidence": 80, review: [], imageIndex: 2, rowIndex: 0 },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]["Tên Người Chơi"], "HongTri");
  assert.equal(rows[0].Phái, "Huyen Co");
  assert.deepEqual(rows.slice(1).map((row) => row.STT), [4, 4]);
  assert.ok(rows.slice(1).every((row) => row.conflict));
  assert.ok(rows.slice(1).every((row) => row.review.includes("STT trùng với thành viên khác")));
});

test("recovers a missing STT only when neighboring rows prove the sequence", () => {
  const rows = mergeRows([
    { STT: 10, "Tên Người Chơi": "A", Phái: "Huyền Cơ", imageIndex: 0, rowIndex: 0 },
    { STT: null, "Tên Người Chơi": "B", Phái: "Tố Vấn", imageIndex: 0, rowIndex: 1 },
    { STT: 12, "Tên Người Chơi": "C", Phái: "Thiết Y", imageIndex: 0, rowIndex: 2 },
    { STT: 20, "Tên Người Chơi": "D", Phái: "Long Ngâm", imageIndex: 1, rowIndex: 0 },
    { STT: null, "Tên Người Chơi": "E", Phái: "Cửu Linh", imageIndex: 1, rowIndex: 1 },
    { STT: 23, "Tên Người Chơi": "F", Phái: "Toái Mộng", imageIndex: 1, rowIndex: 2 },
  ]);
  assert.deepEqual(rows.map((row) => row.STT), [10, 11, 12, 20, 23, null]);
});

test("repairs edge and outlier STTs when surrounding rows establish the sequence", () => {
  const rows = mergeRows([
    { STT: 13, "Tên Người Chơi": "Selected", Phái: "Huyền Cơ", imageIndex: 0, rowIndex: 0 },
    { STT: null, "Tên Người Chơi": "First", Phái: "Tố Vấn", imageIndex: 0, rowIndex: 1 },
    ...[2, 3, 4, 5, 6].map((STT, index) => ({
      STT,
      "Tên Người Chơi": `Member${STT}`,
      Phái: "Long Ngâm",
      imageIndex: 0,
      rowIndex: index + 2,
    })),
    { STT: null, "Tên Người Chơi": "Last", Phái: "Cửu Linh", imageIndex: 0, rowIndex: 7 },
    { STT: 47, "Tên Người Chơi": "Member47", Phái: "Thiết Y", imageIndex: 1, rowIndex: 0 },
    { STT: 46, "Tên Người Chơi": "Member48", Phái: "Thiết Y", imageIndex: 1, rowIndex: 1 },
    { STT: 49, "Tên Người Chơi": "Member49", Phái: "Thiết Y", imageIndex: 1, rowIndex: 2 },
  ]);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "First").STT, 1);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "Last").STT, 7);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "Member48").STT, 48);
});

test("repairs OCR outliers and blank STTs from a strongly supported image sequence", () => {
  const rows = mergeRows([
    ...[25, 26, 27, 28, 29, 20, 3, 32, 33, 34].map((STT, rowIndex) => ({
      STT,
      "Tên Người Chơi": `MemberA${rowIndex}`,
      Phái: "Long Ngâm",
      imageIndex: 0,
      rowIndex,
      centerY: 200 + rowIndex * 56,
    })),
    ...[5, 6, null, 8, 9].map((STT, rowIndex) => ({
      STT,
      "Tên Người Chơi": `MemberB${rowIndex}`,
      Phái: "Tố Vấn",
      imageIndex: 1,
      rowIndex,
      centerY: 200 + rowIndex * 56,
    })),
  ]);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "MemberA5").STT, 30);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "MemberA6").STT, 31);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "MemberB2").STT, 7);
});

test("does not infer STTs from weak image-sequence evidence", () => {
  const rows = mergeRows([
    ...[5, 20, 9, 10, 11].map((STT, rowIndex) => ({
      STT,
      "Tên Người Chơi": `Member${rowIndex}`,
      Phái: "Long Ngâm",
      imageIndex: 0,
      rowIndex,
      centerY: 200 + rowIndex * 56,
    })),
  ]);
  assert.equal(rows.find((row) => row["Tên Người Chơi"] === "Member1").STT, 20);
});

test("fills the sole missing STT only for a complete, duplicate-free list", () => {
  const rows = mergeRows(Array.from({ length: 54 }, (_, index) => {
    const STT = index + 1;
    return {
      STT: STT === 8 ? null : STT,
      "Tên Người Chơi": STT === 8 ? "Di Nguyệt Hoa" : `Member${STT}`,
      Phái: "Huyền Cơ",
      review: STT === 8 ? ["Không đọc được STT"] : [],
    };
  }));
  assert.equal(rows.length, 54);
  assert.deepEqual(rows.map((row) => row.STT), Array.from({ length: 54 }, (_, index) => index + 1));
  assert.equal(rows[7]["Tên Người Chơi"], "Di Nguyệt Hoa");
  assert.deepEqual(rows[7].review, []);

  const ambiguous = mergeRows([
    { STT: 1, "Tên Người Chơi": "A", Phái: "Huyền Cơ" },
    { STT: 2, "Tên Người Chơi": "B", Phái: "Tố Vấn" },
    { STT: 2, "Tên Người Chơi": "C", Phái: "Thiết Y" },
    { STT: null, "Tên Người Chơi": "D", Phái: "Long Ngâm" },
  ]);
  assert.equal(ambiguous.find((row) => row["Tên Người Chơi"] === "D").STT, null);
});

test("uses a matching name and class from an overlapping image to recover STT", () => {
  const rows = mergeRows([
    { STT: 7, "Tên Người Chơi": "Qviet83", Phái: "Long Ngâm", "Tên Người ChơiConfidence": 90, "PháiConfidence": 90, imageIndex: 0, rowIndex: 0 },
    { STT: null, "Tên Người Chơi": "Qviet83", Phái: "Long Ngâm", "Tên Người ChơiConfidence": 75, "PháiConfidence": 90, imageIndex: 1, rowIndex: 0 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].STT, 7);
});

test("flags class disagreements without keeping stale low-confidence warnings", () => {
  const rows = mergeRows([
    { STT: 3, "Tên Người Chơi": "Người Chơi", Phái: "Huyền Cơ", "Tên Người ChơiConfidence": 90, "PháiConfidence": 90, review: [], imageIndex: 0, rowIndex: 0 },
    { STT: 3, "Tên Người Chơi": "Người Chơi", Phái: "Huyen Co", "Tên Người ChơiConfidence": 85, "PháiConfidence": 40, review: ["Độ tin cậy phái thấp (40%)"], imageIndex: 1, rowIndex: 0 },
    { STT: 3, "Tên Người Chơi": "Người Chơi", Phái: "Thiết Y", "Tên Người ChơiConfidence": 90, "PháiConfidence": 65, review: [], imageIndex: 2, rowIndex: 0 },
  ]);
  assert.equal(rows[0].Phái, "Huyền Cơ");
  assert.equal(rows[0].conflict, false);
  assert.deepEqual(rows[0].review, ["Phái khác nhau giữa các ảnh chụp"]);
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
  const styles = new TextDecoder().decode(archive["xl/styles.xml"]);
  const relationships = new TextDecoder().decode(archive["xl/_rels/workbook.xml.rels"]);
  assert.match(workbook, /Danh sách/);
  assert.match(workbook, /Kiểm tra/);
  assert.match(sheet, /HồngTrì/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2"/);
  assert.match(sheet, /<autoFilter ref="A1:C2"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="32"/);
  assert.match(styles, /FF263654/);
  assert.match(relationships, /relationships\/styles/);
});
