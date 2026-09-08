import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

export default function EarningsTab() {
  const insets = useSafeAreaInsets();
  const sum = useQuery({ queryKey: ["prov", "earn-sum"], queryFn: api.providerEarningsSummary });
  const list = useQuery({ queryKey: ["prov", "earn-list"], queryFn: api.providerEarnings });

  const err = sum.error || list.error;
  if (sum.isLoading || list.isLoading) return <LoadingView />;
  if (err) return <ErrorView message={(err as any).message} onRetry={() => { sum.refetch(); list.refetch(); }} />;

  const s = sum.data!;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Earnings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={sum.isFetching} onRefresh={() => { sum.refetch(); list.refetch(); }} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total earnings</Text>
          <Text style={styles.heroValue}>{rupees(s.total_paise)}</Text>
          <Text style={styles.heroSub}>{s.completed_count} completed services</Text>
        </View>
        <View style={styles.grid}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>Today</Text>
            <Text style={styles.tileValue}>{rupees(s.today_paise)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>This week</Text>
            <Text style={styles.tileValue}>{rupees(s.week_paise)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>This month</Text>
            <Text style={styles.tileValue}>{rupees(s.month_paise)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>Pending payout</Text>
            <Text style={styles.tileValue}>{rupees(s.pending_payout_paise)}</Text>
          </View>
        </View>
        <Text style={styles.section}>Recent</Text>
        {!list.data?.length ? <Text style={styles.empty}>Complete services to see earnings here.</Text> :
          list.data.map((e: any) => (
            <View key={e.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Booking {e.booking_id.slice(0, 8).toUpperCase()}</Text>
                <Text style={styles.rowSub}>{new Date(e.created_at).toLocaleDateString("en-IN")} • Gross {rupees(e.gross_paise)} • Fee {rupees(e.commission_paise)}</Text>
              </View>
              <Text style={styles.rowNet}>{rupees(e.net_paise)}</Text>
            </View>
          ))
        }
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  hero: { backgroundColor: colors.brandTertiary, padding: spacing.lg, borderRadius: radius.md, gap: 4 },
  heroLabel: { color: colors.brand, fontWeight: font.weightSemibold, fontSize: font.sm, letterSpacing: 1 },
  heroValue: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: font.weightBold },
  heroSub: { color: colors.muted, fontSize: font.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "47%", padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  tileLabel: { color: colors.muted, fontSize: font.sm },
  tileValue: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: 4 },
  section: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.md },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, gap: spacing.md },
  rowTitle: { color: colors.onSurface, fontSize: font.base, fontWeight: font.weightSemibold },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  rowNet: { color: colors.brand, fontWeight: font.weightBold, fontSize: font.lg },
});
