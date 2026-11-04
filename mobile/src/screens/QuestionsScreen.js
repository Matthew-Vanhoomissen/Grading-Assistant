/**
 * Questions screen: lists an assignment's questions in position order. Each
 * question opens the per-question capture screen; the Rapid fire button
 * starts the one-student-at-a-time flow across all of them.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { getAssignment } from '../api';
import { Button, Message, Screen, formatPoints, styles } from '../ui';

/**
 * Display name for a question. An empty title becomes "Question N", where N
 * is its position, matching the desktop.
 *
 * @param {{ title: string, position: number }} question
 * @returns {string}
 */
export function questionTitle(question) {
  return question.title || `Question ${question.position}`;
}

/**
 * @param {object} props
 * @param {import('../api').Settings} props.settings
 * @param {{ id: number, title: string }} props.assignment
 * @param {(question: object) => void} props.onPick Opens single-question capture.
 * @param {(questions: object[]) => void} props.onRapidFire Starts rapid fire
 *   with the questions in display order.
 * @param {() => void} props.onBack
 */
export default function QuestionsScreen({ settings, assignment, onPick, onRapidFire, onBack }) {
  const [questions, setQuestions] = useState(null); // null until the first load succeeds
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  /** Fetches the assignment's questions. On failure the previous list stays visible. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getAssignment(settings, assignment.id);
      // The server already orders by position; sorting again guards the
      // order rapid fire walks through.
      setQuestions([...detail.questions].sort((a, b) => a.position - b.position));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [settings, assignment.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen title={assignment.title} onBack={onBack}>
      <FlatList
        contentContainerStyle={styles.content}
        data={questions || []}
        keyExtractor={(q) => String(q.id)}
        refreshing={loading && questions !== null}
        onRefresh={load}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {error ? <Message kind="error">{error.message}</Message> : null}
            {questions && questions.length ? (
              <>
                <Button title="Rapid fire (by student)" onPress={() => onRapidFire(questions)} />
                <Text style={styles.hint}>
                  Enter a student once and photograph every question in order. Or pick one question below
                  to photograph the whole class for it.
                </Text>
              </>
            ) : null}
            <Button title="Refresh" variant="secondary" onPress={load} loading={loading} />
          </View>
        }
        ListEmptyComponent={
          questions === null ? (
            loading ? (
              <View style={styles.center}>
                <ActivityIndicator />
              </View>
            ) : null
          ) : (
            <Text style={styles.empty}>No questions yet. Add them on the desktop.</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.listItem} onPress={() => onPick(item)}>
            <Text style={styles.listTitle}>{questionTitle(item)}</Text>
            <Text style={styles.listSub}>{formatPoints(item.max_points)} pts</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
