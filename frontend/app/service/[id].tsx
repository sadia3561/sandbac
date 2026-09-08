import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const svc = useQuery({ queryKey: ["svc", id], queryFn: () => api.service(id!), enabled: !!id });
  const pkgs = useQuery({ queryKey: ["pkgs", id], queryFn: () => api.packages(id!), enabled: !!id });
  const [pkgId, setPkgId] = useState<string | null>(null);

  const selectedPkg = pkgs.data?.find((p: any) => p.id === pkgId) || pkgs.data?.[0];

  if (svc.isLoading || pkgs.isLoading) return <LoadingView />;
  if (svc.error) return <ErrorView message={(svc.error as any).message} onRetry={() => svc.refetch()} />;
  if (!svc.data) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 200 }}>
        <View style={styles.hero}>
          <Image source={{ uri: abs(svc.data.image_url) }} style={StyleSheet.absoluteFill as any} contentFit="cover" />
          <View style={styles.heroScrim} />
          <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + spacing.sm }]} testID="back-btn">
            <Icon name="chevron-back" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{svc.data.name}</Text>
          <Text style={styles.category}>{svc.data.category_name}</Text>
          <Text style={styles.desc}>{svc.data.description}</Text>
          <Text style={styles.sectionTitle}>Choose package</Text>
          <View style={{ gap: spacing.md }}>
            {(pkgs.data || []).map((p: any) => {
              const active = (pkgId || pkgs.data?.[0]?.id) === p.id;
              return (
                <Pressable key={p.id} style={[styles.pkg, active && styles.pkgActive]} onPress={() => setPkgId(p.id)} testID={`pkg-${p.name}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pkgName}>{p.name}</Text>
                    <Text style={styles.pkgDesc}>{p.description}</Text>
                    <Text style={styles.pkgItems}>{(p.included_items || []).join(" • ")}</Text>
                    <Text style={styles.pkgMeta}>{p.duration_minutes ? `${p.duration_minutes} min` : ""}</Text>
                  </View>
                  <Text style={styles.pkgPrice}>{rupees(p.base_price_paise)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.designsRow} onPress={() => router.push(`/designs/${svc.data.id}`)} testID="browse-designs-btn">
            <Icon name="images-outline" size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.designsTitle}>Browse designs & providers</Text>
              <Text style={styles.designsSub}>Pick a specific design or upload your own reference</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>Starting</Text>
          <Text style={styles.footerPrice}>{selectedPkg ? rupees(selectedPkg.base_price_paise) : rupees(svc.data.starting_price_paise)}</Text>
        </View>
        <Button
          label="Quick Book"
          onPress={() => router.push({ pathname: "/booking/new", params: { serviceId: svc.data.id, packageId: (pkgId || pkgs.data?.[0]?.id) } })}
          fullWidth={false}
          style={{ paddingHorizontal: spacing.xxl }}
          testID="quick-book-btn"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, backgroundColor: colors.surfaceTertiary },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  back: { position: "absolute", left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  category: { color: colors.brand, fontWeight: font.weightSemibold },
  desc: { color: colors.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  sectionTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.md },
  pkg: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent" },
  pkgActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  pkgName: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  pkgDesc: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  pkgItems: { color: colors.onSurfaceTertiary, fontSize: font.sm, marginTop: 4 },
  pkgMeta: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  pkgPrice: { color: colors.brand, fontWeight: font.weightBold, fontSize: font.lg },
  designsRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  designsTitle: { color: colors.onSurface, fontWeight: font.weightSemibold, fontSize: font.base },
  designsSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  footerLabel: { color: colors.muted, fontSize: font.sm },
  footerPrice: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
});
