import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { api, API_BASE } from "@/src/api/client";
import { LoadingView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);
const DOC_TYPES = ["AADHAAR", "PAN", "OTHER"];
const STATUS_COLORS: Record<string, string> = {
  NOT_SUBMITTED: colors.muted, PENDING: colors.warning, APPROVED: colors.success, REJECTED: colors.error,
};

export default function KYCScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const kyc = useQuery({ queryKey: ["prov", "kyc"], queryFn: api.providerKYC });
  const [type, setType] = useState<string>("AADHAAR");
  const [num, setNum] = useState("");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (setter: (u: string) => void) => {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr("Gallery permission denied"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    try {
      setBusy(true);
      const up = await api.uploadImage(res.assets[0].base64, res.assets[0].mimeType || "image/jpeg", "portfolio");
      setter(up.url);
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(null);
    if (!front && !num) { setErr("Add document number or a document image"); return; }
    setBusy(true);
    try {
      await api.providerSubmitKYC({
        document_type: type, document_number: num || undefined,
        front_image_url: front || undefined, back_image_url: back || undefined, selfie_url: selfie || undefined,
      });
      qc.invalidateQueries({ queryKey: ["prov", "kyc"] });
      qc.invalidateQueries({ queryKey: ["prov", "me"] });
      Alert.alert("Submitted", "Your KYC is under review.");
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  };

  if (kyc.isLoading) return <LoadingView />;
  const status = kyc.data?.status || "NOT_SUBMITTED";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>KYC verification</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.statusBox, { backgroundColor: (STATUS_COLORS[status] || colors.muted) + "20" }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>Status: {status.replaceAll("_", " ")}</Text>
          {kyc.data?.rejection_reason ? <Text style={{ color: colors.error, marginTop: 4 }}>{kyc.data.rejection_reason}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Document type</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {DOC_TYPES.map((t) => (
              <Pressable key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)} testID={`kyc-type-${t}`}>
                <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.section}>Document number</Text>
          <TextInput style={styles.input} value={num} onChangeText={setNum} placeholder="e.g. XXXX XXXX XXXX" placeholderTextColor={colors.muted} testID="kyc-num" />
        </View>
        <UploadRow label="Document front" url={front} onPick={() => upload(setFront)} onClear={() => setFront(null)} testID="kyc-front" />
        <UploadRow label="Document back" url={back} onPick={() => upload(setBack)} onClear={() => setBack(null)} testID="kyc-back" />
        <UploadRow label="Selfie with document" url={selfie} onPick={() => upload(setSelfie)} onClear={() => setSelfie(null)} testID="kyc-selfie" />
        {err ? <Text style={{ color: colors.error }}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button label={status === "REJECTED" ? "Resubmit KYC" : "Submit KYC"} onPress={submit} loading={busy} disabled={status === "PENDING"} testID="kyc-submit" />
      </View>
    </View>
  );
}

function UploadRow({ label, url, onPick, onClear, testID }: any) {
  return (
    <View style={styles.card}>
      <Text style={styles.section}>{label}</Text>
      {url ? (
        <View>
          <Image source={{ uri: abs(url) }} style={styles.img} contentFit="cover" />
          <Pressable onPress={onClear} style={{ paddingVertical: 6 }}><Text style={{ color: colors.error, fontWeight: font.weightSemibold }}>Remove</Text></Pressable>
        </View>
      ) : <Button label="Upload" variant="secondary" onPress={onPick} testID={testID} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  statusBox: { padding: spacing.md, borderRadius: radius.md },
  statusText: { fontWeight: font.weightBold, fontSize: font.base, letterSpacing: 1 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  section: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: font.weightMedium },
  chipTextActive: { color: colors.onBrandPrimary },
  img: { width: "100%", height: 150, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
});
