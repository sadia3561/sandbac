import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Button } from "@/src/components/Button";
import { colors, spacing, font, radius } from "@/src/theme";

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.hero}>
        <Image
          source={{ uri: "https://images.unsplash.com/photo-1610047614301-13c63f00c032?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" }}
          style={styles.heroImage}
          contentFit="cover"
        />
        <View style={styles.scrim} />
        <View style={styles.heroContent}>
          <Text style={styles.brand}>SANDBAC</Text>
          <Text style={styles.tagline}>Beauty & Celebration{"\n"}at your doorstep</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Text style={styles.copy}>Book trusted professionals for facials, mehndi, makeup, and party decoration — all at your doorstep.</Text>
        <Button label="Get started" onPress={() => router.push("/(auth)/register")} testID="welcome-get-started-btn" />
        <Button label="I already have an account" variant="ghost" onPress={() => router.push("/(auth)/login")} testID="welcome-login-btn" />
        <Pressable onPress={() => router.push("/(auth)/provider-register")} style={{ paddingVertical: spacing.sm }} testID="welcome-provider-register-btn">
          <Text style={{ color: colors.brandPrimary, textAlign: "center", fontWeight: font.weightSemibold }}>Register as a service provider →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, gap: spacing.xl },
  hero: { flex: 1, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end" },
  heroImage: { ...StyleSheet.absoluteFillObject },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  heroContent: { padding: spacing.xl, gap: spacing.xs },
  brand: { color: "#fff", fontSize: font.xxxl, fontWeight: font.weightBold, letterSpacing: 2 },
  tagline: { color: "#fff", fontSize: font.xl, fontWeight: font.weightMedium },
  actions: { gap: spacing.md },
  copy: { color: colors.muted, fontSize: font.base, textAlign: "center", marginBottom: spacing.sm },
});
