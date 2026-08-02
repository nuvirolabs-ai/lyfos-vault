import React from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import * as Linking from "expo-linking";
import Constants from "expo-constants";

import { Screen, Eyebrow, H1, Body, Footnote, PrimaryButton, Card } from "./ui";
import { colors } from "./theme";
import { publicAppOrigin } from "./lib/appUrls";

export default function RecoveryWebHandoff() {
  const pathname = usePathname();
  const origin = publicAppOrigin((Constants?.expoConfig?.extra as any)?.APP_URL);
  const destination = `${origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
          <Eyebrow>Lyfos Circle of Trust</Eyebrow>
          <H1 style={{ marginTop: 12 }}>Continue securely on Lyfos web.</H1>
          <Body style={{ marginTop: 14, color: colors.text2 }}>
            Recovery review and vault release use the verified web ceremony so every nominee sees the same evidence, hold, instructions, and read-only vault controls.
          </Body>
          <Card tone="amber" style={{ marginTop: 18 }}>
            <Footnote style={{ color: colors.amberInk }}>
              You will use your own Lyfos account. You will never sign in as the vault owner, and no plain recovery key is sent by email.
            </Footnote>
          </Card>
          <PrimaryButton onPress={() => Linking.openURL(destination)} label="Continue securely" style={{ marginTop: 22 }} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
