/**
 * Shared UI building blocks and styles: the screen frame, button, message
 * box, and status badge. Plain React Native components only, no UI kit.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Full-screen frame with a header bar, kept clear of the notch and home
 * indicator.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {() => void} [props.onBack] Shows a Back button when provided.
 * @param {React.ReactNode} props.children
 */
export function Screen({ title, onBack, children }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * Full-width button. While `loading`, it shows a spinner and ignores presses.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {() => void} props.onPress
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading]
 * @param {'primary' | 'secondary'} [props.variant] Secondary is outlined.
 * @param {object} [props.style] Extra style, e.g. styles.flex1 inside a row.
 */
export function Button({ title, onPress, disabled, loading, variant = 'primary', style }) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        inactive && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? '#1f5fbf' : '#fff'} />
      ) : (
        <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Colored message box. Renders nothing when there is no content.
 *
 * @param {object} props
 * @param {'error' | 'success' | 'info'} [props.kind]
 * @param {React.ReactNode} props.children
 */
export function Message({ kind = 'info', children }) {
  if (!children) return null;
  return (
    <View style={[styles.message, styles[`message_${kind}`]]}>
      <Text style={styles.messageText}>{children}</Text>
    </View>
  );
}

/** Badge color for each submission status from the server. */
const STATUS_COLORS = {
  queued: '#6b7280',
  processing: '#1f5fbf',
  ready: '#15803d',
  graded: '#065f46',
  error: '#b91c1c',
};

/**
 * Pill showing a submission status. Unknown statuses render in gray.
 *
 * @param {object} props
 * @param {string} props.status queued | processing | ready | graded | error
 */
export function StatusBadge({ status }) {
  return (
    <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] || '#6b7280' }]}>
      <Text style={styles.badgeText}>{status}</Text>
    </View>
  );
}

/**
 * Formats a point value without trailing zeros, rounded to two decimals:
 * 10.0 -> "10", 7.5 -> "7.5".
 *
 * @param {number | string} value
 * @returns {string} "?" when the value is not a finite number.
 */
export function formatPoints(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?';
}

/** Styles shared by every screen. */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f6f8' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dde1e6',
    backgroundColor: '#fff',
  },
  back: { marginRight: 12 },
  backText: { fontSize: 17, color: '#1f5fbf' },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: '#111' },
  body: { flex: 1 },
  content: { padding: 16, gap: 12 },

  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  input: {
    borderWidth: 1,
    borderColor: '#c4cad2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#111',
  },
  hint: { fontSize: 13, color: '#666' },

  button: {
    backgroundColor: '#1f5fbf',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1f5fbf' },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  buttonTextSecondary: { color: '#1f5fbf' },
  row: { flexDirection: 'row', gap: 12 },
  flex1: { flex: 1 },

  message: { borderRadius: 8, padding: 12, borderWidth: 1 },
  message_error: { backgroundColor: '#fdecec', borderColor: '#f3b4b4' },
  message_success: { backgroundColor: '#e8f6ec', borderColor: '#a7dbb5' },
  message_info: { backgroundColor: '#eef3fb', borderColor: '#bcd0ee' },
  messageText: { fontSize: 15, color: '#222' },

  listItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dde1e6',
  },
  listTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  listSub: { fontSize: 14, color: '#555', marginTop: 2 },
  empty: { fontSize: 15, color: '#555', textAlign: 'center', paddingVertical: 24 },
  center: { paddingVertical: 32, alignItems: 'center' },

  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
