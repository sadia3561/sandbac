import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Input, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing } from "@/src/theme";

export default function AdminCustomers() {
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["admin", "customers", q], queryFn: () => api.adminCustomers({ q }) });

  const toggle = async (id: string, next: boolean) => {
    try { await api.adminSetCustomerActive(id, next); qc.invalidateQueries({ queryKey: ["admin", "customers"] }); }
    catch (e: any) { Alert.alert("Error", e?.message); }
  };

  if (data.isLoading) return <LoadingView />;
  if (data.error) return <ErrorView message={(data.error as any).message} onRetry={() => data.refetch()} />;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, alignItems: "center" }}>
          <Input placeholder="Search name / email / phone" value={q} onChangeText={setQ} style={{ flex: 1 }} testID="admin-cust-search" />
        </View>
        <Row>
          <Th flex={2}>Name</Th>
          <Th flex={2}>Email</Th>
          <Th flex={1}>Phone</Th>
          <Th width={120}>Status</Th>
          <Th width={160}>Action</Th>
        </Row>
        {(data.data?.items || []).map((u: any) => (
          <Row key={u.id} hover>
            <Td flex={2}>{u.name}</Td>
            <Td flex={2}>{u.email}</Td>
            <Td flex={1}>{u.phone || "-"}</Td>
            <Td width={120}><StatusPill status={u.is_active ? "ACTIVE" : "INACTIVE"} /></Td>
            <Td width={160}>
              <Btn small variant={u.is_active ? "danger" : "primary"} label={u.is_active ? "Deactivate" : "Activate"} onPress={() => toggle(u.id, !u.is_active)} testID={`toggle-cust-${u.id}`} />
            </Td>
          </Row>
        ))}
        {!(data.data?.items || []).length && <Row><Td>No customers</Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ wrap: { padding: spacing.lg } });
