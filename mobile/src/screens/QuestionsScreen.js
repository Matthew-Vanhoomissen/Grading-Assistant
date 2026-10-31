import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { getAssignment } from '../api';
import { Button, Message, Screen, formatPoints, styles } from '../ui';

export function questionTitle(question) {
  return question.title || `Question ${question.position}`;
}

export default function QuestionsScreen({ settings, assignment, onPick, onBack }) {
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getAssignment(settings, assignment.id);
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
