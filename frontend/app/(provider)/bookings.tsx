import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

const TABS = [
  { k: "new", label: "New" },
  { k: "upcoming", label: "Upcoming" },
  { k: "active", label: "Active" },
  { k: "completed", label: "Completed" },
  { k: "cancelled", label: "Cancelled" },
];

export default function ProviderBookings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState("new");
  const q = useQuery({
    queryKey: ["prov", "bookings", tab],
    queryFn: () => (tab === "new" ? api.providerRequests() : api.providerBookings(tab)),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Bookings</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {TABS.map((t) => (
            <Pressable key={t.k} onPress={() => setTab(t.k)} style={[styles.chip, tab === t.k && styles.chipActive]} testID={`prov-tab-${t.k}`}>
              <Text style={[styles.chipText, tab === t.k && styles.chipTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {q.isLoading ? <LoadingView /> :
       q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> :
       !q.data?.length ? <EmptyView title={tab === "new" ? "No new requests" : "Nothing here yet"} message="Pull to refresh" /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        >
          {q.data.map((b: any) => (
            <Pressable key={b.id} style={styles.card} onPress={() => router.push(`/provider/booking/${b.id}` as any)} testID={`prov-booking-${b.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={[styles.badge, { backgroundColor: b.booking_type === "ASAP" ? colors.error + "20" : colors.info + "20" }]}>
                  <Text style={[styles.badgeText, { color: b.booking_type === "ASAP" ? colors.error : colors.info }]}>
                    {b.booking_type === "ASAP" ? "⚡ ASAP" : `📅 ${b.booking_type}`}
                  </Text>
                </View>
                <Text style={styles.price}>{rupees(b.price_paise)}</Text>
              </View>
              <Text style={styles.title2}>{b.service_name}</Text>
              <Text style={styles.sub}>{b.package_name}{b.design_title ? ` • ${b.design_title}` : ""}</Text>
              <Text style={styles.sub}>{b.address?.city} • {b.address?.pincode}</Text>
              {b.scheduled_at ? <Text style={styles.sub}>{new Date(b.scheduled_at).toLocaleString("en-IN")}</Text> : null}
              <Text style={styles.status}>{b.status.replaceAll("_", " ")}</Text>
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
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: font.sm, fontWeight: font.weightBold },
  title2: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold, marginTop: 4 },
  sub: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontWeight: font.weightBold, fontSize: font.lg },
  status: { color: colors.brandPrimary, fontSize: font.sm, fontWeight: font.weightSemibold, marginTop: 4 },
});
