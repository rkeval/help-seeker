import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Modal, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import type { Housekeeper, Meta, User } from "../types";
import { Button, Card, Chip, Field, Loading, Muted, useTheme } from "../ui";

const SORTS = [["rating", "Top rated"], ["rate", "Lowest rate"], ["exp", "Experience"]] as const;

export default function FindScreen({ user, meta, onNeedSignIn }: { user: User | null; meta: Meta; onNeedSignIn: () => void }) {
  const t = useTheme();
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [sort, setSort] = useState<string>("rating");
  const [list, setList] = useState<Housekeeper[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [target, setTarget] = useState<Housekeeper | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.housekeepers({ service, city: city.trim(), sort }));
    } catch (e) {
      Alert.alert("Couldn't load", (e as Error).message);
      setList((l) => l ?? []);
    }
  }, [service, city, sort]);

  useEffect(() => {
    const id = setTimeout(load, 250); // debounce typing in the city box
    return () => clearTimeout(id);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="Any service" selected={!service} onPress={() => setService("")} />
          {meta.services.map((s) => <Chip key={s} label={s} selected={service === s} onPress={() => setService(s)} />)}
        </ScrollView>
        <Field label="City / area" value={city} onChangeText={setCity} placeholder="e.g. Pune" />
        <View style={{ flexDirection: "row" }}>
          {SORTS.map(([k, label]) => <Chip key={k} label={label} selected={sort === k} onPress={() => setSort(k)} />)}
        </View>
      </View>

      {list === null ? <Loading /> : (
        <FlatList
          data={list}
          keyExtractor={(h) => String(h.id)}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          ListEmptyComponent={<Muted>No matches. Try loosening the filters.</Muted>}
          renderItem={({ item: h }) => (
            <Card>
              <Text style={{ color: t.fg, fontSize: 18, fontWeight: "600" }}>{h.name}</Text>
              <Muted>
                {h.city} · {h.avail} · {h.exp} yrs · {h.rating ? `★ ${h.rating} (${h.reviews})` : "No reviews yet"}
              </Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
                {h.services.map((s) => <Chip key={s} label={s} />)}
              </View>
              {!!h.bio && <Text style={{ color: t.fg }}>{h.bio}</Text>}
              <Text style={{ color: t.fg, fontWeight: "600" }}>₹{h.rate}/hour</Text>
              {user?.role !== "housekeeper" && (
                <Button title="Request contact" onPress={() => (user ? setTarget(h) : onNeedSignIn())} />
              )}
            </Card>
          )}
        />
      )}

      {target && <RequestModal hk={target} onClose={() => setTarget(null)} />}
    </View>
  );
}

function RequestModal({ hk, onClose }: { hk: Housekeeper; onClose: () => void }) {
  const t = useTheme();
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.sendRequest({ housekeeperId: hk.id, phone, when, note });
      Alert.alert("Request sent", `You'll see ${hk.name}'s phone number once they accept.`);
      onClose();
    } catch (e) {
      Alert.alert("Couldn't send", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700" }}>Request {hk.name}</Text>
        <Field label="Your phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="When do you need help?" value={when} onChangeText={setWhen} placeholder="e.g. Mon–Fri mornings" />
        <Field label="Details" value={note} onChangeText={setNote} multiline placeholder="Tasks, home size, language…" />
        <Button title="Send request" onPress={send} disabled={busy} />
        <Button title="Cancel" kind="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
