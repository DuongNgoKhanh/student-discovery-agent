"""One explicit UTC provider shared by verifier and DB-clock test adapters."""

from datetime import datetime, timedelta


class FakeClock:
    def __init__(self, value: datetime):
        self.set(value)

    def set(self, value: datetime) -> None:
        if value.utcoffset() != timedelta(0):
            raise ValueError("test clock requires an aware UTC datetime")
        self._value = value

    def now(self, session=None) -> datetime:
        return self._value
