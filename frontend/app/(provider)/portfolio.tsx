import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { api, rupees, API_BASE } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

const STATUS_COLORS: Record<string, string> = {
  APPROVED: colors.success,
  PENDING_REVIEW: colors.warning,
  REJECTED: colors.error,
  DRAFT: colors.muted,
  INACTIVE: colors.muted,
};

export default function PortfolioTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prov", "portfolio"], queryFn: api.providerPortfolio });

  const del = async (id: string) => { try { await api.providerDeletePortfolio(id); qc.invalidateQueries({ queryKey: ["prov", "portfolio"] }); } catch {} };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>My Portfolio</Text>
        <Text style={styles.sub}>Approved designs are visible to customers</Text>
      </View>
      {q.isLoading ? <LoadingView /> :
       q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        >
          {!q.data?.length ? <EmptyView title="No portfolio yet" message="Add your first design" /> : (
            <View style={styles.grid}>
              {q.data.map((d: any) => (
                <View key={d.id} style={styles.card}>
                  <Image source={{ uri: abs(d.image_url) }} style={styles.img} contentFit="cover" />
                  <View style={{ padding: spacing.sm, gap: 4 }}>
                    <Text style={styles.name} numberOfLines={1}>{d.title}</Text>
                    <View style={[styles.pill, { backgroundColor: (STATUS_COLORS[d.approval_status] || colors.muted) + "20" }]}>
                      <Text style={[styles.pillText, { color: STATUS_COLORS[d.approval_status] || colors.muted }]}>
                        {d.approval_status.replaceAll("_", " ")}
                      </Text>
                    </View>
                    {d.price_paise ? <Text style={styles.price}>{rupees(d.price_paise)}</Text> : null}
                    <Pressable onPress={() => del(d.id)} style={{ paddingVertical: 6 }} testID={`del-port-${d.id}`}>
                      <Text style={{ color: colors.error, fontSize: font.sm, fontWeight: font.weightSemibold }}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      <Pressable style={[styles.fab, { bottom: insets.bottom + spacing.xl }]} onPress={() => router.push("/provider/portfolio-new" as any)} testID="add-portfolio-fab">
        <Icon name="add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  sub: { color: colors.muted, fontSize: font.sm, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: "48%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  img: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: font.base, fontWeight: font.weightSemibold },
  price: { color: colors.brand, fontWeight: font.weightBold, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: font.weightBold },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
});
