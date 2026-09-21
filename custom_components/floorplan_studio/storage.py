"""One layout, kept in `.storage/floorplan_studio.layout`."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import LAYOUT_VERSION, STORAGE_KEY, STORAGE_VERSION


class InvalidLayout(ValueError):
    """The layout is not a version 2 object."""


class LayoutStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    async def async_load(self) -> dict[str, Any] | None:
        return await self._store.async_load()

    async def async_save(self, layout: Any) -> None:
        # The full schema check lives in the editor (src/core/schema.ts); here only the door.
        if not isinstance(layout, dict) or layout.get("version") != LAYOUT_VERSION:
            raise InvalidLayout(f"layout.version must be {LAYOUT_VERSION}")
        await self._store.async_save(layout)
