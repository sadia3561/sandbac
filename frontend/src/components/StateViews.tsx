import React from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { makeStyles, spacing, font, radius } from "@/src/theme";

export const LoadingView = ({ label }: { label?: string }) => {
  const s = useStyles();
  return (
    <View style={s.center} testID="loading-view">
      <ActivityIndicator />
      {label ? <Text style={s.muted}>{label}</Text> : null}
    </View>
  );
};

export const EmptyView = ({
  title, message, ctaLabel, onCta, testID,
}: { title: string; message?: string; ctaLabel?: string; onCta?: () => void; testID?: string }) => {
  const s = useStyles();
  return (
    <View style={s.center} testID={testID || "empty-view"}>
      <Text style={s.emptyTitle}>{title}</Text>
      {message ? <Text style={s.muted}>{message}</Text> : null}
      {ctaLabel && onCta ? (
        <Pressable onPress={onCta} style={s.cta} testID="empty-cta">
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

export const ErrorView = ({ message, onRetry }: { message?: string; onRetry?: () => void }) => {
  const s = useStyles();
  return (
    <View style={s.center} testID="error-view">
      <Text style={s.emptyTitle}>Something went wrong</Text>
      {message ? <Text style={s.muted}>{message}</Text> : null}
      {onRetry ? (
        <Pressable onPress={onRetry} style={s.cta} testID="retry-btn">
          <Text style={s.ctaText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const useStyles = makeStyles((c) => ({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  muted: { color: c.muted, fontSize: font.base, textAlign: "center" },
  emptyTitle: { color: c.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  cta: { backgroundColor: c.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  ctaText: { color: c.onBrandPrimary, fontWeight: font.weightSemibold },
}));
