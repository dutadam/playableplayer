# Playable Player

Mobile-first playable ad player. The current direction is a browser/PWA app in `web/`.

## Web PWA

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173/` locally.

For testing on an iPhone or Android device on the same network, run:

```bash
cd web
npm run dev:https
```

Then open the Network URL shown by Vite. Mobile PWA install works best from a secure origin.

## First Web Version

- Import `.html`, `.htm`, or `.zip` playables.
- Store the library on-device with IndexedDB.
- Serve imported playable assets through a service worker virtual filesystem.
- Launch playables in a full-viewport iframe.
- Royal Match playables open with the matching-flow reference video first; when it ends, a tap starts the playable.
- Library shows Royal Match only for now (Royal Kingdom entries are hidden, not deleted) plus a How to play section with the gameplay notes.
- Single-page setup guide with a looping video (tap to pause/resume), identical on every platform.
- Tap any screen corner twice to reveal hidden controls.
- Retry/reload, fullscreen, or return home from the control panel.
- Detect App Store / Play Store link attempts and show a Retry / Home modal.
- Load Playable pulls the bundled Royal Match pack (Luna playground wrapper; the playable itself streams from assets.lunalabs.io).

## Next Useful Additions

- URL import and QR import flow.
- Console/debug log panel.
- Per-playable orientation notes.
- QA notes, screenshots, or recording support.
