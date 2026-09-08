import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Modal } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const empty = { name: "", state: "", country: "India", is_active: true };

export default function AdminServiceAreas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "cities"], queryFn: api.adminCities });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);

  const open = (c: any | null) => { setEditing(c); setForm(c ? { ...c } : empty); };
  const save = async () => {
    if (!form.name || !form.state) { Alert.alert("Missing", "Name & state required"); return; }
    setBusy(true);
    try {
      if (editing?.id) await api.adminUpdateCity(editing.id, form);
      else await api.adminCreateCity(form);
      qc.invalidateQueries({ queryKey: ["admin", "cities"] });
      qc.invalidateQueries({ queryKey: ["cats"] });
      setEditing(null);
    } catch (e: any) { Alert.alert("Error", e?.message); }
    finally { setBusy(false); }
  };
  const del = async (id: string) => { try { await api.adminDeleteCity(id); qc.invalidateQueries({ queryKey: ["admin", "cities"] }); } catch (e: any) { Alert.alert("Error", e?.message); } };

  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.md }}>
          <Btn label="+ Add city" onPress={() => open(null)} testID="new-city-btn" />
        </View>
        <Row>
          <Th flex={2}>City</Th><Th flex={2}>State</Th><Th flex={1}>Country</Th><Th width={100}>Status</Th><Th width={200}>Action</Th>
        </Row>
        {(q.data || []).map((c: any) => (
          <Row key={c.id} hover>
            <Td flex={2}>{c.name}</Td><Td flex={2}>{c.state}</Td><Td flex={1}>{c.country}</Td>
            <Td width={100}><StatusPill status={c.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={200}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small variant="secondary" label="Edit" onPress={() => open(c)} />
                <Btn small variant="danger" label="Deactivate" onPress={() => del(c.id)} />
              </View>
            </Td>
          </Row>
        ))}
        <Text style={{ color: colors.muted, marginTop: spacing.md }}>Providers set their own radius per service area. India-wide expansion ready.</Text>
      </Card>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.mbg}>
          <View style={styles.mcard}>
            <Text style={styles.mtitle}>{editing?.id ? "Edit city" : "New city"}</Text>
            <Input placeholder="City" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="city-name" />
            <Input placeholder="State" value={form.state} onChangeText={(v) => setForm({ ...form, state: v })} testID="city-state" />
            <Input placeholder="Country" value={form.country} onChangeText={(v) => setForm({ ...form, country: v })} />
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Btn label="Save" loading={busy} onPress={save} testID="city-save-btn" />
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
