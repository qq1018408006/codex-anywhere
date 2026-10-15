import { useSelector } from "@legendapp/state/react";
import { useEffect, useRef } from "react";

import { getPushNotificationSettings, registerPushNotifications } from "@/lib/codex-relay-api";
import {
  defaultPushNotificationPreferences,
  getExpoPushToken,
  hasCompletedInitialPushNotificationRegistration,
  markInitialPushNotificationRegistrationCompleted,
  PushNotificationPermissionDeniedError,
  pushNotificationPlatform,
  supportsPushNotifications,
} from "@/lib/push-notifications";
import { chatStore$ } from "@/state/chat-store";

export function useInitialPushNotificationRegistration() {
  const hasPairedSession = useSelector(() => chatStore$.hasPairedSession.get());
  const registrationStartedRef = useRef(false);

  useEffect(() => {
    if (
      !hasPairedSession ||
      registrationStartedRef.current ||
      !supportsPushNotifications() ||
      hasCompletedInitialPushNotificationRegistration()
    ) {
      return;
    }

    registrationStartedRef.current = true;
    void registerInitialPushNotifications();
  }, [hasPairedSession]);
}

async function registerInitialPushNotifications() {
  try {
    const currentSettings = await getPushNotificationSettings();
    if (currentSettings.registered) {
      markInitialPushNotificationRegistrationCompleted();
      return;
    }

    await registerPushNotifications({
      expoPushToken: await getExpoPushToken(),
      platform: pushNotificationPlatform(),
      preferences: defaultPushNotificationPreferences,
    });
    markInitialPushNotificationRegistrationCompleted();
  } catch (error) {
    if (error instanceof PushNotificationPermissionDeniedError) {
      markInitialPushNotificationRegistrationCompleted();
    }
  }
}
