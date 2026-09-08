import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Location = { city: string; state?: string; latitude?: number; longitude?: number };

type Ctx = {
  location: Location | null;
  ready: boolean;
  setLocation: (l: Location) => Promise<void>;
  clearLocation: () => Promise<void>;
};

const K = "sandbac_location";
const LocCtx = createContext<Ctx | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLoc] = useState<Location | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(K);
        if (s) setLoc(JSON.parse(s));
      } catch {}
      setReady(true);
    })();
  }, []);

  const value = useMemo<Ctx>(() => ({
    location, ready,
    setLocation: async (l) => { setLoc(l); await AsyncStorage.setItem(K, JSON.stringify(l)); },
    clearLocation: async () => { setLoc(null); await AsyncStorage.removeItem(K); },
  }), [location, ready]);
  return <LocCtx.Provider value={value}>{children}</LocCtx.Provider>;
}

export function useLocation() {
  const c = useContext(LocCtx);
  if (!c) throw new Error("useLocation inside LocationProvider");
  return c;
}
