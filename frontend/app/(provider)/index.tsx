import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const STATE_COLORS: Record<string, string> = {
  OFFLINE: "#8E8E93",
  AVAILABLE: "#34C759",
  BUSY: "#FF453A",
  ON_SERVICE: "#FF9F0A",
};

export default function ProviderHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["prov", "me"], queryFn: api.providerMe });
  const av = useQuery({ queryKey: ["prov", "avail"], queryFn: api.providerAvailability });
  const reqs = useQuery({ queryKey: ["prov", "reqs"], queryFn: api.providerRequests });
  const active = useQuery({ queryKey: ["prov", "bookings", "active"], queryFn: () => api.providerBookings("active") });
  const earn = useQuery({ queryKey: ["prov", "earn-sum"], queryFn: api.providerEarningsSummary });

  const state = av.data?.state || "OFFLINE";
  const goOnline = state !== "OFFLINE";

  const toggleOnline = async () => {
    try {
      const next = goOnline ? "OFFLINE" : "AVAILABLE";
      await api.providerSetAvailability(next);
      qc.invalidateQueries({ queryKey: ["prov", "avail"] });
      qc.invalidateQueries({ queryKey: ["prov", "reqs"] });
    } catch (e: any) { Alert.alert("Availability", e?.message || "Failed"); }
  };

  const loading = me.isLoading || av.isLoading || earn.isLoading;
  const err = me.error || av.error;
  if (loading) return <LoadingView />;
  if (err) return <ErrorView message={(err as any).message} onRetry={() => { me.refetch(); av.refetch(); }} />;

  const refetchAll = () => { me.refetch(); av.refetch(); reqs.refetch(); active.refetch(); earn.refetch(); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={<RefreshControl refreshing={me.isFetching || av.isFetching} onRefresh={refetchAll} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello,</Text>
            <Text style={styles.name}>{me.data?.business_name || me.data?.name}</Text>
          </View>
          <Pressable onPress={() => router.push("/(provider)/notifications" as any)} style={styles.iconBtn} testID="prov-notifs-btn">
            <Icon name="notifications-outline" size={20} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={[styles.statusCard, { backgroundColor: STATE_COLORS[state] + "20" }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={[styles.dot, { backgroundColor: STATE_COLORS[state] }]} />
              <Text style={[styles.statusLabel, { color: STATE_COLORS[state] }]}>{state.replace("_", " ")}</Text>
            </View>
            <Text style={styles.statusHint}>{goOnline ? "You're receiving new requests" : "You won't receive new requests"}</Text>
          </View>
          <Button
            label={goOnline ? "Go Offline" : "Go Online"}
            onPress={toggleOnline}
            variant={goOnline ? "secondary" : "primary"}
            fullWidth={false}
            style={{ paddingHorizontal: spacing.lg }}
            testID={goOnline ? "prov-go-offline-btn" : "prov-go-online-btn"}
          />
        </View>

        <View style={styles.grid}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>Today's earnings</Text>
            <Text style={styles.tileValue}>{rupees(earn.data?.today_paise || 0)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>Total completed</Text>
            <Text style={styles.tileValue}>{me.data?.total_completed || 0}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>Rating</Text>
            <Text style={styles.tileValue}>★ {(me.data?.rating || 0).toFixed(1)}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>KYC</Text>
            <Text style={[styles.tileValue, { fontSize: font.base }]}>{me.data?.kyc_status?.replace("_", " ")}</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <QuickAction icon="calendar-outline" label="My Requests" onPress={() => router.push("/(provider)/bookings")} testID="qa-requests" />
          <QuickAction icon="images-outline" label="Portfolio" onPress={() => router.push("/(provider)/portfolio")} testID="qa-portfolio" />
          <QuickAction icon="time-outline" label="Schedule" onPress={() => router.push("/provider/schedule" as any)} testID="qa-schedule" />
          <QuickAction icon="build-outline" label="Services" onPress={() => router.push("/provider/services" as any)} testID="qa-services" />
        </View>

        <Text style={styles.section}>New requests</Text>
        {reqs.isLoading ? <LoadingView /> :
         !reqs.data?.length ? <Text style={styles.empty}>No new requests right now.</Text> :
          reqs.data.slice(0, 5).map((b: any) => (
            <Pressable key={b.id} style={styles.reqCard} onPress={() => router.push(`/provider/booking/${b.id}` as any)} testID={`req-${b.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={[styles.badge, { backgroundColor: b.booking_type === "ASAP" ? colors.error + "20" : colors.info + "20" }]}>
                  <Text style={[styles.badgeText, { color: b.booking_type === "ASAP" ? colors.error : colors.info }]}>
                    {b.booking_type === "ASAP" ? "⚡ ASAP" : `📅 ${b.booking_type}`}
                  </Text>
                </View>
                <Text style={styles.reqPrice}>{rupees(b.price_paise)}</Text>
              </View>
              <Text style={styles.reqTitle}>{b.service_name}</Text>
              <Text style={styles.reqSub}>{b.package_name}{b.design_title ? ` • ${b.design_title}` : ""}</Text>
              <Text style={styles.reqSub}>{b.address?.city} • {b.address?.pincode}</Text>
              {b.scheduled_at ? <Text style={styles.reqSub}>{new Date(b.scheduled_at).toLocaleString("en-IN")}</Text> : null}
            </Pressable>
          ))
        }

        <Text style={styles.section}>Active</Text>
        {active.isLoading ? <LoadingView /> :
         !active.data?.length ? <Text style={styles.empty}>No active service.</Text> :
          active.data.map((b: any) => (
            <Pressable key={b.id} style={styles.reqCard} onPress={() => router.push(`/provider/booking/${b.id}` as any)} testID={`active-${b.id}`}>
              <Text style={styles.reqTitle}>{b.service_name}</Text>
              <Text style={styles.reqSub}>{b.status.replaceAll("_", " ")}</Text>
              <Text style={styles.reqSub}>{b.address?.city}</Text>
            </Pressable>
          ))
        }
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, onPress, testID }: any) {
  return (
    <Pressable style={styles.qa} onPress={onPress} testID={testID}>
      <View style={styles.qaIcon}><Icon name={icon} size={20} color={colors.brandPrimary} /></View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  hello: { color: colors.muted, fontSize: font.base },
  name: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  statusCard: { marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontWeight: font.weightBold, fontSize: font.base, letterSpacing: 1 },
  statusHint: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  tile: { width: "47%", padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  tileLabel: { color: colors.muted, fontSize: font.sm },
  tileValue: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: 4 },
  actionsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.md, marginVertical: spacing.md },
  qa: { flex: 1, alignItems: "center", gap: 6 },
  qaIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  qaLabel: { color: colors.onSurfaceSecondary, fontSize: font.sm, textAlign: "center" },
  section: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.lg },
  reqCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, gap: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: font.sm, fontWeight: font.weightBold },
  reqPrice: { color: colors.brand, fontWeight: font.weightBold, fontSize: font.lg },
  reqTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold, marginTop: 4 },
  reqSub: { color: colors.muted, fontSize: font.sm },
});
