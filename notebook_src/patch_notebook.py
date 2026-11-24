import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NB = ROOT / "ar_vr_environment_kaggle.ipynb"
cells_dir = ROOT / "notebook_src" / "cells"

nb = json.loads(NB.read_text())

replacements = {
    0: ("cell0.md", "markdown"),
    13: ("cell13.md", "markdown"),
    14: ("cell14.py", "code"),
    16: ("cell16.py", "code"),
    18: ("cell18.py", "code"),
    22: ("cell22.py", "code"),
}

for index, (name, kind) in replacements.items():
    src = (cells_dir / name).read_text().rstrip("\n")
    assert nb["cells"][index]["cell_type"] == kind, (index, nb["cells"][index]["cell_type"])
    nb["cells"][index]["source"] = src.splitlines(keepends=True)

NB.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n")
print("patched", NB)
