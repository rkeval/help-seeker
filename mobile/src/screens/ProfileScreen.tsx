import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import type { Meta, Profile } from "../types";
import { Button, Chip, Field, Muted, useTheme } from "../ui";

export default function ProfileScreen({ meta, initial, emailVerified, onSaved }: { meta: Meta; initial: Profile | null; emailVerified: boolean; onSaved: () => void }) {
  const t = useTheme();
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
      Alert.alert("Saved", emailVerified ? "Households can now find you." : "Your profile will appear in search once you confirm your email.");
      onSaved();
    } catch (e) {
      Alert.alert("Couldn't save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700" }}>My housekeeper profile</Text>
      <Muted>Your phone number is only shared with households whose request you accept.</Muted>
      <Field label="City / area" value={city} onChangeText={setCity} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Rate per hour (₹)" value={rate} onChangeText={setRate} keyboardType="number-pad" />
      <Field label="Years of experience" value={exp} onChangeText={setExp} keyboardType="number-pad" />
      <View>
        <Muted>Availability</Muted>
        <View style={{ flexDirection: "row", marginTop: 6 }}>
          {meta.availability.map((a) => <Chip key={a} label={a} selected={avail === a} onPress={() => setAvail(a)} />)}
        </View>
      </View>
      <View>
        <Muted>Services you offer</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {meta.services.map((s) => <Chip key={s} label={s} selected={services.includes(s)} onPress={() => toggle(s)} />)}
        </View>
      </View>
      <Field label="About you" value={bio} onChangeText={setBio} multiline maxLength={1000} />
      <Button title="Save profile" onPress={save} disabled={busy} />
    </ScrollView>
  );
}
