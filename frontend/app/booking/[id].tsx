import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

const STAGES = [
  "PENDING", "SEARCHING_PROVIDER", "PROVIDER_ACCEPTED", "CONFIRMED",
  "PROVIDER_ON_THE_WAY", "ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED",
];

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ["booking", id], queryFn: () => api.booking(id!), enabled: !!id });
  const currentIdx = b.data ? STAGES.indexOf(b.data.status) : -1;
  const isTerminal = b.data && (b.data.status === "CANCELLED" || b.data.status === "EXPIRED");

  if (b.isLoading) return <LoadingView />;
  if (b.error) return <ErrorView message={(b.error as any).message} onRetry={() => b.refetch()} />;
  if (!b.data) return null;

  const onCancel = async () => {
    try { await api.cancelBooking(b.data.id); qc.invalidateQueries({ queryKey: ["booking", id] }); qc.invalidateQueries({ queryKey: ["bookings"] }); } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Booking</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.hero}>
          <Text style={styles.status}>{b.data.status.replaceAll("_", " ")}</Text>
          <Text style={styles.title}>{b.data.service_name}</Text>
          <Text style={styles.sub}>{b.data.package_name}{b.data.design_title ? ` • ${b.data.design_title}` : ""}</Text>
          <Text style={styles.price}>{rupees(b.data.price_paise)}</Text>
          <Text style={styles.bid}>Booking ID: {b.data.id.slice(0, 8).toUpperCase()}</Text>
        </View>

        {b.data.status === "SEARCHING_PROVIDER" ? (
          <View style={styles.searchBox}>
            <Text style={styles.searchTitle}>Finding a provider near you…</Text>
            <Text style={styles.sub}>We'll notify you when someone accepts your request.</Text>
          </View>
        ) : null}

        {!isTerminal ? (
          <View style={styles.card}>
            <Text style={styles.section}>Progress</Text>
            <View style={{ gap: 6 }}>
              {STAGES.map((s, idx) => {
                const done = currentIdx >= idx;
                const active = currentIdx === idx;
                return (
                  <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]} />
                    <Text style={[styles.stage, done && { color: colors.onSurface }]}>{s.replaceAll("_", " ")}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.section}>Provider</Text>
          <Text style={styles.value}>{b.data.provider_name || "To be assigned"}</Text>
        </View>

        {b.data.scheduled_at ? (
          <View style={styles.card}>
            <Text style={styles.section}>Scheduled</Text>
            <Text style={styles.value}>{new Date(b.data.scheduled_at).toLocaleString("en-IN")}</Text>
          </View>
        ) : null}

        {b.data.address ? (
          <View style={styles.card}>
            <Text style={styles.section}>Address</Text>
            <Text style={styles.value}>{b.data.address.label}</Text>
            <Text style={styles.sub}>{b.data.address.house}, {b.data.address.street}, {b.data.address.city} - {b.data.address.pincode}</Text>
          </View>
        ) : null}

        {b.data.reference_image_url ? (
          <View style={styles.card}>
            <Text style={styles.section}>Your reference</Text>
            <Image source={{ uri: abs(b.data.reference_image_url) }} style={styles.refImg} contentFit="cover" />
            {b.data.reference_note ? <Text style={styles.sub}>{b.data.reference_note}</Text> : null}
          </View>
        ) : null}

        {b.data.notes ? (
          <View style={styles.card}>
            <Text style={styles.section}>Notes</Text>
            <Text style={styles.value}>{b.data.notes}</Text>
          </View>
        ) : null}

        {!isTerminal && b.data.status !== "SERVICE_COMPLETED" ? (
          <Button label="Cancel booking" variant="ghost" onPress={onCancel} testID="cancel-booking-btn" />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  hero: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  status: { color: colors.brand, fontWeight: font.weightBold, letterSpacing: 1, fontSize: font.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold, marginTop: spacing.xs },
  sub: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.sm },
  bid: { color: colors.muted, fontSize: font.sm, marginTop: 4 },
  searchBox: { backgroundColor: colors.warning + "20", padding: spacing.md, borderRadius: radius.md },
  searchTitle: { color: colors.warning, fontWeight: font.weightBold, fontSize: font.base },
  card: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, gap: 4 },
  section: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, textTransform: "uppercase", letterSpacing: 0.5 },
  value: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.divider },
  dotDone: { backgroundColor: colors.success },
  dotActive: { backgroundColor: colors.brandPrimary, transform: [{ scale: 1.3 }] },
  stage: { color: colors.muted, fontSize: font.base },
  refImg: { width: "100%", height: 180, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
});
