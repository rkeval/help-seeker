// The deployed site. Every build (Expo Go, simulators, store builds) talks to it unless told otherwise.
export const LIVE_API_URL = "https://help-seeker.onrender.com";

// To develop against a server running on your own computer instead, set the address before starting Expo:
//   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start      (your computer's LAN IP, for a phone)
//   EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo start          (Android emulator)
//   EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start         (iOS simulator)
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || LIVE_API_URL).replace(/\/$/, "");
