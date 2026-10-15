import { Redirect } from "expo-router";

import { ChatPreviewScreen } from "@/components/chat/ChatPreviewScreen";

export default function PreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return <ChatPreviewScreen />;
}
