import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Alert } from "react-native";
import * as ExpoLocation from "expo-location";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/src/components/Button";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { useLocation } from "@/src/context/LocationContext";
import { api } from "@/src/api/client";
import { colors, spacing, font, radius } from "@/src/theme";

export default function LocationOnboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setLocation } = useLocation();
  const [cities, setCities] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr(null); setCities(null);
    try { const items = await api.cities(); setCities(items); }
    catch (e: any) { setErr(e?.message || "Could not load cities"); }
  };
  useEffect(() => { load(); }, []);

  const useCurrent = async () => {
    setBusy(true);
    try {
      const p = await ExpoLocation.requestForegroundPermissionsAsync();
      if (p.status !== "granted") { Alert.alert("Permission needed", "Enable location or pick manually."); return; }
      const pos = await ExpoLocation.getCurrentPositionAsync({});
      let city = "Your City";
      try {
        const rg = await ExpoLocation.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        if (rg[0]?.city) city = rg[0].city;
        else if (rg[0]?.region) city = rg[0].region;
      } catch {}
      await setLocation({ city, latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      router.replace("/(tabs)");
    } catch { Alert.alert("Location failed", "Please pick a city manually."); }
    finally { setBusy(false); }
  };

  const pickCity = async (c: any) => { await setLocation({ city: c.name, state: c.state }); router.replace("/(tabs)"); };

  const filtered = (cities || []).filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <Text style={styles.title}>Where do you need service?</Text>
      <Text style={styles.subtitle}>We'll find providers near you</Text>
      <Button label={busy ? "Detecting…" : "Use current location"} onPress={useCurrent} loading={busy} testID="use-current-location-btn" />
      <View style={styles.sep}><View style={styles.line} /><Text style={styles.or}>OR</Text><View style={styles.line} /></View>
      <TextInput
        style={styles.input} value={query} onChangeText={setQuery}
        placeholder="Search your city" placeholderTextColor={colors.muted} testID="city-search-input"
      />
      <View style={{ flex: 1 }}>
        {cities === null && !err ? <LoadingView /> : null}
        {err ? <ErrorView message={err} onRetry={load} /> : null}
        {cities ? (
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {filtered.map((c) => (
              <Pressable key={c.id} style={styles.row} onPress={() => pickCity(c)} testID={`city-row-${c.name}`}>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.rowSub}>{c.state}</Text>
              </Pressable>
            ))}
            {filtered.length === 0 ? <Text style={{ color: colors.muted, textAlign: "center", padding: spacing.xl }}>No cities match.</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  subtitle: { color: colors.muted, fontSize: font.base },
  sep: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.sm },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  or: { color: colors.muted, fontWeight: font.weightSemibold },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
