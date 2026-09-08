import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, Modal, TextInput } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "@/src/api/client";
import { Image } from "expo-image";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);
const STATUSES = ["", "PENDING", "APPROVED", "REJECTED", "NOT_SUBMITTED"];

export default function AdminKYC() {
  const [status, setStatus] = useState("PENDING");
  const [detail, setDetail] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "kyc", status], queryFn: () => api.adminKycList(status || undefined) });

  const openDetail = async (p: any) => {
    try { const d = await api.adminKycDetail(p.id); setDetail(d); } catch (e: any) { Alert.alert("Error", e?.message); }
  };
  const approve = async () => {
    if (!detail) return; setBusy(true);
    try { await api.adminKycApprove(detail.provider.id); qc.invalidateQueries({ queryKey: ["admin", "kyc"] }); setDetail(null); Alert.alert("Approved", ""); }
    catch (e: any) { Alert.alert("Error", e?.message); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!detail || !reason.trim()) { Alert.alert("Reason required"); return; }
    setBusy(true);
    try { await api.adminKycReject(detail.provider.id, reason.trim()); qc.invalidateQueries({ queryKey: ["admin", "kyc"] }); setDetail(null); setReason(""); }
    catch (e: any) { Alert.alert("Error", e?.message); } finally { setBusy(false); }
  };

  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md, flexWrap: "wrap" }}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={[styles.tab, status === s && styles.tabActive]} testID={`kyc-tab-${s || "all"}`}>
              <Text style={[styles.tabText, status === s && styles.tabTextActive]}>{s || "All"}</Text>
            </Pressable>
          ))}
        </View>
        <Row>
          <Th flex={2}>Business</Th>
          <Th flex={2}>Contact</Th>
          <Th width={120}>Type</Th>
          <Th width={120}>Status</Th>
          <Th width={110}>Action</Th>
        </Row>
        {(q.data || []).map((p: any) => (
          <Row key={p.id} hover>
            <Td flex={2}>{p.business_name}</Td>
            <Td flex={2}>{p.email}{p.phone ? ` • ${p.phone}` : ""}</Td>
            <Td width={120}>{p.provider_type}</Td>
            <Td width={120}><StatusPill status={p.kyc_status} /></Td>
            <Td width={110}><Btn small label="Review" onPress={() => openDetail(p)} testID={`kyc-review-${p.id}`} /></Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td>No providers in this state.</Td></Row>}
      </Card>

      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <Text style={styles.modalTitle}>KYC review • {detail?.provider?.business_name}</Text>
              <Text style={styles.kv}>Email: {detail?.user?.email}</Text>
              <Text style={styles.kv}>Phone: {detail?.user?.phone || "-"}</Text>
              <Text style={styles.kv}>Type: {detail?.provider?.provider_type}</Text>
              <Text style={styles.kv}>Experience: {detail?.provider?.experience_years} yrs</Text>
              <Text style={styles.kv}>Doc type: {detail?.kyc?.document_type || "-"}</Text>
              <Text style={styles.kv}>Doc number: {detail?.kyc?.document_number || "-"}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {["front_image_url", "back_image_url", "selfie_url"].map((k) => detail?.kyc?.[k] ? (
                  <View key={k} style={styles.docBox}>
                    <Text style={styles.docLabel}>{k.replace("_url", "").replaceAll("_", " ")}</Text>
                    <Image source={{ uri: abs(detail.kyc[k]) }} style={styles.doc} contentFit="cover" />
                  </View>
                ) : null)}
                {!detail?.kyc && <Text style={{ color: colors.muted }}>No documents uploaded yet.</Text>}
              </View>
              <TextInput
                style={styles.reason}
                value={reason} onChangeText={setReason}
                placeholder="Rejection reason (required if rejecting)" placeholderTextColor={colors.muted}
                multiline testID="kyc-reject-reason"
              />
              <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
                <Btn variant="ghost" label="Cancel" onPress={() => { setDetail(null); setReason(""); }} testID="kyc-cancel-btn" />
                <Btn variant="danger" label="Reject" loading={busy} onPress={reject} testID="kyc-reject-btn" />
                <Btn label="Approve" loading={busy} onPress={approve} testID="kyc-approve-btn" />
              </View>
            </ScrollView>
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
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.md },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, maxWidth: 700, width: "100%", maxHeight: "90%" },
  modalTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  kv: { color: colors.onSurfaceSecondary, fontSize: font.base },
  docBox: { width: 200 },
  docLabel: { color: colors.muted, fontSize: font.sm, marginBottom: 4, textTransform: "capitalize" },
  doc: { width: 200, height: 130, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  reason: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, minHeight: 80, textAlignVertical: "top" },
});
