import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

export default function DesignsScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const svc = useQuery({ queryKey: ["svc", serviceId], queryFn: () => api.service(serviceId!), enabled: !!serviceId });
  const designs = useQuery({ queryKey: ["designs", serviceId], queryFn: () => api.designs(serviceId), enabled: !!serviceId });
  const pkgs = useQuery({ queryKey: ["pkgs", serviceId], queryFn: () => api.packages(serviceId!), enabled: !!serviceId });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>{svc.data?.name ? `${svc.data.name} Designs` : "Designs"}</Text>
        <View style={{ width: 40 }} />
      </View>
      {designs.isLoading ? <LoadingView /> :
       designs.error ? <ErrorView message={(designs.error as any).message} onRetry={() => designs.refetch()} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          <Pressable
            style={styles.customCard}
            onPress={() => router.push({ pathname: "/booking/new", params: { serviceId: serviceId!, packageId: pkgs.data?.[0]?.id || "", customUpload: "1" } })}
            testID="upload-reference-btn"
          >
            <Icon name="cloud-upload-outline" size={24} color={colors.brandPrimary} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.customTitle}>Have your own design?</Text>
              <Text style={styles.customSub}>Send us a photo you like and we'll try to create something similar.</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
          {!designs.data?.length ? (
            <EmptyView title="No designs yet" message="Check back soon for provider designs" />
          ) : (
            <View style={styles.grid}>
              {designs.data.map((d: any) => (
                <Pressable key={d.id} style={styles.card} onPress={() => router.push(`/design/${d.id}`)} testID={`design-${d.id}`}>
                  <Image source={{ uri: abs(d.image_url) }} style={styles.cardImg} contentFit="cover" />
                  <View style={{ padding: spacing.sm, gap: 2 }}>
                    <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
                    <Text style={styles.provider}>{d.provider_name} • ★ {d.provider_rating?.toFixed(1) || "—"}</Text>
                    {d.price_paise ? <Text style={styles.price}>{rupees(d.price_paise)}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  customCard: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, marginBottom: spacing.lg },
  customTitle: { color: colors.onSurface, fontWeight: font.weightSemibold, fontSize: font.base },
  customSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: "48%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  cardImg: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceTertiary },
  title: { color: colors.onSurface, fontSize: font.base, fontWeight: font.weightSemibold },
  provider: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontWeight: font.weightSemibold, marginTop: 2 },
});
