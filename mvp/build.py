"""Builds the single-file MVP page (mvp/asistente-de-proyectos.html).

Inlines the Lukkap logo as a data URI and the sample transcript as JSON,
because an artifact page cannot load local files.

Usage: python3 mvp/build.py
"""

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "mvp" / "app.src.html"
OUT = ROOT / "mvp" / "asistente-de-proyectos.html"
LOGO = ROOT / "design" / "logos" / "lukkap-logo-claim-color.png"
SAMPLE = ROOT / "samples" / "transcript-ejemplo-brisa-del-sur.txt"

logo_uri = "data:image/png;base64," + base64.b64encode(LOGO.read_bytes()).decode()
sample_json = json.dumps(
    {"fileName": SAMPLE.name, "text": SAMPLE.read_text(encoding="utf-8")},
    ensure_ascii=False,
).replace("<", "\\u003c")  # keep "</script>" out of the inline JSON

html = SRC.read_text(encoding="utf-8")
html = html.replace("__LOGO_DATA_URI__", logo_uri).replace("__SAMPLE_TRANSCRIPT_JSON__", sample_json)
OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
