import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

function runHaptic(effect: () => Promise<void>) {
  if (Platform.OS === "web") {
    return;
  }

  void effect().catch(() => undefined);
}

export function hapticSelection() {
  runHaptic(() => Haptics.selectionAsync());
}

export function hapticLightImpact() {
  runHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function hapticMediumImpact() {
  runHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function hapticSuccess() {
  runHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning() {
  runHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
