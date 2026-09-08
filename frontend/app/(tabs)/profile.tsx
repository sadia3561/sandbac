import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/context/AuthContext";
import { useLocation } from "@/src/context/LocationContext";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

const Row = ({ icon, label, onPress, testID }: any) => (
  <Pressable style={styles.row} onPress={onPress} testID={testID}>
    <Icon name={icon} size={20} color={colors.brandPrimary} />
    <Text style={styles.rowLabel}>{label}</Text>
    <Icon name="chevron-forward" size={18} color={colors.muted} />
  </Pressable>
);

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { clearLocation } = useLocation();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}>
        <View style={styles.head}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || "?").slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </View>
        <View style={styles.card}>
          <Row icon="location-outline" label="Saved addresses" onPress={() => router.push("/addresses")} testID="profile-addresses" />
          <Row icon="calendar-outline" label="Booking history" onPress={() => router.push("/(tabs)/bookings")} testID="profile-history" />
          <Row icon="pin-outline" label="Change location" onPress={async () => { await clearLocation(); router.replace("/onboarding/location"); }} testID="profile-change-location" />
          <Row icon="help-circle-outline" label="Help & Support" onPress={() => {}} testID="profile-help" />
        </View>
        <Button label="Log out" variant="secondary" onPress={signOut} testID="profile-logout-btn" />
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
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: font.lg },
});
