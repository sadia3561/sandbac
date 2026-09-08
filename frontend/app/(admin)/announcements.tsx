import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { Card, Input, Btn } from "@/src/components/admin";
import { colors, spacing, font } from "@/src/theme";

const AUDS = ["ALL", "CUSTOMERS", "PROVIDERS"];

export default function AdminAnnouncements() {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [aud, setAud] = useState<"ALL" | "CUSTOMERS" | "PROVIDERS">("ALL");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title || !message) { Alert.alert("Missing", "Title & message required"); return; }
    setBusy(true);
    try {
      const r = await api.adminAnnounce({ title, message, audience: aud });
      Alert.alert("Sent", `Delivered to ${r.recipients} recipient(s)`);
      setTitle(""); setMessage("");
    } catch (e: any) { Alert.alert("Error", e?.message); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: insets.bottom + spacing.xl }]}>
      <Card>
        <Text style={styles.h}>Broadcast an announcement</Text>
        <Text style={{ color: colors.muted, marginBottom: spacing.md }}>Sends an in-app notification to the selected audience. Push infrastructure lands in a later step.</Text>
        <Input placeholder="Title" value={title} onChangeText={setTitle} testID="ann-title" />
        <View style={{ height: spacing.sm }} />
        <Input placeholder="Message" value={message} onChangeText={setMessage} multiline style={{ minHeight: 100, textAlignVertical: "top" }} testID="ann-msg" />
        <View style={{ height: spacing.md }} />
        <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md }}>
          {AUDS.map((a) => (
            <Pressable key={a} onPress={() => setAud(a as any)} style={[styles.tag, aud === a && styles.tagActive]} testID={`ann-aud-${a}`}>
              <Text style={[styles.tagText, aud === a && styles.tagTextActive]}>{a}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Btn label="Send announcement" loading={busy} onPress={send} testID="ann-send-btn" />
        </View>
      </Card>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { padding: spacing.lg },
  h: { color: colors.onSurface, fontSize: font.xl, fontWeight: font.weightBold, marginBottom: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surfaceTertiary },
  tagActive: { backgroundColor: colors.brandPrimary },
  tagText: { color: colors.onSurfaceTertiary },
  tagTextActive: { color: colors.onBrandPrimary, fontWeight: font.weightSemibold },
});
