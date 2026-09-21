from pathlib import Path

import pytest

from custom_components.floorplan_studio.const import DOMAIN

WWW = Path("custom_components/floorplan_studio/www")


async def test_the_sidebar_entry_is_admin_only_and_points_at_the_panel_module(hass, entry):
    panel = hass.data["frontend_panels"]["floorplan-studio"]
    assert panel.require_admin is True
    assert panel.sidebar_title == "Floorplan Studio"
    assert panel.sidebar_icon == "mdi:floor-plan"
    cfg = panel.config["_panel_custom"]
    assert cfg["name"] == "floorplan-studio-panel"
    assert cfg["module_url"].startswith("/floorplan_studio_static/floorplan-studio-panel.js")


async def test_unloading_removes_the_sidebar_entry_and_a_reload_brings_it_back(hass, entry):
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "floorplan-studio" not in hass.data["frontend_panels"]
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert "floorplan-studio" in hass.data["frontend_panels"]


@pytest.mark.skipif(not (WWW / "floorplan-studio-panel.js").exists(), reason="run `npm run build` first: www/ is built, not committed")
async def test_the_built_panel_file_is_served_from_the_static_path(hass, entry, hass_client):
    client = await hass_client()
    r = await client.get("/floorplan_studio_static/floorplan-studio-panel.js")
    assert r.status == 200
    assert "floorplan-studio-panel" in await r.text()


async def test_the_card_script_is_added_to_every_dashboard_with_no_manual_resource(hass, entry):

    urls = hass.data["frontend_extra_module_url"].urls
    assert any(u.startswith("/floorplan_studio_static/floorplan-studio-card.js") for u in urls)


async def test_unloading_takes_the_card_script_away_again(hass, entry):
    assert any(u.startswith("/floorplan_studio_static/") for u in hass.data["frontend_extra_module_url"].urls)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    urls = hass.data["frontend_extra_module_url"].urls
    assert not any(u.startswith("/floorplan_studio_static/") for u in urls)


async def _set_sidebar(hass, entry, show):
    r = await hass.config_entries.options.async_init(entry.entry_id)
    assert r["type"] == "form"
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"show_in_sidebar": show})
    assert r["type"] == "create_entry"
    await hass.async_block_till_done()


async def test_the_sidebar_entry_is_on_by_default(hass, entry):
    assert entry.options.get("show_in_sidebar", True) is True
    assert "floorplan-studio" in hass.data["frontend_panels"]


async def test_the_options_form_offers_the_switch_defaulting_to_on(hass, entry):
    r = await hass.config_entries.options.async_init(entry.entry_id)
    key = next(k for k in r["data_schema"].schema if str(k) == "show_in_sidebar")
    assert key.default() is True


async def test_switching_it_off_hides_the_sidebar_entry_but_keeps_the_editor_and_the_card_working(hass, entry, hass_ws_client):
    await _set_sidebar(hass, entry, False)
    assert "floorplan-studio" not in hass.data["frontend_panels"]
    assert any(u.startswith("/floorplan_studio_static/floorplan-studio-card.js") for u in hass.data["frontend_extra_module_url"].urls)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "floorplan_studio/load"})
    assert (await ws.receive_json())["success"] is True


async def test_switching_it_back_on_brings_the_entry_back(hass, entry):
    await _set_sidebar(hass, entry, False)
    await _set_sidebar(hass, entry, True)
    assert "floorplan-studio" in hass.data["frontend_panels"]


async def test_unloading_while_hidden_does_not_fail(hass, entry):
    await _set_sidebar(hass, entry, False)
    assert await hass.config_entries.async_unload(entry.entry_id)


BRAND = Path("custom_components/floorplan_studio/brand")


def _png_size(path: Path) -> tuple[int, int]:
    import struct  # noqa: PLC0415

    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} is not a PNG"
    return struct.unpack(">II", data[16:24])


@pytest.mark.parametrize(
    "name,size",
    [("icon.png", (256, 256)), ("icon@2x.png", (512, 512)), ("logo.png", (640, 256)), ("logo@2x.png", (1280, 512)), ("dark_logo.png", (640, 256)), ("dark_logo@2x.png", (1280, 512))],
)
def test_the_brand_images_ship_inside_the_integration_at_the_sizes_home_assistant_expects(name, size):
    assert _png_size(BRAND / name) == size
