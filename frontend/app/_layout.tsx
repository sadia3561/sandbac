import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { LocationProvider, useLocation } from "@/src/context/LocationContext";
import { useRealtime } from "@/src/realtime/useRealtime";

LogBox.ignoreAllLogs(true);

function Gate() {
  const { user, ready: authReady } = useAuth();
  const { location, ready: locReady } = useLocation();
  const router = useRouter();
  const segments = useSegments();
  useRealtime();

  useEffect(() => {
    if (!authReady || !locReady) return;
    const first = segments[0] as string | undefined;
    const inAuth = first === "(auth)";
    const inOnboarding = first === "onboarding";
    const inProvider = first === "(provider)" || first === "provider";
    const inCustomer = first === "(tabs)";

    if (!user && !inAuth) {
      router.replace("/(auth)/welcome");
      return;
    }
    if (user?.role === "ADMIN") {
      if (first !== "(admin)") router.replace("/(admin)");
      return;
    }
    if (user?.role === "PROVIDER") {
      if (!inProvider && !inAuth) router.replace("/(provider)");
      else if (inAuth) router.replace("/(provider)");
      return;
    }
    // CUSTOMER path
    if (user && !location && !inOnboarding) {
      router.replace("/onboarding/location");
    } else if (user && location && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [user, location, authReady, locReady, segments]);

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#FFFFFF" } }} />;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocationProvider>
              <StatusBar style="dark" />
              <Gate />
            </LocationProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
