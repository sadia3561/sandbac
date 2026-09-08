import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { LoadingView, ErrorView, EmptyView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

export default function NotificationsTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifs"], queryFn: api.notifications });

  const onRead = async (id: string) => { await api.markRead(id); qc.invalidateQueries({ queryKey: ["notifs"] }); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Notifications</Text>
      </View>
      {q.isLoading ? <LoadingView /> :
       q.error ? <ErrorView message={(q.error as any).message} onRetry={() => q.refetch()} /> :
       !q.data?.length ? <EmptyView title="You're all caught up" message="Booking updates will appear here" /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        >
          {q.data.map((n: any) => (
            <Pressable key={n.id} onPress={() => onRead(n.id)} style={[styles.item, !n.read && styles.itemUnread]} testID={`notif-${n.id}`}>
              <Text style={styles.itemTitle}>{n.title}</Text>
              <Text style={styles.itemMsg}>{n.message}</Text>
              <Text style={styles.time}>{new Date(n.created_at).toLocaleString("en-IN")}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  item: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, gap: 4 },
  itemUnread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  itemTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  itemMsg: { color: colors.onSurfaceSecondary, fontSize: font.base },
  time: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
