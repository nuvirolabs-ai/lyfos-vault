// Bottom-tab layout for the unlocked app. Two primary tabs: Home and
// Vault. Settings is a modal accessed from each tab's header — same
// IA as the web.

import React from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable } from "react-native";
import { colors } from "../../src/theme";
import { useApp } from "../../src/AppContext";

export default function TabsLayout() {
  const { unlocked } = useApp();
  // If not unlocked, root layout has redirected away — this is just a safety net.
  if (!unlocked) return null;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.text3,
        tabBarStyle: { borderTopColor: colors.divider, backgroundColor: colors.bg, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" }
      }}
    >
      <Tabs.Screen name="home"   options={{ title: "Home",   tabBarIcon: ({ color }) => <TabDot color={color} /> }} />
      <Tabs.Screen name="vault"  options={{ title: "Vault",  tabBarIcon: ({ color }) => <TabDot color={color} hollow /> }} />
    </Tabs>
  );
}

function TabDot({ color, hollow }: { color: string; hollow?: boolean }) {
  return (
    <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, backgroundColor: hollow ? "transparent" : color, borderWidth: 1.5, borderColor: color }} />
  );
}
