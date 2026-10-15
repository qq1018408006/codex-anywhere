// Modified for Codex Anywhere (2026); see the repository NOTICE.
import { ChatScreen } from "@/components/chat/ChatScreen";
import { useSelector } from "@legendapp/state/react";
import { chatStore$ } from "@/state/chat-store";
import { getCodexRelayServerUrl } from "@/lib/codex-relay-api";

export default function HomeScreen() {
  const serverUrl = useSelector(() => chatStore$.serverUrl.get());
  return <ChatScreen key={serverUrl || getCodexRelayServerUrl()} />;
}
