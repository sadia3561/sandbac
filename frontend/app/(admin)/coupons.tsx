import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Modal, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const empty = { code: "", discount_type: "FLAT" as "FLAT" | "PERCENT", discount_value: 0, min_amount_paise: 0, max_discount_paise: null, usage_limit: null, expires_at: null, is_active: true };

export default function AdminCoupons() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "coupons"], queryFn: api.adminCoupons });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [valueStr, setValueStr] = useState("0");
  const [minStr, setMinStr] = useState("0");
  const [busy, setBusy] = useState(false);

  const open = (c: any | null) => {
    setEditing(c);
    if (c) {
      setForm({ ...c });
      setValueStr(c.discount_type === "PERCENT" ? String(c.discount_value) : String(Math.round((c.discount_value || 0) / 100)));
      setMinStr(String(Math.round((c.min_amount_paise || 0) / 100)));
    } else { setForm(empty); setValueStr("0"); setMinStr("0"); }
  };
  const save = async () => {
    if (!form.code) { Alert.alert("Missing", "Code required"); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        discount_value: form.discount_type === "PERCENT" ? Number(valueStr) : Math.round(Number(valueStr) * 100),
        min_amount_paise: Math.round(Number(minStr) * 100),
      };
      if (editing?.id) await api.adminUpdateCoupon(editing.id, payload);
      else await api.adminCreateCoupon(payload);
      qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
      setEditing(null);
    } catch (e: any) { Alert.alert("Error", e?.message); } finally { setBusy(false); }
  };
  const del = async (id: string) => { try { await api.adminDeleteCoupon(id); qc.invalidateQueries({ queryKey: ["admin", "coupons"] }); } catch (e: any) { Alert.alert("Error", e?.message); } };

  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.md }}>
          <Btn label="+ New coupon" onPress={() => open(null)} testID="new-coupon-btn" />
        </View>
        <Row>
          <Th flex={1}>Code</Th><Th width={100}>Type</Th><Th width={120}>Value</Th>
          <Th width={140}>Min amount</Th><Th width={110}>Usage</Th><Th width={100}>Status</Th><Th width={200}>Action</Th>
        </Row>
        {(q.data || []).map((c: any) => (
          <Row key={c.id} hover>
            <Td flex={1} mono>{c.code}</Td>
            <Td width={100}>{c.discount_type}</Td>
            <Td width={120}>{c.discount_type === "PERCENT" ? `${c.discount_value}%` : rupees(c.discount_value)}</Td>
            <Td width={140}>{rupees(c.min_amount_paise || 0)}</Td>
            <Td width={110}>{c.usage_count || 0}{c.usage_limit ? `/${c.usage_limit}` : ""}</Td>
            <Td width={100}><StatusPill status={c.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={200}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small variant="secondary" label="Edit" onPress={() => open(c)} />
                <Btn small variant="danger" label="Deactivate" onPress={() => del(c.id)} />
              </View>
            </Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td>No coupons yet.</Td></Row>}
      </Card>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.mbg}>
          <ScrollView style={{ width: "100%", maxWidth: 480 }} contentContainerStyle={styles.mcard}>
            <Text style={styles.mtitle}>{editing?.id ? "Edit coupon" : "New coupon"}</Text>
            <Input placeholder="Code (e.g. WELCOME10)" value={form.code} onChangeText={(v) => setForm({ ...form, code: v.toUpperCase() })} testID="coup-code" />
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(["FLAT", "PERCENT"] as const).map((t) => (
                <Pressable key={t} onPress={() => setForm({ ...form, discount_type: t })} style={[styles.tag, form.discount_type === t && styles.tagActive]}>
                  <Text style={[styles.tagText, form.discount_type === t && styles.tagTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <Input placeholder={form.discount_type === "PERCENT" ? "Discount %" : "Discount ₹"} value={valueStr} onChangeText={setValueStr} keyboardType="number-pad" testID="coup-value" />
            <Input placeholder="Minimum booking ₹" value={minStr} onChangeText={setMinStr} keyboardType="number-pad" testID="coup-min" />
            <Input placeholder="Usage limit (blank = unlimited)" value={form.usage_limit ? String(form.usage_limit) : ""} onChangeText={(v) => setForm({ ...form, usage_limit: v ? Number(v) : null })} keyboardType="number-pad" testID="coup-limit" />
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Btn label="Save" loading={busy} onPress={save} testID="coup-save-btn" />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  mbg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.md },
  mcard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  mtitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginBottom: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  tagActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tagText: { color: colors.onSurfaceTertiary },
  tagTextActive: { color: colors.onBrandPrimary, fontWeight: font.weightSemibold },
});
