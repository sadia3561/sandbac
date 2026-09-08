import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Alert, Modal, Text, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const empty = {
  category_id: "", name: "", slug: "", description: "", image_url: "",
  starting_price_paise: 0, duration_minutes: 60, is_active: true,
  allows_reference_image: true, allows_design_selection: true,
  supported_booking_types: ["ASAP", "SCHEDULED", "LATER"],
};
const BOOKING_TYPES = ["ASAP", "SCHEDULED", "LATER"];

export default function AdminServices() {
  const qc = useQueryClient();
  const svcs = useQuery({ queryKey: ["admin", "services"], queryFn: api.adminServices });
  const cats = useQuery({ queryKey: ["admin", "cats"], queryFn: api.adminCategoriesAll });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [priceRupees, setPriceRupees] = useState("0");
  const [busy, setBusy] = useState(false);

  const open = (s: any | null) => {
    setEditing(s);
    if (s) { setForm({ ...s }); setPriceRupees(String(Math.round((s.starting_price_paise || 0) / 100))); }
    else { setForm({ ...empty, category_id: cats.data?.[0]?.id || "" }); setPriceRupees("0"); }
  };
  const save = async () => {
    if (!form.name || !form.slug || !form.category_id) { Alert.alert("Missing", "Name, slug, category required"); return; }
    setBusy(true);
    try {
      const payload = { ...form, starting_price_paise: Math.round(Number(priceRupees || "0") * 100) };
      if (editing?.id) await api.adminUpdateService(editing.id, payload);
      else await api.adminCreateService(payload);
      qc.invalidateQueries({ queryKey: ["admin", "services"] });
      qc.invalidateQueries({ queryKey: ["pop"] });
      setEditing(null);
    } catch (e: any) { Alert.alert("Error", e?.message); }
    finally { setBusy(false); }
  };
  const del = async (id: string) => {
    try { await api.adminDeleteService(id); qc.invalidateQueries({ queryKey: ["admin", "services"] }); }
    catch (e: any) { Alert.alert("Error", e?.message); }
  };
  const toggleBookingType = (t: string) => {
    const has = form.supported_booking_types.includes(t);
    setForm({ ...form, supported_booking_types: has ? form.supported_booking_types.filter((x: string) => x !== t) : [...form.supported_booking_types, t] });
  };

  if (svcs.isLoading || cats.isLoading) return <LoadingView />;
  if (svcs.error) return <ErrorView message={(svcs.error as any).message} onRetry={() => svcs.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.md }}>
          <Btn label="+ New service" onPress={() => open(null)} testID="new-svc-btn" />
        </View>
        <Row>
          <Th flex={2}>Name</Th><Th flex={1}>Category</Th><Th width={120}>Starting</Th>
          <Th width={90}>Duration</Th><Th width={100}>Status</Th><Th width={200}>Action</Th>
        </Row>
        {(svcs.data || []).map((s: any) => (
          <Row key={s.id} hover>
            <Td flex={2}>{s.name}</Td><Td flex={1}>{s.category_name}</Td>
            <Td width={120}>{rupees(s.starting_price_paise || 0)}</Td>
            <Td width={90}>{s.duration_minutes || "-"} min</Td>
            <Td width={100}><StatusPill status={s.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={200}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small variant="secondary" label="Edit" onPress={() => open(s)} testID={`edit-svc-${s.slug}`} />
                <Btn small variant="danger" label="Deactivate" onPress={() => del(s.id)} testID={`del-svc-${s.slug}`} />
              </View>
            </Td>
          </Row>
        ))}
      </Card>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.mbg}>
          <ScrollView style={{ width: "100%", maxWidth: 600 }} contentContainerStyle={styles.mcard}>
            <Text style={styles.mtitle}>{editing?.id ? "Edit service" : "New service"}</Text>
            <Text style={styles.lbl}>Category</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(cats.data || []).map((c: any) => {
                const active = form.category_id === c.id;
                return <Pressable key={c.id} onPress={() => setForm({ ...form, category_id: c.id })} style={[styles.tag, active && styles.tagActive]} testID={`svc-cat-${c.slug}`}><Text style={[styles.tagText, active && styles.tagTextActive]}>{c.name}</Text></Pressable>;
              })}
            </View>
            <Input placeholder="Service name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="svc-name" />
            <Input placeholder="Slug" value={form.slug} onChangeText={(v) => setForm({ ...form, slug: v.toLowerCase().replace(/\s+/g, "-") })} testID="svc-slug" />
            <Input placeholder="Description" value={form.description || ""} onChangeText={(v) => setForm({ ...form, description: v })} testID="svc-desc" />
            <Input placeholder="Image URL" value={form.image_url || ""} onChangeText={(v) => setForm({ ...form, image_url: v })} testID="svc-img" />
            <Input placeholder="Starting price (₹)" value={priceRupees} onChangeText={setPriceRupees} keyboardType="number-pad" testID="svc-price" />
            <Input placeholder="Duration (minutes)" value={String(form.duration_minutes || 0)} onChangeText={(v) => setForm({ ...form, duration_minutes: Number(v) || 0 })} keyboardType="number-pad" testID="svc-duration" />
            <Text style={styles.lbl}>Supported booking types</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {BOOKING_TYPES.map((t) => {
                const active = form.supported_booking_types.includes(t);
                return <Pressable key={t} onPress={() => toggleBookingType(t)} style={[styles.tag, active && styles.tagActive]} testID={`svc-btype-${t}`}><Text style={[styles.tagText, active && styles.tagTextActive]}>{t}</Text></Pressable>;
              })}
            </View>
            <View style={{ flexDirection: "row", gap: 6, marginTop: spacing.sm }}>
              <Pressable onPress={() => setForm({ ...form, allows_reference_image: !form.allows_reference_image })} style={[styles.tag, form.allows_reference_image && styles.tagActive]}><Text style={[styles.tagText, form.allows_reference_image && styles.tagTextActive]}>Reference images</Text></Pressable>
              <Pressable onPress={() => setForm({ ...form, allows_design_selection: !form.allows_design_selection })} style={[styles.tag, form.allows_design_selection && styles.tagActive]}><Text style={[styles.tagText, form.allows_design_selection && styles.tagTextActive]}>Design selection</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end", marginTop: spacing.md }}>
              <Btn variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Btn label="Save" loading={busy} onPress={save} testID="svc-save-btn" />
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
  lbl: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, marginTop: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  tagActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tagText: { color: colors.onSurfaceTertiary, fontSize: font.sm },
  tagTextActive: { color: colors.onBrandPrimary, fontWeight: font.weightSemibold },
});
