"""The sidebar entry (the editor as a custom panel) and the card script, both served from this folder's www/."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN, PANEL_URL_PATH, STATIC_URL

_STATIC_DONE = f"{DOMAIN}_static_registered"
_CARD_URL = f"{DOMAIN}_card_url"


def _card_url(version: str) -> str:
    return f"{STATIC_URL}/floorplan-studio-card.js?v={version}"


async def async_register(hass: HomeAssistant) -> None:
    if not hass.data.get(_STATIC_DONE):  # a static path cannot be removed, so once per run
        www = Path(__file__).parent / "www"
        await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(www), cache_headers=False)])
        hass.data[_STATIC_DONE] = True
    version = (await async_get_integration(hass, DOMAIN)).version
    frontend.add_extra_js_url(hass, _card_url(version))
    hass.data[_CARD_URL] = _card_url(version)
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="floorplan-studio-panel",
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{STATIC_URL}/floorplan-studio-panel.js?v={version}",
        sidebar_title="Floorplan Studio",
        sidebar_icon="mdi:floor-plan",
        require_admin=True,
    )


def async_unregister(hass: HomeAssistant) -> None:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    if url := hass.data.pop(_CARD_URL, None):
        frontend.remove_extra_js_url(hass, url)
