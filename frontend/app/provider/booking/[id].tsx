import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from "react-native";
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

const REJECT_REASONS = ["Not available", "Too far", "Wrong service", "Timing issue", "Other"];

const NEXT_ACTION: Record<string, { label: string; status: string }> = {
  PROVIDER_ACCEPTED: { label: "I'm on the way", status: "PROVIDER_ON_THE_WAY" },
  CONFIRMED: { label: "I'm on the way", status: "PROVIDER_ON_THE_WAY" },
  PROVIDER_ON_THE_WAY: { label: "I've Arrived", status: "ARRIVED" },
  ARRIVED: { label: "Start Service", status: "SERVICE_STARTED" },
  SERVICE_STARTED: { label: "Complete Service", status: "SERVICE_COMPLETED" },
};

export default function ProviderBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showReasons, setShowReasons] = useState(false);

  // Try provider-owned first, then unclaimed
  const b = useQuery({
    queryKey: ["prov", "booking-detail", id],
    queryFn: async () => {
      try { return await api.providerBooking(id!); }
      catch {
        const reqs = await api.providerRequests();
        return reqs.find((r: any) => r.id === id);
      }
    },
    enabled: !!id,
  });

  if (b.isLoading) return <LoadingView />;
  if (b.error) return <ErrorView message={(b.error as any).message} onRetry={() => b.refetch()} />;
  if (!b.data) return <ErrorView message="Booking not found" />;

  const booking = b.data;
  const isUnclaimed = !booking.provider_id;
  const next = NEXT_ACTION[booking.status];

  const accept = async () => {
    setBusy(true);
    try {
      await api.providerAccept(booking.id);
      qc.invalidateQueries();
      Alert.alert("Accepted", "Booking assigned to you.");
      router.replace(`/provider/booking/${booking.id}` as any);
    } catch (e: any) {
      Alert.alert("Cannot accept", e?.message === "This booking is no longer available"
        ? "This booking was already accepted by another provider."
        : (e?.message || "Failed"));
      router.back();
    } finally { setBusy(false); }
  };

  const reject = async (reason: string) => {
    setBusy(true);
    try {
      await api.providerReject(booking.id, reason);
      qc.invalidateQueries();
      router.back();
    } catch (e: any) { Alert.alert("Reject", e?.message || "Failed"); }
    finally { setBusy(false); setShowReasons(false); }
  };

  const doTransition = async (status: string) => {
    setBusy(true);
    try {
      await api.providerTransition(booking.id, status);
      qc.invalidateQueries();
    } catch (e: any) { Alert.alert("Update", e?.message || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Booking</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 200 }}>
        <View style={styles.hero}>
          <View style={[styles.badge, { backgroundColor: booking.booking_type === "ASAP" ? colors.error + "20" : colors.info + "20" }]}>
            <Text style={[styles.badgeText, { color: booking.booking_type === "ASAP" ? colors.error : colors.info }]}>
              {booking.booking_type === "ASAP" ? "⚡ ASAP" : `📅 ${booking.booking_type}`}
            </Text>
          </View>
          <Text style={styles.title}>{booking.service_name}</Text>
          <Text style={styles.sub}>{booking.package_name}{booking.design_title ? ` • ${booking.design_title}` : ""}</Text>
          <Text style={styles.price}>{rupees(booking.price_paise)}</Text>
          <Text style={styles.bid}>Booking {booking.id.slice(0, 8).toUpperCase()} • Status: {booking.status.replaceAll("_", " ")}</Text>
        </View>

        {booking.address ? (
          <View style={styles.card}>
            <Text style={styles.section}>Customer address</Text>
            <Text style={styles.value}>{booking.address.house}, {booking.address.street}</Text>
            <Text style={styles.sub}>{booking.address.landmark ? booking.address.landmark + " • " : ""}{booking.address.city} - {booking.address.pincode}</Text>
          </View>
        ) : null}

        {booking.scheduled_at ? (
          <View style={styles.card}>
            <Text style={styles.section}>When</Text>
            <Text style={styles.value}>{new Date(booking.scheduled_at).toLocaleString("en-IN")}</Text>
          </View>
        ) : null}

        {booking.design_title ? (
          <View style={styles.card}>
            <Text style={styles.section}>Customer selected design</Text>
            <Text style={styles.value}>{booking.design_title}</Text>
          </View>
        ) : null}

        {booking.reference_image_url ? (
          <View style={styles.card}>
            <Text style={styles.section}>Customer reference</Text>
            <Image source={{ uri: abs(booking.reference_image_url) }} style={styles.refImg} contentFit="cover" />
            {booking.reference_note ? <Text style={styles.sub}>{booking.reference_note}</Text> : null}
            <Text style={styles.hint}>This is a customer requirement/reference. Delivery is not guaranteed to be identical.</Text>
          </View>
        ) : null}

        {booking.notes ? (
          <View style={styles.card}>
            <Text style={styles.section}>Notes</Text>
            <Text style={styles.value}>{booking.notes}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {isUnclaimed ? (
          showReasons ? (
            <View style={{ gap: spacing.sm, width: "100%" }}>
              <Text style={{ color: colors.onSurface, fontWeight: font.weightSemibold }}>Reject reason</Text>
              {REJECT_REASONS.map((r) => (
                <Pressable key={r} style={styles.reasonBtn} onPress={() => reject(r)} testID={`reject-reason-${r}`}>
                  <Text>{r}</Text>
                </Pressable>
              ))}
              <Button label="Cancel" variant="ghost" onPress={() => setShowReasons(false)} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button label="Reject" variant="secondary" onPress={() => setShowReasons(true)} fullWidth={false} style={{ flex: 1 }} testID="reject-btn" />
              <Button label="Accept" onPress={accept} loading={busy} fullWidth={false} style={{ flex: 1 }} testID="accept-btn" />
            </View>
          )
        ) : next ? (
          <Button label={next.label} onPress={() => doTransition(next.status)} loading={busy} testID={`transition-${next.status}`} />
        ) : (
          <Text style={{ color: colors.muted, textAlign: "center" }}>No further actions.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  hero: { backgroundColor: colors.brandTertiary, padding: spacing.lg, borderRadius: radius.md, gap: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontWeight: font.weightBold, fontSize: font.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold, marginTop: spacing.sm },
  sub: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.sm },
  bid: { color: colors.muted, fontSize: font.sm, marginTop: 4 },
  card: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, gap: 4 },
  section: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, textTransform: "uppercase", letterSpacing: 0.5 },
  value: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  hint: { color: colors.warning, fontSize: font.sm, marginTop: 4 },
  refImg: { width: "100%", height: 200, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  reasonBtn: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm },
});
