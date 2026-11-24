import importlib.util
import sys
import unittest
from pathlib import Path


OCR_PATH = Path(__file__).resolve().parents[1] / "quet_bang_hoi_claude - Android2.py"
SPEC = importlib.util.spec_from_file_location("bang_hoi_ocr_test", OCR_PATH)
OCR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OCR
SPEC.loader.exec_module(OCR)


class NameNormalizationTests(unittest.TestCase):
    def test_joins_spaced_uppercase_name(self):
        for raw in ("ETH A N", "ETHA N"):
            with self.subTest(raw=raw):
                name, notes = OCR.lam_sach_ten(raw, False)
                self.assertEqual(name, "ETHAN")
                self.assertTrue(notes)

    def test_preserves_vietnamese_name_spacing_and_accents(self):
        name, _ = OCR.lam_sach_ten("Hạ Anh", False)
        self.assertEqual(name, "Hạ Anh")

    def test_corrects_known_game_name_ocr_errors(self):
        corrections = {
            "HổngTr": "HồngTrì",
            "Tõng Vãn Khanh": "Tống Vân Khanh",
            "Hẳc Hy": "Hắc Hy",
        }
        for raw, expected in corrections.items():
            with self.subTest(raw=raw):
                self.assertEqual(OCR.sua_loi_dau_ten(raw), expected)


if __name__ == "__main__":
    unittest.main()
