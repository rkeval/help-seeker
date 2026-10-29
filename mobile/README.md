# Help Seeker – mobile app (Android + iPhone)

One React Native / [Expo](https://expo.dev) codebase for both platforms. It talks to the same backend as the website.
Sign-in uses a bearer token kept in the device's secure storage (Keychain on iOS, Keystore on Android).

## Try it on your phone
The app talks to the live site, `https://help-seeker.onrender.com`, by default.
1. In this folder: `npm install`, then `npx expo start`.
2. Install **Expo Go** on your phone and scan the QR code (phone and computer on the same Wi-Fi).

The free hosting plan puts the server to sleep when idle, so the **first request after a quiet spell can take up to a minute**. The app shows "Waking up the server…" and waits (up to 90 seconds) rather than failing.

### Developing against a server on your computer
Start the backend (`npm start` in the repo root, needs `DATABASE_URL`, optionally `npm run seed` first), then point the app at it:
```sh
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start   # a phone: your computer's LAN IP
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo start       # Android emulator
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start      # iOS simulator
```
Careful: the live site is the real database. Signing up in the app creates real accounts there.

## Publishing to the stores
1. The backend is already deployed (HTTPS, Neon + Render, see the root README) and the app points at it by default (`src/config.ts`). Release builds must use an `https://` address: plain `http://` is blocked on both platforms.
2. Change `ios.bundleIdentifier` / `android.package` in `app.json` to an id you own.
3. Build with EAS: `npx eas-cli build --platform all`, then `npx eas-cli submit`.
   You need an Apple Developer account (US$99/yr) and a Google Play developer account (US$25 one-off).
   App Store review also requires a privacy policy. In-app account deletion (Account tab) is already built.

## Scripts
`npm run typecheck` · `npx expo export --platform all` (verifies the bundles build)
