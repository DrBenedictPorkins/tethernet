# Store Submission Checklist

## Blocking — must be done before submitting

- [ ] **Privacy policy live URL** — deploy `store/privacy-policy.html` to GitHub Pages
  - Create repo `DrBenedictPorkins/tethernet` on GitHub (or use existing)
  - Push this repo with `store/privacy-policy.html`
  - Enable GitHub Pages (Settings → Pages → Branch: main → /store folder, or root)
  - URL will be: `https://drbenedictporkins.github.io/tethernet/privacy.html`
  - Update that URL in both `chrome-listing.md` and `firefox-listing.md` if different
  - Also link it from the onboarding page footer

- [ ] **Screenshots** — 1280×800 PNG (Chrome requires at least 1, recommends 5)
  - Shot 1: Onboarding consent page
  - Shot 2: Popup connected — active session, passive mode toggle
  - Shot 3: Terminal showing Claude Code + get_connection_info output
  - Shot 4: Passive mode report page (View Report tab)
  - Shot 5: Canvas telemetry report

- [ ] **Promotional tile** — 440×280 PNG (optional but strongly recommended for CWS)

## Chrome Web Store

- [ ] Go to https://chrome.google.com/webstore/devconsole
- [ ] Pay one-time $5 developer fee if not already paid
- [ ] New Item → upload ZIP of extension directory (exclude `store/`, `test/`, `.git/`)
- [ ] Paste description from `store/chrome-listing.md`
- [ ] Privacy policy URL: `https://drbenedictporkins.github.io/tethernet/privacy.html`
- [ ] Category: Developer Tools
- [ ] Upload screenshots
- [ ] Permission justifications — use exact text from `SUBMISSION_NOTES.md`
- [ ] Submit for review (expect 1–7 days; `debugger` permission triggers manual review)

## Firefox AMO

- [ ] Go to https://addons.mozilla.org/developers/
- [ ] Submit New Add-on → upload XPI (zip the extension directory)
- [ ] Paste description from `store/firefox-listing.md`
- [ ] Privacy policy URL: `https://drbenedictporkins.github.io/tethernet/privacy.html`
- [ ] Category: Web Development
- [ ] Select data collection categories matching manifest `data_collection_permissions`
- [ ] Upload screenshots
- [ ] AMO does source code review — they will ask for source if minified (ours isn't, so fine)

## Post-submission

- [ ] Update `SUBMISSION_NOTES.md` with submission date and review tracking
- [ ] Monitor Chrome developer console for reviewer questions
- [ ] Monitor AMO email for reviewer questions

## Version in manifests

- Chrome: `1.0.0` — confirm this is correct before submitting
- Firefox: `2.0.2` — confirm this is correct before submitting
