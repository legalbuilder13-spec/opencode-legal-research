from __future__ import annotations

from typing import Protocol


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
    policies = (
        (resource_module.RLIMIT_CORE, 0, 0),
        (resource_module.RLIMIT_CPU, 300, 330),
        (resource_module.RLIMIT_FSIZE, 2 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
        (resource_module.RLIMIT_NOFILE, 512, 512),
    )
    for resource_id, requested_soft, requested_hard in policies:
        current_soft, current_hard = resource_module.getrlimit(resource_id)
        hard = requested_hard if current_hard < 0 else min(requested_hard, current_hard)
        soft = min(requested_soft, hard)
        if current_soft >= 0:
            soft = min(soft, current_soft) if current_soft < requested_soft else soft
        resource_module.setrlimit(resource_id, (soft, hard))
