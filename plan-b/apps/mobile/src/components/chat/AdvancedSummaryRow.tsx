import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Fonts, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hapticSelection } from "@/lib/haptics";

export function AdvancedSummaryRow({
  expanded,
  label,
  onPress,
  value,
}: {
  expanded: boolean;
  label: string;
  onPress: () => void;
  value: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${label} ${value}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        expanded ? { backgroundColor: theme.backgroundSelected } : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.trailing}>
        <Text numberOfLines={1} style={[styles.value, { color: theme.textSecondaryStrong }]}>
          {value}
        </Text>
        <Icon
          name={expanded ? "expand" : "chevronRight"}
          size={16}
          tintColor={theme.textSecondary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: Spacing.three,
  },
  label: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: Spacing.two,
    justifyContent: "flex-end",
    marginLeft: Spacing.three,
  },
  value: {
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "right",
  },
  pressed: {
    opacity: 0.72,
  },
});
