import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, StatusPill } from "@/src/components/admin";
import { colors, spacing } from "@/src/theme";

export default function AdminComplaints() {
  const q = useQuery({ queryKey: ["admin", "complaints"], queryFn: api.adminComplaints });
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <Text style={{ color: colors.muted, marginBottom: spacing.md }}>
          Complaint intake API is scaffolded; customer/provider UI to file complaints will land in a later step.
        </Text>
        <Row>
          <Th width={110}>ID</Th><Th flex={1}>Category</Th><Th flex={3}>Description</Th>
          <Th width={110}>Status</Th><Th width={130}>Created</Th>
        </Row>
        {(q.data || []).map((c: any) => (
          <Row key={c.id} hover>
            <Td width={110} mono>{c.id.slice(0, 8).toUpperCase()}</Td>
            <Td flex={1}>{c.category}</Td>
            <Td flex={3}>{c.description}</Td>
            <Td width={110}><StatusPill status={c.status || "OPEN"} /></Td>
            <Td width={130}>{new Date(c.created_at).toLocaleDateString("en-IN")}</Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td>No complaints filed.</Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ wrap: { padding: spacing.lg } });
