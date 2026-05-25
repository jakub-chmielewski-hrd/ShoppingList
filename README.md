# Lista zakupów

Mobile-first shopping list generated from PDFs in `DietPDFs`.

## Update data

```powershell
python scripts\extract_shopping_lists.py
```

## Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173` on the computer, or `http://<your-computer-ip>:4173` from a phone on the same Wi-Fi.

## Deploy

Host this folder as a static site. Netlify, Vercel, Cloudflare Pages, and GitHub Pages all work.
