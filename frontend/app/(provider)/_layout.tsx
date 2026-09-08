import React from "react";
import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, font } from "@/src/theme";

export default function ProviderTabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: font.sm, fontWeight: font.weightMedium },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.divider },
        tabBarIcon: ({ color, size }) => {
          const map: Record<string, string> = {
            index: "home", bookings: "briefcase", portfolio: "images",
            earnings: "cash", profile: "person",
          };
          return <Icon name={map[route.name] as any} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio" }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
