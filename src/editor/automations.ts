/**
 * S4.6: pure builders for the automation configs the panel offers. Each returns one config with two triggers (given
 * `id`s) and a `choose` action, so `createHelper`/`createAutomation` (`hass-write.ts`) ever needs to POST one
 * automation, not several. Nothing here touches `hass`: the panel confirms, then hands the result to `createAutomation`.
 */

export interface AutomationConfig { alias: string; trigger: unknown[]; condition?: unknown[]; action: unknown[] }

const turnOn = (entity_id: string | string[]) => ({ service: "homeassistant.turn_on", target: { entity_id } });
const turnOff = (entity_id: string | string[]) => ({ service: "homeassistant.turn_off", target: { entity_id } });
const chooseOnOff = (entity_id: string | string[]): AutomationConfig["action"] => [{ choose: [
  { conditions: [{ condition: "trigger", id: "on" }], sequence: [turnOn(entity_id)] },
  { conditions: [{ condition: "trigger", id: "off" }], sequence: [turnOff(entity_id)] },
] }];

/** A switch's on/off state drives `homeassistant.turn_on`/`turn_off` on every target. */
export function switchControls(switchEntity: string, targets: string[]): AutomationConfig {
  if (!targets.length) throw new Error("Pick at least one thing for the switch to control.");
  if (targets.includes(switchEntity)) throw new Error("A switch cannot control itself.");
  return {
    alias: `${switchEntity} controls`,
    trigger: [
      { platform: "state", entity_id: switchEntity, to: "on", id: "on" },
      { platform: "state", entity_id: switchEntity, to: "off", id: "off" },
    ],
    action: chooseOnOff(targets),
  };
}

/** The light group turns on with the motion group, off `offAfter` seconds after motion stops. */
export function motionLights(motionGroup: string, lightGroup: string, offAfter: number): AutomationConfig {
  if (!(offAfter > 0)) throw new Error("Give a positive number of seconds.");
  return {
    alias: `${motionGroup} → ${lightGroup}`,
    trigger: [
      { platform: "state", entity_id: motionGroup, to: "on", id: "on" },
      { platform: "state", entity_id: motionGroup, to: "off", for: { seconds: offAfter }, id: "off" },
    ],
    action: chooseOnOff(lightGroup),
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The entity turns on at `on` and off at `off`, both "HH:MM". */
export function schedule(entity: string, on: string, off: string): AutomationConfig {
  if (!HHMM.test(on) || !HHMM.test(off)) throw new Error("Give both times as HH:MM.");
  return {
    alias: `${entity} schedule`,
    trigger: [
      { platform: "time", at: on, id: "on" },
      { platform: "time", at: off, id: "off" },
    ],
    action: chooseOnOff(entity),
  };
}

/**
 * Opens the automation's own editor in HA, the same navigation HA's own links use — no page reload. Lives here, not in
 * `hass-write.ts`, because it touches no `hass`: the editor calls it directly after `createAutomation` resolves, and the
 * editor never imports `hass-write.ts` (kept out of the standalone build).
 */
export function openAutomation(id: string): void {
  history.pushState(null, "", `/config/automation/edit/${id}`);
  window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
}
