import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, font, radius } from "@/src/theme";

export default function Register() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name || !email || !password) { setErr("Please fill all required fields"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setLoading(true);
    try { await signUp(name.trim(), email.trim().toLowerCase(), password, phone || undefined); }
    catch (e: any) { setErr(e?.message || "Registration failed"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Join SANDBAC in a minute</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.muted} testID="register-name-input" />
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" testID="register-email-input" />
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+91 …" placeholderTextColor={colors.muted} keyboardType="phone-pad" testID="register-phone-input" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Create a password" placeholderTextColor={colors.muted} secureTextEntry testID="register-password-input" />
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <Button label="Create account" onPress={submit} loading={loading} testID="register-submit-button" style={{ marginTop: spacing.md }} />
          <Pressable onPress={() => router.push("/(auth)/login")} style={{ paddingVertical: spacing.md }} testID="register-goto-login">
            <Text style={styles.link}>Have an account? Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: font.weightBold },
  subtitle: { color: colors.muted, fontSize: font.lg, marginBottom: spacing.lg },
  form: { gap: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontSize: font.base, fontWeight: font.weightMedium, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface },
  error: { color: colors.error, fontSize: font.base, marginTop: spacing.sm },
  link: { color: colors.brandPrimary, textAlign: "center", fontWeight: font.weightMedium },
});
