/**
 * Assignments screen: lists every assignment on the server with its question
 * count and total points. Supports pull-to-refresh. A rejected token adds a
 * shortcut back to the Connect screen, the only place it can be fixed.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { listAssignments } from '../api';
import { Button, Message, Screen, formatPoints, styles } from '../ui';

/**
 * @param {object} props
 * @param {import('../api').Settings} props.settings
 * @param {(assignment: object) => void} props.onPick
 * @param {() => void} props.onSettings Returns to the Connect screen.
 */
export default function AssignmentsScreen({ settings, onPick, onSettings }) {
  const [assignments, setAssignments] = useState(null); // null until the first load succeeds
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  /** Fetches the list. On failure the previous list stays visible. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await listAssignments(settings));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen title="Assignments" onBack={onSettings}>
      <FlatList
        contentContainerStyle={styles.content}
        data={assignments || []}
        keyExtractor={(a) => String(a.id)}
        refreshing={loading && assignments !== null}
        onRefresh={load}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {error ? <Message kind="error">{error.message}</Message> : null}
            {error && error.kind === 'auth' ? (
              <Button title="Connection settings" variant="secondary" onPress={onSettings} />
            ) : null}
            <Button title="Refresh" variant="secondary" onPress={load} loading={loading} />
          </View>
        }
        ListEmptyComponent={
          assignments === null ? (
            loading ? (
              <View style={styles.center}>
                <ActivityIndicator />
              </View>
            ) : null
          ) : (
            <Text style={styles.empty}>No assignments yet. Create one on the desktop.</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.listItem} onPress={() => onPick(item)}>
            <Text style={styles.listTitle}>{item.title}</Text>
            <Text style={styles.listSub}>
              {item.question_count} {item.question_count === 1 ? 'question' : 'questions'} ·{' '}
              {formatPoints(item.total_points)} pts
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
