// Shared UI primitives — minimal, matched to the web's Apple aesthetic.

import React from "react";
import { Pressable, Text, TextInput, TextProps, View, ViewStyle, TextStyle, StyleSheet, ActivityIndicator } from "react-native";
import { colors, radii, typography } from "./theme";

// Text primitives forward any extra react-native Text props
// (numberOfLines, selectable, onPress, accessibilityRole, etc.) so
// truncation and copy-to-select work at the call sites.
type TextComponentProps = TextProps & { style?: TextStyle };

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.screen, style]}>{children}</View>;
}

export function Eyebrow({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.eyebrow, style]} {...rest}>{String(children).toUpperCase()}</Text>;
}

export function H1({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.h1, style]} {...rest}>{children}</Text>;
}
export function H2({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.h2, style]} {...rest}>{children}</Text>;
}
export function H3({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.h3, style]} {...rest}>{children}</Text>;
}
export function Body({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.body, style]} {...rest}>{children}</Text>;
}
export function Footnote({ children, style, ...rest }: TextComponentProps) {
  return <Text style={[s.foot, style]} {...rest}>{children}</Text>;
}

export function PrimaryButton({ onPress, disabled, busy, label, style }: { onPress: () => void; disabled?: boolean; busy?: boolean; label: string; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[s.btnPrimary, (disabled || busy) && s.btnDisabled, style]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>{label}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({ onPress, disabled, label, style }: { onPress: () => void; disabled?: boolean; label: string; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btnSecondary, disabled && s.btnDisabled, style]}>
      <Text style={s.btnSecondaryText}>{label}</Text>
    </Pressable>
  );
}

export function DangerButton({ onPress, busy, label }: { onPress: () => void; busy?: boolean; label: string }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={[s.btnDanger, busy && s.btnDisabled]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>{label}</Text>}
    </Pressable>
  );
}

export function LinkText({ onPress, children, style }: { onPress: () => void; children: React.ReactNode; style?: TextStyle }) {
  return (
    <Pressable onPress={onPress}><Text style={[s.link, style]}>{children}</Text></Pressable>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput style={[s.input, props.style]} placeholderTextColor={colors.text4} {...props} />;
}

export function Card({ children, tone, style }: { children: React.ReactNode; tone?: "default" | "amber" | "danger" | "success"; style?: ViewStyle }) {
  const styleByTone = {
    default: s.card,
    amber:   [s.card, s.cardAmber],
    danger:  [s.card, s.cardDanger],
    success: [s.card, s.cardSuccess]
  }[tone ?? "default"];
  return <View style={[styleByTone as any, style]}>{children}</View>;
}

export function Divider({ space = 16 }: { space?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: space }} />;
}

export function StatusPill({ label, tone }: { label: string; tone: "amber" | "green" | "red" | "neutral" }) {
  const palette = {
    amber:   { bg: colors.amberSoft,    fg: colors.amberInk },
    green:   { bg: colors.greenSoft,    fg: colors.greenInk },
    red:     { bg: colors.redSoft,      fg: colors.redInk   },
    neutral: { bg: "rgba(0,0,0,0.06)",  fg: colors.text2    }
  }[tone];
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: palette.bg }}>
      <Text style={{ ...typography.caption, color: palette.fg }}>{label.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  eyebrow: { ...typography.caption, color: colors.text3, marginBottom: 4 },
  h1: { ...typography.title1, color: colors.text },
  h2: { ...typography.title2, color: colors.text },
  h3: { ...typography.title3, color: colors.text },
  body: { ...typography.body, color: colors.text },
  foot: { ...typography.footnote, color: colors.text2 },

  btnPrimary: {
    backgroundColor: colors.inkBtn, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: radii.pill, alignItems: "center", justifyContent: "center"
  },
  btnPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  btnSecondary: {
    borderWidth: 1, borderColor: colors.divider, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface
  },
  btnSecondaryText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  btnDanger: {
    backgroundColor: colors.redInk, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: radii.pill, alignItems: "center", justifyContent: "center"
  },
  btnDisabled: { opacity: 0.4 },

  link: { color: colors.text2, fontSize: 13, textDecorationLine: "underline" },

  fieldLabel: { ...typography.caption, color: colors.text3, marginBottom: 6 },
  fieldHint:  { ...typography.footnote, color: colors.text4, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: colors.divider, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: radii.md, fontSize: 15, color: colors.text, backgroundColor: colors.surface
  },

  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1,
    borderColor: colors.divider, padding: 16
  },
  cardAmber:   { borderColor: "rgba(200,135,25,0.3)", backgroundColor: colors.amberSoft },
  cardDanger:  { borderColor: "rgba(180,35,24,0.3)",  backgroundColor: colors.redSoft   },
  cardSuccess: { borderColor: "rgba(52,199,89,0.3)",  backgroundColor: colors.greenSoft }
});
