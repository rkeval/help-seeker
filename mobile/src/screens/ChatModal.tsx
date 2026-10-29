import { ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { core, useI18n } from "../i18n";
import type { ChatMessage } from "../types";
import { Button, Muted, useTheme } from "../ui";

const POLL_MS = 4000;

// One conversation, tied to an accepted request. New messages are fetched every few seconds while it's open.
export default function ChatModal({ requestId, name, onClose }: { requestId: number; name: string; onClose: () => void }) {
  const t = useTheme();
  const { t: tx, dateTime } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const last = useRef(0);
  const warned = useRef(false);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((cur) => {
      const have = new Set((cur ?? []).map((m) => m.id));
      const fresh = incoming.filter((m) => !have.has(m.id));
      return fresh.length || cur === null ? [...(cur ?? []), ...fresh].sort((a, b) => a.id - b.id) : cur;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await api.messages(requestId, last.current);
      if (r.messages.length) last.current = Math.max(last.current, ...r.messages.map((m) => m.id));
      merge(r.messages);
      warned.current = false;
    } catch (e) {
      setMessages((cur) => cur ?? []); // show the empty state rather than a spinner forever; the next poll retries
      if (!warned.current) { warned.current = true; Alert.alert(tx("chat.load_failed"), (e as Error).message); } // once, not every 4 seconds
    }
  }, [requestId, merge, tx]);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await api.sendMessage(requestId, body);
      setText("");
      merge([m]); // shown right away; `last` only moves on polls, so the other person's messages are never skipped
    } catch (e) {
      Alert.alert(tx("common.send_failed"), (e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 }}>
            <Text style={{ color: t.fg, fontSize: 18, fontWeight: "700", flexShrink: 1 }}>{tx("chat.title", { name })}</Text>
            <View><Button title={tx("common.close")} kind="ghost" onPress={onClose} /></View>
          </View>

          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          >
            {messages !== null && messages.length === 0 && <Muted>{tx("chat.empty")}</Muted>}
            {(messages ?? []).map((m) => (
              <View
                key={m.id}
                style={{
                  alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "80%", padding: 10, borderRadius: 14, borderWidth: 1,
                  borderColor: m.mine ? t.accent : t.line, backgroundColor: m.mine ? t.accent : t.card,
                }}
              >
                <Text style={{ color: m.mine ? "#fff" : t.fg }}>{m.body}</Text>
                <Text style={{ color: m.mine ? "#ffffffb3" : t.muted, fontSize: 11, marginTop: 2 }}>
                  {dateTime(m.created_at)}
                </Text>
              </View>
            ))}
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 8, padding: 12, alignItems: "flex-end" }}>
            <TextInput
              value={text}
              placeholder={tx("chat.placeholder")}
              placeholderTextColor={t.muted}
              onChangeText={(v) => setText(core.truncateGraphemes(v, 1000))}
              multiline
              accessibilityLabel={tx("chat.aria")}
              style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 10, color: t.fg, backgroundColor: t.card, fontSize: 16 }}
            />
            <Button title={tx("common.send")} onPress={send} disabled={sending || !text.trim()} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
