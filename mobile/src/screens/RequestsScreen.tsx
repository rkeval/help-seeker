import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Linking, Text, View } from "react-native";
import { api } from "../api";
import type { HousekeeperRequest, SeekerRequest, User } from "../types";
import { Button, Card, Chip, Loading, Muted, useTheme } from "../ui";

type Row = SeekerRequest | HousekeeperRequest;

export default function RequestsScreen({ user }: { user: User }) {
  const t = useTheme();
  const isHk = user.role === "housekeeper";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(isHk ? await api.housekeeperRequests() : await api.seekerRequests());
    } catch (e) {
      Alert.alert("Couldn't load", (e as Error).message);
      setRows((r) => r ?? []);
    }
  }, [isHk]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { Alert.alert("Couldn't update", (e as Error).message); }
  };
  const call = (phone: string) => void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`);

  if (rows === null) return <Loading />;
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => String(r.id)}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      ListEmptyComponent={<Muted>Nothing here yet.</Muted>}
      renderItem={({ item: r }) => {
        const hkRow = "seeker_name" in r ? r : null;
        const seekerRow = "hk_name" in r ? r : null;
        const phone = hkRow ? hkRow.seeker_phone : seekerRow?.hk_phone;
        const color = r.status === "accepted" ? t.ok : r.status === "declined" ? t.danger : t.muted;
        return (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: t.fg, fontSize: 17, fontWeight: "600" }}>{hkRow ? hkRow.seeker_name : seekerRow?.hk_name}</Text>
              <Text style={{ color, fontWeight: "600" }}>{r.status}</Text>
            </View>
            <Muted>{new Date(r.created_at.replace(" ", "T") + "Z").toLocaleString()} · {r.when || "flexible"}</Muted>
            {!!r.note && <Text style={{ color: t.fg }}>{r.note}</Text>}
            {!!phone && <Button kind="ghost" title={`Call ${phone}`} onPress={() => call(phone)} />}

            {hkRow && r.status === "pending" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button title="Accept" onPress={() => act(() => api.answer(r.id, "accepted"))} /></View>
                <View style={{ flex: 1 }}><Button kind="ghost" title="Decline" onPress={() => act(() => api.answer(r.id, "declined"))} /></View>
              </View>
            )}
            {seekerRow && r.status === "accepted" && (seekerRow.my_rating
              ? <Muted>You rated this {"★".repeat(seekerRow.my_rating)}</Muted>
              : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                  <Muted>Rate: </Muted>
                  {[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={`${n}★`} onPress={() => act(() => api.review(r.id, n))} />)}
                </View>
              ))}
          </Card>
        );
      }}
    />
  );
}
