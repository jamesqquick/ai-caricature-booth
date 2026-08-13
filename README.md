# AI Caricature Booth

A static Astro and React prototype for an event photobooth. The entire flow runs in one hydrated React island:

1. Choose a New York scene.
2. Take or retake a photo with the browser camera.
3. Watch a simulated generation sequence.
4. Review a postcard-style local preview.

There are no APIs, uploads, databases, analytics, or AI model calls. Refreshing the page resets the flow, and the captured photo never leaves the browser.

## Development

```sh
npm install
npm run dev
```

Camera access requires `localhost` or HTTPS. A plain HTTP LAN address will not expose `navigator.mediaDevices` in most browsers.

## Verification

```sh
npm test
npm run check
npm run build
```
