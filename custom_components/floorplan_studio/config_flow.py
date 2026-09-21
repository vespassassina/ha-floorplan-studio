"""No fields: adding the integration is one click. manifest.json `single_config_entry` allows one instance."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import CONF_SHOW_IN_SIDEBAR, DOMAIN


class FloorplanStudioConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None) -> ConfigFlowResult:
        return self.async_create_entry(title="Floorplan Studio", data={})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return FloorplanStudioOptionsFlow()


class FloorplanStudioOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input=None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = self.config_entry.options.get(CONF_SHOW_IN_SIDEBAR, True)
        return self.async_show_form(step_id="init", data_schema=vol.Schema({vol.Required(CONF_SHOW_IN_SIDEBAR, default=current): bool}))
