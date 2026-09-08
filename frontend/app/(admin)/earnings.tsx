import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, rupees } from "@/src/api/client";
import { LoadingView, ErrorView } from "@/src/components/StateViews";
import { Card, Row, Th, Td, StatusPill } from "@/src/components/admin";
import { colors, spacing } from "@/src/theme";

export default function AdminEarnings() {
  const q = useQuery({ queryKey: ["admin", "earnings"], queryFn: api.adminEarnings });
  if (q.isLoading) return <LoadingView />;
  if (q.error) return <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} />;
  const totals = (q.data || []).reduce((acc: any, e: any) => ({
    gross: acc.gross + (e.gross_paise || 0),
    commission: acc.commission + (e.commission_paise || 0),
    net: acc.net + (e.net_paise || 0),
  }), { gross: 0, commission: 0, net: 0 });
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Card>
        <View style={{ flexDirection: "row", gap: spacing.lg, marginBottom: spacing.md, flexWrap: "wrap" }}>
          <View><Text style={styles.k}>Gross</Text><Text style={styles.v}>{rupees(totals.gross)}</Text></View>
          <View><Text style={styles.k}>Platform</Text><Text style={styles.v}>{rupees(totals.commission)}</Text></View>
          <View><Text style={styles.k}>Provider net</Text><Text style={styles.v}>{rupees(totals.net)}</Text></View>
        </View>
        <Row>
          <Th width={110}>Booking</Th><Th flex={2}>Provider</Th>
          <Th width={110}>Gross</Th><Th width={110}>Platform</Th><Th width={110}>Net</Th>
          <Th width={110}>Payout</Th><Th width={130}>Date</Th>
        </Row>
        {(q.data || []).map((e: any) => (
          <Row key={e.id} hover>
            <Td width={110} mono>{(e.booking_id || "").slice(0, 8).toUpperCase()}</Td>
            <Td flex={2}>{e.provider_name || "-"}</Td>
            <Td width={110}>{rupees(e.gross_paise)}</Td>
            <Td width={110}>{rupees(e.commission_paise)}</Td>
            <Td width={110}>{rupees(e.net_paise)}</Td>
            <Td width={110}><StatusPill status={e.status} /></Td>
            <Td width={130}>{new Date(e.created_at).toLocaleDateString("en-IN")}</Td>
          </Row>
        ))}
        {!(q.data || []).length && <Row><Td>No earnings yet.</Td></Row>}
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  k: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  v: { color: colors.onSurface, fontSize: 20, fontWeight: "700", marginTop: 4 },
});
