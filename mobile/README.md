# Help Seeker – mobile app (Android + iPhone)

One React Native / [Expo](https://expo.dev) codebase for both platforms. It talks to the same backend as the website.
Sign-in uses a bearer token kept in the device's secure storage (Keychain on iOS, Keystore on Android).

## Try it on your phone
1. Start the backend on your computer (needs `DATABASE_URL`, see the root README): `npm start` in the repo root, optionally `npm run seed` first.
2. In this folder: `npm install`, then point the app at your computer's LAN IP and start Expo:
   ```sh
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start
   ```
3. Install **Expo Go** on your phone and scan the QR code (phone and computer on the same Wi-Fi).

Emulators work without the env var: Android emulator uses `http://10.0.2.2:3000`, the iOS simulator uses `http://localhost:3000`.

## Publishing to the stores
1. Deploy the backend somewhere with **HTTPS** (`NODE_ENV=production`; the root README has a free Neon + Render recipe) and set `EXPO_PUBLIC_API_URL` to that URL. Plain `http://` is blocked in release builds on both platforms.
2. Change `ios.bundleIdentifier` / `android.package` in `app.json` to an id you own.
3. Build with EAS: `npx eas-cli build --platform all`, then `npx eas-cli submit`.
   You need an Apple Developer account (US$99/yr) and a Google Play developer account (US$25 one-off).
   App Store review also requires a privacy policy. In-app account deletion (Account tab) is already built.

## Scripts
`npm run typecheck` · `npx expo export --platform all` (verifies the bundles build)
