import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { api } from "../api";
import type { User } from "../types";
import { Button, Card, Field, Muted, useTheme } from "../ui";

export default function AccountScreen({ user, onSignOut, onDeleted }: { user: User; onSignOut: () => void; onDeleted: () => void }) {
  const t = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmDelete = () =>
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account, profile, requests and reviews. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api.deleteAccount(password);
              Alert.alert("Account deleted", "Your account and data have been removed.");
              onDeleted();
            } catch (e) {
              Alert.alert("Couldn't delete", (e as Error).message);
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
        <Button kind="ghost" title="Sign out" onPress={onSignOut} />
      </Card>

      <Card>
        <Text style={{ color: t.danger, fontSize: 16, fontWeight: "600" }}>Delete account</Text>
        <Muted>Enter your password to confirm. This can't be undone.</Muted>
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        <Button title="Delete my account" onPress={confirmDelete} disabled={busy || !password} />
      </Card>
    </ScrollView>
  );
}
