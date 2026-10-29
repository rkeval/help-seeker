import { Platform } from "react-native";

// Point this at your deployed server (HTTPS) for real builds:
//   EXPO_PUBLIC_API_URL=https://your-host npx expo start
// In development the default reaches a server running on your computer from the Android emulator
// (10.0.2.2) or the iOS simulator (localhost). On a physical phone use your computer's LAN IP.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000");
