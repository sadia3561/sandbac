import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Slot, useRouter, useSegments } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, font, radius } from "@/src/theme";

const ITEMS: { key: string; label: string; icon: string; route: string }[] = [
  { key: "", label: "Dashboard", icon: "speedometer-outline", route: "/(admin)" },
  { key: "customers", label: "Customers", icon: "people-outline", route: "/(admin)/customers" },
  { key: "providers", label: "Providers", icon: "briefcase-outline", route: "/(admin)/providers" },
  { key: "kyc", label: "Provider KYC", icon: "shield-checkmark-outline", route: "/(admin)/kyc" },
  { key: "categories", label: "Categories", icon: "grid-outline", route: "/(admin)/categories" },
  { key: "services", label: "Services", icon: "construct-outline", route: "/(admin)/services" },
  { key: "packages", label: "Packages", icon: "pricetags-outline", route: "/(admin)/packages" },
  { key: "portfolio", label: "Portfolio / Designs", icon: "images-outline", route: "/(admin)/portfolio" },
  { key: "custom-requests", label: "Custom Requests", icon: "chatbubbles-outline", route: "/(admin)/custom-requests" },
  { key: "bookings", label: "Bookings", icon: "calendar-outline", route: "/(admin)/bookings" },
  { key: "service-areas", label: "Service Areas", icon: "map-outline", route: "/(admin)/service-areas" },
  { key: "reviews", label: "Reviews", icon: "star-outline", route: "/(admin)/reviews" },
  { key: "complaints", label: "Complaints", icon: "warning-outline", route: "/(admin)/complaints" },
  { key: "announcements", label: "Announcements", icon: "megaphone-outline", route: "/(admin)/announcements" },
  { key: "coupons", label: "Coupons", icon: "gift-outline", route: "/(admin)/coupons" },
  { key: "earnings", label: "Earnings", icon: "cash-outline", route: "/(admin)/earnings" },
  { key: "audit-logs", label: "Audit Logs", icon: "document-text-outline", route: "/(admin)/audit-logs" },
];

export default function AdminLayout() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const router = useRouter();
  const segments = useSegments();
  const currentKey = (segments[1] as string | undefined) || "";
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showSidebar = isWide || sidebarOpen;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary, flexDirection: isWide ? "row" : "column" }}>
      {showSidebar ? (
        <View style={[styles.sidebar, isWide ? styles.sidebarPermanent : styles.sidebarOverlay]}>
          <View style={styles.brandBox}>
            <Text style={styles.brand}>SANDBAC</Text>
            <Text style={styles.brandSub}>Admin</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {ITEMS.map((it) => {
              const active = it.key === currentKey;
              return (
                <Pressable
                  key={it.key}
                  onPress={() => { router.push(it.route as any); if (!isWide) setSidebarOpen(false); }}
                  style={[styles.item, active && styles.itemActive]}
                  testID={`admin-nav-${it.key || "dashboard"}`}
                >
                  <Icon name={it.icon as any} size={18} color={active ? colors.brandPrimary : colors.onSurfaceTertiary} />
                  <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{it.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={styles.logout} onPress={signOut} testID="admin-logout">
            <Icon name="log-out-outline" size={18} color={colors.error} />
            <Text style={{ color: colors.error, fontWeight: font.weightSemibold }}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <View style={styles.topBar}>
          {!isWide ? (
            <Pressable onPress={() => setSidebarOpen((v) => !v)} style={styles.hamburger} testID="admin-hamburger">
              <Icon name="menu" size={22} color={colors.onSurface} />
            </Pressable>
          ) : null}
          <Text style={styles.topTitle}>{ITEMS.find((i) => i.key === currentKey)?.label || "Dashboard"}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.adminEmail}>{user?.email}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 260, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.divider, paddingVertical: spacing.md },
  sidebarPermanent: {},
  sidebarOverlay: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 10, elevation: 10, shadowColor: "#000", shadowOffset: { width: 2, height: 0 }, shadowOpacity: 0.15, shadowRadius: 8 },
  brandBox: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  brand: { color: colors.brand, fontSize: font.xl, fontWeight: font.weightBold, letterSpacing: 1 },
  brandSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  itemActive: { backgroundColor: colors.brandTertiary, borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  itemLabel: { color: colors.onSurfaceTertiary, fontSize: font.base },
  itemLabelActive: { color: colors.brand, fontWeight: font.weightSemibold },
  logout: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  topBar: { height: 60, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.md },
  topTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold },
  adminEmail: { color: colors.muted, fontSize: font.sm },
  hamburger: { padding: spacing.sm },
});
