import React from "react";
import { View, Text, ScrollView, StyleSheet, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, Btn, StatusPill } from "@/src/components/admin";
import { colors, spacing } from "@/src/theme";

export default function AdminReviews() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "reviews"], queryFn: api.adminReviews });
  const moderate = async (id: string, hidden: boolean) => {
    try { await api.adminModerateReview(id, hidden); qc.invalidateQueries({ queryKey: ["admin", "reviews"] }); }
    catch (e: any) { Alert.alert("Error", e?.message); }
  };
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <Row>
          <Th width={80}>Rating</Th><Th flex={3}>Comment</Th><Th flex={1}>Booking</Th>
          <Th width={110}>Status</Th><Th width={150}>Action</Th>
        </Row>
        {(q.data || []).map((r: any) => (
          <Row key={r.id} hover>
            <Td width={80}>{"★".repeat(Math.round(r.rating || 0))}</Td>
            <Td flex={3}>{r.comment || "-"}</Td>
            <Td flex={1}>{(r.booking_id || "").slice(0, 8).toUpperCase()}</Td>
            <Td width={110}><StatusPill status={r.hidden ? "INACTIVE" : "ACTIVE"} /></Td>
            <Td width={150}>
              <Btn small variant={r.hidden ? "primary" : "danger"} label={r.hidden ? "Show" : "Hide"} onPress={() => moderate(r.id, !r.hidden)} />
            </Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td><Text style={{ color: colors.muted }}>No reviews yet — reviews appear after customers rate completed bookings.</Text></Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ wrap: { padding: spacing.lg } });
