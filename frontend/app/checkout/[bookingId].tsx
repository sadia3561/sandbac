import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, ApiError } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

/**
 * SANDBAC Checkout — Prompt 9
 *
 * Flow:
 *   1. Load booking (server-authoritative price)
 *   2. Load payment gateway public config (never any secrets)
 *   3. Load latest payment for booking (retry-friendly)
 *   4. On "Pay now":
 *        POST /payments/order → gets client-safe payload
 *        POST /payments/mock/pay → simulates gateway (test env only)
 *        POST /payments/verify → captures on backend
 *   5. Show success / retry / cancel
 */
export default function Checkout() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const bk = useQuery({ queryKey: ["booking", bookingId], queryFn: () => api.booking(bookingId!), enabled: !!bookingId });
  const cfg = useQuery({ queryKey: ["payment", "config"], queryFn: () => api.paymentConfig() });
  const existing = useQuery({
    queryKey: ["payment", "of-booking", bookingId],
    queryFn: () => api.bookingPayment(bookingId!),
    enabled: !!bookingId,
    refetchInterval: 3000,
  });
  const attempts = useQuery({
    queryKey: ["payment", "attempts", bookingId],
    queryFn: () => api.bookingPaymentAttempts(bookingId!),
    enabled: !!bookingId,
  });

  const isCaptured = existing.data?.state === "CAPTURED"
    || existing.data?.state === "PARTIALLY_REFUNDED"
    || existing.data?.state === "REFUNDED";

  const [status, setStatus] = useState<"idle" | "opening" | "verifying" | "success" | "failed">("idle");
  const [failMsg, setFailMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isCaptured) setStatus("success");
  }, [isCaptured]);

  const pay = useMutation({
    mutationFn: async () => {
      setFailMsg(null);
      setStatus("opening");
      const order = await api.createPaymentOrder(bookingId!);
      const gwp = order.gateway_payload;
      // Simulate gateway checkout — real Razorpay would open its native SDK here.
      const paid = await api.mockPay(order.payment_id, gwp.gateway_order_id);
      setStatus("verifying");
      await api.verifyPayment(order.payment_id, gwp.gateway_order_id, paid.gateway_payment_id, paid.gateway_signature);
      return true;
    },
    onSuccess: () => {
      setStatus("success");
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["payment", "of-booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["payment", "attempts", bookingId] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["customerPayments"] });
    },
    onError: (e: any) => {
      setStatus("failed");
      setFailMsg(e instanceof ApiError ? e.message : "Payment could not be completed.");
    },
  });

  if (bk.isLoading || cfg.isLoading) return <LoadingView />;
  if (bk.error) return <ErrorView message={(bk.error as any).message} onRetry={() => bk.refetch()} />;
  if (!bk.data) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        {/* Booking summary */}
        <View style={styles.card}>
          <Text style={styles.section}>Order summary</Text>
          <Row label="Service" value={bk.data.service_name} />
          <Row label="Package" value={bk.data.package_name} />
          {bk.data.design_title ? <Row label="Design" value={bk.data.design_title} /> : null}
          <Row label="When" value={bk.data.booking_type === "ASAP" ? "As soon as possible" : new Date(bk.data.scheduled_at).toLocaleString()} />
          {bk.data.address ? <Row label="Address" value={`${bk.data.address.house}, ${bk.data.address.street}, ${bk.data.address.city}`} multiline /> : null}
        </View>

        {/* Amount (backend-authoritative) */}
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Amount to pay</Text>
          <Text style={styles.amountValue}>{rupees(bk.data.price_paise)}</Text>
          <Text style={styles.currency}>{cfg.data?.currency || "INR"} · Verified by SANDBAC</Text>
        </View>

        {/* Payment status card */}
        {status === "success" ? (
          <View style={[styles.card, { borderLeftColor: colors.success, borderLeftWidth: 4 }]}>
            <View style={styles.rowFlex}>
              <Icon name="checkmark-circle" size={28} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.successTitle}>Payment successful</Text>
                <Text style={styles.subMuted}>
                  Reference: {existing.data?.gateway_payment_id?.slice(-10) || "—"}
                </Text>
              </View>
            </View>
            <Button label="Back to booking" onPress={() => router.replace(`/booking/${bookingId}`)} variant="primary" />
          </View>
        ) : status === "failed" ? (
          <View style={[styles.card, { borderLeftColor: colors.error, borderLeftWidth: 4 }]}>
            <View style={styles.rowFlex}>
              <Icon name="close-circle" size={28} color={colors.error} />
              <View style={{ flex: 1 }}>
                <Text style={styles.failTitle}>Payment failed</Text>
                <Text style={styles.subMuted}>{failMsg || "Please try again."}</Text>
              </View>
            </View>
            <Button label="Try again" onPress={() => pay.mutate()} variant="primary" />
            <View style={{ height: spacing.xs }} />
            <Button label="Back to booking" onPress={() => router.back()} variant="secondary" />
          </View>
        ) : status === "opening" || status === "verifying" ? (
          <View style={styles.card}>
            <View style={styles.rowFlex}>
              <ActivityIndicator color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>
                  {status === "opening" ? "Contacting payment gateway…" : "Verifying payment…"}
                </Text>
                <Text style={styles.subMuted}>Please don't close this screen.</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.section}>Payment method</Text>
            <View style={styles.methodBox}>
              <Icon name="card" size={22} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>SANDBAC Secure Checkout</Text>
                <Text style={styles.subMuted}>
                  {cfg.data?.environment === "production" ? "Live" : "Test mode"} · UPI / Card / Netbanking
                </Text>
              </View>
            </View>
            <View style={{ height: spacing.sm }} />
            <Button
              title={`Pay ${rupees(bk.data.price_paise)}`}
              onPress={() => pay.mutate()}
              variant="primary"
              testID="pay-btn"
              disabled={bk.data.status === "CANCELLED" || bk.data.status === "EXPIRED"}
            />
          </View>
        )}

        {/* Attempts history */}
        {attempts.data && attempts.data.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.section}>Payment attempts</Text>
            {attempts.data.map((a, i) => (
              <View key={a.id} style={styles.attemptRow}>
                <Text style={styles.attemptNo}>#{a.attempt_no}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.attemptState}>{a.state}</Text>
                  <Text style={styles.subMuted}>{new Date(a.created_at).toLocaleString()}</Text>
                </View>
                <Text style={styles.attemptAmt}>{rupees(a.amount_paise)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.legal}>
          Payments processed securely by SANDBAC. The amount shown is calculated and verified server-side.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  return (
    <View style={{ flexDirection: "row", paddingVertical: 6, gap: spacing.md }}>
      <Text style={{ width: 80, color: colors.muted, fontSize: font.sm }}>{label}</Text>
      <Text style={{ flex: 1, color: colors.onSurface, fontSize: font.base, ...(multiline ? {} : { }) }} numberOfLines={multiline ? 3 : 1}>
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  headerTitle: { fontSize: font.lg, fontWeight: font.weightSemibold, color: colors.onSurface },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  section: { fontSize: font.base, fontWeight: font.weightSemibold, color: colors.onSurface, marginBottom: spacing.xs },
  amountBox: {
    backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.xl, alignItems: "center",
  },
  amountLabel: { color: colors.onBrand, opacity: 0.85, fontSize: font.sm },
  amountValue: { color: colors.onBrand, fontSize: font.xxxl, fontWeight: font.weightBold, marginVertical: 4 },
  currency: { color: colors.onBrand, opacity: 0.85, fontSize: font.sm },
  methodBox: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingVertical: spacing.sm },
  methodTitle: { fontSize: font.base, fontWeight: font.weightMedium, color: colors.onSurface },
  subMuted: { fontSize: font.sm, color: colors.muted },
  rowFlex: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingVertical: spacing.sm },
  successTitle: { fontSize: font.lg, fontWeight: font.weightBold, color: colors.success },
  failTitle: { fontSize: font.lg, fontWeight: font.weightBold, color: colors.error },
  pendingTitle: { fontSize: font.base, fontWeight: font.weightMedium, color: colors.onSurface },
  attemptRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  attemptNo: { width: 32, fontSize: font.sm, fontWeight: font.weightSemibold, color: colors.muted },
  attemptState: { fontSize: font.sm, fontWeight: font.weightMedium, color: colors.onSurface },
  attemptAmt: { fontSize: font.sm, fontWeight: font.weightSemibold, color: colors.onSurface },
  legal: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: spacing.md },
});
