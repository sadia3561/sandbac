import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

export default function PortfolioNew() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const svcQ = useQuery({ queryKey: ["prov", "services"], queryFn: api.providerServices });
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [price, setPrice] = useState(""); // rupees
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const first = svcQ.data?.find((s: any) => s.is_offered);
    if (!serviceId && first) setServiceId(first.service_id);
  }, [svcQ.data]);

  const pick = async (fromCamera: boolean) => {
    setErr(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr("Permission denied"); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    try {
      setBusy(true);
      const up = await api.uploadImage(res.assets[0].base64, res.assets[0].mimeType || "image/jpeg", "portfolio");
      setImage(up.url);
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(null);
    if (!serviceId || !title || !image) { setErr("Pick a service, title, and image"); return; }
    setBusy(true);
    try {
      await api.providerCreatePortfolio({
        service_id: serviceId, title, description, image_url: image,
        price_paise: price ? Math.round(Number(price) * 100) : undefined,
      });
      qc.invalidateQueries({ queryKey: ["prov", "portfolio"] });
      Alert.alert("Submitted", "Your design is now pending admin approval.");
      router.back();
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  };

  if (svcQ.isLoading) return <LoadingView />;
  const offered = (svcQ.data || []).filter((s: any) => s.is_offered);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>New portfolio item</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {!offered.length ? (
          <View style={styles.card}>
            <Text style={styles.section}>No services enabled</Text>
            <Text style={{ color: colors.muted }}>Enable at least one service first.</Text>
            <Button label="Manage services" onPress={() => router.push("/provider/services" as any)} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.section}>Service</Text>
              {offered.map((s: any) => {
                const active = serviceId === s.service_id;
                return (
                  <Pressable key={s.service_id} style={[styles.row, active && styles.rowActive]} onPress={() => setServiceId(s.service_id)} testID={`pick-svc-${s.service_name}`}>
                    <Text style={styles.value}>{s.service_name}</Text>
                    <Text style={styles.sub}>{s.category_name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.card}>
              <Text style={styles.section}>Design title</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Rose Gold Birthday" placeholderTextColor={colors.muted} testID="port-title" />
              <Text style={styles.section}>Description</Text>
              <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} placeholder="Short description of the design" placeholderTextColor={colors.muted} multiline testID="port-desc" />
              <Text style={styles.section}>Price (₹, optional)</Text>
              <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="e.g. 999" placeholderTextColor={colors.muted} testID="port-price" />
            </View>
            <View style={styles.card}>
              <Text style={styles.section}>Image</Text>
              {image ? (
                <View>
                  <Image source={{ uri: abs(image) }} style={styles.previewImg} contentFit="cover" />
                  <Pressable style={{ marginTop: spacing.sm }} onPress={() => setImage(null)} testID="port-remove-img">
                    <Text style={{ color: colors.error, fontWeight: font.weightSemibold }}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button label="Camera" variant="secondary" onPress={() => pick(true)} fullWidth={false} style={{ flex: 1 }} testID="port-camera" />
                  <Button label="Gallery" variant="secondary" onPress={() => pick(false)} fullWidth={false} style={{ flex: 1 }} testID="port-gallery" />
                </View>
              )}
            </View>
            {err ? <Text style={{ color: colors.error }}>{err}</Text> : null}
          </>
        )}
      </ScrollView>
      {offered.length ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label="Submit for approval" onPress={submit} loading={busy} testID="port-submit" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  section: { color: colors.muted, fontSize: font.sm, fontWeight: font.weightSemibold, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.xs },
  value: { color: colors.onSurface, fontWeight: font.weightSemibold, fontSize: font.base },
  sub: { color: colors.muted, fontSize: font.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  row: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent" },
  rowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  previewImg: { width: "100%", height: 200, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
});
