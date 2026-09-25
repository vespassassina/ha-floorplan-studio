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


CARD = "/floorplan_studio_static/floorplan-studio-card.js"


def _card_resources(hass):
    return [r for r in hass.data["lovelace"].resources.async_items() if r["url"].startswith(CARD)]


def _extra_urls(hass):
    return [u for u in hass.data["frontend_extra_module_url"].urls if u.startswith(CARD)]


async def _yaml_entry(hass):
    from homeassistant.setup import async_setup_component  # noqa: PLC0415
    from pytest_homeassistant_custom_component.common import MockConfigEntry  # noqa: PLC0415

    assert await async_setup_component(hass, "lovelace", {"lovelace": {"mode": "yaml"}})
    e = MockConfigEntry(domain=DOMAIN, title="Floorplan Studio")
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    return e


# S8.3: a dashboard resource loads after HA's core has installed its scoped-registry polyfill, so the card's
# define lands in the registry HA reads. add_extra_js_url runs in parallel with core and lost that race on about
# half of the maintainer's hard reloads ("Custom element doesn't exist").
async def test_the_card_is_a_dashboard_resource_in_storage_mode_not_an_extra_module(hass, entry):
    version = (await __import__("homeassistant.loader", fromlist=["x"]).async_get_integration(hass, DOMAIN)).version
    res = _card_resources(hass)
    assert [(r["type"], r["url"]) for r in res] == [("module", f"{CARD}?v={version}")]
    assert _extra_urls(hass) == []


async def test_a_reload_does_not_add_the_resource_twice(hass, entry):
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert len(_card_resources(hass)) == 1


async def test_an_upgrade_rewrites_the_version_on_the_existing_resource(hass, entry):
    res = hass.data["lovelace"].resources
    [item] = _card_resources(hass)
    await res.async_update_item(item["id"], {"res_type": "module", "url": f"{CARD}?v=0.0.1"})
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    [after] = _card_resources(hass)
    assert after["id"] == item["id"]
    assert after["url"] == item["url"]


async def test_a_resource_the_user_added_elsewhere_is_left_alone(hass, entry):
    res = hass.data["lovelace"].resources
    for r in _card_resources(hass):
        await res.async_delete_item(r["id"])
    await res.async_create_item({"res_type": "module", "url": "/local/other-card.js"})  # the only one, so first
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert any(r["url"] == "/local/other-card.js" for r in res.async_items())
    assert len(_card_resources(hass)) == 1


async def test_removing_the_integration_removes_the_resource(hass, entry):
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert _card_resources(hass) == []


async def test_in_yaml_mode_the_card_falls_back_to_an_extra_module(hass):
    await _yaml_entry(hass)
    assert len(_extra_urls(hass)) == 1


async def test_in_yaml_mode_unloading_takes_the_extra_module_away_again(hass):
    e = await _yaml_entry(hass)
    assert await hass.config_entries.async_unload(e.entry_id)
    await hass.async_block_till_done()
    assert _extra_urls(hass) == []


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
    assert len(_card_resources(hass)) == 1
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
