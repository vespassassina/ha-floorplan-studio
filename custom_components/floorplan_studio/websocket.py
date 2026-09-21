"""floorplan_studio/load (any user) and floorplan_studio/save (admin only)."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .storage import InvalidLayout, LayoutStore


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_load)
    websocket_api.async_register_command(hass, ws_save)


def _store(hass: HomeAssistant) -> LayoutStore | None:
    return hass.data.get(DOMAIN)


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/load"})
@websocket_api.async_response
async def ws_load(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    connection.send_result(msg["id"], {"layout": await store.async_load()})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/save", vol.Required("layout"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    try:
        await store.async_save(msg["layout"])
    except InvalidLayout as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"ok": True})
