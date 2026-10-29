import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { Meta, Profile } from "../types";
import { Button, Chip, Field, Muted, useTheme } from "../ui";

export default function ProfileScreen({ meta, initial, emailVerified, onSaved }: { meta: Meta; initial: Profile | null; emailVerified: boolean; onSaved: () => void }) {
  const t = useTheme();
  const { t: tx, label } = useI18n();
  const [city, setCity] = useState(initial?.city ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [rate, setRate] = useState(initial ? String(initial.rate) : "");
  const [exp, setExp] = useState(initial ? String(initial.exp) : "0");
  const [avail, setAvail] = useState(initial?.avail ?? meta.availability[0]);
  const [services, setServices] = useState<string[]>(initial?.services ?? []);
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [busy, setBusy] = useState(false);

  const toggle = (s: string) => setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const save = async () => {
    setBusy(true);
    try {
      await api.saveProfile({ city, phone, rate: Number(rate), exp: Number(exp) || 0, avail, services, bio });
      Alert.alert(tx("profile.saved_title"), emailVerified ? tx("profile.saved_live_short") : tx("profile.saved_hidden_short"));
      onSaved();
    } catch (e) {
      Alert.alert(tx("profile.save_failed"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700" }}>{tx("profile.title")}</Text>
      <Muted>{tx("profile.phone_hint")}</Muted>
      <Field label={tx("profile.city")} value={city} onChangeText={setCity} maxChars={100} />
      <Field label={tx("profile.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label={tx("profile.rate_rupees")} value={rate} onChangeText={setRate} keyboardType="number-pad" />
      <Field label={tx("profile.exp")} value={exp} onChangeText={setExp} keyboardType="number-pad" />
      <View>
        <Muted>{tx("profile.avail")}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {meta.availability.map((a) => <Chip key={a} label={label("avail.", a)} selected={avail === a} onPress={() => setAvail(a)} />)}
        </View>
      </View>
      <View>
        <Muted>{tx("profile.services")}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {meta.services.map((s) => <Chip key={s} label={label("service.", s)} selected={services.includes(s)} onPress={() => toggle(s)} />)}
        </View>
      </View>
      <Field label={tx("profile.bio")} value={bio} onChangeText={setBio} multiline maxChars={1000} />
      <Button title={tx("profile.save")} onPress={save} disabled={busy} />
    </ScrollView>
  );
}
