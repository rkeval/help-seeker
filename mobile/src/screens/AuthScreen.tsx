import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import type { SignupRole, User } from "../types";
import { useI18n } from "../i18n";
import { Button, Chip, Field, LanguagePicker, Muted, useTheme } from "../ui";

export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useTheme();
  const { t: tx } = useI18n();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [role, setRole] = useState<SignupRole>("seeker");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await api.requestPasswordReset(email);
        Alert.alert(tx("register.check_email_title"), `${tx("forgot.sent")}\n\n${tx("forgot.sent_mobile")}`);
        setMode("login");
        return;
      }
      const user: User = mode === "login"
        ? await api.login({ email, password })
        : await api.register({ role, name, email, password });
      if (mode === "register") {
        Alert.alert(tx("register.check_email_title"), tx("register.check_email", { email: user.email }));
      }
      onSignedIn();
    } catch (e) {
      Alert.alert(tx("auth.cant_continue"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.fg, fontSize: 28, fontWeight: "700", marginTop: 24, lineHeight: 38 }}>{tx("app.name")}</Text>
      <Muted>{tx("app.tagline")}</Muted>
      <LanguagePicker />

      {mode === "register" && (
        <View>
          <Muted>{tx("register.iam")}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
            <Chip label={tx("register.chip.seeker")} selected={role === "seeker"} onPress={() => setRole("seeker")} />
            <Chip label={tx("register.chip.housekeeper")} selected={role === "housekeeper"} onPress={() => setRole("housekeeper")} />
            <Chip label={tx("register.chip.both")} selected={role === "both"} onPress={() => setRole("both")} />
          </View>
          <Field label={tx("field.name")} value={name} onChangeText={setName} autoComplete="name" maxChars={100} />
        </View>
      )}
      <Field label={tx("field.email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      {mode !== "forgot" && (
        <Field label={tx("field.password_new")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "login" ? "current-password" : "new-password"} />
      )}

      <Button title={mode === "login" ? tx("auth.signin") : mode === "register" ? tx("register.submit") : tx("forgot.submit")} onPress={submit} disabled={busy} />
      {mode === "login" && <Button kind="ghost" title={tx("login.forgot")} onPress={() => setMode("forgot")} />}
      <Button
        kind="ghost"
        title={mode === "register" ? tx("register.have_account") : mode === "forgot" ? tx("forgot.back") : tx("register.new_here")}
        onPress={() => setMode(mode === "login" ? "register" : "login")}
      />
    </ScrollView>
  );
}
