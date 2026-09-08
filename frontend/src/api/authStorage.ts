import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ACCESS = "sandbac_access";
const REFRESH = "sandbac_refresh";
const USER = "sandbac_user";

async function set(k: string, v: string) {
  if (Platform.OS === "web") return AsyncStorage.setItem(k, v);
  return SecureStore.setItemAsync(k, v);
}
async function get(k: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(k);
  return SecureStore.getItemAsync(k);
}
async function del(k: string) {
  if (Platform.OS === "web") return AsyncStorage.removeItem(k);
  return SecureStore.deleteItemAsync(k);
}

export const authStorage = {
  setTokens: async (access: string, refresh: string) => {
    await set(ACCESS, access);
    await set(REFRESH, refresh);
  },
  getAccess: () => get(ACCESS),
  getRefresh: () => get(REFRESH),
  setUser: (u: unknown) => set(USER, JSON.stringify(u)),
  getUser: async () => {
    const s = await get(USER);
    try { return s ? JSON.parse(s) : null; } catch { return null; }
  },
  clear: async () => { await del(ACCESS); await del(REFRESH); await del(USER); },
};
