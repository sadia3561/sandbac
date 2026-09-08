import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Switch, Alert } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { LoadingView } from "@/src/components/StateViews";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Day = { day_of_week: number; start_time: string; end_time: string; is_active: boolean };

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prov", "schedule"], queryFn: api.providerSchedule });
  const [days, setDays] = useState<Day[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) {
      const full: Day[] = Array.from({ length: 7 }, (_, i) => {
        const found = q.data.find((d: any) => d.day_of_week === i);
        return found || { day_of_week: i, start_time: "09:00", end_time: "18:00", is_active: false };
      });
      setDays(full);
    }
  }, [q.data]);

  const save = async () => {
    setBusy(true);
    try {
      await api.providerSetSchedule(days);
      qc.invalidateQueries({ queryKey: ["prov", "schedule"] });
      Alert.alert("Saved", "Working schedule updated.");
    } catch (e: any) { Alert.alert("Save", e?.message || "Failed"); }
    finally { setBusy(false); }
  };

  if (q.isLoading) return <LoadingView />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="back-btn"><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Working schedule</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Part-time providers: only enable days you actually work. Backend uses this for scheduled bookings.</Text>
        {days.map((d, idx) => (
          <View key={idx} style={styles.card}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.dayLabel}>{DAY_LABELS[idx]}</Text>
              <Switch value={d.is_active} onValueChange={(v) => setDays(days.map((x, i) => i === idx ? { ...x, is_active: v } : x))} testID={`sched-active-${idx}`} />
            </View>
            {d.is_active ? (
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sublabel}>Start (HH:MM)</Text>
                  <TextInput style={styles.input} value={d.start_time} onChangeText={(v) => setDays(days.map((x, i) => i === idx ? { ...x, start_time: v } : x))} testID={`sched-start-${idx}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sublabel}>End (HH:MM)</Text>
                  <TextInput style={styles.input} value={d.end_time} onChangeText={(v) => setDays(days.map((x, i) => i === idx ? { ...x, end_time: v } : x))} testID={`sched-end-${idx}`} />
                </View>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button label="Save schedule" onPress={save} loading={busy} testID="sched-save-btn" />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  hint: { color: colors.muted, fontSize: font.sm, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  dayLabel: { color: colors.onSurface, fontSize: font.lg, fontWeight: font.weightSemibold },
  sublabel: { color: colors.muted, fontSize: font.sm, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: font.base, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
});
