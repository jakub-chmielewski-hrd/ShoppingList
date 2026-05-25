from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "DietPDFs"
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "shopping-lists.json"

CATEGORIES = {
    "Pieczywo",
    "Zbożowe",
    "Nabiał",
    "Tłuszcze",
    "Owoce i warzywa",
    "Zioła i przyprawy",
    "Strączkowe",
    "Mięso",
    "Orzechy i nasiona",
    "Pozostałe",
}

NOISE_PREFIXES = (
    "Wartość odżywcza produktów",
    "rozszerzone i uaktualnione",
    "Instytutu Żywienia",
    "Narodowego Instytutu",
)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def normalize_spaces(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    replacements = {
        "T ortilla": "Tortilla",
        "T ofu": "Tofu",
        "T abele": "Tabele",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return value


def looks_complete_item(value: str) -> bool:
    return bool(re.search(r"\d+(?:,\d+)?\s*g$", value))


def split_item(value: str) -> dict[str, str]:
    value = normalize_spaces(value)
    match = re.match(
        r"^(?P<name>.*?)(?P<quantity>\d+(?:,\d+)?\s*x\s*.+?\s+\d+(?:,\d+)?g|\d+(?:,\d+)?g)$",
        value,
    )
    if not match:
        return {"name": value, "quantity": ""}

    name = normalize_spaces(match.group("name"))
    quantity = normalize_spaces(match.group("quantity"))
    return {"name": name, "quantity": quantity}


def extract_pdf(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    start = text.find("LISTA ZAKUP")
    end = text.find("ZALECENIA", start)
    if start == -1 or end == -1:
        raise ValueError(f"Could not find shopping list section in {pdf_path.name}")

    lines = [
        normalize_spaces(line)
        for line in text[start:end].splitlines()
        if normalize_spaces(line)
    ]

    current_category: dict | None = None
    categories: list[dict] = []
    pending: list[str] = []

    def flush_pending() -> None:
        nonlocal pending
        if current_category and pending:
            raw = normalize_spaces(" ".join(pending))
            if raw:
                item = split_item(raw)
                item["id"] = slugify(f"{current_category['name']}-{raw}")[:80]
                current_category["items"].append(item)
        pending = []

    for line in lines:
        if line.startswith("LISTA ZAKUP"):
            continue
        if line in CATEGORIES:
            flush_pending()
            current_category = {"name": line, "items": []}
            categories.append(current_category)
            continue
        if not current_category:
            continue
        if "Soczewica czerwona" in line and not line.startswith("Soczewica czerwona"):
            line = line[line.find("Soczewica czerwona") :]
        if line.startswith(NOISE_PREFIXES) or "Instytutu Zdrowia Publicznego" in line:
            continue

        pending.append(line)
        if looks_complete_item(line):
            flush_pending()

    flush_pending()

    return {
        "id": slugify(pdf_path.stem),
        "title": pdf_path.stem,
        "source": str(pdf_path.relative_to(ROOT)).replace("\\", "/"),
        "categories": categories,
    }


def main() -> None:
    lists = [extract_pdf(path) for path in sorted(PDF_DIR.glob("*.pdf"))]
    DATA_DIR.mkdir(exist_ok=True)
    OUT_FILE.write_text(
        json.dumps({"lists": lists}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    total = sum(
        len(category["items"])
        for shopping_list in lists
        for category in shopping_list["categories"]
    )
    print(f"Wrote {OUT_FILE.relative_to(ROOT)} with {len(lists)} list(s), {total} item(s).")


if __name__ == "__main__":
    main()
