import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Modal, ScrollView, Text, View } from "react-native";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { Housekeeper, Meta, User } from "../types";
import { Button, Card, Chip, Field, Loading, Muted, useTheme } from "../ui";

const SORTS = [["rating", "sort.rating"], ["rate", "sort.rate"], ["exp", "sort.exp"]] as const;

export default function FindScreen({ user, meta, onNeedSignIn }: { user: User | null; meta: Meta; onNeedSignIn: () => void }) {
  const t = useTheme();
  const { t: tx, label, rupees } = useI18n();
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
      Alert.alert(tx("common.load_failed"), (e as Error).message);
      setList((l) => l ?? []);
    }
  }, [service, city, sort, tx]);

  useEffect(() => {
    const id = setTimeout(load, 250); // debounce typing in the city box
    return () => clearTimeout(id);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label={tx("filter.any_service")} selected={!service} onPress={() => setService("")} />
          {meta.services.map((s) => <Chip key={s} label={label("service.", s)} selected={service === s} onPress={() => setService(s)} />)}
        </ScrollView>
        <Field label={tx("filter.city")} value={city} onChangeText={setCity} placeholder={tx("filter.city_ph")} maxChars={100} />
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {SORTS.map(([k, key]) => <Chip key={k} label={tx(key)} selected={sort === k} onPress={() => setSort(k)} />)}
        </View>
      </View>

      {list === null ? <Loading /> : (
        <FlatList
          data={list}
          keyExtractor={(h) => String(h.id)}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          ListEmptyComponent={<Muted>{tx("results.none")}</Muted>}
          renderItem={({ item: h }) => (
            <Card>
              <Text style={{ color: t.fg, fontSize: 18, fontWeight: "600" }}>{h.name}</Text>
              <Muted>
                {h.city} · {label("avail.", h.avail)} · {tx("hk.years", { n: h.exp })} · {h.rating ? `★ ${h.rating} (${h.reviews})` : tx("hk.no_reviews")}
              </Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
                {h.services.map((s) => <Chip key={s} label={label("service.", s)} />)}
              </View>
              {!!h.bio && <Text style={{ color: t.fg }}>{h.bio}</Text>}
              <Text style={{ color: t.fg, fontWeight: "600" }}>{tx("hk.rate", { rate: rupees(h.rate) })}</Text>
              {h.mine
                ? <Muted>{tx("hk.is_you")}</Muted>
                : <Button title={tx("hk.request_contact")} onPress={() => (user ? setTarget(h) : onNeedSignIn())} />}
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
  const { t: tx } = useI18n();
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.sendRequest({ housekeeperId: hk.id, phone, when, note });
      Alert.alert(tx("dlg.sent_title"), tx("dlg.sent", { name: hk.name }));
      onClose();
    } catch (e) {
      Alert.alert(tx("common.send_failed"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700" }}>{tx("dlg.title", { name: hk.name })}</Text>
        <Field label={tx("dlg.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label={tx("dlg.when")} value={when} onChangeText={setWhen} placeholder={tx("dlg.when_ph")} maxChars={200} />
        <Field label={tx("dlg.note")} value={note} onChangeText={setNote} multiline placeholder={tx("dlg.note_ph")} maxChars={1000} />
        <Button title={tx("dlg.submit")} onPress={send} disabled={busy} />
        <Button title={tx("common.cancel")} kind="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
