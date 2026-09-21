import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.floorplan_studio.const import DOMAIN


@pytest.fixture(autouse=True)
def _enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture
async def entry(hass):
    e = MockConfigEntry(domain=DOMAIN, title="Floorplan Studio")
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    return e
