# VMD Leads — desktop CRM for VM Diamond Construction

Electron shell + Firebase (Firestore, email/password auth). UI text is Russian; client-facing templates are English.

## Layout
- `main.js`, `preload.js` — Electron shell. Changing these requires a NEW installer (users reinstall).
- `src/` — UI (app.js, templates.js, index.html, style.css, config.js). Bundled by `build.mjs` (esbuild) into `renderer/`.
- `src/ui-version.txt` — integer UI version. Bump it for every UI release.
- `docs/` — GitHub Pages (https://parlyy.github.io/vmd-leads/). The installed app downloads `docs/version.json` + the files listed there (SHA-256 checked) and offers «Обновить сейчас».
- `apps-script/` — Google Apps Script (Gmail → Firestore import, Claude proxy). Deployed manually by the owner in script.google.com; secrets live in Script properties, never in this repo.
- `test/` — fake Firebase modules + Playwright screenshots (`node test/build-test.mjs && node test/shot.js`).

## Shipping a UI update (no reinstall)
1. `npm ci` then edit `src/…`.
2. Bump `src/ui-version.txt`.
3. `npm run bundle`, run the test screenshots, then copy `renderer/{index.html,app.js,style.css,version.json}` → `docs/`.
4. Commit and push to `main`. Pages publishes within ~1 min; apps pick it up on next launch or within 2 h.

## Shipping a shell update (installer)
`npm run dist:win` (needs wine + wine32) and `npx electron-builder --mac zip --arm64`. Mac build is unsigned: user runs `xattr -cr` + `codesign --force --deep -s -` once.

## Rules
- Never commit API keys, passwords or tokens. Firebase web config in `src/config.js` is public by design (data is protected by Firestore rules).
- Client-facing text: formal Canadian English; new-inquiry replies include the Warranty & Licensing block and ask clients to write to info@vmdiamondconstruction.ca; never promise response times; never invent prices; never mention subcontractors.
