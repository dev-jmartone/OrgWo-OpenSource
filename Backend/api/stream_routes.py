import queue
import time
from flask import Blueprint, Response
from Backend.utils import event_listeners, event_listeners_lock

stream_bp = Blueprint("stream", __name__)

@stream_bp.route("/api/stream")
def sse_stream():
    def event_generator():
        q = queue.Queue()
        with event_listeners_lock:
            event_listeners.append(q)
        try:
            # Initial connection acknowledge
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    event = q.get(timeout=2.0)
                    yield f"event: {event}\ndata: {{}}\n\n"
                except queue.Empty:
                    # Keepalive comment
                    yield ": ping\n\n"
        except GeneratorExit:
            pass
        finally:
            with event_listeners_lock:
                if q in event_listeners:
                    event_listeners.remove(q)

    return Response(
        event_generator(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )
