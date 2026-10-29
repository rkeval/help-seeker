import { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, useColorScheme } from "react-native";

export const palette = (dark: boolean) => ({
  bg: dark ? "#12151b" : "#f6f7f9",
  card: dark ? "#1b2029" : "#ffffff",
  fg: dark ? "#e8ebf0" : "#1d2330",
  muted: dark ? "#9aa3b2" : "#667085",
  line: dark ? "#2a303c" : "#e3e6eb",
  accent: dark ? "#6c9bff" : "#2f6fed",
  danger: "#d92d20",
  ok: "#12804b",
});
export const useTheme = () => palette(useColorScheme() === "dark");

export function Button({ title, onPress, kind = "primary", disabled }: {
  title: string; onPress: () => void; kind?: "primary" | "ghost"; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        kind === "primary" ? { backgroundColor: t.accent } : { borderWidth: 1, borderColor: t.line },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={{ color: kind === "primary" ? "#fff" : t.fg, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        {...props}
        style={[s.input, { borderColor: t.line, color: t.fg, backgroundColor: t.bg }, props.multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.line }]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: !!selected }}
      style={[s.chip, { borderColor: selected ? t.accent : t.line, backgroundColor: selected ? t.accent : "transparent" }]}
    >
      <Text style={{ color: selected ? "#fff" : t.fg, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 13 }}>{children}</Text>;
};

export const Loading = () => <ActivityIndicator style={{ margin: 24 }} />;

const s = StyleSheet.create({
  btn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
});
