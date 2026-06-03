// Landing route for "/". The redirect decision lives in _layout.tsx's
// Routing effect (auth → sign-in, stored vault → unlock, fresh → create,
// unlocked → home). Until that fires we render a calm splash so the entry
// URL always matches a screen instead of showing "Unmatched Route".

import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Eyebrow } from "../src/ui";
import { colors } from "../src/theme";

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, gap: 18 }}>
      <Eyebrow>Lyfos</Eyebrow>
      <ActivityIndicator color={colors.text3} />
    </View>
  );
}
