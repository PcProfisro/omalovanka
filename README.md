# Maľovanky – Jar 🌸

Interaktívna omaľovánka pre deti s jarnými motívmi — súčasť ekosystému **eduAlf**.

## Funkcie

- 🎨 Galéria omaľovánok načítaných z GitHub repozitára
- 🪣 Vedierko (výplň regiónu), 🖌️ štetec (voľné kreslenie), 🧹 guma
- 3 hrúbky štetca
- 30 farieb na výber
- Späť (Ctrl+Z), vymazať všetko
- Uložiť ako PNG (s logom Alfíka)
- Tlačiť (s logom Alfíka)
- Zvukové efekty
- Automatické ukladanie pokroku (localStorage)
- Responzívny dizajn (desktop + mobil)
- Vlastné SVG kurzory (vedierko / štetec / guma)

## Štruktúra

```
coloring-app/
├── index.html              ← SPA entry point
├── style.css               ← štýly (eduAlf design system)
├── app.js                  ← logika aplikácie (vanilla JS)
├── drive-sources.json      ← voliteľný fallback pre Drive súbory
├── svgs/                   ← lokálne SVG zálohy (8 omaľovánok)
├── assets/
│   ├── logo-edualf-light.svg
│   ├── logo-edualf-dark.svg
│   └── icon_app_alfik.svg
└── audio/
    ├── fill.mp3
    ├── undo.mp3
    ├── clearall.mp3
    └── click.mp3
```

## Nasadenie na GitHub Pages

1. Pushni repozitár na GitHub
2. **Settings → Pages → Source:** `main` branch, `/ (root)`
3. URL: `https://yourusername.github.io/repo-name/coloring-app/`

## Konfigurácia SVG zdroja

V `app.js` nastav GitHub repozitár s SVG súbormi:

```js
const GITHUB_SVG_SOURCE = 'https://api.github.com/repos/PcProfisro/moje-omalovanky/contents/';
```

SVG súbory musia byť vo verejnom repozitári. App automaticky:
- Stiahne zoznam všetkých `.svg` súborov
- Zoradí ich abecedne/číselne
- Načíta z `raw.githubusercontent.com` (bez CORS problémov)

Kedykoľvek nahráš nový SVG → automaticky sa objaví v galérii.

## SVG formát omaľovánok

```xml
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- Vyfarbiteľná plocha -->
  <path data-region="path1" fill="#ffffff" d="..."/>
  <!-- Obrys (neklikateľný) -->
  <path data-locked="true" fill="#1a1a1a" d="..."/>
</svg>
```

- `data-region` → klikateľná vyfarbiteľná oblasť
- `data-locked="true"` → obrys (pointer-events: none)
- Štvorec 1:1, viewBox 0 0 1024 1024

## Lokálne spustenie

Potrebuješ HTTP server (SVG sa načítavajú cez `fetch`):

```bash
npx serve coloring-app
# alebo
python -m http.server 8080 --directory coloring-app
```

## Klávesové skratky

| Klávesa | Akcia |
|---|---|
| `V` | Vedierko |
| `B` | Štetec |
| `E` | Guma |
| `Ctrl+Z` | Späť |
| `Esc` | Zatvoriť / Späť do galérie |
