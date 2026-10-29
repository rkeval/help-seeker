import { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, useColorScheme } from "react-native";
import { core, useI18n } from "./i18n";

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
      <Text style={{ color: kind === "primary" ? "#fff" : t.fg, fontWeight: "600", textAlign: "center", lineHeight: 22 }}>{title}</Text>
    </Pressable>
  );
}

// `maxChars` limits what people see as characters (grapheme clusters), not UTF-16 code units, so Indic text isn't cut short;
// an over-long paste is cut between clusters. (React Native's own `maxLength` counts code units, so it is not used.)
export function Field({ label, maxChars, onChangeText, ...props }: { label: string; maxChars?: number } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        {...props}
        onChangeText={maxChars && onChangeText ? (v) => onChangeText(core.truncateGraphemes(v, maxChars)) : onChangeText}
        style={[s.input, { borderColor: t.line, color: t.fg, backgroundColor: t.bg }, props.multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.line }]}>{children}</View>;
}

export function Chip({ label, selected, onPress, lang }: { label: string; selected?: boolean; onPress?: () => void; lang?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: !!selected }}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLanguage={lang}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[s.chip, { borderColor: selected ? t.accent : t.line, backgroundColor: selected ? t.accent : "transparent" }]}
    >
      <Text style={{ color: selected ? "#fff" : t.fg, fontSize: 14, lineHeight: 20 }}>{label}</Text>
    </Pressable>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{children}</Text>;
};

// The language picker: every language written in its own script (autonym), each tagged with its own language so a screen reader
// pronounces it correctly. Used on the sign-in screen, in Account and in the language sheet opened from the header.
export function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("lang.label")}>
      <Muted>{t("lang.label")}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
        {core.LANGS.map((l) => <Chip key={l.code} label={l.name} lang={l.code} selected={lang === l.code} onPress={() => setLang(l.code)} />)}
      </View>
    </View>
  );
}

export const Loading = () => <ActivityIndicator style={{ margin: 24 }} />;

const s = StyleSheet.create({
  btn: { minHeight: 48, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minHeight: 48 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, minHeight: 40, justifyContent: "center", marginRight: 8, marginBottom: 8 },
});
