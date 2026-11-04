"""Background thread that processes queued submissions one at a time.

Polling SQLite every few seconds is simpler than a real queue (Redis,
Celery) and fast enough for a class of 50. A failure on one submission sets
it to error and the loop moves on to the next.
"""

import threading
import time
import traceback

from backend import db
from backend.pipeline import process_submission

POLL_SECONDS = 2


def process_next():
    """Process the oldest queued submission.

    Returns False if the queue was empty. Any exception marks that
    submission as an error, with the message stored for the review screen.
    """
    claimed = db.claim_next_queued()
    if not claimed:
        return False
    submission_id = claimed["id"]
    try:
        process_submission(submission_id)
    except Exception as e:
        traceback.print_exc()
        db.update_submission(submission_id, status="error",
                             error_message=f"{type(e).__name__}: {e}")
    return True


def run_forever():
    """Requeue interrupted work, then process the queue until shutdown."""
    db.requeue_stuck()
    while True:
        if not process_next():
            time.sleep(POLL_SECONDS)


def start():
    """Start the worker in a daemon thread and return the thread."""
    thread = threading.Thread(target=run_forever, name="grader-worker",
                              daemon=True)
    thread.start()
    return thread
