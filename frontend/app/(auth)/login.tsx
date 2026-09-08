import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, font, radius } from "@/src/theme";

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!email || !password) { setErr("Enter email and password"); return; }
    setLoading(true);
    try { await signIn(email.trim().toLowerCase(), password); }
    catch (e: any) { setErr(e?.message || "Sign in failed"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com"
            placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" testID="login-email-input"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input} value={password} onChangeText={setPassword} placeholder="Your password"
            placeholderTextColor={colors.muted} secureTextEntry testID="login-password-input"
          />
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <Button label="Sign in" onPress={onSubmit} loading={loading} testID="login-submit-button" style={{ marginTop: spacing.md }} />
          <Pressable onPress={() => router.push("/(auth)/register")} style={{ paddingVertical: spacing.md }} testID="login-goto-register">
            <Text style={styles.link}>New here? Create an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: font.xxxl, fontWeight: font.weightBold },
  subtitle: { color: colors.muted, fontSize: font.lg, marginBottom: spacing.lg },
  form: { gap: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontSize: font.base, fontWeight: font.weightMedium, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, fontSize: font.lg, color: colors.onSurface },
  error: { color: colors.error, fontSize: font.base, marginTop: spacing.sm },
  link: { color: colors.brandPrimary, textAlign: "center", fontWeight: font.weightMedium },
});
