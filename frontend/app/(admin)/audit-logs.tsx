import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td } from "@/src/components/admin";
import { colors, spacing } from "@/src/theme";

export default function AdminAuditLogs() {
  const q = useQuery({ queryKey: ["admin", "audit"], queryFn: api.adminAuditLogs });
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <Row>
          <Th width={180}>Time</Th><Th flex={2}>Admin</Th><Th flex={2}>Action</Th>
          <Th flex={1}>Entity</Th><Th width={140}>ID</Th><Th flex={2}>Meta</Th>
        </Row>
        {(q.data || []).map((a: any) => (
          <Row key={a.id} hover>
            <Td width={180}>{new Date(a.created_at).toLocaleString("en-IN")}</Td>
            <Td flex={2}>{a.admin_email || a.admin_id?.slice(0, 8)}</Td>
            <Td flex={2}>{a.action}</Td>
            <Td flex={1}>{a.entity_type}</Td>
            <Td width={140} mono>{(a.entity_id || "").slice(0, 8).toUpperCase()}</Td>
            <Td flex={2}><Text style={{ color: colors.muted }} numberOfLines={1}>{JSON.stringify(a.meta || {})}</Text></Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td>No admin actions logged yet.</Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ wrap: { padding: spacing.lg } });
