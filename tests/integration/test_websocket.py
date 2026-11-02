import json
from pathlib import Path

from homeassistant import config_entries, data_entry_flow

from custom_components.floorplan_studio.const import DOMAIN

DEMO = json.loads(Path("demo/layout.json").read_text())


async def test_load_before_any_save_returns_null_not_an_error(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/load"})
    msg = await ws.receive_json()
    assert msg["success"] is True
    assert msg["result"] == {"layout": None, "rev": 0}


async def test_version_names_the_installed_integration_for_any_user(hass, entry, hass_ws_client):
    manifest = json.loads(Path("custom_components/floorplan_studio/manifest.json").read_text())
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/version"})
    msg = await ws.receive_json()
    assert msg["success"] is True
    assert msg["result"] == {"version": manifest["version"]}


async def test_save_then_load_returns_the_same_layout(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": DEMO})
    msg = await ws.receive_json()
    assert msg["success"] is True
    assert msg["result"] == {"ok": True, "rev": 1}
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    msg = await ws.receive_json()
    assert msg["result"]["layout"] == DEMO


async def test_save_of_version_1_is_rejected_with_invalid_format_and_stores_nothing(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": {"version": 1}})
    msg = await ws.receive_json()
    assert msg["success"] is False
    assert msg["error"]["code"] == "invalid_format"
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    assert (await ws.receive_json())["result"] == {"layout": None, "rev": 0}


async def test_save_of_a_layout_that_is_not_an_object_is_rejected(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": ["version", 2]})
    msg = await ws.receive_json()
    assert msg["success"] is False
    assert msg["error"]["code"] == "invalid_format"


async def test_a_non_admin_can_load_but_not_save(hass, entry, hass_ws_client, hass_read_only_access_token):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": DEMO})
    msg = await ws.receive_json()
    assert msg["success"] is False
    assert msg["error"]["code"] == "unauthorized"
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    assert (await ws.receive_json())["success"] is True


async def test_a_saved_layout_survives_a_reload_of_the_entry(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": DEMO})
    await ws.receive_json()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    assert (await ws.receive_json())["result"]["layout"] == DEMO


async def test_config_flow_makes_one_entry_with_no_fields_and_refuses_a_second(hass):
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert r["type"] == data_entry_flow.FlowResultType.CREATE_ENTRY
    r2 = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert r2["type"] == data_entry_flow.FlowResultType.ABORT
    assert r2["reason"] == "single_instance_allowed"


async def _send(ws, i, **msg):
    await ws.send_json({"id": i, **msg})
    return await ws.receive_json()


async def test_each_save_bumps_rev_and_load_returns_it(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    assert (await _send(ws, 1, type="floorplan_studio/save", layout=DEMO))["result"]["rev"] == 1
    assert (await _send(ws, 2, type="floorplan_studio/save", layout=DEMO))["result"]["rev"] == 2
    assert (await _send(ws, 3, type="floorplan_studio/load"))["result"]["rev"] == 2


async def test_save_with_a_stale_expected_rev_is_refused_with_conflict_and_writes_nothing(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    other = {**DEMO, "title": "Written elsewhere"}
    await _send(ws, 1, type="floorplan_studio/save", layout=DEMO)  # rev 1
    await _send(ws, 2, type="floorplan_studio/save", layout=other, expected_rev=1)  # rev 2
    msg = await _send(ws, 3, type="floorplan_studio/save", layout={**DEMO, "title": "Stale"}, expected_rev=1)
    assert msg["success"] is False
    assert msg["error"]["code"] == "conflict"
    loaded = (await _send(ws, 4, type="floorplan_studio/load"))["result"]
    assert loaded["rev"] == 2
    assert loaded["layout"] == other


async def test_save_with_the_current_expected_rev_succeeds(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await _send(ws, 1, type="floorplan_studio/save", layout=DEMO)
    msg = await _send(ws, 2, type="floorplan_studio/save", layout=DEMO, expected_rev=1)
    assert msg["success"] is True
    assert msg["result"]["rev"] == 2


async def test_save_without_expected_rev_still_overwrites_for_old_clients(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await _send(ws, 1, type="floorplan_studio/save", layout=DEMO)
    msg = await _send(ws, 2, type="floorplan_studio/save", layout={**DEMO, "title": "Legacy"})
    assert msg["success"] is True
    assert msg["result"]["rev"] == 2


async def test_a_layout_stored_before_rev_existed_loads_as_rev_0_and_saves_as_rev_1(hass, entry, hass_ws_client, hass_storage):
    # Old format: the store held the layout itself, with no wrapper.
    hass_storage["floorplan_studio.layout"] = {"version": 1, "key": "floorplan_studio.layout", "data": DEMO}
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    loaded = (await _send(ws, 1, type="floorplan_studio/load"))["result"]
    assert loaded == {"layout": DEMO, "rev": 0}
    assert (await _send(ws, 2, type="floorplan_studio/save", layout=DEMO, expected_rev=0))["result"]["rev"] == 1


async def test_a_conflicting_save_by_a_non_admin_is_still_unauthorized(hass, entry, hass_ws_client, hass_read_only_access_token):
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    msg = await _send(ws, 1, type="floorplan_studio/save", layout=DEMO, expected_rev=99)
    assert msg["error"]["code"] == "unauthorized"


def _with_trace(layout):
    out = json.loads(json.dumps(layout))
    first = next(iter(out["floors"].values()))
    first["trace"] = {"src": "data:image/png;base64,AAAA", "x": 0, "y": 0, "w": 100, "rot": 0, "alpha": 0.5, "on": True}
    return out


def _traces(layout):
    return [k for k, f in layout["floors"].items() if "trace" in f]


async def _save_traced(ws):
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": _with_trace(DEMO)})
    assert (await ws.receive_json())["success"] is True


async def test_load_leaves_the_trace_images_out_unless_asked(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await _save_traced(ws)
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    assert _traces((await ws.receive_json())["result"]["layout"]) == []
    await ws.send_json({"id": 3, "type": "floorplan_studio/load", "with_trace": True})
    assert len(_traces((await ws.receive_json())["result"]["layout"])) == 1


async def test_stripping_the_trace_does_not_touch_the_stored_layout(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await _save_traced(ws)
    await ws.send_json({"id": 2, "type": "floorplan_studio/load"})
    await ws.receive_json()
    await ws.send_json({"id": 3, "type": "floorplan_studio/load", "with_trace": True})
    assert len(_traces((await ws.receive_json())["result"]["layout"])) == 1


async def test_a_non_admin_asking_for_the_trace_gets_none_and_no_error(hass, entry, hass_ws_client, hass_read_only_access_token):
    admin = await hass_ws_client(hass)
    await _save_traced(admin)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json({"id": 2, "type": "floorplan_studio/load", "with_trace": True})
    msg = await ws.receive_json()
    assert msg["success"] is True
    assert _traces(msg["result"]["layout"]) == []


async def test_a_save_fires_floorplan_studio_updated_and_a_refused_one_does_not(hass, entry, hass_ws_client):
    seen = []
    hass.bus.async_listen("floorplan_studio_updated", seen.append)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": {"version": 1}})
    await ws.receive_json()
    await hass.async_block_till_done()
    assert seen == []
    await ws.send_json({"id": 2, "type": "floorplan_studio/save", "layout": DEMO})
    await ws.receive_json()
    await hass.async_block_till_done()
    assert len(seen) == 1


async def test_a_non_admin_subscribes_and_follows_an_admin_save_until_it_unsubscribes(hass, entry, hass_ws_client, hass_read_only_access_token):
    """HA lets a non-admin subscribe to a whitelist of bus events only, so a wall tablet needs its own command."""
    tablet = await hass_ws_client(hass, hass_read_only_access_token)
    admin = await hass_ws_client(hass)
    await tablet.send_json({"id": 5, "type": "floorplan_studio/subscribe"})
    msg = await tablet.receive_json()
    assert msg["id"] == 5 and msg["success"] is True

    await admin.send_json({"id": 1, "type": "floorplan_studio/save", "layout": DEMO})
    assert (await admin.receive_json())["success"] is True
    event = await tablet.receive_json()
    assert event["id"] == 5 and event["type"] == "event"
    assert event["event"] == {"rev": 1}

    await tablet.send_json({"id": 6, "type": "unsubscribe_events", "subscription": 5})
    assert (await tablet.receive_json())["success"] is True
    await admin.send_json({"id": 2, "type": "floorplan_studio/save", "layout": DEMO})
    assert (await admin.receive_json())["result"]["rev"] == 2
    await hass.async_block_till_done()
    # The next thing the tablet hears is the answer to this ping, not an event for the second save.
    await tablet.send_json({"id": 7, "type": "ping"})
    assert (await tablet.receive_json())["type"] == "pong"


async def test_a_refused_save_sends_the_subscriber_nothing(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/subscribe"})
    assert (await ws.receive_json())["success"] is True
    await ws.send_json({"id": 2, "type": "floorplan_studio/save", "layout": {"version": 1}})
    assert (await ws.receive_json())["success"] is False
    await ws.send_json({"id": 3, "type": "ping"})
    assert (await ws.receive_json())["type"] == "pong"
