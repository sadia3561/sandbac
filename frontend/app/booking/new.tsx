import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);
const TYPES = [
  { k: "ASAP", label: "ASAP", sub: "Need it now" },
  { k: "SCHEDULED", label: "Schedule", sub: "Pick date & time" },
  { k: "LATER", label: "Later", sub: "Book for another time" },
];

export default function BookingNew() {
  const { serviceId, packageId, designId, customUpload } = useLocalSearchParams<{ serviceId: string; packageId?: string; designId?: string; customUpload?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const svc = useQuery({ queryKey: ["svc", serviceId], queryFn: () => api.service(serviceId!), enabled: !!serviceId });
  const pkgs = useQuery({ queryKey: ["pkgs", serviceId], queryFn: () => api.packages(serviceId!), enabled: !!serviceId });
  const design = useQuery({ queryKey: ["design", designId], queryFn: () => api.design(designId!), enabled: !!designId });
  const addrs = useQuery({ queryKey: ["addrs"], queryFn: api.addresses });

  const [selPkgId, setSelPkgId] = useState<string | null>(packageId || null);
  const [type, setType] = useState<"ASAP" | "SCHEDULED" | "LATER">("ASAP");
  const [when, setWhen] = useState<string>(""); // ISO date-time input as text
  const [addrId, setAddrId] = useState<string | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [refNote, setRefNote] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!selPkgId && pkgs.data?.[0]) setSelPkgId(pkgs.data[0].id); }, [pkgs.data]);
  useEffect(() => { if (!addrId && addrs.data?.[0]) setAddrId(addrs.data[0].id); }, [addrs.data]);

  const selPkg = pkgs.data?.find((p: any) => p.id === selPkgId);
  const price = useMemo(() => {
    if (design.data?.price_paise) return design.data.price_paise;
    return selPkg?.base_price_paise ?? svc.data?.starting_price_paise ?? 0;
  }, [design.data, selPkg, svc.data]);

  const pickImage = async (fromCamera: boolean) => {
    setErr(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr("Permission denied"); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    if (!a.base64) { setErr("Could not read image"); return; }
    try {
      setBusy(true);
      const up = await api.uploadReference(a.base64, a.mimeType || "image/jpeg");
      setRefUrl(up.url);
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(null);
    if (!serviceId || !selPkgId) { setErr("Choose a package"); return; }
    if (!addrId) { setErr("Add an address to continue"); return; }
    if ((type === "SCHEDULED" || type === "LATER") && !when) { setErr("Choose date & time"); return; }
    setBusy(true);
    try {
      const b = await api.createBooking({
        service_id: serviceId,
        package_id: selPkgId,
        design_id: designId || undefined,
        address_id: addrId,
        booking_type: type,
        scheduled_at: type === "ASAP" ? undefined : new Date(when).toISOString(),
        reference_image_url: refUrl || undefined,
        reference_note: refNote || undefined,
        notes: notes || undefined,
      });
      router.replace(`/checkout/${b.id}`);
    } catch (e: any) { setErr(e?.message || "Booking failed"); }
    finally { setBusy(false); }
  };

  if (svc.isLoading || pkgs.isLoading) return <LoadingView />;
  if (svc.error) return <ErrorView message={(svc.error as any).message} onRetry={() => svc.refetch()} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Review & Book</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 180, gap: spacing.lg }}>
        <View style={styles.card}>
          <Text style={styles.section}>Service</Text>
          <Text style={styles.value}>{svc.data?.name}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Package</Text>
          {(pkgs.data || []).map((p: any) => {
            const active = selPkgId === p.id;
            return (
              <Pressable key={p.id} style={[styles.pkgRow, active && styles.pkgActive]} onPress={() => setSelPkgId(p.id)} testID={`sel-pkg-${p.name}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgName}>{p.name}</Text>
                  <Text style={styles.pkgSub}>{p.description}</Text>
                </View>
                <Text style={styles.pkgPrice}>{rupees(p.base_price_paise)}</Text>
              </Pressable>
            );
          })}
        </View>

        {design.data ? (
          <View style={styles.card}>
            <Text style={styles.section}>Selected design</Text>
            <View style={styles.row}>
              <Image source={{ uri: abs(design.data.image_url) }} style={styles.thumb} contentFit="cover" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.value}>{design.data.title}</Text>
                <Text style={styles.pkgSub}>{design.data.provider_name}</Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.section}>Reference image (optional)</Text>
          <Text style={styles.hint}>Have your own design? Upload it and we'll try to create something similar.</Text>
          {refUrl ? (
            <View style={styles.row}>
              <Image source={{ uri: abs(refUrl) }} style={styles.thumb} contentFit="cover" />
              <Pressable style={styles.remove} onPress={() => setRefUrl(null)} testID="remove-reference-btn">
                <Icon name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button label="Camera" variant="secondary" onPress={() => pickImage(true)} fullWidth={false} style={{ flex: 1 }} testID="ref-camera-btn" />
              <Button label="Gallery" variant="secondary" onPress={() => pickImage(false)} fullWidth={false} style={{ flex: 1 }} testID="ref-gallery-btn" />
            </View>
          )}
          <TextInput
            style={styles.input} value={refNote} onChangeText={setRefNote}
            placeholder="Optional: describe what you want" placeholderTextColor={colors.muted}
            testID="ref-note-input"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>When?</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {TYPES.map((t) => (
              <Pressable key={t.k} style={[styles.typeChip, type === t.k && styles.typeChipActive]} onPress={() => setType(t.k as any)} testID={`type-${t.k}`}>
                <Text style={[styles.typeLabel, type === t.k && styles.typeLabelActive]}>{t.label}</Text>
                <Text style={[styles.typeSub, type === t.k && styles.typeSubActive]}>{t.sub}</Text>
              </Pressable>
            ))}
          </View>
          {type !== "ASAP" ? (
            <TextInput
              style={styles.input} value={when} onChangeText={setWhen}
              placeholder="YYYY-MM-DD HH:mm (e.g. 2026-09-15 19:00)"
              placeholderTextColor={colors.muted}
              testID="schedule-input"
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={styles.section}>Address</Text>
            <Pressable onPress={() => router.push("/addresses")} testID="manage-addresses-btn"><Text style={styles.link}>Manage</Text></Pressable>
          </View>
          {addrs.isLoading ? <LoadingView /> : !addrs.data?.length ? (
            <Pressable style={styles.addAddr} onPress={() => router.push("/addresses")} testID="add-address-cta">
              <Text style={{ color: colors.brandPrimary, fontWeight: font.weightSemibold }}>+ Add address</Text>
            </Pressable>
          ) : addrs.data.map((a: any) => {
            const active = addrId === a.id;
            return (
              <Pressable key={a.id} style={[styles.pkgRow, active && styles.pkgActive]} onPress={() => setAddrId(a.id)} testID={`sel-addr-${a.id}`}>
                <View>
                  <Text style={styles.value}>{a.label}</Text>
                  <Text style={styles.pkgSub}>{a.house}, {a.street}, {a.city} - {a.pincode}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Notes for provider (optional)</Text>
          <TextInput
            style={[styles.input, { height: 80 }]} value={notes} onChangeText={setNotes}
            placeholder="Anything else we should know?" placeholderTextColor={colors.muted}
            multiline testID="booking-notes-input"
          />
        </View>

        {err ? <Text style={{ color: colors.error }}>{err}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerPrice}>{rupees(price)}</Text>
        </View>
        <Button label={busy ? "Booking…" : "Confirm Booking"} onPress={submit} loading={busy} fullWidth={false} style={{ paddingHorizontal: spacing.xl }} testID="confirm-booking-btn" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  section: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, textTransform: "uppercase", letterSpacing: 0.5 },
  value: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  hint: { color: colors.muted, fontSize: font.sm },
  row: { flexDirection: "row", alignItems: "center" },
  thumb: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  remove: { padding: spacing.sm, marginLeft: "auto" },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  pkgRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent" },
  pkgActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  pkgName: { color: colors.onSurface, fontWeight: font.weightSemibold, fontSize: font.base },
  pkgSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  pkgPrice: { color: colors.brand, fontWeight: font.weightBold },
  typeChip: { flex: 1, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
  typeChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  typeLabel: { color: colors.onSurface, fontWeight: font.weightSemibold },
  typeLabelActive: { color: colors.brand },
  typeSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  typeSubActive: { color: colors.brand },
  addAddr: { padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed", alignItems: "center" },
  link: { color: colors.brandPrimary, fontWeight: font.weightSemibold },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, flexDirection: "row", alignItems: "center", gap: spacing.md },
  footerLabel: { color: colors.muted, fontSize: font.sm },
  footerPrice: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
});
