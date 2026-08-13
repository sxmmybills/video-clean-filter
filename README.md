# Video Clean & Filter

Strip metadata and apply subtle filters to videos — runs entirely in your browser.

Replaces the Adarsus (metadata cleaning) + Canva (filter) workflow with a single tool that processes everything client-side. No uploads, no servers, no accounts needed.

## What it does

1. **Strips all metadata** — GPS, camera model, timestamps, device info, software tags — everything personal is removed
2. **Applies a filter at 10% intensity** — Warm, Cool, Vintage, Dramatic, Greyscale, Summer, or Moody
3. **Exports a clean video** ready to post

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/video-clean-filter)

Or manually:

```bash
npm install
npm run build
```

Push to GitHub and connect the repo in [vercel.com/new](https://vercel.com/new). Vercel auto-detects Vite and deploys.

## Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Browser support

- Chrome / Edge 79+ (desktop & Android)
- Safari 14.0+ / iOS 14.0+
- Firefox 29+

Uses Canvas + MediaRecorder APIs — no FFmpeg or WASM required.
