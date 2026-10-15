import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hapticLightImpact, hapticMediumImpact, hapticSelection } from "@/lib/haptics";

import {
  powerSelectionAccessibilityLabel,
  powerSelectionLabel,
  type PowerSelection,
} from "./model-picker-options";
import { powerHapticKind, type PowerHapticKind } from "./power-selector-geometry";
import { FastToggle } from "./FastToggle";
import { PowerTrack } from "./PowerTrack";

export function PowerSelector({
  fastAvailable,
  fastEnabled,
  onAdvancedPress,
  onFastChange,
  onSelect,
  selected,
  selections,
}: {
  fastAvailable: boolean;
  fastEnabled: boolean;
  onAdvancedPress: () => void;
  onFastChange: (enabled: boolean) => void;
  onSelect: (selection: PowerSelection) => void;
  selected: PowerSelection | undefined;
  selections: PowerSelection[];
}) {
  const theme = useTheme();
  const selectedIndex = Math.max(
    selections.findIndex((selection) => selection.id === selected?.id),
    0,
  );
  const [previewIndex, setPreviewIndex] = useState<number>();
  const displayedSelection = previewIndex === undefined ? selected : selections[previewIndex];
  const selectedLabel = displayedSelection ? powerSelectionLabel(displayedSelection) : "Custom";
  const accessibilityValueLabel = displayedSelection
    ? powerSelectionAccessibilityLabel(displayedSelection)
    : "Custom";
  const lastSelectionIdRef = useRef(selected?.id);

  useEffect(() => {
    lastSelectionIdRef.current = selected?.id;
    setPreviewIndex(undefined);
  }, [selected?.id]);

  const commitIndex = useCallback(
    (index: number) => {
      setPreviewIndex(undefined);
      const selection = selections[index];
      if (!selection || selection.id === lastSelectionIdRef.current) {
        return;
      }
      lastSelectionIdRef.current = selection.id;
      onSelect(selection);
    },
    [onSelect, selections],
  );
  const crossIndex = useCallback(
    (index: number) => {
      setPreviewIndex(index);
      runPowerHaptic(powerHapticKind(index, selections.length));
    },
    [selections.length],
  );

  return (
    <View style={styles.stack}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.backgroundSelected,
          },
        ]}
      >
        <View style={styles.headingRow}>
          <Pressable
            accessibilityHint="Shows model, reasoning, and speed controls"
            accessibilityLabel="Advanced"
            accessibilityRole="button"
            onPress={() => {
              hapticSelection();
              onAdvancedPress();
            }}
            style={({ pressed }) => [styles.advancedButton, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.advancedLabel, { color: theme.textSecondaryStrong }]}>
              Advanced
            </Text>
            <Icon name="chevronRight" size={14} strokeWidth={1.8} tintColor={theme.textSecondary} />
          </Pressable>

          {fastAvailable ? <FastToggle enabled={fastEnabled} onChange={onFastChange} /> : null}
        </View>

        <PowerTrack
          accessibilityValueLabel={accessibilityValueLabel}
          onCommitIndex={commitIndex}
          onCrossIndex={crossIndex}
          selectedIndex={selectedIndex}
          selectionCount={selections.length}
        />
      </View>

      <Pressable
        accessibilityHint="Shows model, reasoning, and speed controls"
        accessibilityLabel={`${accessibilityValueLabel}, Advanced options`}
        accessibilityRole="button"
        onPress={() => {
          hapticSelection();
          onAdvancedPress();
        }}
        style={styles.selectionButton}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.selectionPill,
              { backgroundColor: theme.backgroundSelected },
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={styles.selectionPillSpacer} />
            <Text numberOfLines={1} style={[styles.selectionText, { color: theme.text }]}>
              {selectedLabel}
            </Text>
            <View style={styles.selectionPillTrailing}>
              <Icon name="expand" size={14} strokeWidth={1.8} tintColor={theme.textSecondary} />
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function runPowerHaptic(kind: PowerHapticKind) {
  switch (kind) {
    case "selection":
      hapticSelection();
      return;
    case "light":
      hapticLightImpact();
      return;
    case "medium":
      hapticMediumImpact();
  }
}

const styles = StyleSheet.create({
  stack: {
    width: "100%",
  },
  container: {
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    gap: Spacing.half,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 2,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
  },
  advancedButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    height: 44,
    justifyContent: "flex-start",
    minWidth: 88,
  },
  advancedLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  selectionButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: "100%",
  },
  selectionPill: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 15,
    flexDirection: "row",
    height: 30,
    paddingHorizontal: 10,
    width: "100%",
  },
  selectionPillSpacer: {
    width: 16,
  },
  selectionText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  selectionPillTrailing: {
    alignItems: "flex-end",
    width: 16,
  },
  pressed: {
    opacity: 0.66,
  },
});
