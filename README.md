# Fake Form Filler

A Chrome/Chromium extension (also works on Edge, Brave, etc.) that fills out
web forms with fake but realistic-looking personal details — useful for
testing forms without typing dummy data by hand every time.

**Password fields are never touched. The email field is filled with a real,
receivable email alias (via the [SimpleLogin](https://simplelogin.io) API)
instead of a made-up address** — see [Email alias setup](#email-alias-setup-simplelogin)
below.

## What it fills in

- Email (real, working alias via SimpleLogin — see setup below; left empty
  if no API key is configured)
- First name, last name, full name
- Address, city, ZIP/postal code, state
- Phone number
- Company name
- Date of birth
- Radio buttons (one random choice per group) and checkboxes (randomly checked)

All values generated on a page are consistent with each other (the same
name and city are reused everywhere they're needed on that page).

## Installation (developer mode)

1. Download and unzip this folder onto your computer.
2. Open Chrome (or Chromium/Edge/Brave) and go to `chrome://extensions`.
3. Turn on **"Developer mode"** (toggle in the top-right corner).
4. Click **"Load unpacked"**.
5. Select the `fake-form-filler` folder.
6. The extension icon will appear in the toolbar (it may be hidden under
   the puzzle-piece icon 🧩 — click that and pin it for easy access).

## Email alias setup (SimpleLogin)

To have the extension fill the email field with a real, working address
that forwards to your actual inbox, you need a free [SimpleLogin](https://simplelogin.io)
account and API key.

### Get your API key

1. Sign up (or log in) at [simplelogin.io](https://simplelogin.io).
2. Go to **app.simplelogin.io/dashboard/setting**.
3. Scroll down to the **"API Key"** section.
4. Click **"Create new API Key"** (give it a name, e.g. "Fake Form Filler").
5. Copy the generated key (looks like `sl_xxxxxxxxxxxxx...`) — it's shown
   **only once**, so save it somewhere safe.
6. If it's ever exposed, revoke it and generate a new one from the same page.

### Add it to the extension

1. Click the extension icon to open the popup.
2. Paste the API key into the **"SimpleLogin API key"** field at the bottom.
3. Click **"Save key"** — it's stored locally in the browser
   (`chrome.storage.local`) and is only ever sent to `app.simplelogin.io`
   over HTTPS.

If no key is saved, or the API call fails (e.g. invalid key, no reusable alias,
no network), the email field is simply left untouched — no fake address
is ever generated instead.

## How to use it

1. Go to the page with the form you want to fill (e.g. a sign-up form).
2. Click the extension icon.
3. Click **"Fill the form"** — recognized fields are filled in with matching data.

## Notes and limitations

- Doesn't work on fields inside a closed Shadow DOM.
- On native `<select>` dropdowns, it tries to match the generated data to
  an option's text; if nothing matches, it picks a random option.
- Any other native `<select>` dropdown (size, country, "how did you hear
  about us?", etc.) also gets a random valid option picked — the empty/
  disabled placeholder option is never chosen. Multi-select (`<select
  multiple>`) and disabled selects are left untouched.
- Doesn't handle "custom" dropdowns built with `<div>`s/JavaScript (not
  native `<select>` elements).
- Radio buttons and checkboxes are clicked at random — including things
  like "I agree to the terms" — so always double-check before submitting
  a real form.
- The email alias feature requires a SimpleLogin account and API key
  (see [Email alias setup](#email-alias-setup-simplelogin)); without one,
  the email field is left blank rather than filled with a fake address.
- Aliases are **reused**, not created on every click. The extension creates
  up to 3 aliases (`MAX_POOL_SIZE` in `popup.js`), remembers them, and from
  then on picks one of them at random. If SimpleLogin refuses to create a new
  one (e.g. the 10-alias limit of the free plan), it falls back to the aliases
  it created earlier — recognized by the note "Created by Fake Form Filler…" —
  so your other aliases are never touched. Aliases you delete from the
  SimpleLogin dashboard (or disable) are skipped automatically.