"""Floorplan Studio: load and save a floor plan layout, serve the editor panel."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import panel, websocket
from .const import DOMAIN
from .storage import LayoutStore


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if DOMAIN not in hass.data:
        websocket.async_register(hass)  # commands cannot be unregistered, so once per run
    hass.data[DOMAIN] = LayoutStore(hass)
    await panel.async_register(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    panel.async_unregister(hass)
    hass.data.pop(DOMAIN, None)
    return True
