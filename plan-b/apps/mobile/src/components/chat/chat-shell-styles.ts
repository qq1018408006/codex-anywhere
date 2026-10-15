import { StyleSheet } from "react-native-unistyles";

import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";

export const chatShellStyles = StyleSheet.create({
  chatBody: {
    flex: 1,
    minHeight: 0,
  },
  composerDock: {
    elevation: 8,
    flexShrink: 0,
    position: "relative",
    zIndex: 8,
  },
  container: {
    backgroundColor: Colors.dark.background,
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  shell: {
    backgroundColor: Colors.dark.background,
    flex: 1,
    gap: 0,
    paddingTop: Spacing.one,
  },
  timeline: {
    flex: 1,
    minHeight: 0,
  },
});
