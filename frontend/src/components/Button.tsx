import React from "react";
import { Pressable, Text, ActivityIndicator, StyleProp, ViewStyle, View } from "react-native";
import { makeStyles, spacing, radius, font } from "@/src/theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
};

export function Button({ label, onPress, variant = "primary", loading, disabled, testID, style, fullWidth = true }: Props) {
  const s = useStyles();
  const isDisabled = disabled || loading;
  const containerStyle = [
    s.base,
    variant === "primary" && s.primary,
    variant === "secondary" && s.secondary,
    variant === "ghost" && s.ghost,
    fullWidth && s.full,
    isDisabled && s.disabled,
    style,
  ];
  const textStyle = [
    s.text,
    variant === "primary" && s.textPrimary,
    variant === "secondary" && s.textSecondary,
    variant === "ghost" && s.textGhost,
  ];
  return (
    <Pressable onPress={isDisabled ? undefined : onPress} style={containerStyle} testID={testID}>
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : undefined} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Text style={textStyle}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  base: { paddingVertical: spacing.md + 2, paddingHorizontal: spacing.xl, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  full: { alignSelf: "stretch" },
  primary: { backgroundColor: c.brandPrimary },
  secondary: { backgroundColor: c.brandSecondary },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.border },
  disabled: { opacity: 0.5 },
  text: { fontSize: font.lg, fontWeight: font.weightSemibold },
  textPrimary: { color: c.onBrandPrimary },
  textSecondary: { color: c.onBrandSecondary },
  textGhost: { color: c.onSurface },
}));
