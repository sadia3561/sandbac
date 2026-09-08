import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, Switch } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { useLocation } from "@/src/context/LocationContext";
import { colors, spacing, font, radius } from "@/src/theme";

export default function AddressesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { location } = useLocation();
  const q = useQuery({ queryKey: ["addrs"], queryFn: api.addresses });
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ label: "Home", house: "", street: "", landmark: "", city: location?.city || "", state: location?.state || "", pincode: "", is_default: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!f.house || !f.street || !f.city || !f.pincode) { setErr("Fill house, street, city and pincode"); return; }
    setBusy(true);
    try {
      await api.createAddress(f);
      qc.invalidateQueries({ queryKey: ["addrs"] });
      setShow(false);
      setF({ label: "Home", house: "", street: "", landmark: "", city: location?.city || "", state: location?.state || "", pincode: "", is_default: false });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => { await api.deleteAddress(id); qc.invalidateQueries({ queryKey: ["addrs"] }); };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Saved addresses</Text>
        <Pressable style={styles.back} onPress={() => setShow((s) => !s)} testID="toggle-add-address-btn">
          <Icon name={show ? "close" : "add"} size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {show ? (
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Label (Home / Work / Other)" placeholderTextColor={colors.muted} value={f.label} onChangeText={(v) => setF({ ...f, label: v })} testID="addr-label" />
            <TextInput style={styles.input} placeholder="House / Flat / Building" placeholderTextColor={colors.muted} value={f.house} onChangeText={(v) => setF({ ...f, house: v })} testID="addr-house" />
            <TextInput style={styles.input} placeholder="Street / Locality" placeholderTextColor={colors.muted} value={f.street} onChangeText={(v) => setF({ ...f, street: v })} testID="addr-street" />
            <TextInput style={styles.input} placeholder="Landmark (optional)" placeholderTextColor={colors.muted} value={f.landmark} onChangeText={(v) => setF({ ...f, landmark: v })} testID="addr-landmark" />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor={colors.muted} value={f.city} onChangeText={(v) => setF({ ...f, city: v })} testID="addr-city" />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="State" placeholderTextColor={colors.muted} value={f.state} onChangeText={(v) => setF({ ...f, state: v })} testID="addr-state" />
            </View>
            <TextInput style={styles.input} placeholder="Pincode" placeholderTextColor={colors.muted} value={f.pincode} onChangeText={(v) => setF({ ...f, pincode: v })} keyboardType="number-pad" testID="addr-pincode" />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.value}>Set as default</Text>
              <Switch value={f.is_default} onValueChange={(v) => setF({ ...f, is_default: v })} />
            </View>
            {err ? <Text style={{ color: colors.error }}>{err}</Text> : null}
            <Button label="Save address" onPress={submit} loading={busy} testID="save-address-btn" />
          </View>
        ) : null}
        {q.isLoading ? <LoadingView /> :
         q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> :
         !q.data?.length ? <EmptyView title="No addresses" message="Add your first address to book services" /> :
         q.data.map((a: any) => (
          <View key={a.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{a.label}{a.is_default ? " • Default" : ""}</Text>
              <Text style={styles.sub}>{a.house}, {a.street}{a.landmark ? `, ${a.landmark}` : ""}</Text>
              <Text style={styles.sub}>{a.city}, {a.state} - {a.pincode}</Text>
            </View>
            <Pressable style={styles.trash} onPress={() => del(a.id)} testID={`del-addr-${a.id}`}>
              <Icon name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  form: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, gap: spacing.md },
  label: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  sub: { color: colors.muted, fontSize: font.sm },
  value: { color: colors.onSurface, fontWeight: font.weightSemibold },
  trash: { padding: spacing.sm },
});
