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
    assert msg["result"] == {"layout": None}


async def test_save_then_load_returns_the_same_layout(hass, entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/save", "layout": DEMO})
    msg = await ws.receive_json()
    assert msg["success"] is True
    assert msg["result"] == {"ok": True}
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
    assert (await ws.receive_json())["result"] == {"layout": None}


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
