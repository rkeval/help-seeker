import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { api, loadToken } from "./src/api";
import AccountScreen from "./src/screens/AccountScreen";
import AuthScreen from "./src/screens/AuthScreen";
import FindScreen from "./src/screens/FindScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import RequestsScreen from "./src/screens/RequestsScreen";
import { I18nProvider, core, useI18n } from "./src/i18n";
import { tr } from "./src/i18n";
import type { Meta, Profile, User } from "./src/types";
import { Button, LanguagePicker, Loading, useTheme } from "./src/ui";

type Tab = "find" | "profile" | "requests" | "account" | "auth";

export default function App() {
  return <SafeAreaProvider><I18nProvider><Main /></I18nProvider></SafeAreaProvider>;
}

// Shown while the app first contacts the server. On the free hosting plan the server sleeps when idle, so the very
// first start can take up to a minute: say so instead of leaving a bare spinner.
function StartingUp() {
  const t = useTheme();
  const { t: tx } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(id);
  }, []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", padding: 24, gap: 8 }}>
      <Loading />
      {slow && (
        <Text style={{ color: t.muted, textAlign: "center" }}>
          {tx("net.waking")}
        </Text>
      )}
    </SafeAreaView>
  );
}

function Main() {
  const t = useTheme();
  const { t: tx, lang } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("find");
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setProfile(me.profile);
    setUnread(me.unreadMessages ?? 0);
    return me;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadToken();
        const [m] = await Promise.all([api.meta(), refresh()]);
        setMeta(m);
      } catch (e) {
        Alert.alert(tr("net.cant_reach_title"), (e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  // keep the unread-messages count on the Requests tab fresh while signed in
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { void refresh().catch(() => {}); }, 20000);
    return () => clearInterval(id);
  }, [user, refresh]);

  const signedIn = async () => {
    const me = await refresh();
    setTab(me.user?.role === "housekeeper" && !me.profile ? "profile" : "find");
  };
  const signOut = async () => {
    try { await api.logout(); } catch { /* token is cleared locally regardless */ }
    setUser(null); setProfile(null); setTab("find");
  };

  const resendVerification = async () => {
    try {
      await api.resendVerification();
      Alert.alert(tx("verify.sent_title"), tx("verify.sent", { email: user?.email ?? "" }));
    } catch (e) {
      Alert.alert(tx("common.send_failed"), (e as Error).message);
    }
  };
  const recheckVerification = async () => {
    try {
      const me = await refresh();
      if (me.user?.emailVerified) Alert.alert(tx("verify.confirmed_title"), tx("verify.confirmed"));
      else Alert.alert(tx("verify.not_yet_title"), tx("verify.not_yet"));
    } catch (e) {
      Alert.alert(tx("verify.check_failed"), (e as Error).message);
    }
  };

  if (!ready) return <StartingUp />;
  if (!meta) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 12 }}>
        <Text style={{ color: t.fg, textAlign: "center" }}>{tx("net.cant_connect")}</Text>
        <Button title={tx("common.try_again")} onPress={() => { setReady(false); api.meta().then(setMeta).then(refresh).finally(() => setReady(true)); }} />
      </SafeAreaView>
    );
  }

  const tabs: [Tab, string][] = [["find", tx("tab.find")]];
  if (user) tabs.push(["profile", profile ? tx("tab.profile") : tx("tab.offer")]);
  if (user) tabs.push(["requests", unread ? tx("tab.requests_new", { n: unread }) : tx("tab.requests")], ["account", tx("tab.account")]);
  const current = core.LANGS.find((l) => l.code === lang);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", columnGap: 12, paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700", lineHeight: 28 }}>{tx("app.name")}</Text>
        <Pressable onPress={() => setLangOpen(true)} accessibilityRole="button" accessibilityLabel={`${tx("lang.label")}: ${current?.name}`} accessibilityLanguage={lang}
          hitSlop={8} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: t.accent, lineHeight: 22 }}>{current?.name} ▾</Text>
        </Pressable>
        {user
          ? <Pressable onPress={signOut} hitSlop={8} style={{ minHeight: 44, justifyContent: "center", flexShrink: 1 }}><Text style={{ color: t.accent, lineHeight: 22 }}>{tx("auth.signout_name", { name: user.name })}</Text></Pressable>
          : <Pressable onPress={() => setTab("auth")} hitSlop={8} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: t.accent, lineHeight: 22 }}>{tx("auth.signin")}</Text></Pressable>}
      </View>
      {langOpen && (
        <Modal animationType="fade" transparent onRequestClose={() => setLangOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 }} onPress={() => setLangOpen(false)}>
            <Pressable style={{ backgroundColor: t.card, borderRadius: 14, padding: 16, gap: 12 }} onPress={() => {}}>
              <ScrollView><LanguagePicker /></ScrollView>
              <Button title={tx("common.close")} kind="ghost" onPress={() => setLangOpen(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {user && !user.emailVerified && (
        <View style={{ margin: 12, padding: 12, gap: 8, borderRadius: 12, borderWidth: 1, borderColor: t.accent, backgroundColor: t.card }}>
          <Text style={{ color: t.fg }}>
            {tx("verify.banner", { email: user.email })}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={tx("verify.resend")} onPress={resendVerification} /></View>
            <View style={{ flex: 1 }}><Button kind="ghost" title={tx("verify.recheck")} onPress={recheckVerification} /></View>
          </View>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {tab === "auth" && !user && <AuthScreen onSignedIn={signedIn} />}
        {(tab === "find" || (tab === "auth" && user)) && <FindScreen user={user} meta={meta} onNeedSignIn={() => setTab("auth")} />}
        {tab === "profile" && user && <ProfileScreen meta={meta} initial={profile} emailVerified={user.emailVerified} onSaved={() => void refresh()} />}
        {tab === "account" && user && (
          <AccountScreen user={user} onSignOut={signOut} onDeleted={() => { setUser(null); setProfile(null); setTab("find"); }} />
        )}
        {tab === "requests" && user && <RequestsScreen key={user.id} offers={!!profile} user={user} onUnreadChange={() => void refresh().catch(() => {})} />}
      </View>

      <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
        {tabs.map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 12, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tab === id ? t.accent : t.muted, fontWeight: tab === id ? "700" : "400", textAlign: "center", fontSize: 14, lineHeight: 20 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
