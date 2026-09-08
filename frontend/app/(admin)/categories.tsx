import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Alert, Modal, Text } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const empty = { name: "", slug: "", description: "", image_url: "", icon: "", sort_order: 0, is_active: true };

export default function AdminCategories() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "cats"], queryFn: api.adminCategoriesAll });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);

  const open = (c: any | null) => { setEditing(c); setForm(c ? { ...c } : empty); };
  const save = async () => {
    if (!form.name || !form.slug) { Alert.alert("Missing", "Name & slug required"); return; }
    setBusy(true);
    try {
      if (editing?.id) await api.adminUpdateCategory(editing.id, form);
      else await api.adminCreateCategory(form);
      qc.invalidateQueries({ queryKey: ["admin", "cats"] });
      qc.invalidateQueries({ queryKey: ["cats"] });
      setEditing(null);
    } catch (e: any) { Alert.alert("Error", e?.message); }
    finally { setBusy(false); }
  };
  const del = async (id: string) => {
    try { await api.adminDeleteCategory(id); qc.invalidateQueries({ queryKey: ["admin", "cats"] }); qc.invalidateQueries({ queryKey: ["cats"] }); }
    catch (e: any) { Alert.alert("Error", e?.message); }
  };

  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.md }}>
          <Btn label="+ New category" onPress={() => open(null)} testID="new-cat-btn" />
        </View>
        <Row>
          <Th flex={2}>Name</Th><Th flex={2}>Slug</Th><Th width={80}>Order</Th><Th width={100}>Status</Th><Th width={200}>Action</Th>
        </Row>
        {(q.data || []).map((c: any) => (
          <Row key={c.id} hover>
            <Td flex={2}>{c.name}</Td><Td flex={2}>{c.slug}</Td><Td width={80}>{c.sort_order}</Td>
            <Td width={100}><StatusPill status={c.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={200}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small variant="secondary" label="Edit" onPress={() => open(c)} testID={`edit-cat-${c.slug}`} />
                <Btn small variant="danger" label="Deactivate" onPress={() => del(c.id)} testID={`del-cat-${c.slug}`} />
              </View>
            </Td>
          </Row>
        ))}
      </Card>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.mbg}>
          <View style={styles.mcard}>
            <Text style={styles.mtitle}>{editing?.id ? "Edit category" : "New category"}</Text>
            <Input placeholder="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="cat-name" />
            <Input placeholder="Slug (e.g. beauty)" value={form.slug} onChangeText={(v) => setForm({ ...form, slug: v.toLowerCase().replace(/\s+/g, "-") })} testID="cat-slug" />
            <Input placeholder="Description" value={form.description || ""} onChangeText={(v) => setForm({ ...form, description: v })} testID="cat-desc" />
            <Input placeholder="Image URL" value={form.image_url || ""} onChangeText={(v) => setForm({ ...form, image_url: v })} testID="cat-img" />
            <Input placeholder="Sort order" value={String(form.sort_order || 0)} onChangeText={(v) => setForm({ ...form, sort_order: Number(v) || 0 })} keyboardType="number-pad" testID="cat-order" />
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Btn label="Save" loading={busy} onPress={save} testID="cat-save-btn" />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  mbg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.md },
  mcard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, width: "100%", maxWidth: 480 },
  mtitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginBottom: spacing.sm },
});
