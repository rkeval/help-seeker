import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { api, loadToken } from "./src/api";
import AccountScreen from "./src/screens/AccountScreen";
import AuthScreen from "./src/screens/AuthScreen";
import FindScreen from "./src/screens/FindScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import type { Meta, Profile, User } from "./src/types";
import { Button, Loading, useTheme } from "./src/ui";

type Tab = "find" | "profile" | "requests" | "account" | "auth";

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

function Main() {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("find");

  const refresh = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setProfile(me.profile);
    return me;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadToken();
        const [m] = await Promise.all([api.meta(), refresh()]);
        setMeta(m);
      } catch (e) {
        Alert.alert("Can't reach the server", (e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  const signedIn = async () => {
    const me = await refresh();
    setTab(me.user?.role === "housekeeper" && !me.profile ? "profile" : "find");
  };
  const signOut = async () => {
    try { await api.logout(); } catch { /* token is cleared locally regardless */ }
    setUser(null); setProfile(null); setTab("find");
  };

  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}><Loading /></SafeAreaView>;
  if (!meta) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 12 }}>
        <Text style={{ color: t.fg, textAlign: "center" }}>Couldn't connect to Help Seeker.</Text>
        <Button title="Try again" onPress={() => { setReady(false); api.meta().then(setMeta).then(refresh).finally(() => setReady(true)); }} />
      </SafeAreaView>
    );
  }

  const tabs: [Tab, string][] = [["find", "Find"]];
  if (user?.role === "housekeeper") tabs.push(["profile", "Profile"]);
  if (user) tabs.push(["requests", "Requests"], ["account", "Account"]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700" }}>Help Seeker</Text>
        {user
          ? <Pressable onPress={signOut}><Text style={{ color: t.accent }}>Sign out ({user.name})</Text></Pressable>
          : <Pressable onPress={() => setTab("auth")}><Text style={{ color: t.accent }}>Sign in</Text></Pressable>}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "auth" && !user && <AuthScreen onSignedIn={signedIn} />}
        {(tab === "find" || (tab === "auth" && user)) && <FindScreen user={user} meta={meta} onNeedSignIn={() => setTab("auth")} />}
        {tab === "profile" && user?.role === "housekeeper" && <ProfileScreen meta={meta} initial={profile} onSaved={() => void refresh()} />}
        {tab === "account" && user && (
          <AccountScreen user={user} onSignOut={signOut} onDeleted={() => { setUser(null); setProfile(null); setTab("find"); }} />
        )}
        {tab === "requests" && user && <RequestsScreen key={user.id} user={user} />}
      </View>

      <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
        {tabs.map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" style={{ flex: 1, padding: 14, alignItems: "center" }}>
            <Text style={{ color: tab === id ? t.accent : t.muted, fontWeight: tab === id ? "700" : "400" }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
