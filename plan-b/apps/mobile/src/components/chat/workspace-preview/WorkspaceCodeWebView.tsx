import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { Spacing } from "@/constants/theme";

import {
  createWorkspaceCodeEditorId,
  postWorkspaceCodeEditorState,
  registerWorkspaceCodeEditorBridgeHandlers,
  WorkspaceCodeEditorBridgeWebView,
  type WorkspaceCodeEditorMode,
  type WorkspaceCodeEditorState,
} from "./workspace-code-editor-bridge";
import workspaceCodeEditorHtml from "./workspace-code-editor-html";

export function WorkspaceCodeWebView({
  fill,
  language,
  lineNumbers,
  mode,
  value,
  onChangeText,
}: {
  fill?: boolean;
  language: string;
  lineNumbers?: boolean;
  mode: WorkspaceCodeEditorMode;
  value: string;
  onChangeText?: (value: string) => void;
}) {
  const onChangeTextRef = useRef(onChangeText);
  const editorIdRef = useRef<string | null>(null);
  const postEditorStateRef = useRef(() => {});
  const postEditorStateTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  if (!editorIdRef.current) {
    editorIdRef.current = createWorkspaceCodeEditorId();
  }
  const editorId = editorIdRef.current;
  const stateRef = useRef<WorkspaceCodeEditorState>({
    editorId,
    language: normalizeMonacoLanguage(language),
    lineNumbers: Boolean(lineNumbers),
    mode,
    value,
  });
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const postEditorState = useCallback(() => {
    postWorkspaceCodeEditorState(stateRef.current);
  }, []);
  const postEditorStateWithRetries = useCallback(() => {
    postEditorState();
    for (const delay of [80, 240]) {
      const timer = setTimeout(postEditorState, delay);
      postEditorStateTimersRef.current.push(timer);
    }
  }, [postEditorState]);

  useEffect(() => {
    postEditorStateRef.current = postEditorStateWithRetries;
  }, [postEditorStateWithRetries]);

  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  useEffect(() => {
    return registerWorkspaceCodeEditorBridgeHandlers(editorId, {
      reportChange(nextValue) {
        stateRef.current = {
          ...stateRef.current,
          value: nextValue,
        };
        onChangeTextRef.current?.(nextValue);
      },
      reportError(message) {
        setIsEditorReady(true);
        setEditorError(message);
      },
      reportReady() {
        setIsEditorReady(true);
        setEditorError(null);
        postEditorStateRef.current();
      },
    });
  }, [editorId]);

  useEffect(() => {
    return () => {
      for (const timer of postEditorStateTimersRef.current) {
        clearTimeout(timer);
      }
      postEditorStateTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const nextState: WorkspaceCodeEditorState = {
      editorId,
      language: normalizeMonacoLanguage(language),
      lineNumbers: Boolean(lineNumbers),
      mode,
      value,
    };
    stateRef.current = nextState;
    postEditorState();
  }, [editorId, language, lineNumbers, mode, postEditorState, value]);

  return (
    <View
      style={[
        styles.editorInputFrame,
        fill ? styles.editorInputFrameFill : styles.editorInputFrameFixed,
      ]}
    >
      <WorkspaceCodeEditorBridgeWebView
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        injectedJavaScriptBeforeContentLoaded={workspaceCodeEditorIdScript(editorId)}
        javaScriptEnabled
        nestedScrollEnabled
        onLoadStart={() => {
          setEditorError(null);
          setIsEditorReady(false);
        }}
        onLoadEnd={postEditorStateWithRetries}
        originWhitelist={["*"]}
        scrollEnabled={false}
        source={{ html: workspaceCodeEditorHtml }}
        style={styles.editorWebView}
      />
      {!isEditorReady && !editorError ? (
        <View style={styles.editorWebLoading}>
          <ActivityIndicator color="#8EA2BD" size="small" />
          <ThemedText type="small" style={styles.editorWebLoadingText}>
            Loading editor
          </ThemedText>
        </View>
      ) : null}
      {editorError ? (
        <View style={styles.editorWebError}>
          <Icon name="warning" size={15} tintColor="#F87171" />
          <ThemedText type="small" style={styles.editorWebErrorText}>
            {editorError}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function workspaceCodeEditorIdScript(editorId: string) {
  return `window.__workspaceCodeEditorId = ${JSON.stringify(editorId)}; true;`;
}

function normalizeMonacoLanguage(language: string) {
  const normalized = language.toLowerCase();
  const aliases: Record<string, string> = {
    cjs: "javascript",
    htm: "html",
    js: "javascript",
    kt: "kotlin",
    md: "markdown",
    mdx: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shellscript",
    text: "plaintext",
    ts: "typescript",
    yml: "yaml",
  };
  return aliases[normalized] ?? normalized;
}

const styles = StyleSheet.create({
  editorInputFrame: {
    backgroundColor: "#252525",
    borderColor: "rgba(132, 145, 165, 0.18)",
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  editorInputFrameFixed: {
    height: 360,
  },
  editorInputFrameFill: {
    flex: 1,
    minHeight: 0,
  },
  editorWebView: {
    backgroundColor: "#252525",
    flex: 1,
  },
  editorWebLoading: {
    alignItems: "center",
    backgroundColor: "#252525",
    bottom: 0,
    gap: Spacing.two,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  editorWebLoadingText: {
    color: "#8EA2BD",
  },
  editorWebError: {
    alignItems: "center",
    backgroundColor: "rgba(37, 37, 37, 0.94)",
    bottom: 0,
    flexDirection: "row",
    gap: Spacing.one,
    left: 0,
    padding: Spacing.two,
    position: "absolute",
    right: 0,
    top: 0,
  },
  editorWebErrorText: {
    color: "#F87171",
    flex: 1,
  },
});
