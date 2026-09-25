"""The sidebar entry (the editor as a custom panel) and the card script, both served from this folder's www/."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.loader import async_get_integration

from .const import DOMAIN, PANEL_URL_PATH, STATIC_URL

_STATIC_DONE = f"{DOMAIN}_static_registered"
_CARD_URL = f"{DOMAIN}_card_url"
_PANEL_SHOWN = f"{DOMAIN}_panel_shown"
_LOGGER = logging.getLogger(__name__)


def _card_url(version: str) -> str:
    return f"{STATIC_URL}/floorplan-studio-card.js?v={version}"


def _storage_resources(hass: HomeAssistant):
    """The dashboard resource collection, or None when resources are YAML (read-only) or lovelace is absent."""
    ll = hass.data.get("lovelace")
    if getattr(ll, "resource_mode", None) != "storage":
        return None
    return getattr(ll, "resources", None)


def _ours(res) -> list[dict]:
    return [r for r in res.async_items() if r.get("url", "").startswith(f"{STATIC_URL}/floorplan-studio-card.js")]


async def _add_resource(hass: HomeAssistant, url: str) -> bool:
    """S8.3: load the card as a dashboard resource, like HACS does. A resource runs after HA's core has installed
    its scoped-registry polyfill; add_extra_js_url runs in parallel with core and lost that race on about half of
    hard reloads ("Custom element doesn't exist"). Returns False when resources are not ours to write."""
    res = _storage_resources(hass)
    if res is None:
        return False
    try:
        await res.async_get_info()  # loads the collection from storage on first use
        mine = _ours(res)
        if not mine:
            await res.async_create_item({"res_type": "module", "url": url})
        elif mine[0]["url"] != url:  # an upgrade: same entry, new ?v= so browsers fetch the new file
            await res.async_update_item(mine[0]["id"], {"res_type": "module", "url": url})
    except (HomeAssistantError, ValueError) as err:
        _LOGGER.warning("Could not add the card as a dashboard resource, loading it as an extra module: %s", err)
        return False
    return True


async def async_remove_resource(hass: HomeAssistant) -> None:
    """Called when the integration is removed, not on unload: a reload must not churn the user's resource list."""
    res = _storage_resources(hass)
    if res is None:
        return
    await res.async_get_info()
    for r in _ours(res):
        await res.async_delete_item(r["id"])


async def async_register(hass: HomeAssistant, show_in_sidebar: bool = True) -> None:
    if not hass.data.get(_STATIC_DONE):  # a static path cannot be removed, so once per run
        www = Path(__file__).parent / "www"
        await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(www), cache_headers=False)])
        hass.data[_STATIC_DONE] = True
    version = (await async_get_integration(hass, DOMAIN)).version
    if not await _add_resource(hass, _card_url(version)):  # YAML resources: the S8.3 re-define covers the race
        frontend.add_extra_js_url(hass, _card_url(version))
        hass.data[_CARD_URL] = _card_url(version)
    if not show_in_sidebar:  # hidden: the card and the websocket still work, only the sidebar link is gone
        return
    hass.data[_PANEL_SHOWN] = True
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
    if hass.data.pop(_PANEL_SHOWN, None):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    if url := hass.data.pop(_CARD_URL, None):
        frontend.remove_extra_js_url(hass, url)
