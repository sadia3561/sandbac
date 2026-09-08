import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Alert, Modal, Text, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const empty = { service_id: "", name: "", description: "", base_price_paise: 0, duration_minutes: 60, included_items: [], is_active: true };

export default function AdminPackages() {
  const qc = useQueryClient();
  const [serviceFilter, setServiceFilter] = useState<string>("");
  const svcs = useQuery({ queryKey: ["admin", "services"], queryFn: api.adminServices });
  const pkgs = useQuery({ queryKey: ["admin", "pkgs", serviceFilter], queryFn: () => api.adminPackages(serviceFilter || undefined) });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [priceR, setPriceR] = useState("0");
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (p: any | null) => {
    setEditing(p);
    if (p) { setForm({ ...p }); setPriceR(String(Math.round((p.base_price_paise || 0) / 100))); setItems((p.included_items || []).join(", ")); }
    else { setForm({ ...empty, service_id: serviceFilter || svcs.data?.[0]?.id || "" }); setPriceR("0"); setItems(""); }
  };

  const save = async () => {
    if (!form.name || !form.service_id) { Alert.alert("Missing", "Name & service required"); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        base_price_paise: Math.round(Number(priceR || "0") * 100),
        included_items: items.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (editing?.id) await api.adminUpdatePackage(editing.id, payload);
      else await api.adminCreatePackage(payload);
      qc.invalidateQueries({ queryKey: ["admin", "pkgs"] });
      setEditing(null);
    } catch (e: any) { Alert.alert("Error", e?.message); }
    finally { setBusy(false); }
  };
  const del = async (id: string) => { try { await api.adminDeletePackage(id); qc.invalidateQueries({ queryKey: ["admin", "pkgs"] }); } catch (e: any) { Alert.alert("Error", e?.message); } };

  if (svcs.isLoading || pkgs.isLoading) return <LoadingView />;
  if (pkgs.error) return <ErrorView message={(pkgs.error as any).message} onRetry={() => pkgs.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md, flexWrap: "wrap", alignItems: "center" }}>
          <Pressable onPress={() => setServiceFilter("")} style={[styles.tag, !serviceFilter && styles.tagActive]}><Text style={[styles.tagText, !serviceFilter && styles.tagTextActive]}>All</Text></Pressable>
          {(svcs.data || []).map((s: any) => (
            <Pressable key={s.id} onPress={() => setServiceFilter(s.id)} style={[styles.tag, serviceFilter === s.id && styles.tagActive]} testID={`pkg-filter-${s.slug}`}>
              <Text style={[styles.tagText, serviceFilter === s.id && styles.tagTextActive]}>{s.name}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <Btn label="+ New package" onPress={() => open(null)} testID="new-pkg-btn" />
        </View>
        <Row>
          <Th flex={1}>Service</Th><Th flex={1}>Name</Th>
          <Th width={120}>Price</Th><Th width={90}>Duration</Th>
          <Th width={100}>Status</Th><Th width={200}>Action</Th>
        </Row>
        {(pkgs.data || []).map((p: any) => (
          <Row key={p.id} hover>
            <Td flex={1}>{p.service_name}</Td><Td flex={1}>{p.name}</Td>
            <Td width={120}>{rupees(p.base_price_paise || 0)}</Td>
            <Td width={90}>{p.duration_minutes || "-"} min</Td>
            <Td width={100}><StatusPill status={p.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={200}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small variant="secondary" label="Edit" onPress={() => open(p)} testID={`edit-pkg-${p.id}`} />
                <Btn small variant="danger" label="Deactivate" onPress={() => del(p.id)} testID={`del-pkg-${p.id}`} />
              </View>
            </Td>
          </Row>
        ))}
        {!(pkgs.data || []).length && <Row><Td>No packages</Td></Row>}
      </Card>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.mbg}>
          <ScrollView style={{ width: "100%", maxWidth: 560 }} contentContainerStyle={styles.mcard}>
            <Text style={styles.mtitle}>{editing?.id ? "Edit package" : "New package"}</Text>
            <Text style={styles.lbl}>Service</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(svcs.data || []).map((s: any) => (
                <Pressable key={s.id} onPress={() => setForm({ ...form, service_id: s.id })} style={[styles.tag, form.service_id === s.id && styles.tagActive]}>
                  <Text style={[styles.tagText, form.service_id === s.id && styles.tagTextActive]}>{s.name}</Text>
                </Pressable>
              ))}
            </View>
            <Input placeholder="Package name (Basic / Premium / Luxury)" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="pkg-name" />
            <Input placeholder="Description" value={form.description || ""} onChangeText={(v) => setForm({ ...form, description: v })} testID="pkg-desc" />
            <Input placeholder="Price (₹)" value={priceR} onChangeText={setPriceR} keyboardType="number-pad" testID="pkg-price" />
            <Input placeholder="Duration (minutes)" value={String(form.duration_minutes || 0)} onChangeText={(v) => setForm({ ...form, duration_minutes: Number(v) || 0 })} keyboardType="number-pad" testID="pkg-duration" />
            <Input placeholder="Included items, comma separated" value={items} onChangeText={setItems} testID="pkg-items" />
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end", marginTop: spacing.md }}>
              <Btn variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Btn label="Save" loading={busy} onPress={save} testID="pkg-save-btn" />
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
