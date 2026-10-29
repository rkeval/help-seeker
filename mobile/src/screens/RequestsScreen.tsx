import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Linking, Text, View } from "react-native";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { HousekeeperRequest, SeekerRequest, User } from "../types";
import ChatModal from "./ChatModal";
import { Button, Card, Chip, Loading, Muted, useTheme } from "../ui";

type Item =
  | { key: string; header: string }
  | { key: string; empty: true }
  | { key: string; req: SeekerRequest | HousekeeperRequest };

// Everyone has "sent" requests; people who offer services also have "received" ones.
export default function RequestsScreen({ offers, onUnreadChange }: { user: User; offers: boolean; onUnreadChange?: () => void }) {
  const t = useTheme();
  const { t: tx, dateTime } = useI18n();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chat, setChat] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const sections: [string, string, (SeekerRequest | HousekeeperRequest)[]][] = [];
      if (offers) sections.push(["received", "req.received", await api.housekeeperRequests()]);
      sections.push(["sent", "req.sent", await api.seekerRequests()]);
      setRows(sections.flatMap(([id, title, list]): Item[] => [
        { key: "h-" + id, header: title }, // a translation key, shown through tx() below
        ...(list.length ? list.map((req) => ({ key: `${id}-${req.id}`, req })) : [{ key: "e-" + id, empty: true as const }]),
      ]));
    } catch (e) {
      Alert.alert(tx("common.load_failed"), (e as Error).message);
      setRows((r) => r ?? []);
    }
  }, [offers]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { Alert.alert(tx("req.update_failed"), (e as Error).message); }
  };
  const call = (phone: string) => void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`);

  if (rows === null) return <Loading />;
  return (
    <>
    <FlatList
      data={rows}
      keyExtractor={(i) => i.key}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      renderItem={({ item }) => {
        if ("header" in item) return <Text style={{ color: t.fg, fontSize: 18, fontWeight: "700", marginTop: 6 }}>{tx(item.header)}</Text>;
        if ("empty" in item) return <Muted>{tx("req.none")}</Muted>;
        const r = item.req;
        const hkRow = "seeker_name" in r ? r : null;
        const seekerRow = "hk_name" in r ? r : null;
        const phone = hkRow ? hkRow.seeker_phone : seekerRow?.hk_phone;
        const color = r.status === "accepted" ? t.ok : r.status === "declined" ? t.danger : t.muted;
        return (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: t.fg, fontSize: 17, fontWeight: "600" }}>{hkRow ? hkRow.seeker_name : seekerRow?.hk_name}</Text>
              <Text style={{ color, fontWeight: "600" }}>{tx("status." + r.status)}</Text>
            </View>
            <Muted>{dateTime(r.created_at)} · {r.when || tx("req.flexible")}</Muted>
            {!!r.note && <Text style={{ color: t.fg }}>{r.note}</Text>}
            {!!phone && <Button kind="ghost" title={tx("req.call", { phone })} onPress={() => call(phone)} />}

            {hkRow && r.status === "pending" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button title={tx("req.accept")} onPress={() => act(() => api.answer(r.id, "accepted"))} /></View>
                <View style={{ flex: 1 }}><Button kind="ghost" title={tx("req.decline")} onPress={() => act(() => api.answer(r.id, "declined"))} /></View>
              </View>
            )}
            {r.status === "accepted" && (
              <Button
                title={r.unread ? tx("req.messages_new", { n: r.unread }) : tx("req.messages")}
                onPress={() => setChat({ id: r.id, name: hkRow ? hkRow.seeker_name : seekerRow?.hk_name ?? "" })}
              />
            )}
            {seekerRow && r.status === "accepted" && (seekerRow.my_rating
              ? <Muted>{tx("req.you_rated", { stars: "★".repeat(seekerRow.my_rating) })}</Muted>
              : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                  <Muted>{tx("req.rate_prompt")} </Muted>
                  {[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={`${n}★`} onPress={() => act(() => api.review(r.id, n))} />)}
                </View>
              ))}
          </Card>
        );
      }}
    />
    {chat && (
      <ChatModal
        requestId={chat.id}
        name={chat.name}
        onClose={() => { setChat(null); void load(); onUnreadChange?.(); }}
      />
    )}
    </>
  );
}
