import { useSelector } from "@legendapp/state/react";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  activateConnection,
  getActiveConnectionId,
  getConnectionProfiles,
  saveConnectionProfile,
  type ConnectionProfile,
} from "@/lib/connection-profiles";
import { clearServerState } from "@/lib/server-state";
import {
  chatStore$,
  resetChatSessionState,
  setConnection,
  setHasPairedSession,
  setServerUrl,
} from "@/state/chat-store";

export function ConnectionSettings() {
  const queryClient = useQueryClient();
  const serverUrl = useSelector(() => chatStore$.serverUrl.get());
  const [profiles, setProfiles] = useState(getConnectionProfiles);
  const [editingId, setEditingId] = useState(getActiveConnectionId);
  const current = profiles.find((profile) => profile.id === editingId);
  const [name, setName] = useState(current?.name ?? "");
  const [address, setAddress] = useState(current?.serverUrl ?? serverUrl);

  useEffect(() => {
    setProfiles(getConnectionProfiles());
  }, [serverUrl]);

  function switchTo(profile: ConnectionProfile) {
    // Leaving Settings remounts the chat and releases the previous live stream.
    void queryClient.cancelQueries();
    const activated = activateConnection(profile.id);
    clearServerState(queryClient);
    resetChatSessionState();
    setHasPairedSession(Boolean(activated.clientToken));
    setServerUrl(activated.serverUrl);
    setConnection(activated.clientToken ? "checking" : "offline");
    router.replace("/");
  }

  function saveAndSwitch() {
    try {
      switchTo(saveConnectionProfile({ id: editingId, name, serverUrl: address }));
    } catch (error) {
      Alert.alert("连接配置", error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <ThemedText type="smallBold">后台连接 / Runtime</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setEditingId(undefined);
            setName("");
            setAddress("");
          }}
          style={styles.button}
        >
          <ThemedText type="small">＋ 新增</ThemedText>
        </Pressable>
      </View>
      {profiles.map((profile) => (
        <Pressable
          key={profile.id}
          accessibilityRole="button"
          onPress={() => {
            if (profile.id !== getActiveConnectionId()) {
              switchTo(profile);
              return;
            }
            setEditingId(profile.id);
            setName(profile.name);
            setAddress(profile.serverUrl);
          }}
          style={styles.row}
        >
          <View style={styles.copy}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {profile.name}
            </ThemedText>
            <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
              {profile.serverUrl}
            </ThemedText>
          </View>
          <ThemedText type="small">
            {profile.id === getActiveConnectionId() ? "当前 · 编辑" : "切换"}
          </ThemedText>
        </Pressable>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        {editingId ? "编辑当前连接地址（可改为公网域名或 IP:端口）" : "新增后台连接"}
      </ThemedText>
      <TextInput
        accessibilityLabel="连接名称"
        placeholder="连接名称，例如家里电脑、独立 runtime"
        placeholderTextColor="#8e9694"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="服务器 URL"
        placeholder="https://example.com 或 http://IP:端口"
        placeholderTextColor="#8e9694"
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
      />
      <ThemedText type="small" themeColor="textSecondary">
        每个后台分别保存配对。新后台首次连接需在会话首页扫描二维码或粘贴配对链接；已有连接改地址无需重新配对。
      </ThemedText>
      <Pressable accessibilityRole="button" onPress={saveAndSwitch} style={styles.saveButton}>
        <ThemedText type="smallBold">保存并切换</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#242827", borderRadius: 16, padding: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  button: { padding: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  copy: { flex: 1, gap: 4 },
  input: {
    color: "#eef3f1",
    backgroundColor: "#191c1b",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
  },
  saveButton: { alignItems: "center", backgroundColor: "#315a46", borderRadius: 10, padding: 12 },
});
