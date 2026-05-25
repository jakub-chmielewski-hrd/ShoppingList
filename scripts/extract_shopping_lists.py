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

DAYS = (
    "Poniedziałek",
    "Wtorek",
    "Środa",
    "Czwartek",
    "Piątek",
    "Sobota",
    "Niedziela",
)

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


def normalize_key(value: str) -> str:
    value = normalize_spaces(value).lower()
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", value)


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


def extract_shopping_categories(text: str) -> list[dict]:
    start = text.find("LISTA ZAKUP")
    end = text.find("ZALECENIA", start)
    if start == -1 or end == -1:
        raise ValueError("Could not find shopping list section")

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
    return categories


def master_lookup(categories: list[dict]) -> dict[str, dict]:
    lookup = {}
    for category in categories:
        for item in category["items"]:
            key = normalize_key(item["name"])
            lookup[key] = {"category": category["name"], **item}
    return lookup


def possible_product_start(line: str, product_keys: set[str]) -> bool:
    candidate = normalize_key(split_item(line)["name"])
    if len(candidate) < 3:
        return False
    return any(key.startswith(candidate) or candidate.startswith(key) for key in product_keys)


def match_master_item(item_name: str, lookup: dict[str, dict]) -> dict | None:
    key = normalize_key(item_name)
    if key in lookup:
        return lookup[key]
    matches = [
        value
        for master_key, value in lookup.items()
        if master_key.startswith(key) or key.startswith(master_key)
    ]
    if not matches:
        return None
    return max(matches, key=lambda item: len(normalize_key(item["name"])))


def extract_grams(quantity: str) -> int | None:
    match = re.search(r"(\d+(?:,\d+)?)\s*g$", quantity)
    if not match:
        return None
    return round(float(match.group(1).replace(",", ".")))


def extract_day_sections(text: str) -> list[tuple[str, str]]:
    pattern = re.compile(r"ROZPISKA DNI\s+(" + "|".join(DAYS) + r")\b")
    matches = list(pattern.finditer(text))
    sections = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections.append((match.group(1), text[start:end]))
    return sections


def extract_days(text: str, categories: list[dict]) -> list[dict]:
    lookup = master_lookup(categories)
    product_keys = set(lookup)
    days = []

    for day_name, section in extract_day_sections(text):
        ingredients = {}
        pending: list[str] = []

        def flush_pending() -> None:
            nonlocal pending
            if not pending:
                return
            raw = normalize_spaces(" ".join(pending))
            pending = []
            item = split_item(raw)
            master = match_master_item(item["name"], lookup)
            if not master:
                return

            key = normalize_key(master["name"])
            grams = extract_grams(item["quantity"])
            current = ingredients.setdefault(
                key,
                {
                    "id": master["id"],
                    "name": master["name"],
                    "category": master["category"],
                    "grams": 0,
                    "parts": [],
                },
            )
            if grams is not None:
                current["grams"] += grams
            current["parts"].append(item["quantity"])

        for raw_line in section.splitlines():
            line = normalize_spaces(raw_line)
            if not line:
                continue
            if pending:
                pending.append(line)
                if looks_complete_item(line):
                    flush_pending()
                continue
            if possible_product_start(line, product_keys):
                pending.append(line)
                if looks_complete_item(line):
                    flush_pending()

        flush_pending()
        day_items = []
        for item in ingredients.values():
            quantity = f"{item['grams']}g" if item["grams"] else ", ".join(item["parts"])
            day_items.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "category": item["category"],
                    "quantity": quantity,
                }
            )
        days.append({"name": day_name, "items": day_items})

    return days


def extract_pdf(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    categories = extract_shopping_categories(text)

    return {
        "id": slugify(pdf_path.stem),
        "title": pdf_path.stem,
        "source": str(pdf_path.relative_to(ROOT)).replace("\\", "/"),
        "categories": categories,
        "days": extract_days(text, categories),
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
