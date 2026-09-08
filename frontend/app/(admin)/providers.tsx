import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing, font } from "@/src/theme";

const KYC_TABS = ["", "PENDING", "APPROVED", "REJECTED", "NOT_SUBMITTED"];

export default function AdminProviders() {
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("");
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["admin", "providers", q, kyc], queryFn: () => api.adminProviders({ q, kyc: kyc || undefined }) });

  const toggle = async (id: string, next: boolean) => {
    try { await api.adminSetProviderActive(id, next); qc.invalidateQueries({ queryKey: ["admin", "providers"] }); }
    catch (e: any) { Alert.alert("Error", e?.message); }
  };

  if (data.isLoading) return <LoadingView />;
  if (data.error) return <ErrorView message={(data.error as any).message} onRetry={() => data.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, alignItems: "center", flexWrap: "wrap" }}>
          <Input placeholder="Search name / email" value={q} onChangeText={setQ} style={{ flex: 1, minWidth: 200 }} testID="admin-prov-search" />
          <View style={{ flexDirection: "row", gap: 6 }}>
            {KYC_TABS.map((t) => (
              <Pressable key={t} onPress={() => setKyc(t)} style={[styles.tab, kyc === t && styles.tabActive]} testID={`kyc-filter-${t || "all"}`}>
                <Text style={[styles.tabText, kyc === t && styles.tabTextActive]}>{t || "All"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Row>
          <Th flex={2}>Business</Th>
          <Th flex={2}>Email</Th>
          <Th width={100}>Type</Th>
          <Th width={110}>Availability</Th>
          <Th width={110}>KYC</Th>
          <Th width={100}>Active</Th>
          <Th width={140}>Action</Th>
        </Row>
        {(data.data?.items || []).map((p: any) => (
          <Row key={p.id} hover>
            <Td flex={2}>{p.business_name}</Td>
            <Td flex={2}>{p.email}</Td>
            <Td width={100}>{p.provider_type}</Td>
            <Td width={110}><StatusPill status={p.availability} /></Td>
            <Td width={110}><StatusPill status={p.kyc_status} /></Td>
            <Td width={100}><StatusPill status={p.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={140}>
              <Btn small variant={p.is_active ? "danger" : "primary"} label={p.is_active ? "Deactivate" : "Activate"} onPress={() => toggle(p.id, !p.is_active)} testID={`toggle-prov-${p.id}`} />
            </Td>
          </Row>
        ))}
        {!(data.data?.items || []).length && <Row><Td>No providers</Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: font.weightMedium },
  tabTextActive: { color: colors.onBrandPrimary },
});
