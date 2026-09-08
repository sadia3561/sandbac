import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

const TABS = [
  { k: "upcoming", label: "Upcoming" },
  { k: "active", label: "Active" },
  { k: "completed", label: "Completed" },
  { k: "cancelled", label: "Cancelled" },
];

const statusColor = (s: string) => {
  if (s === "SERVICE_COMPLETED") return colors.success;
  if (s === "CANCELLED" || s === "EXPIRED") return colors.error;
  if (s.includes("PROVIDER") || s === "CONFIRMED" || s.includes("SERVICE") || s === "ARRIVED") return colors.warning;
  return colors.info;
};

export default function BookingsTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState("upcoming");
  const q = useQuery({ queryKey: ["bookings", tab], queryFn: () => api.bookings(tab) });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>My Bookings</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {TABS.map((t) => (
            <Pressable key={t.k} onPress={() => setTab(t.k)} style={[styles.chip, tab === t.k && styles.chipActive]} testID={`bookings-tab-${t.k}`}>
              <Text style={[styles.chipText, tab === t.k && styles.chipTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {q.isLoading ? <LoadingView /> :
       q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> :
       !q.data?.length ? <EmptyView title="No bookings yet" message="Explore services and make your first booking" ctaLabel="Explore" onCta={() => router.push("/(tabs)")} /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        >
          {q.data.map((b: any) => (
            <Pressable key={b.id} style={styles.card} onPress={() => router.push(`/booking/${b.id}`)} testID={`booking-card-${b.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.cardTitle}>{b.service_name}</Text>
                <View style={[styles.pill, { backgroundColor: statusColor(b.status) + "20" }]}>
                  <Text style={[styles.pillText, { color: statusColor(b.status) }]}>{b.status.replaceAll("_", " ")}</Text>
                </View>
              </View>
              <Text style={styles.cardSub}>{b.package_name}{b.design_title ? ` • ${b.design_title}` : ""}</Text>
              <Text style={styles.cardSub}>{b.booking_type}{b.scheduled_at ? ` • ${new Date(b.scheduled_at).toLocaleString("en-IN")}` : ""}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm }}>
                <Text style={styles.price}>{rupees(b.price_paise)}</Text>
                {b.provider_name ? <Text style={styles.cardSub}>{b.provider_name}</Text> : <Text style={styles.cardSub}>Provider TBD</Text>}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold, marginBottom: spacing.md },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: font.weightMedium },
  chipTextActive: { color: colors.onBrandPrimary },
  card: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, gap: 4 },
  cardTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold, flex: 1 },
  cardSub: { color: colors.muted, fontSize: font.sm },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: font.sm, fontWeight: font.weightSemibold },
  price: { color: colors.brand, fontWeight: font.weightBold, fontSize: font.lg },
});
