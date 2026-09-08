import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/context/AuthContext";
import { Button } from "@/src/components/Button";
import { api } from "@/src/api/client";
import { LoadingView } from "@/src/components/StateViews";
import { colors, spacing, font, radius } from "@/src/theme";

const Row = ({ icon, label, sub, onPress, testID }: any) => (
  <Pressable style={styles.row} onPress={onPress} testID={testID}>
    <Icon name={icon} size={20} color={colors.brandPrimary} />
    <View style={{ flex: 1 }}>
      <Text style={styles.rowLabel}>{label}</Text>
      {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
    </View>
    <Icon name="chevron-forward" size={18} color={colors.muted} />
  </Pressable>
);

export default function ProviderProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const me = useQuery({ queryKey: ["prov", "me"], queryFn: api.providerMe });

  if (me.isLoading) return <LoadingView />;
  const p = me.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}>
        <View style={styles.head}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(p?.business_name || p?.name || "?").slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p?.business_name || p?.name}</Text>
            <Text style={styles.email}>{p?.email}</Text>
            <Text style={styles.badge}>{p?.provider_type} • {p?.experience_years}y exp • ★ {(p?.rating || 0).toFixed(1)}</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Row icon="build-outline" label="My services" sub="Enable services you offer" onPress={() => router.push("/provider/services" as any)} testID="prof-services" />
          <Row icon="time-outline" label="Working schedule" sub="Days & hours you work" onPress={() => router.push("/provider/schedule" as any)} testID="prof-schedule" />
          <Row icon="images-outline" label="Portfolio" onPress={() => router.push("/(provider)/portfolio")} testID="prof-portfolio" />
          <Row icon="shield-checkmark-outline" label="KYC" sub={p?.kyc_status?.replaceAll("_", " ")} onPress={() => router.push("/provider/kyc" as any)} testID="prof-kyc" />
        </View>
        <View style={styles.card}>
          <Row icon="help-circle-outline" label="Help & Support" onPress={() => {}} testID="prof-help" />
        </View>
        <Button label="Log out" variant="secondary" onPress={signOut} testID="prof-logout-btn" />
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 28, fontWeight: font.weightBold, color: colors.onBrandSecondary },
  name: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  email: { color: colors.muted },
  badge: { color: colors.brand, fontSize: font.sm, marginTop: 2, fontWeight: font.weightSemibold },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  rowLabel: { color: colors.onSurface, fontSize: font.lg },
  rowSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
});
