import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { api } from "../api";
import type { User } from "../types";
import { useI18n } from "../i18n";
import { Button, Card, Field, LanguagePicker, Muted, useTheme } from "../ui";

export default function AccountScreen({ user, onSignOut, onDeleted }: { user: User; onSignOut: () => void; onDeleted: () => void }) {
  const t = useTheme();
  const { t: tx } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmDelete = () =>
    Alert.alert(
      tx("account.delete_question"),
      tx("account.delete_text"),
      [
        { text: tx("common.cancel"), style: "cancel" },
        {
          text: tx("account.delete_forever"),
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api.deleteAccount(password);
              Alert.alert(tx("account.deleted_title"), tx("account.deleted"));
              onDeleted();
            } catch (e) {
              Alert.alert(tx("account.delete_failed"), (e as Error).message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ color: t.fg, fontSize: 18, fontWeight: "600" }}>{user.name}</Text>
        <Muted>{user.email}</Muted>
        <Button kind="ghost" title={tx("auth.signout")} onPress={onSignOut} />
      </Card>

      <Card>
        <LanguagePicker />
      </Card>

      <Card>
        <Text style={{ color: t.danger, fontSize: 16, fontWeight: "600" }}>{tx("account.delete_heading")}</Text>
        <Muted>{tx("account.delete_hint")}</Muted>
        <Field label={tx("field.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        <Button title={tx("account.delete_button")} onPress={confirmDelete} disabled={busy || !password} />
      </Card>
    </ScrollView>
  );
}
