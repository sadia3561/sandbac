import { View, ActivityIndicator } from "react-native";
import { colors } from "@/src/theme";

export default function Index() {
  // Gate in _layout handles routing based on auth+location
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}
