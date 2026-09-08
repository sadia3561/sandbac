import React from "react";
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

export default function DesignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const d = useQuery({ queryKey: ["design", id], queryFn: () => api.design(id!), enabled: !!id });
  const pkgs = useQuery({ queryKey: ["pkgs", d.data?.service_id], queryFn: () => api.packages(d.data!.service_id), enabled: !!d.data?.service_id });

  if (d.isLoading) return <LoadingView />;
  if (d.error) return <ErrorView message={(d.error as any).message} onRetry={() => d.refetch()} />;
  if (!d.data) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 180 }}>
        <View style={styles.hero}>
          <Image source={{ uri: abs(d.data.image_url) }} style={StyleSheet.absoluteFill as any} contentFit="cover" />
          <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + spacing.sm }]} testID="back-btn">
            <Icon name="chevron-back" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{d.data.title}</Text>
          <Text style={styles.provider}>{d.data.provider_name} • ★ {d.data.provider_rating?.toFixed(1) || "—"}</Text>
          {d.data.description ? <Text style={styles.desc}>{d.data.description}</Text> : null}
          {d.data.price_paise ? <Text style={styles.price}>{rupees(d.data.price_paise)}</Text> : null}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Book This Design"
          onPress={() => router.push({ pathname: "/booking/new", params: { serviceId: d.data.service_id, packageId: (d.data.package_id || pkgs.data?.[0]?.id || ""), designId: d.data.id } })}
          testID="book-design-btn"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 320, backgroundColor: colors.surfaceTertiary },
  back: { position: "absolute", left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  provider: { color: colors.brand, fontWeight: font.weightSemibold },
  desc: { color: colors.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  price: { color: colors.brand, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.sm },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
});
