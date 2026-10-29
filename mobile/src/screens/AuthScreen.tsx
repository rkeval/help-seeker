import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import type { Role, User } from "../types";
import { Button, Chip, Field, Muted, useTheme } from "../ui";

export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTheme();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [role, setRole] = useState<Role>("seeker");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await api.requestPasswordReset(email);
        Alert.alert("Check your email", `${r.message}\n\nOpen the link on this phone, choose a new password, then sign in here.`);
        setMode("login");
        return;
      }
      const user: User = mode === "login"
        ? await api.login({ email, password })
        : await api.register({ role, name, email, password });
      if (mode === "register") {
        Alert.alert("Check your email", `We sent a confirmation link to ${user.email}. Open it to finish setting up your account.`);
      }
      onSignedIn();
    } catch (e) {
      Alert.alert("Couldn't continue", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.fg, fontSize: 28, fontWeight: "700", marginTop: 24 }}>Help Seeker</Text>
      <Muted>Find trusted housekeepers for cleaning, dishwashing, cooking and more.</Muted>

      {mode === "register" && (
        <View>
          <Muted>I am a…</Muted>
          <View style={{ flexDirection: "row", marginTop: 6 }}>
            <Chip label="Household" selected={role === "seeker"} onPress={() => setRole("seeker")} />
            <Chip label="Housekeeper" selected={role === "housekeeper"} onPress={() => setRole("housekeeper")} />
          </View>
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
        </View>
      )}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      {mode !== "forgot" && (
        <Field label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "login" ? "current-password" : "new-password"} />
      )}

      <Button title={mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"} onPress={submit} disabled={busy} />
      {mode === "login" && <Button kind="ghost" title="Forgot password?" onPress={() => setMode("forgot")} />}
      <Button
        kind="ghost"
        title={mode === "register" ? "Have an account? Sign in" : mode === "forgot" ? "Back to sign in" : "New here? Create an account"}
        onPress={() => setMode(mode === "login" ? "register" : "login")}
      />
    </ScrollView>
  );
}
