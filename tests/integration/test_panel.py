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
