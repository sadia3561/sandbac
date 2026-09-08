import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, StatusPill } from "@/src/components/admin";
import { colors, spacing, font } from "@/src/theme";

const STATUSES = ["", "PENDING", "SEARCHING_PROVIDER", "PROVIDER_ACCEPTED", "PROVIDER_ON_THE_WAY", "ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED", "CANCELLED"];

export default function AdminBookings() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const data = useQuery({ queryKey: ["admin", "bookings", status, q], queryFn: () => api.adminBookings({ status: status || undefined, q: q || undefined, limit: 100 }) });

  if (data.isLoading) return <LoadingView />;
  if (data.error) return <ErrorView message={(data.error as any).message} onRetry={() => data.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md, flexWrap: "wrap", alignItems: "center" }}>
          <Input placeholder="Search service / booking id" value={q} onChangeText={setQ} style={{ flex: 1, minWidth: 200 }} testID="bookings-search" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: spacing.sm }}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={[styles.tab, status === s && styles.tabActive]} testID={`bk-status-${s || "all"}`}>
              <Text style={[styles.tabText, status === s && styles.tabTextActive]}>{s.replaceAll("_", " ") || "All"}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Row>
          <Th width={110}>ID</Th><Th flex={2}>Service</Th><Th flex={1}>Package</Th>
          <Th width={110}>Type</Th><Th width={100}>Price</Th><Th width={150}>Status</Th><Th width={140}>Created</Th>
        </Row>
        {(data.data?.items || []).map((b: any) => (
          <Row key={b.id} hover>
            <Td width={110} mono>{b.id.slice(0, 8).toUpperCase()}</Td>
            <Td flex={2}>{b.service_name}</Td>
            <Td flex={1}>{b.package_name}{b.design_title ? ` • ${b.design_title}` : ""}</Td>
            <Td width={110}>{b.booking_type}</Td>
            <Td width={100}>{rupees(b.price_paise || 0)}</Td>
            <Td width={150}><StatusPill status={b.status} /></Td>
            <Td width={140}>{new Date(b.created_at).toLocaleDateString("en-IN")}</Td>
          </Row>
        ))}
        {!(data.data?.items || []).length && <Row><Td>No bookings match.</Td></Row>}
        <Text style={{ color: colors.muted, marginTop: spacing.sm }}>{data.data?.total || 0} total</Text>
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary, flexShrink: 0 },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: font.weightMedium },
  tabTextActive: { color: colors.onBrandPrimary },
});
