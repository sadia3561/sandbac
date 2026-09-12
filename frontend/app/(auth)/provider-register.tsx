import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, font, radius } from "@/src/theme";

const TYPES = [
  { k: "FULL_TIME", label: "Full-time", sub: "I work all day" },
  { k: "PART_TIME", label: "Part-time", sub: "Only specific hours" },
];

export default function ProviderRegister() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUpProvider } = useAuth();
  const [f, setF] = useState({
    name: "", email: "", phone: "", password: "",
    business_name: "", bio: "", experience_years: "0", service_radius_km: "10",
    city: "", state: "", provider_type: "FULL_TIME" as "FULL_TIME" | "PART_TIME",
    gender: "FEMALE" as "FEMALE" | "MALE" | "OTHER",
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!f.name || !f.email || !f.password || !f.phone) { setErr("Fill name, email, phone, and password"); return; }
    if (f.password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      await signUpProvider({
        ...f,
        email: f.email.trim().toLowerCase(),
        experience_years: Number(f.experience_years) || 0,
        service_radius_km: Number(f.service_radius_km) || 10,
      });
    } catch (e: any) { setErr(e?.message || "Registration failed"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Become a SANDBAC provider</Text>
        <Text style={styles.subtitle}>Grow your bookings with premium doorstep customers</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="Your name" placeholderTextColor={colors.muted} testID="prov-reg-name" />
          <Text style={styles.label}>Business / studio name</Text>
          <TextInput style={styles.input} value={f.business_name} onChangeText={(v) => setF({ ...f, business_name: v })} placeholder="Aisha Studio" placeholderTextColor={colors.muted} testID="prov-reg-business" />
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" testID="prov-reg-email" />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} placeholder="+91 …" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="prov-reg-phone" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} value={f.password} onChangeText={(v) => setF({ ...f, password: v })} placeholder="At least 6 characters" placeholderTextColor={colors.muted} secureTextEntry testID="prov-reg-password" />
          <Text style={styles.label}>Bio (short intro)</Text>
          <TextInput style={styles.input} value={f.bio} onChangeText={(v) => setF({ ...f, bio: v })} placeholder="What do you specialise in?" placeholderTextColor={colors.muted} testID="prov-reg-bio" />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Experience (yrs)</Text>
              <TextInput style={styles.input} value={f.experience_years} onChangeText={(v) => setF({ ...f, experience_years: v })} keyboardType="number-pad" testID="prov-reg-exp" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Service radius (km)</Text>
              <TextInput style={styles.input} value={f.service_radius_km} onChangeText={(v) => setF({ ...f, service_radius_km: v })} keyboardType="number-pad" testID="prov-reg-radius" />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>City</Text>
              <TextInput style={styles.input} value={f.city} onChangeText={(v) => setF({ ...f, city: v })} placeholder="Bengaluru" placeholderTextColor={colors.muted} testID="prov-reg-city" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>State</Text>
              <TextInput style={styles.input} value={f.state} onChangeText={(v) => setF({ ...f, state: v })} placeholder="Karnataka" placeholderTextColor={colors.muted} testID="prov-reg-state" />
            </View>
          </View>
          <Text style={styles.label}>Provider type</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {TYPES.map((t) => {
              const active = f.provider_type === t.k;
              return (
                <Pressable key={t.k} style={[styles.typeChip, active && styles.typeChipActive]} onPress={() => setF({ ...f, provider_type: t.k as any })} testID={`prov-type-${t.k}`}>
                  <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{t.label}</Text>
                  <Text style={[styles.typeSub, active && styles.typeSubActive]}>{t.sub}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Gender</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: -6, marginBottom: 4 }}>
            Some personal services (Facial, Mehndi, Makeup) are matched to same-gender providers only.
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {(["FEMALE", "MALE", "OTHER"] as const).map((g) => {
              const active = f.gender === g;
              return (
                <Pressable key={g} style={[styles.typeChip, active && styles.typeChipActive]} onPress={() => setF({ ...f, gender: g })} testID={`prov-gender-${g}`}>
                  <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{g.charAt(0) + g.slice(1).toLowerCase()}</Text>
                </Pressable>
              );
            })}
          </View>
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <Button label="Create provider account" onPress={submit} loading={loading} testID="prov-reg-submit-button" style={{ marginTop: spacing.md }} />
          <Pressable onPress={() => router.push("/(auth)/login")} style={{ paddingVertical: spacing.md }} testID="prov-reg-goto-login">
            <Text style={styles.link}>Already a provider? Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxl, fontWeight: font.weightBold },
  subtitle: { color: colors.muted, fontSize: font.base, marginBottom: spacing.md },
  form: { gap: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: font.weightMedium, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, fontSize: font.base, color: colors.onSurface },
  error: { color: colors.error, fontSize: font.base, marginTop: spacing.sm },
  link: { color: colors.brandPrimary, textAlign: "center", fontWeight: font.weightMedium },
  typeChip: { flex: 1, padding: spacing.md, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
  typeChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  typeLabel: { color: colors.onSurface, fontWeight: font.weightSemibold },
  typeLabelActive: { color: colors.brand },
  typeSub: { color: colors.muted, fontSize: font.sm, marginTop: 2 },
  typeSubActive: { color: colors.brand },
});
