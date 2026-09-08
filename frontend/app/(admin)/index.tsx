import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, StatCard, StatusPill } from "@/src/components/admin";
import { colors, spacing, font } from "@/src/theme";

export default function AdminDashboard() {
  const q = useQuery({ queryKey: ["admin", "dash"], queryFn: api.adminDashboard });
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  const s = q.data?.stats || {};
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.grid}>
        <StatCard label="Customers" value={s.customers_total || 0} />
        <StatCard label="Providers" value={s.providers_total || 0} sub={`${s.providers_online || 0} online`} />
        <StatCard label="Pending KYC" value={s.providers_pending_kyc || 0} color={colors.warning} />
        <StatCard label="Active bookings" value={s.bookings_active || 0} color={colors.info} />
        <StatCard label="Completed" value={s.bookings_completed || 0} color={colors.success} />
        <StatCard label="Cancelled" value={s.bookings_cancelled || 0} color={colors.error} />
        <StatCard label="Portfolio pending" value={s.portfolio_pending || 0} color={colors.warning} />
        <StatCard label="Revenue" value={rupees(s.revenue_paise || 0)} sub={`Platform ${rupees(s.platform_paise || 0)}`} color={colors.brand} />
        <StatCard label="Pending payouts" value={rupees(s.pending_payouts_paise || 0)} />
      </View>

      <Text style={styles.section}>Recent bookings</Text>
      <Card>
        {(q.data?.recent_bookings || []).length === 0 ? <Text style={{ color: colors.muted }}>No bookings yet.</Text> :
          (q.data?.recent_bookings || []).map((b: any) => (
            <View key={b.id} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineTitle}>{b.service_name} • {b.package_name}</Text>
                <Text style={styles.lineSub}>{new Date(b.created_at).toLocaleString("en-IN")} • {rupees(b.price_paise)}</Text>
              </View>
              <StatusPill status={b.status} />
            </View>
          ))
        }
      </Card>

      <Text style={styles.section}>Recent providers</Text>
      <Card>
        {(q.data?.recent_providers || []).length === 0 ? <Text style={{ color: colors.muted }}>No providers yet.</Text> :
          (q.data?.recent_providers || []).map((p: any) => (
            <View key={p.id} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineTitle}>{p.business_name}</Text>
                <Text style={styles.lineSub}>{p.provider_type} • {p.base_city || "-"}</Text>
              </View>
              <StatusPill status={p.kyc_status} />
            </View>
          ))
        }
      </Card>

      <Text style={styles.section}>Pending KYC</Text>
      <Card>
        {(q.data?.pending_kyc || []).length === 0 ? <Text style={{ color: colors.muted }}>Queue empty.</Text> :
          (q.data?.pending_kyc || []).map((p: any) => (
            <View key={p.id} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineTitle}>{p.business_name}</Text>
                <Text style={styles.lineSub}>{p.provider_type} • Submitted {new Date(p.updated_at).toLocaleDateString("en-IN")}</Text>
              </View>
              <StatusPill status="PENDING" />
            </View>
          ))
        }
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  section: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.md },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  lineTitle: { color: colors.onSurface, fontWeight: font.weightSemibold },
  lineSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
