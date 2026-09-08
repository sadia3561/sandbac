import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#1A1A1A",
  surfaceSecondary: "#F8F8F7",
  onSurfaceSecondary: "#1C1C1E",
  surfaceTertiary: "#F0F0EE",
  onSurfaceTertiary: "#3A3A3C",
  surfaceInverse: "#1C1C1E",
  onSurfaceInverse: "#FFFFFF",
  muted: "#8E8E93",
  brand: "#B04A5A",
  onBrand: "#FFFFFF",
  brandPrimary: "#C05364",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#F5D6DA",
  onBrandSecondary: "#B04A5A",
  brandTertiary: "#F9EBEB",
  onBrandTertiary: "#8A3845",
  success: "#34C759",
  onSuccess: "#FFFFFF",
  warning: "#FF9F0A",
  onWarning: "#FFFFFF",
  error: "#FF453A",
  onError: "#FFFFFF",
  info: "#64D2FF",
  onInfo: "#1C1C1E",
  border: "#E5E5E3",
  borderStrong: "#D1D1CE",
  divider: "#E5E5E3",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const font = {
  sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32,
  weightRegular: "400" as const, weightMedium: "500" as const,
  weightSemibold: "600" as const, weightBold: "700" as const,
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;
