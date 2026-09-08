import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { api, API_BASE, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, StatusPill } from "@/src/components/admin";
import { colors, spacing, font, radius } from "@/src/theme";

const abs = (u?: string) => (!u ? "" : u.startsWith("http") ? u : `${API_BASE}${u}`);

export default function AdminCustomRequests() {
  const q = useQuery({ queryKey: ["admin", "custom"], queryFn: api.adminCustomRequests });
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <Text style={{ color: colors.muted, marginBottom: spacing.md }}>
          Customer-uploaded references. These belong to the customer as service requirements — not to SANDBAC or providers.
        </Text>
        <View style={styles.grid}>
          {(q.data || []).map((b: any) => (
            <View key={b.id} style={styles.card}>
              <Image source={{ uri: abs(b.reference_image_url) }} style={styles.img} contentFit="cover" />
              <View style={{ padding: spacing.md, gap: 4 }}>
                <Text style={styles.title}>{b.service_name}</Text>
                <Text style={styles.sub}>{b.package_name}{b.design_title ? ` • ${b.design_title}` : ""}</Text>
                {b.reference_note ? <Text style={styles.sub}>"{b.reference_note}"</Text> : null}
                <Text style={styles.sub}>{b.address?.city || "-"} • {new Date(b.created_at).toLocaleDateString("en-IN")}</Text>
                <Text style={styles.price}>{rupees(b.price_paise)}</Text>
                <StatusPill status={b.status} />
              </View>
            </View>
          ))}
          {!(q.data || []).length && <Text style={{ color: colors.muted }}>No custom requests yet.</Text>}
        </View>
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: 280, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, overflow: "hidden" },
  img: { width: "100%", height: 180, backgroundColor: colors.surfaceTertiary },
  title: { color: colors.onSurface, fontWeight: font.weightSemibold, fontSize: font.base },
  sub: { color: colors.muted, fontSize: font.sm },
  price: { color: colors.brand, fontWeight: font.weightBold },
});
