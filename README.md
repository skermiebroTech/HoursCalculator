# Weekly Hours

A tiny, fast, mobile-first web app for entering your weekly work hours and copying them in exactly the format your workplace expects:

```
Monday 800-300 6.5h
Tuesday 930-230 4.5h
Wednesday 730-300 7h
Thursday 730-300 7h
Friday 730-200 6h
total 31h
```

Built with plain HTML, CSS, and vanilla JavaScript — no accounts, no server, no build step, no dependencies. Everything you enter is saved in your browser's localStorage, and the site works offline once installed.

## Features

- Rows for Monday–Sunday; Monday–Friday enabled by default, any day can be toggled on or off
- Start time, finish time, and unpaid break (default 30 minutes) per day
- Paid hours calculated automatically (`finish − start − break`), including shifts that finish after midnight
- Live preview in the exact submission format, with times like `800`/`930`/`300` and hours like `7h`/`6.5h`/`6.25h`
- Big **Copy Hours** button with a clear "Copied" confirmation
- Week selector with previous/next buttons — each week's hours are saved separately
- One-tap quick-pick chips for common start/finish times (still fully typeable)
- **Repeat last week**, **Mon–Fri reset**, and **Clear week** shortcuts
- **Export / Import** a backup file to move your hours between devices or keep a copy
- Validation for missing times, zero-length shifts, and breaks longer than the shift
- Light and dark mode (follows your system, with a manual toggle)
- Installable as a PWA that works offline

## Deploy on GitHub Pages

1. Create a new repository on [github.com](https://github.com/new) (for example `weekly-hours`). Public repos get free GitHub Pages.
2. Upload all six files to the root of the repository:
   `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`, `README.md`
   (On the repo page: **Add file → Upload files**, drag them in, and commit.)
3. In the repository, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose the `main` branch and the `/ (root)` folder, then click **Save**.
5. Wait a minute or two, then open the URL GitHub shows at the top of the Pages settings — it will look like:

   ```
   https://<your-username>.github.io/<repository-name>/
   ```

That's it. Any time you edit the files and commit, the site updates automatically. If you change `style.css`, `app.js`, or `index.html`, also bump `CACHE_NAME` in `service-worker.js` (e.g. `weekly-hours-v2`) so installed copies fetch the new version.

## Install on your phone

Open the site in your phone's browser, then:

- **iPhone (Safari):** Share button → **Add to Home Screen**
- **Android (Chrome):** Menu (⋮) → **Add to Home screen** / **Install app**

It will open full-screen like a native app and keep working with no connection.

## Run locally

Just open `index.html` in a browser — everything works except the offline service worker (which needs `https://` or `localhost`). For the full experience run a tiny local server:

```
python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Moving data between devices

Because everything is stored locally, there's no automatic cloud sync. To move your hours from one device to another:

1. On the first device, open **Backup & transfer → Export backup**. This downloads a small `weekly-hours-backup-YYYY-MM-DD.json` file.
2. Transfer that file to the other device (AirDrop, email it to yourself, a shared cloud folder, a USB cable — whatever's easiest).
3. On the second device, open the site and choose **Backup & transfer → Import backup**, then pick the file.

Importing merges the weeks in the file with whatever is already there and replaces any weeks that share the same dates, so it's safe to import onto a device that already has some hours entered. Keep the exported file around and it also doubles as a backup.

## Privacy

All data stays in your browser's localStorage on your device. Nothing is ever uploaded anywhere. Backup files are created and read entirely on your device — they're only sent somewhere if *you* choose to share them.
