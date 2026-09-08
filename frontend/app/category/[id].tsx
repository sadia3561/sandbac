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

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cats = useQuery({ queryKey: ["cats"], queryFn: api.categories });
  const cat = cats.data?.find((c: any) => c.id === id);
  const svcs = useQuery({ queryKey: ["services", id], queryFn: () => api.services(id!), enabled: !!id });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>{cat?.name || "Category"}</Text>
        <View style={{ width: 40 }} />
      </View>
      {svcs.isLoading ? <LoadingView /> :
       svcs.error ? <ErrorView message={(svcs.error as any).message} onRetry={() => svcs.refetch()} /> :
       !svcs.data?.length ? <EmptyView title="No services yet" message="Please check back soon" /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
          {svcs.data.map((s: any) => (
            <Pressable key={s.id} style={styles.card} onPress={() => router.push(`/service/${s.id}`)} testID={`service-${s.slug}`}>
              <Image source={{ uri: abs(s.image_url) }} style={styles.img} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.title}>{s.name}</Text>
                <Text style={styles.desc} numberOfLines={2}>{s.description}</Text>
                <Text style={styles.price}>Starting {rupees(s.starting_price_paise)}</Text>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
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
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  img: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  title: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  desc: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontWeight: font.weightSemibold, fontSize: font.base, marginTop: 2 },
});
