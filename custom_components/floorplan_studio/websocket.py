"""floorplan_studio/load, floorplan_studio/version and floorplan_studio/subscribe (any user), floorplan_studio/save (admin only).

load replies `{layout, rev}`; save replies `{ok, rev}`. A save may carry `expected_rev`; when it is not the stored
revision the reply is the error `conflict` and nothing is written. Without it the save overwrites, as before.
subscribe answers with a bare result, then sends an event `{rev}` after each save. HA lets a non-admin subscribe only to a
whitelist of bus events, so this is how a wall tablet signed in as a normal user follows a save."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .storage import InvalidLayout, LayoutStore, RevConflict


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_load)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_version)


def _store(hass: HomeAssistant) -> LayoutStore | None:
    return hass.data.get(DOMAIN)


def _trace_for_card(floor: Any) -> bool:
    """True when this floor's trace image is turned on for dashboard cards too (S49)."""
    trace = floor.get("trace") if isinstance(floor, dict) else None
    return isinstance(trace, dict) and trace.get("on") is True and trace.get("card") is True


def _without_trace(layout: Any) -> Any:
    """A copy with editor-only trace images left out; floors with trace.on and trace.card true keep theirs. Stored data is untouched."""
    floors = layout.get("floors") if isinstance(layout, dict) else None
    if not isinstance(floors, dict):
        return layout
    return {**layout, "floors": {k: (f if _trace_for_card(f) or not isinstance(f, dict) else {n: v for n, v in f.items() if n != "trace"}) for k, f in floors.items()}}


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/load", vol.Optional("with_trace", default=False): bool})
@websocket_api.async_response
async def ws_load(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    layout, rev = await store.async_load_with_rev()
    # Editor-only traces stay out of card/non-admin loads unless opted onto the card (on and card both true); Studio (admin + with_trace) sees all.
    if not (msg["with_trace"] and connection.user.is_admin):
        layout = _without_trace(layout)
    connection.send_result(msg["id"], {"layout": layout, "rev": rev})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/save", vol.Required("layout"): dict, vol.Optional("expected_rev"): vol.All(int, vol.Range(min=0))})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    try:
        rev = await store.async_save(msg["layout"], msg.get("expected_rev"))
    except InvalidLayout as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    except RevConflict as err:
        connection.send_error(msg["id"], "conflict", f"The plan was saved elsewhere (revision {err.current}, you have {msg['expected_rev']}). Reload it, or overwrite it with yours.")
        return
    hass.bus.async_fire("floorplan_studio_updated", {"rev": rev})  # open cards reload
    connection.send_result(msg["id"], {"ok": True, "rev": rev})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The installed version, so an open page that is older than it can ask for a reload."""
    connection.send_result(msg["id"], {"version": str((await async_get_integration(hass, DOMAIN)).version)})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Pushes `{rev}` to this connection after every save. Open to any user: the bus event itself is admin-only to subscribe to."""
    msg_id = msg["id"]

    @callback
    def forward(event: Any) -> None:
        connection.send_message(websocket_api.event_message(msg_id, {"rev": event.data.get("rev")}))

    connection.subscriptions[msg_id] = hass.bus.async_listen("floorplan_studio_updated", forward)
    connection.send_result(msg_id)
