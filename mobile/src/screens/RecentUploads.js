/**
 * Recent uploads list for one question: each submission's label and status,
 * newest first. Polls while anything is queued or processing, so the user
 * can watch photos move through the server's pipeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { listSubmissions } from '../api';
import { POLL_MS } from '../config';
import { StatusBadge, styles } from '../ui';

/** Maximum number of rows rendered; the list lives inside a ScrollView. */
const SHOWN = 30;

/**
 * @param {object} props
 * @param {import('../api').Settings} props.settings
 * @param {number} props.questionId
 * @param {number} props.refreshKey Change it to reload immediately, e.g.
 *   right after an upload.
 */
export default function RecentUploads({ settings, questionId, refreshKey }) {
  const [items, setItems] = useState(null); // null until the first load succeeds
  const [error, setError] = useState(null);
  const inFlight = useRef(false); // stops polls from overlapping on a slow network

  /** Fetches the list. On failure the last good list stays visible. */
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const rows = await listSubmissions(settings, questionId);
      setItems([...rows].sort((a, b) => b.id - a.id));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
    }
  }, [settings, questionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const active = !!items && items.some((s) => s.status === 'queued' || s.status === 'processing');
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={styles.label}>Recent uploads{active ? ' (updating…)' : ''}</Text>
        <Pressable onPress={load} hitSlop={12}>
          <Text style={{ color: '#1f5fbf', fontSize: 15 }}>Refresh</Text>
        </Pressable>
      </View>

      {error ? <Text style={{ color: '#b91c1c' }}>Couldn't refresh: {error}</Text> : null}

      {items === null ? (
        error ? null : <ActivityIndicator />
      ) : items.length === 0 ? (
        <Text style={styles.hint}>Nothing uploaded for this question yet.</Text>
      ) : (
        items.slice(0, SHOWN).map((s) => (
          <View key={s.id} style={styles.listItem}>
            <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
              <Text style={[styles.listTitle, styles.flex1]} numberOfLines={1}>
                {s.student_label}
              </Text>
              <StatusBadge status={s.status} />
            </View>
            {s.status === 'error' && s.error_message ? (
              <Text style={{ color: '#b91c1c', marginTop: 6 }}>{s.error_message}</Text>
            ) : null}
          </View>
        ))
      )}
      {items && items.length > SHOWN ? (
        <Text style={styles.hint}>Showing the newest {SHOWN} of {items.length}.</Text>
      ) : null}
    </View>
  );
}
