import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Modal, Pressable, TextInput } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, rupees } from "@/src/api/client";
import { Image } from "expo-image";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);
const TABS = ["PENDING_REVIEW", "APPROVED", "REJECTED", ""];

export default function AdminPortfolio() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [reject, setReject] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["admin", "portfolio", status], queryFn: () => api.adminPortfolio(status || undefined) });

  const approve = async (id: string) => {
    setBusy(true);
    try { await api.adminPortfolioApprove(id); qc.invalidateQueries({ queryKey: ["admin", "portfolio"] }); } catch (e: any) { Alert.alert("Error", e?.message); } finally { setBusy(false); }
  };
  const doReject = async () => {
    if (!reject || !reason.trim()) { Alert.alert("Reason required"); return; }
    setBusy(true);
    try { await api.adminPortfolioReject(reject.id, reason.trim()); qc.invalidateQueries({ queryKey: ["admin", "portfolio"] }); setReject(null); setReason(""); }
    catch (e: any) { Alert.alert("Error", e?.message); } finally { setBusy(false); }
  };

  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => setStatus(t)} style={[styles.tab, status === t && styles.tabActive]} testID={`portfolio-tab-${t || "all"}`}>
              <Text style={[styles.tabText, status === t && styles.tabTextActive]}>{t.replaceAll("_", " ") || "All"}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.grid}>
          {(q.data || []).map((d: any) => (
            <View key={d.id} style={styles.card}>
              <Image source={{ uri: abs(d.image_url) }} style={styles.img} contentFit="cover" />
              <View style={{ padding: spacing.md, gap: 4 }}>
                <Text style={styles.title}>{d.title}</Text>
                <Text style={styles.sub}>{d.provider_name || "—"}</Text>
                {d.price_paise ? <Text style={styles.price}>{rupees(d.price_paise)}</Text> : null}
                <StatusPill status={d.approval_status} />
                {d.rejection_reason ? <Text style={{ color: colors.error, fontSize: font.sm }}>{d.rejection_reason}</Text> : null}
                {d.approval_status === "PENDING_REVIEW" ? (
                  <View style={{ flexDirection: "row", gap: 6, marginTop: spacing.sm }}>
                    <Btn small variant="danger" label="Reject" onPress={() => setReject(d)} testID={`port-reject-${d.id}`} />
                    <Btn small label="Approve" loading={busy} onPress={() => approve(d.id)} testID={`port-approve-${d.id}`} />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          {!(q.data || []).length && <Text style={{ color: colors.muted }}>Queue empty for this filter.</Text>}
        </View>
      </Card>

      <Modal visible={!!reject} transparent animationType="fade" onRequestClose={() => setReject(null)}>
        <View style={styles.mbg}>
          <View style={styles.mcard}>
            <Text style={styles.mtitle}>Reject "{reject?.title}"</Text>
            <TextInput style={styles.reason} placeholder="Reason (required)" placeholderTextColor={colors.muted} value={reason} onChangeText={setReason} multiline testID="port-reject-reason" />
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" label="Cancel" onPress={() => { setReject(null); setReason(""); }} />
              <Btn variant="danger" label="Reject" loading={busy} onPress={doReject} testID="port-reject-confirm" />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: font.weightMedium },
  tabTextActive: { color: colors.onBrandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: 260, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, overflow: "hidden" },
  img: { width: "100%", height: 180, backgroundColor: colors.surfaceTertiary },
  title: { color: colors.onSurface, fontSize: font.base, fontWeight: font.weightSemibold },
  sub: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontWeight: font.weightBold },
  mbg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.md },
  mcard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 480 },
  mtitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  reason: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, minHeight: 80, textAlignVertical: "top" },
});
