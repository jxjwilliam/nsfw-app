#!/usr/bin/env python3
"""Build a labeled contact sheet from the ckpt-showcase output folder.

Usage:
  python3 scripts/make-showcase-contact-sheet.py [output.png]

Reads outputs/images/ckpt-showcase-2026-08-30/*.png and writes a labeled
grid preview (one cell per checkpoint).
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC_DIR = Path(__file__).resolve().parent.parent / "outputs" / "images" / "ckpt-showcase-2026-08-30"
OUT_DEFAULT = Path(__file__).resolve().parent.parent / "outputs" / "images" / "ckpt-showcase-2026-08-30" / "contact-sheet.png"

COLS = 4
CELL_W = 320
CELL_H = 430
THUMB_PAD = 20
LABEL_H = 30
BG = (28, 28, 32)
FG = (230, 230, 230)


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_DEFAULT
    files = sorted(p for p in SRC_DIR.glob("*.png") if not p.name.startswith("._") and "contact-sheet" not in p.name)
    if not files:
        print(f"No images found in {SRC_DIR}")
        return 1

    rows = (len(files) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL_W, rows * CELL_H), BG)
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=22)
    except TypeError:  # older Pillow
        font = ImageFont.load_default()

    thumb_w = CELL_W - 2 * THUMB_PAD
    thumb_h = CELL_H - LABEL_H - 2 * THUMB_PAD

    for idx, path in enumerate(files):
        col = idx % COLS
        row = idx // COLS
        x0 = col * CELL_W
        y0 = row * CELL_H

        img = Image.open(path).convert("RGB")
        img.thumbnail((thumb_w, thumb_h), Image.LANCZOS)
        img_x = x0 + (CELL_W - img.width) // 2
        img_y = y0 + THUMB_PAD
        sheet.paste(img, (img_x, img_y))

        label = path.stem
        bbox = draw.textbbox((0, 0), label, font=font)
        text_w = bbox[2] - bbox[0]
        text_x = x0 + (CELL_W - text_w) // 2
        text_y = y0 + CELL_H - LABEL_H + 2
        draw.text((text_x, text_y), label, fill=FG, font=font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    print(f"Contact sheet: {out_path} ({len(files)} images, {COLS}x{rows} grid)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
