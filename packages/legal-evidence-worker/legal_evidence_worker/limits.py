from __future__ import annotations

from typing import Protocol

MAX_ADDRESS_SPACE_BYTES = 8 * 1024 * 1024 * 1024
MAX_PROCESS_COUNT = 256


class ResourceModule(Protocol):
    RLIMIT_CORE: int
    RLIMIT_CPU: int
    RLIMIT_FSIZE: int
    RLIMIT_NOFILE: int

    def getrlimit(self, resource: int) -> tuple[int, int]: ...

    def setrlimit(self, resource: int, limits: tuple[int, int]) -> None: ...


def apply_process_limits(resource_module: ResourceModule | None = None) -> None:
    """Apply portable OS limits before any document parser is imported."""

    if resource_module is None:
        try:
            import resource as resource_module
        except ImportError:
            return
    policies: list[tuple[int, int, int, bool]] = [
        (resource_module.RLIMIT_CORE, 0, 0, True),
        (resource_module.RLIMIT_CPU, 300, 330, True),
        (
            resource_module.RLIMIT_FSIZE,
            2 * 1024 * 1024 * 1024,
            2 * 1024 * 1024 * 1024,
            True,
        ),
        (resource_module.RLIMIT_NOFILE, 512, 512, True),
    ]
    optional_policies = (
        ("RLIMIT_AS", MAX_ADDRESS_SPACE_BYTES, MAX_ADDRESS_SPACE_BYTES),
        ("RLIMIT_NPROC", MAX_PROCESS_COUNT, MAX_PROCESS_COUNT),
    )
    for name, requested_soft, requested_hard in optional_policies:
        resource_id = getattr(resource_module, name, None)
        if isinstance(resource_id, int):
            policies.append((resource_id, requested_soft, requested_hard, False))

    for resource_id, requested_soft, requested_hard, required in policies:
        current_soft, current_hard = resource_module.getrlimit(resource_id)
        hard = requested_hard if current_hard < 0 else min(requested_hard, current_hard)
        soft = min(requested_soft, hard)
        if current_soft >= 0:
            soft = min(soft, current_soft) if current_soft < requested_soft else soft
        try:
            resource_module.setrlimit(resource_id, (soft, hard))
        except (OSError, ValueError):
            if required:
                raise
