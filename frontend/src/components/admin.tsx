import React, { PropsWithChildren } from "react";
import { View, Text, StyleSheet, ViewStyle, StyleProp, TextInput, Pressable, ActivityIndicator } from "react-native";
import { colors, spacing, font, radius } from "@/src/theme";

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <View style={[styles.card, { minWidth: 200, flex: 1 }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export function Th({ children, flex = 1, width }: PropsWithChildren<{ flex?: number; width?: number }>) {
  return <View style={[styles.th, width ? { width } : { flex }]}><Text style={styles.thText}>{children}</Text></View>;
}
export function Td({ children, flex = 1, width, mono }: PropsWithChildren<{ flex?: number; width?: number; mono?: boolean }>) {
  return (
    <View style={[styles.td, width ? { width } : { flex }]}>
      {typeof children === "string" || typeof children === "number"
        ? <Text style={[styles.tdText, mono && styles.mono]}>{children}</Text>
        : children}
    </View>
  );
}
export function Row({ children, style, hover }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; hover?: boolean }>) {
  return <View style={[styles.row, hover && styles.rowHover, style]}>{children}</View>;
}
export function Badge({ label, color = colors.info }: { label: string; color?: string }) {
  return <View style={[styles.badge, { backgroundColor: color + "20" }]}><Text style={[styles.badgeText, { color }]}>{label}</Text></View>;
}
export function Btn({ label, onPress, variant = "primary", small, loading, disabled, testID }: any) {
  const isD = disabled || loading;
  return (
    <Pressable style={[styles.btn, small && styles.btnSmall, variant === "danger" && styles.btnDanger, variant === "secondary" && styles.btnSec, variant === "ghost" && styles.btnGhost, isD && { opacity: 0.5 }]} onPress={isD ? undefined : onPress} testID={testID}>
      {loading ? <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : colors.onSurface} /> :
        <Text style={[styles.btnText, small && styles.btnTextSmall, variant === "danger" && { color: "#fff" }, variant === "ghost" && { color: colors.onSurface }, variant === "secondary" && { color: colors.brand }]}>{label}</Text>
      }
    </Pressable>
  );
}
export function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />;
}
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    APPROVED: colors.success, ACTIVE: colors.success, AVAILABLE: colors.success, SERVICE_COMPLETED: colors.success,
    PENDING: colors.warning, PENDING_REVIEW: colors.warning, BUSY: colors.warning, ON_SERVICE: colors.warning,
    REJECTED: colors.error, CANCELLED: colors.error, EXPIRED: colors.error, OFFLINE: colors.muted,
    NOT_SUBMITTED: colors.muted, INACTIVE: colors.muted, DRAFT: colors.muted,
  };
  const c = map[status] || colors.info;
  return <Badge label={status.replaceAll("_", " ")} color={c} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.divider },
  statLabel: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightMedium },
  statValue: { color: colors.onSurface, fontSize: 28, fontWeight: font.weightBold, marginTop: 6 },
  statSub: { color: colors.muted, fontSize: font.sm, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.divider, paddingHorizontal: spacing.md, minHeight: 52 },
  rowHover: { backgroundColor: colors.surfaceSecondary },
  th: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  thText: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightBold, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  tdText: { color: colors.onSurface, fontSize: font.base },
  mono: { fontFamily: "monospace" as any },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: font.weightBold, letterSpacing: 0.3 },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  btnSmall: { paddingHorizontal: spacing.sm + 2, paddingVertical: 6 },
  btnDanger: { backgroundColor: colors.error },
  btnSec: { backgroundColor: colors.brandTertiary },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  btnText: { color: "#fff", fontWeight: font.weightSemibold },
  btnTextSmall: { fontSize: font.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
});
