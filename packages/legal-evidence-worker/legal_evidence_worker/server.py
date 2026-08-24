from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pydantic import ValidationError

from .contract import IngestRequest
from .ingest import CancelledError, IngestError, ingest


class Server:
    def __init__(self) -> None:
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="evidence-ingest")
        self.jobs: dict[str, threading.Event] = {}
        self.write_lock = threading.Lock()

    def run(self) -> None:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
                self.receive(message)
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                self.send({"event": "protocol_error", "error": str(error)})
        self.executor.shutdown(wait=True, cancel_futures=False)

    def receive(self, message: Any) -> None:
        if not isinstance(message, dict):
            raise TypeError("Protocol message must be an object")
        command = message.get("command")
        if command == "ingest":
            request = IngestRequest.model_validate(message.get("request"))
            if request.job_id in self.jobs:
                raise ValueError(f"Duplicate active job: {request.job_id}")
            cancel = threading.Event()
            self.jobs[request.job_id] = cancel
            self.send({"event": "accepted", "job_id": request.job_id})
            self.executor.submit(self.execute, request, cancel)
            return
        if command == "cancel":
            job_id = str(message.get("job_id", ""))
            cancel = self.jobs.get(job_id)
            if cancel is None:
                raise ValueError(f"Unknown active job: {job_id}")
            cancel.set()
            self.send({"event": "cancel_requested", "job_id": job_id})
            return
        raise ValueError(f"Unsupported command: {command}")

    def execute(self, request: IngestRequest, cancel: threading.Event) -> None:
        try:
            result = ingest(
                request,
                cancel=cancel,
                progress=lambda stage, percent: self.send(
                    {
                        "event": "progress",
                        "job_id": request.job_id,
                        "stage": stage,
                        "percent": percent,
                    }
                ),
            )
            self.send(
                {
                    "event": "completed",
                    "job_id": request.job_id,
                    "result": result.model_dump(mode="json"),
                }
            )
        except CancelledError as error:
            self.send({"event": "cancelled", "job_id": request.job_id, "error": str(error)})
        except (IngestError, ValidationError, OSError) as error:
            self.send({"event": "failed", "job_id": request.job_id, "error": str(error)})
        except Exception as error:
            self.send(
                {
                    "event": "failed",
                    "job_id": request.job_id,
                    "error": f"Unexpected worker failure: {type(error).__name__}",
                }
            )
        finally:
            self.jobs.pop(request.job_id, None)

    def send(self, message: dict[str, object]) -> None:
        with self.write_lock:
            sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
            sys.stdout.flush()


def main() -> None:
    Server().run()


if __name__ == "__main__":
    main()
