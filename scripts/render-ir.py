#!/usr/bin/env python3
"""data/ir-sources.json의 IR 원문(PDF)을 받아 assets/ir/<ticker>/NN.jpg 로 렌더링하고
data/reits.json 의 irResources.viewer 를 갱신한다. (값 생성 아님 — 원문 페이지 이미지화)
사용: python3 scripts/render-ir.py
필요: pip install pymupdf ; curl
"""
import json, os, subprocess, sys
from pathlib import Path
import fitz  # pymupdf

ROOT = Path(__file__).resolve().parent.parent
SRC = json.loads((ROOT / "data" / "ir-sources.json").read_text("utf-8"))["sources"]
REITS_PATH = ROOT / "data" / "reits.json"
doc = json.loads(REITS_PATH.read_text("utf-8"))
by_ticker = {r["ticker"]: r for r in doc["reits"]}

ZOOM = 1.5          # ≈108 DPI
JPEG_QUALITY = 72

def download(url, dest):
    subprocess.run(["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "60", "-o", str(dest), url], check=True)
    if dest.stat().st_size < 1000 or b"%PDF" not in dest.read_bytes()[:1024]:
        raise RuntimeError(f"PDF 아님/다운로드 실패: {url}")

def render(entry):
    t = entry["ticker"]
    out_dir = ROOT / "assets" / "ir" / t
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.jpg"):
        old.unlink()
    pdf_path = out_dir / "_src.pdf"
    download(entry["url"], pdf_path)
    pdf = fitz.open(pdf_path)
    total = pdf.page_count
    cap = entry.get("pages") or total
    n = min(cap, total)
    images = []
    mat = fitz.Matrix(ZOOM, ZOOM)
    for i in range(n):
        pix = pdf.load_page(i).get_pixmap(matrix=mat)
        fname = f"{i+1:02d}.jpg"
        pix.pil_save(out_dir / fname, format="JPEG", quality=JPEG_QUALITY)
        images.append(f"assets/ir/{t}/{fname}")
    pdf.close()
    pdf_path.unlink()  # 원본 PDF는 저장소에 남기지 않음(용량) — 이미지+외부원본링크로 제공
    return images, total, n

for e in SRC:
    t = e["ticker"]
    if t not in by_ticker:
        print(f"  skip {t}: reits.json에 없음"); continue
    try:
        images, total, shown = render(e)
    except Exception as ex:
        print(f"  FAIL {t} {e['name']}: {ex}"); continue
    r = by_ticker[t]
    ir = r.get("irResources") or {}
    ir["viewer"] = {
        "kind": e["kind"],
        "images": images,
        "shownPages": shown,
        "totalPages": total,
        "pdfUrl": e["url"],
    }
    r["irResources"] = ir
    print(f"  OK   {t} {e['name']}: {shown}/{total}p → {len(images)} img")

REITS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", "utf-8")
print("data/reits.json irResources.viewer 갱신 완료")
