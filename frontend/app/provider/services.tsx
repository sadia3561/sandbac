import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Switch, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

export default function ProviderServices() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prov", "services"], queryFn: api.providerServices });

  const toggle = async (service_id: string, on: boolean, exp = 0) => {
    try {
      await api.providerToggleService(service_id, on, exp);
      qc.invalidateQueries({ queryKey: ["prov", "services"] });
    } catch (e: any) { Alert.alert("Update", e?.message || "Failed"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My services</Text>
        <View style={{ width: 40 }} />
      </View>
      {q.isLoading ? <LoadingView /> :
       q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}>
          <Text style={styles.hint}>Only enabled services will receive booking requests.</Text>
          {q.data?.map((s: any) => (
            <View key={s.service_id} style={styles.card}>
              {s.image_url ? <Image source={{ uri: s.image_url }} style={styles.img} contentFit="cover" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.service_name}</Text>
                <Text style={styles.sub}>{s.category_name}</Text>
              </View>
              <Switch value={s.is_offered} onValueChange={(v) => toggle(s.service_id, v, s.experience_years)} testID={`svc-toggle-${s.service_name}`} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  hint: { color: colors.muted, fontSize: font.sm, marginBottom: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  img: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  sub: { color: colors.muted, fontSize: font.sm },
});
