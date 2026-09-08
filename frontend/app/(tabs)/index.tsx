import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { api, rupees, API_BASE } from "@/src/api/client";
import { useLocation } from "@/src/context/LocationContext";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location } = useLocation();

  const catsQ = useQuery({ queryKey: ["cats"], queryFn: api.categories });
  const popQ = useQuery({ queryKey: ["pop"], queryFn: () => api.popular(6) });

  const loading = catsQ.isLoading || popQ.isLoading;
  const error = catsQ.error || popQ.error;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.push("/onboarding/location")} style={styles.locBtn} testID="home-location-pill">
          <Icon name="location" size={16} color={colors.brandPrimary} />
          <View style={{ marginLeft: 6 }}>
            <Text style={styles.locLabel}>Your location</Text>
            <Text style={styles.locCity}>{location?.city || "Choose"}</Text>
          </View>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => router.push("/(tabs)/notifications")} testID="home-notifications-btn">
          <Icon name="notifications-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={catsQ.isFetching || popQ.isFetching} onRefresh={() => { catsQ.refetch(); popQ.refetch(); }} />}
      >
        <View style={styles.brandRow}>
          <Text style={styles.brand}>SANDBAC</Text>
          <Text style={styles.tag}>Beauty & Celebration • at your doorstep</Text>
        </View>
        <Pressable style={styles.search} onPress={() => {}} testID="home-search">
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput placeholder="What service do you need?" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.onSurface, fontSize: font.base }} editable={false} />
        </Pressable>

        {loading ? <LoadingView /> : null}
        {error && !loading ? <ErrorView message={(error as any).message} onRetry={() => { catsQ.refetch(); popQ.refetch(); }} /> : null}

        {catsQ.data ? (
          <>
            <Text style={styles.sectionTitle}>Categories</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
              {catsQ.data.map((c: any) => (
                <Pressable key={c.id} style={styles.catCard} onPress={() => router.push(`/category/${c.id}`)} testID={`cat-${c.slug}`}>
                  <Image source={{ uri: c.image_url }} style={styles.catImg} contentFit="cover" />
                  <View style={styles.catShade} />
                  <Text style={styles.catName}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {popQ.data ? (
          <>
            <Text style={styles.sectionTitle}>Popular services</Text>
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {popQ.data.map((s: any) => (
                <Pressable key={s.id} style={styles.svcCard} onPress={() => router.push(`/service/${s.id}`)} testID={`svc-${s.slug}`}>
                  <Image source={{ uri: abs(s.image_url) }} style={styles.svcImg} contentFit="cover" />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.svcTitle}>{s.name}</Text>
                    <Text style={styles.svcDesc} numberOfLines={2}>{s.description}</Text>
                    <Text style={styles.svcPrice}>Starting {rupees(s.starting_price_paise)}</Text>
                  </View>
                  <Icon name="chevron-forward" size={20} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  locBtn: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.xs, paddingRight: spacing.md },
  locLabel: { color: colors.muted, fontSize: font.sm },
  locCity: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  brandRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  brand: { color: colors.brand, fontSize: font.xxl, fontWeight: font.weightBold, letterSpacing: 1 },
  tag: { color: colors.muted, fontSize: font.base, marginTop: 2 },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceTertiary, marginHorizontal: spacing.lg, marginVertical: spacing.md, padding: spacing.md, borderRadius: radius.pill },
  sectionTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  catRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  catCard: { width: 130, height: 100, borderRadius: radius.md, overflow: "hidden", justifyContent: "flex-end", padding: spacing.md },
  catImg: { ...StyleSheet.absoluteFillObject },
  catShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  catName: { color: "#fff", fontWeight: font.weightBold, fontSize: font.lg },
  svcCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  svcImg: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  svcTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  svcDesc: { color: colors.muted, fontSize: font.sm },
  svcPrice: { color: colors.brand, fontWeight: font.weightSemibold, fontSize: font.base, marginTop: 2 },
});
