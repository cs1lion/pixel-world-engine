"""世界事件日志。"""

from events.log import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    EventLog,
    EventValidationError,
    WorldEvent,
    append_many,
)
from events.world_changes import (
    WORLD_CHANGED,
    WORLD_CHANGE_CHECKS,
    WorldChangeError,
    validate_world_change,
)

__all__ = [
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
    "WORLD_CHANGED",
    "WORLD_CHANGE_CHECKS",
    "EventLog",
    "EventValidationError",
    "WorldChangeError",
    "WorldEvent",
    "append_many",
    "validate_world_change",
]
