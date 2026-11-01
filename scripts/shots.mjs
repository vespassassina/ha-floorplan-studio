// Renders the demo plan through the built card and editor and writes PNGs to shots/current/, plus a contact
// sheet (shots/current/index.html) so a person or an agent can look at every state in one go.
//
// Why this exists: three S2.9 defects passed lint, unit tests and computed-style pairs while the pixel was
// wrong. Only rendering the plan and looking caught them. This makes the looking cheap enough to do on
// every task that touches render.ts or a stylesheet.
//
//   npm run shots             build, then render; report which images differ from shots/baseline/
//   npm run shots -- --accept copy shots/current/ over shots/baseline/ (after you have looked)
//   npm run shots -- --strict exit 1 when any image differs from the baseline
//   npm run shots -- --polish render only the Sprint 28 set to shots/current/polish/ (4x, three themes, day and night)
//
// The baseline is local and gitignored: PNGs differ between machines (fonts, antialiasing), so a committed
// baseline would fail everywhere but where it was made. Only demo/ is ever drawn; no personal layout.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = new Set(process.argv.slice(2));
const OUT = "shots/current";
const BASE = "shots/baseline";
const CARD = "dist/floorplan-studio-card.js";
const DIST = resolve("dist-test"); // the card with the 3D test hook (build with FP_TEST_BUILD=1, as `npm run shots` does)
const EDITOR = "dist/editor.html";
for (const f of [CARD, EDITOR]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Run \`npm run build\` first, or use \`npm run shots\`, which builds.`);
    process.exit(1);
  }
}
const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const cardJs = readFileSync(CARD, "utf8");
// Review 27: the floors' offsets. The first floor sits 120 cm east and 40 cm south of the ground floor, so the floor below
// shows as a displaced outline: part of it falls where the shown floor draws nothing, part under its room fills.
const ghostLayout = structuredClone(layout);
ghostLayout.floors.first.offset = [120, 40];
// S29.13: the ghost turned. The first floor is drawn 5.5 degrees anticlockwise (rotation -5.5) and sits where it did, so the ground floor below
// it is drawn turned by +5.5 about the plan's origin on top of the shift: the page sets the pose, `demo/layout.json` is not touched.
const turnedLayout = structuredClone(ghostLayout);
turnedLayout.floors.first.rotation = -5.5;
// The 3D fixture: `hand-align-house.json` stores no pose. Aligned = the truth written as a pose (the same numbers as tests/fixtures/hand-align-truth.ts:
// ground -2.5 degrees and [-57, 112] from the basement, first 4 degrees and [83, -41] from the ground, so the first floor's pose is composed here).
const handHouse = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const handAligned = structuredClone(handHouse);
{
  const rot = (v, d) => { const a = (d * Math.PI) / 180; return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]; };
  handAligned.floors.ground.rotation = -2.5; handAligned.floors.ground.offset = [-57, 112];
  const o = rot([83, -41], -2.5);
  handAligned.floors.first.rotation = 1.5; handAligned.floors.first.offset = [-57 + o[0], 112 + o[1]];
}
const alignHouse = JSON.parse(readFileSync("tests/fixtures/align-house.json", "utf8"));

// One entity table for the whole demo. `off` is every device at rest; `on` is every device doing its thing.
const now = () => new Date().toISOString();
const st = (state, attributes = {}) => ({ state, attributes, last_changed: now() });
// S16.3: the stub picture of the demo camera, a 96 x 54 PNG made here (a sky, a floor, a door), so no real camera image is ever in the repo.
const CAMPIC = await (async () => {
  const { deflateSync, crc32 } = await import("node:zlib");
  const W = 96, H = 54, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const door = x > 58 && x < 78 && y > 14, floor = y > 40, o = y * (W * 3 + 1) + 1 + x * 3;
    const c = door ? [150, 90, 40] : floor ? [90, 90, 100] : [120 + y, 160 + y, 200];
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]), n = Buffer.alloc(4), c = Buffer.alloc(4); n.writeUInt32BE(data.length); c.writeUInt32BE(crc32(b)); return Buffer.concat([n, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
})();
const withCam = (hass) => ({ ...hass, states: { ...hass.states, "camera.demo_hall": st("idle", { entity_picture: CAMPIC }) } });
const STATES = {
  off: {
    "light.demo_kitchen": "off", "sensor.demo_hall_pc": "off", "cover.demo_hall_blind": "closed", "sensor.demo_hall_printer": "idle", "sensor.demo_hall_ap": "off", "light.demo_living": "off", "light.demo_bedroom": "off", "switch.demo_hall": "off",
    "switch.demo_tv_plug": "off", "binary_sensor.demo_hall_motion": "off", "climate.demo_living": "off",
    "media_player.demo_office": "idle", "camera.demo_hall": "idle", "sensor.demo_living_temperature": "21.5",
    "sensor.demo_bedroom_temperature": "19", "sensor.demo_bathroom_humidity": "54",
  },
  on: {
    "light.demo_kitchen": ["on", { rgb_color: [255, 170, 60] }], "sensor.demo_hall_pc": "on", "cover.demo_hall_blind": "open", "sensor.demo_hall_printer": "printing", "sensor.demo_hall_ap": "on", "light.demo_living": "on", "light.demo_bedroom": "on",
    "switch.demo_hall": "on", "switch.demo_tv_plug": "on", "binary_sensor.demo_hall_motion": "on", "climate.demo_living": "heat",
    "media_player.demo_office": "playing", "camera.demo_hall": "streaming", "sensor.demo_living_temperature": "23.5",
    "sensor.demo_bedroom_temperature": "12,5", // a comma decimal: must read as no value, never as a number (S2.5)
    "sensor.demo_bathroom_humidity": "unavailable",
  },
  gone: Object.fromEntries(Object.keys({
    "light.demo_kitchen": 0, "sensor.demo_hall_pc": 0, "cover.demo_hall_blind": 0, "sensor.demo_hall_printer": 0, "sensor.demo_hall_ap": 0, "light.demo_living": 0, "light.demo_bedroom": 0, "switch.demo_hall": 0, "switch.demo_tv_plug": 0,
    "binary_sensor.demo_hall_motion": 0, "climate.demo_living": 0, "media_player.demo_office": 0, "camera.demo_hall": 0,
    "sensor.demo_living_temperature": 0, "sensor.demo_bedroom_temperature": 0, "sensor.demo_bathroom_humidity": 0,
  }).map((k) => [k, "unavailable"])),
};
// S7.6: after sunset, every device at rest but the kitchen light, so one room stays bright and the rest go dark.
STATES.night = { ...STATES.off, "light.demo_kitchen": ["on", { rgb_color: [255, 170, 60] }], "sun.sun": "below_horizon" };
// S14.2: the popup shots show the Living light with every control a colour lamp has (brightness, colour temperature, colour).
const lamp = (hass, on) => on ? { ...hass, states: { ...hass.states, "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["color_temp", "hs"], brightness: 128, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000, hs_color: [30, 60] }) } } : hass;
function hassFor(which, dark) {
  const states = {};
  for (const [id, v] of Object.entries(STATES[which])) states[id] = Array.isArray(v) ? st(v[0], v[1]) : st(v);
  return { states, themes: { darkMode: dark } }; // no callService: a function cannot be sent into the page, and nothing here clicks
}

// S2.13: the monitored types on their own, on the ground floor, beside the demo's devices. Grey on the disc, in every theme.
const MON = ["battery", "inverter", "server", "access_point"];
const monLayout = structuredClone(layout);
MON.forEach((t, i) => monLayout.floors.ground.devices.push({ id: `mon-${t}`, type: t, entity: `sensor.demo_${t}`, x: 500 + i * 70, y: 500 }));
// S7.8: a person with a room sensor. Off: away, at the placed spot. On: home, and the sensor names the Kitchen, so the
// icon stands beside the kitchen light, not on it. Gone: unavailable. The demo's own Alex (first floor) has no sensor.
monLayout.floors.ground.devices.push({ id: "mon-person", type: "person", entity: "person.demo_sam", name: "Sam", x: 770, y: 500, room: "sensor.demo_sam_room" });
Object.assign(STATES.off, { "person.demo_sam": "not_home", "sensor.demo_sam_room": "not_home", "person.demo_alex": "not_home" });
Object.assign(STATES.on, { "person.demo_sam": "home", "sensor.demo_sam_room": "Kitchen", "person.demo_alex": "home" });
// S33.1: the demo fan, off and running.
Object.assign(STATES.off, { "fan.demo_bedroom": "off" });
Object.assign(STATES.on, { "fan.demo_bedroom": ["on", { percentage: 60, supported_features: 1 }] });
Object.assign(STATES.gone, { "fan.demo_bedroom": "unavailable" });
Object.assign(STATES.gone, { "person.demo_sam": "unavailable", "sensor.demo_sam_room": "unavailable", "person.demo_alex": "unavailable" });
// The demo's own radar (first floor, Office) gets the same on/off/gone treatment as the ground floor's mon-radar,
// so the first-floor shots show it doing something too, not permanently idle for want of a state.
Object.assign(STATES.off, { "binary_sensor.demo_office_radar_occupancy": "off", "sensor.demo_office_radar_target_1_x": "unavailable", "sensor.demo_office_radar_target_1_y": "unavailable" });
Object.assign(STATES.on, { "binary_sensor.demo_office_radar_occupancy": "on", "sensor.demo_office_radar_target_1_x": "0", "sensor.demo_office_radar_target_1_y": "1000" });
Object.assign(STATES.gone, { "binary_sensor.demo_office_radar_occupancy": "unavailable", "sensor.demo_office_radar_target_1_x": "unavailable", "sensor.demo_office_radar_target_1_y": "unavailable" });
// S7.9: an mmWave radar in Living, rot 180 (facing south into the room), with two tracked targets. Off: no one
// home, the presence sensor is off and the target sensors read unavailable, so no dot is drawn — the fade rule
// alone would not show that, only the missing-dot check does. On: presence on, two targets at different spots.
monLayout.floors.ground.devices.push({
  id: "mon-radar", type: "radar", entity: "binary_sensor.demo_radar_presence", name: "Living radar", x: 250, y: 60, rot: 180,
  targets: [{ x: "sensor.demo_radar_t1_x", y: "sensor.demo_radar_t1_y" }, { x: "sensor.demo_radar_t2_x", y: "sensor.demo_radar_t2_y" }],
});
Object.assign(STATES.off, { "binary_sensor.demo_radar_presence": "off", "sensor.demo_radar_t1_x": "unavailable", "sensor.demo_radar_t1_y": "unavailable", "sensor.demo_radar_t2_x": "unavailable", "sensor.demo_radar_t2_y": "unavailable" });
Object.assign(STATES.on, { "binary_sensor.demo_radar_presence": "on", "sensor.demo_radar_t1_x": "0", "sensor.demo_radar_t1_y": "2000", "sensor.demo_radar_t2_x": "-1000", "sensor.demo_radar_t2_y": "1000" });
Object.assign(STATES.gone, { "binary_sensor.demo_radar_presence": "unavailable", "sensor.demo_radar_t1_x": "unavailable", "sensor.demo_radar_t1_y": "unavailable", "sensor.demo_radar_t2_x": "unavailable", "sensor.demo_radar_t2_y": "unavailable" });
// S7.10: a vacuum in the Hall. Off: docked (idle grey, no spin). On: cleaning (active colour, spinning). Gone: unavailable.
monLayout.floors.ground.devices.push({ id: "mon-vacuum", type: "vacuum", entity: "vacuum.demo_hall", name: "Hall vacuum", x: 440, y: 550 });
// S9.3: a tv device, on/off like a switch (its own entity, distinct from the media_player the demo already draws
// as type "media" — that one's states are "idle"/"playing", not "on"/"off"). Nothing in the demo layout had a
// "tv" device before, so the shots never showed one; without this a screen-shot review can never catch a fixed
// TV blue regressing (CLAUDE.md finding 16).
monLayout.floors.ground.devices.push({ id: "mon-tv", type: "tv", entity: "media_player.demo_tv", name: "Hall TV", x: 510, y: 550 });
Object.assign(STATES.off, { "media_player.demo_tv": "off" });
Object.assign(STATES.on, { "media_player.demo_tv": "on" });
Object.assign(STATES.gone, { "media_player.demo_tv": "unavailable" });
// Objects in 2.5D: a TV on the Living room's north wall (it stands against the wall and shows its screen), and a speaker
// standing in the room (a cabinet with two drivers). The Hall TV above is on the south wall, so it shows its back.
monLayout.floors.ground.devices.push({ id: "mon-tv-living", type: "tv", entity: "media_player.demo_tv_living", name: "Living TV", x: 400, y: 70 });
monLayout.floors.ground.devices.push({ id: "mon-speaker", type: "speaker", entity: "media_player.demo_sonos", name: "Sonos", x: 440, y: 300 });
Object.assign(STATES.off, { "media_player.demo_tv_living": "off", "media_player.demo_sonos": "idle" });
Object.assign(STATES.on, { "media_player.demo_tv_living": "on", "media_player.demo_sonos": "playing" });
Object.assign(STATES.gone, { "media_player.demo_tv_living": "unavailable", "media_player.demo_sonos": "unavailable" });
// S18.12: a tv, speaker and computer piece with an entity (tracking it) beside the same three without one, in the Kitchen.
// Idle, the linked ones must read blue and the plain ones grey; on, linked ones go amber (and the tv and speaker send waves).
const pc = (id, symbol, x, y, entity) => ({ id, symbol, x, y, rot: 0, w: symbol === "tv" ? 120 : symbol === "speaker" ? 25 : 120, h: symbol === "tv" ? 10 : symbol === "speaker" ? 25 : 60, ...(entity ? { entity } : {}) });
monLayout.floors.ground.furniture.push(
  pc("shot-tv-linked", "tv", 560, 40, "media_player.shot_tv"), pc("shot-tv-plain", "tv", 720, 40),
  pc("shot-sp-linked", "speaker", 540, 100, "media_player.shot_sp"), pc("shot-sp-plain", "speaker", 620, 100),
  pc("shot-pc-linked", "computer", 580, 160, "switch.shot_pc"), pc("shot-pc-plain", "computer", 720, 160));
Object.assign(STATES.off, { "media_player.shot_tv": "off", "media_player.shot_sp": "idle", "switch.shot_pc": "off" });
Object.assign(STATES.on, { "media_player.shot_tv": "playing", "media_player.shot_sp": "playing", "switch.shot_pc": "on" });
Object.assign(STATES.gone, { "media_player.shot_tv": "unavailable", "media_player.shot_sp": "unavailable", "switch.shot_pc": "unavailable" });
// S18.14: a siren (rings while on), a siren-typed device on a plain entity (danger colour, no rings) and an alarm panel
// (armed = danger red, disarmed = idle), in the Hall beside the vacuum. Off, on and gone, like the rest.
monLayout.floors.ground.devices.push(
  { id: "mon-siren", type: "siren", entity: "siren.demo_hall", name: "Hall siren", x: 360, y: 550 },
  { id: "mon-siren-plain", type: "siren", entity: "switch.demo_horn", name: "Horn", x: 360, y: 500 },
  { id: "mon-alarm", type: "alarm", entity: "alarm_control_panel.demo_home", name: "Alarm panel", x: 290, y: 550 });
Object.assign(STATES.off, { "siren.demo_hall": "off", "switch.demo_horn": "off", "alarm_control_panel.demo_home": "disarmed" });
Object.assign(STATES.on, { "siren.demo_hall": "on", "switch.demo_horn": "on", "alarm_control_panel.demo_home": "armed_away" });
Object.assign(STATES.gone, { "siren.demo_hall": "unavailable", "switch.demo_horn": "unavailable", "alarm_control_panel.demo_home": "unavailable" });
// S8.13: an open contact door and window draw their alert line in "on"; closed in "off", unknown in "gone".
Object.assign(STATES.off, { "binary_sensor.demo_front_door": "off", "binary_sensor.demo_bedroom_window": "off" });
Object.assign(STATES.on, { "binary_sensor.demo_front_door": "on", "binary_sensor.demo_bedroom_window": "on" });
Object.assign(STATES.gone, { "binary_sensor.demo_front_door": "unavailable", "binary_sensor.demo_bedroom_window": "unavailable" });
Object.assign(STATES.off, { "vacuum.demo_hall": "docked" });
Object.assign(STATES.on, { "vacuum.demo_hall": "cleaning" });
Object.assign(STATES.gone, { "vacuum.demo_hall": "unavailable" });
// S10.3: the front door also carries a vibration sensor, added here rather than to demo/layout.json itself (that
// fixture is shared with migrate.test.ts's v1-equals-v2 check, which a real schema change would need to touch on
// both sides — not worth it just to have one more shot). Spread from STATES.off only now, after every assign
// above, so "vibrating" carries the same full entity set they do; it is otherwise "off", so the alarm state shows
// solid on its own, distinct from "on"'s dashed+alarm combination (both classes together).
monLayout.floors.ground.doors[0].vibration = ["binary_sensor.demo_front_vibration"];
STATES.vibrating = { ...STATES.off, "binary_sensor.demo_front_vibration": "on" };
// Everything lit and the Living radiator actually heating (hvac_action), so the radiator box shows its heater tint.
STATES.heating = { ...STATES.on, "climate.demo_living": ["heat", { hvac_action: "heating" }] };

// Plugs are active only while they draw power (Diego, 2026-10). The TV plug is switched on and draws 35 W: active.
// A second plug is switched on and idles at 0.4 W: grey, not blue. Off: both switched off, 0 W. Gone: unavailable.
monLayout.floors.ground.devices.find((d) => d.id === "plug-living").power = "sensor.demo_tv_plug_power";
monLayout.floors.ground.devices.push({ id: "mon-plug-idle", type: "plug", entity: "switch.demo_idle_plug", name: "Idle plug", power: "sensor.demo_idle_plug_power", x: 60, y: 400 });
const watts = (n) => ["" + n, { unit_of_measurement: "W", device_class: "power" }];
Object.assign(STATES.off, { "sensor.demo_tv_plug_power": watts(0), "switch.demo_idle_plug": "off", "sensor.demo_idle_plug_power": watts(0) });
Object.assign(STATES.on, { "sensor.demo_tv_plug_power": watts(35), "switch.demo_idle_plug": "on", "sensor.demo_idle_plug_power": watts(0.4) });
Object.assign(STATES.gone, { "sensor.demo_tv_plug_power": "unavailable", "switch.demo_idle_plug": "unavailable", "sensor.demo_idle_plug_power": "unavailable" });
// A curtain (a cover) in the Hall: open it is drawn idle like closed, never orange (Diego, 2026-10). Closed in "off",
// open in "on", unavailable in "gone".
monLayout.floors.ground.devices.push({ id: "mon-curtain", type: "cover", entity: "cover.demo_curtain", name: "Hall curtain", x: 200, y: 550 });
Object.assign(STATES.off, { "cover.demo_curtain": "closed" });
Object.assign(STATES.on, { "cover.demo_curtain": "open" });
Object.assign(STATES.gone, { "cover.demo_curtain": "unavailable" });
// Only the Hall's motion sensor on: its room gets the thin inner line. With the curtain open and the kitchen light on
// beside it, so one picture shows the line, an idle open cover and a lit lamp.
STATES.motion = { ...STATES.off, "binary_sensor.demo_hall_motion": "on", "cover.demo_curtain": "open", "light.demo_kitchen": ["on", { rgb_color: [255, 170, 60] }] };

// S35.4: the demo car (a piece with attached sensors) at rest, in three states and gone; the lock, charger and tracker values are
// those the integrations send (Renault: battery_charging binary_sensor; any lock: locked/unlocked; a tracker: home, not_home or a zone).
const carStates = (where, charging, lock) => ({
  "device_tracker.demo_car": where, "sensor.demo_car_battery": ["78", { device_class: "battery", unit_of_measurement: "%" }],
  "binary_sensor.demo_car_charging": [charging ? "on" : "off", { device_class: "battery_charging" }], "lock.demo_car_doors": lock,
  "sensor.demo_car_range": ["310", { unit_of_measurement: "km" }],
});
Object.assign(STATES.off, carStates("home", false, "locked"));
Object.assign(STATES.on, carStates("home", true, "locked"));
Object.assign(STATES.gone, carStates("unavailable", false, "unavailable"));
STATES.carCharging = { ...STATES.off, ...carStates("home", true, "locked") };
STATES.carAway = { ...STATES.off, ...carStates("Work", false, "locked") };
STATES.carDoor = { ...STATES.off, ...carStates("home", false, "unlocked") };
// All nine models on a test-only layout: the demo house with a 3 x 3 grid of cars below it, each in its own colour.
const carsLayout = structuredClone(monLayout);
{
  const COLOURS = ["#c03030", "#2060c0", "#e0c020", "#20a060", "#808080", "#f08020", "#6030a0", "#101010", "#e8e8e8"];
  carsLayout.floors.ground.furniture.push(...["sedan", "wagon", "suv", "offroad", "truck", "van", "utility", "citycar", "electric"].map((model, i) => ({
    id: `shot-car-${model}`, symbol: "car", model, color: COLOURS[i], x: 260 + (i % 3) * 540, y: 800 + Math.floor(i / 3) * 320, rot: 0, w: 470, h: 182 })));
}

// S11.1: sensors that belong to a room. Living owns two temperature sensors (their mean shows under the name, and the
// loose icon is gone), a humidity sensor and the Hall's motion sensor; the Kitchen owns one that reads unavailable, so
// it shows nothing. Built on a clone: demo/layout.json stays as it is.
const roomLayout = structuredClone(monLayout);
const rg = roomLayout.floors.ground.rooms;
Object.assign(rg.find((r) => r.name === "Living"), { temps: ["sensor.demo_living_temperature", "sensor.demo_living_temp2"], humidity: ["sensor.demo_living_humidity"] });
Object.assign(rg.find((r) => r.name === "Hall"), { motion: ["binary_sensor.demo_hall_motion"] });
Object.assign(rg.find((r) => r.name === "Kitchen"), { temps: ["sensor.demo_kitchen_temp"], motion: ["binary_sensor.demo_kitchen_motion"] });
STATES.roomsensors = { ...STATES.off, "sensor.demo_living_temperature": ["21", { unit_of_measurement: "°C" }], "sensor.demo_living_temp2": ["22.4", { unit_of_measurement: "°C" }], "sensor.demo_living_humidity": ["48", { unit_of_measurement: "%" }], "binary_sensor.demo_hall_motion": "on", "sensor.demo_kitchen_temp": "unavailable", "binary_sensor.demo_kitchen_motion": "unavailable" };

// S13: floor textures in 3D, on a clone. The lit Kitchen wears the lightest wood (the case that could saturate), Living a
// checkerboard turned 30 degrees at 150%, the Hall dark wood.
const texLayout = structuredClone(roomLayout);
const tg = texLayout.floors.ground.rooms;
Object.assign(tg.find((r) => r.name === "Kitchen"), { texture: "wood-light" });
Object.assign(tg.find((r) => r.name === "Living"), { texture: "checker-classic", textureRot: 30, textureScale: 1.5 });
Object.assign(tg.find((r) => r.name === "Hall"), { texture: "wood-dark" });

// S28.1: `npm run shots -- --polish` renders only the Sprint 28 set to shots/current/polish/: the demo ground and first floor in
// 2.5D (tilt .5) and 3D (default camera and one orbit), blueprint, light and ha-dark, day and night, at deviceScaleFactor 4,
// plus 4x crops of a door, a window, a tree and a wall foot in both views. The demo has no tree, so two are added to the demo
// garden here, in the page's layout copy; demo/layout.json is not touched. Fails when a file is missing or a frame is blank.
if (args.has("--polish")) {
  const POLISH = "shots/current/polish";
  const DPR = 4;
  const polishLayout = structuredClone(layout);
  polishLayout.floors.ground.furniture.push(
    { id: "polish-tree-1", symbol: "tree", x: 868, y: 408, rot: 0, w: 60, h: 60 },
    { id: "polish-tree-2", symbol: "tree", x: 864, y: 516, rot: 20, w: 50, h: 70 });
  const HA = {
    light: "--primary-text-color:#212121;--secondary-text-color:#727272;--card-background-color:#ffffff;--secondary-background-color:#e5e5e5",
    dark: "--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--secondary-background-color:#282828",
  };
  const PT = [
    { id: "blueprint", theme: "blueprint", dark: false, vars: "", page: "#0d1522" },
    { id: "light", theme: "light", dark: false, vars: "", page: "#fff" },
    { id: "ha-dark", theme: "ha", dark: true, vars: HA.dark, page: "#111111" },
  ];
  // Plan points (cm) to look at, per floor: [kind, x, y, z of the thing, label]. Crops are 160 x 160 css px (640 x 640 px at 4x).
  const SPOTS = {
    ground: [["door", 345, 600, 100], ["tree", 868, 408, 200], ["wallfoot", 500, 200, 0]],
    first: [["window", 200, 0, 110]],
  };
  const files = [], problems = [];
  mkdirSync(POLISH, { recursive: true });
  for (const f of readdirSync(POLISH)) rmSync(`${POLISH}/${f}`, { force: true });
  const sizeOk = (path, min) => existsSync(path) && readFileSync(path).length >= min;
  const keep = (name, min) => { files.push([name, min]); };
  const toScreen = async (page, floorName) => {
    // The plan to the screen at floor level: an affine map from three vertices of the first room (its drawn points, through the polygon's own CTM).
    const pts = polishLayout.floors[floorName].rooms[0].pts.slice(0, 3);
    return page.evaluate((plan) => {
      const sr = document.getElementById("c").shadowRoot, poly = sr.querySelector('svg polygon[data-r="0"]'), m = poly.getScreenCTM();
      const drawn = poly.getAttribute("points").trim().split(/[\s,]+/).map(Number);
      const scr = [0, 1, 2].map((i) => ({ x: m.a * drawn[2 * i] + m.c * drawn[2 * i + 1] + m.e, y: m.b * drawn[2 * i] + m.d * drawn[2 * i + 1] + m.f }));
      // solve screen = A * plan + t from the three vertices
      const [p0, p1, p2] = plan, [s0, s1, s2] = scr;
      const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      const row = (k) => {
        const dx = ((s1[k] - s0[k]) * (p2[1] - p0[1]) - (s2[k] - s0[k]) * (p1[1] - p0[1])) / det;
        const dy = ((s2[k] - s0[k]) * (p1[0] - p0[0]) - (s1[k] - s0[k]) * (p2[0] - p0[0])) / det;
        return [dx, dy, s0[k] - dx * p0[0] - dy * p0[1]];
      };
      return [row("x"), row("y")];
    }, pts);
  };
  const clip = (x, y, w = 160, h = 160) => ({ x: Math.max(0, Math.round(x - w / 2)), y: Math.max(0, Math.round(y - h / 2)), width: w, height: h });
  const browser = await chromium.launch();
  try {
    for (const t of PT) for (const day of [true, false]) for (const floor of ["ground", "first"]) for (const view of ["2.5d", "3d"]) {
      const tag = `${t.id}-${day ? "day" : "night"}`, base = `${view === "3d" ? "3d" : "2-5d"}-${floor}-${tag}`;
      const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: DPR });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`${base}: ${e}`));
      page.on("console", (m) => { if (m.type() === "error") problems.push(`${base}: console.error ${m.text()}`); });
      const config = { layout: polishLayout, floor, theme: t.theme, view, active_list: false, ...(view === "2.5d" ? { tilt: 0.5 } : {}) };
      const hass = hassFor(day ? "off" : "night", t.dark);
      if (view === "2.5d") {
        await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:${t.page};${t.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
        await page.addScriptTag({ content: cardJs, type: "module" });
      } else {
        const ORIGIN = "http://fp.test";
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== ORIGIN) return route.abort();
          if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><script type="module" src="/floorplan_studio_static/floorplan-studio-card.js?v=shots"></script><body style="margin:0;padding:12px;background:${t.page};${t.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>` });
          const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname);
          if (!m || !existsSync(resolve(DIST, m[1]))) return route.fulfill({ status: 404, body: "not found" });
          return route.fulfill({ contentType: "text/javascript", body: readFileSync(resolve(DIST, m[1])) });
        });
        await page.goto(`${ORIGIN}/`);
      }
      await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
      await page.evaluate(([c, h]) => { const el = document.getElementById("c"); el.setConfig(c); el.hass = h; return el.updateComplete; }, [config, hass]);
      const card = page.locator("floorplan-studio-card");
      if (view === "3d") {
        try { await page.waitForFunction(() => +(document.getElementById("c").shadowRoot.querySelector(".fp-3d")?.dataset.drawn ?? 0) >= 1, null, { timeout: 30000 }); }
        catch { problems.push(`${base}: the 3D view never drew a frame`); await ctx.close(); continue; }
        await page.waitForTimeout(900);
      } else if ((await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length)) < 10) problems.push(`${base}: the plan drew almost nothing`);
      await page.mouse.move(0, 0);
      await card.screenshot({ path: `${POLISH}/${base}.png` });
      keep(`${base}.png`, 30000);
      const aff = view === "2.5d" ? await toScreen(page, floor) : null;
      for (const [kind, x, y, z] of SPOTS[floor]) {
        const name = `crop-${kind}-${base}`;
        let at;
        if (view === "3d") at = await page.evaluate(([x, y, z]) => globalThis.__fp3d.project(x, y, z), [x, y, z]);
        else {
          const sx = aff[0][0] * x + aff[0][1] * y + aff[0][2], sy = aff[1][0] * x + aff[1][1] * y + aff[1][2];
          at = { x: sx, y: sy - (z ? 0.5 * z * Math.abs(aff[1][1]) : 0) }; // a lifted thing stands above its foot
        }
        const docH = await page.evaluate(() => document.documentElement.scrollHeight), cl = clip(at.x, at.y);
        cl.y = Math.max(0, Math.min(cl.y, docH - cl.height));
        await page.screenshot({ path: `${POLISH}/${name}.png`, clip: cl });
        keep(`${name}.png`, 4000);
      }
      if (view === "3d") {
        const holder = card.locator(".fp-3d"), b = await holder.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 160, b.y + b.height / 2 - 40, { steps: 8 }); await page.mouse.up();
        await page.waitForTimeout(500);
        await page.mouse.move(0, 0);
        await card.screenshot({ path: `${POLISH}/${base}-orbit.png` });
        keep(`${base}-orbit.png`, 30000);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  for (const [name, min] of files) {
    const p = `${POLISH}/${name}`;
    if (!existsSync(p)) problems.push(`${name}: missing`);
    else if (!sizeOk(p, min)) problems.push(`${name}: blank? ${readFileSync(p).length} bytes, under ${min}`);
  }
  console.log(`${files.length} polish images in ${POLISH}/`);
  if (problems.length) { console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`); process.exit(1); }
  process.exit(0);
}

const shots = [];
const errors = [];
mkdirSync("shots", { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  // Themes: blueprint (the default), light, and Home Assistant's own, drawn under stand-in HA variables in a light and a dark set.
  const HA_VARS = {
    light: "--primary-text-color:#212121;--secondary-text-color:#727272;--card-background-color:#ffffff;--secondary-background-color:#e5e5e5",
    dark: "--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--secondary-background-color:#282828",
  };
  const THEMES = [
    { id: "blueprint", theme: "blueprint", dark: false, vars: "", page: "#0d1522" },
    { id: "light", theme: "light", dark: false, vars: "", page: "#fff" },
    { id: "ha-light", theme: "ha", dark: false, vars: HA_VARS.light, page: "#fafafa" },
    { id: "ha-dark", theme: "ha", dark: true, vars: HA_VARS.dark, page: "#111111" },
  ];
  const cardShots = [];
  for (const floor of Object.keys(layout.floors)) for (const which of Object.keys(STATES)) for (const t of THEMES) {
    if (which === "night" || which === "vibrating" || which === "motion" || which === "roomsensors" || which === "heating" || which.startsWith("car")) continue; // below: ground floor only, two themes each
    cardShots.push({ name: `card-${floor}-${which}-${t.id}`, floor, which, dark: t.dark, theme: t.theme, vars: t.vars, page: t.page });
  }
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light"))
    cardShots.push({ name: `card-ground-night-${t.id}`, floor: "ground", which: "night", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page });
  // S10.3: the front door's vibration sensor only exists on the ground floor's monLayout clone, so this shot is
  // ground-only, same restriction as night above.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light"))
    cardShots.push({ name: `card-ground-vibrating-${t.id}`, floor: "ground", which: "vibrating", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page });
  // The motion perimeter: ground floor, 2D and 2.5D, a dark and a light theme, at 3x so the line can be judged.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const view of ["2d", "2.5d"])
    cardShots.push({ name: `card-ground-motion-${t.id}${view === "2.5d" ? "-2-5d" : ""}`, floor: "ground", which: "motion", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view, dpr: 3 });
  // S11.1: a room's own sensors: the readout under the name, no icons for them, the Hall's border; 2D and 2.5D, at 2x.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const view of ["2d", "2.5d"])
    cardShots.push({ name: `card-ground-roomsensors-${t.id}${view === "2.5d" ? "-2-5d" : ""}`, floor: "ground", which: "roomsensors", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view, dpr: 2, rooms: true });
  // S11.3/S11.4: the Living room picked by a real click, the room section and the filtered list in the left panel, with the lamp's
  // details open; blueprint and light, at 375 px (the list is folded by default there) and at 1000 px, and in 2.5D once.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const width of [375, 1000])
    cardShots.push({ name: `card-ground-roompicked-${t.id}-${width}px`, floor: "ground", which: "roomsensors", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, width, dpr: 2, rooms: true, pick: 0 });
  cardShots.push({ name: "card-ground-roompicked-blueprint-2-5d", floor: "ground", which: "roomsensors", dark: false, theme: "blueprint", vars: "", page: "#0d1522", width: 1000, dpr: 2, rooms: true, pick: 0, view: "2.5d" });
  // S20.2: a floor pill pressed by a real click: the pill's ring and the floor's panel with its All off, at 1000 and 375 px.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const width of [375, 1000])
    cardShots.push({ name: `card-ground-floorpicked-${t.id}-${width}px`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, width, dpr: 2, cfg: { floor: "all" }, pill: "Ground" });
  // 2.5D: both floors, at rest and lit, in the default, a light and a dark theme (the three that read differently).
  for (const floor of Object.keys(layout.floors)) for (const which of ["off", "on"]) for (const t of THEMES.filter((x) => ["blueprint", "light", "ha-dark"].includes(x.id)))
    cardShots.push({ name: `card-${floor}-${which}-${t.id}-2-5d`, floor, which, dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view: "2.5d" });
  // Tilt 0 (top-down), the default and 1 (side-on) on both floors, lit, blueprint; and the cards with no text.
  const bp = THEMES[0];
  for (const floor of Object.keys(layout.floors)) for (const tilt of [0, 0.5, 1])
    cardShots.push({ name: `card-${floor}-on-blueprint-tilt-${String(tilt).replace(".", "-")}`, floor, which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, view: "2.5d", cfg: { tilt } });
  for (const floor of Object.keys(layout.floors)) for (const view of ["2d", "2.5d"])
    cardShots.push({ name: `card-${floor}-on-blueprint-${view.replace(".", "-")}-labels-off`, floor, which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, view, cfg: { labels: false } });
  // The card turned by the user (config `rotation`, the same path the rotate buttons end on): 2D at 45 and 90, 2.5D at
  // 45 and 180 (the lift must still point up the screen), both floors; and the toolbar on a 375 px card, which wraps.
  for (const floor of Object.keys(layout.floors)) {
    for (const rotation of [45, 90]) cardShots.push({ name: `card-${floor}-on-blueprint-rot-${rotation}`, floor, which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, cfg: { rotation } });
    for (const rotation of [45, 180]) cardShots.push({ name: `card-${floor}-on-blueprint-2-5d-rot-${rotation}`, floor, which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, view: "2.5d", cfg: { rotation } });
  }
  // Radiator, speaker and TV solids: ground floor, lit and at rest, tilt 0.5 and 1, turned 0 and 90, light and blueprint.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const tilt of [0.5, 1]) for (const rotation of [0, 90]) for (const which of ["off", "on", "heating"])
    cardShots.push({ name: `card-ground-${which}-${t.id}-solids-tilt-${String(tilt).replace(".", "-")}-rot-${rotation}`, floor: "ground", which, dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view: "2.5d", cfg: { tilt, rotation, active_list: false }, dpr: 2 });
  // S14.2: the popup after a real tap on the Living light (light: brightness, colour temperature and colour sliders) and on the
  // plug (its confirm step), light and dark, wide and narrow; and the hover tooltip with a real mouse over the light.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const width of [900, 375]) {
    cardShots.push({ name: `card-ground-popup-${t.id}-${width}px`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, width, dpr: 2, cfg: { active_list: false }, tap: 0 });
    cardShots.push({ name: `card-ground-popup-confirm-${t.id}-${width}px`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, width, dpr: 2, cfg: { active_list: false }, tap: 3, tap2: true });
  }
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) cardShots.push({ name: `card-ground-tooltip-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, dpr: 2, cfg: { active_list: false }, hover: 0 });
  // S27.C: four devices stacked on one spot in the Hall, zoomed in, closed and then fanned out by a real tap (spiderfy); and the
  // kitchen's full-height window is in every ground shot.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const open of [false, true])
    cardShots.push({ name: `card-ground-stack-${open ? "open" : "closed"}-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, dpr: 2, cfg: { active_list: false, detail: "full", center: [560, 560], zoom_level: 4 }, stack: open });
  // Review 27: the ghost floor (Floor below) on the first floor, 2D, in every theme, and 2.5D in the default.
  for (const t of THEMES) cardShots.push({ name: `card-first-ghost-${t.id}`, floor: "first", which: "off", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, ghost: true, cfg: { ghost_floor: true, active_list: false } });
  // S29.13: the same ghost turned by the first floor's rotation: 2D in three themes, 2.5D in the default.
  for (const t of THEMES.filter((x) => ["blueprint", "light", "ha-dark"].includes(x.id))) cardShots.push({ name: `card-first-ghost-turned-${t.id}`, floor: "first", which: "off", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, turned: true, cfg: { ghost_floor: true, active_list: false } });
  cardShots.push({ name: "card-first-ghost-turned-blueprint-2-5d", floor: "first", which: "off", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, turned: true, view: "2.5d", cfg: { ghost_floor: true, active_list: false } });
  cardShots.push({ name: "card-first-ghost-blueprint-2-5d", floor: "first", which: "off", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, ghost: true, view: "2.5d", cfg: { ghost_floor: true, active_list: false } });
  cardShots.push({ name: "card-ground-on-blueprint-2-5d-375px", floor: "ground", which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, view: "2.5d", width: 375 });
  cardShots.push({ name: "card-ground-on-blueprint-2-5d-rot-45-375px", floor: "ground", which: "on", dark: bp.dark, theme: bp.theme, vars: bp.vars, page: bp.page, view: "2.5d", width: 375, cfg: { rotation: 45 } });
  // S34.11: the card itself with a favourite (the Overview's top section) and with the heat map on (plan, legend, menu item), light,
  // blueprint and a dark theme. The renderFloor shots further down show the rooms at 4x; these show the chrome around them.
  for (const t of THEMES.filter((x) => ["light", "blueprint", "ha-dark"].includes(x.id))) {
    cardShots.push({ name: `card-ground-favourites-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, cfg: { favourites: ["light.demo_living", "switch.demo_tv_plug"] }, openSheet: true });
    for (const kind of ["temperature", "humidity"])
      cardShots.push({ name: `card-ground-heat-${kind}-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, cfg: { heat_map: kind } });
  }
  for (const t of THEMES.filter((x) => ["light", "blueprint", "ha-dark"].includes(x.id)))
    cardShots.push({ name: `card-ground-heat-temperature-living-3x-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, dpr: 3, cfg: { heat_map: "temperature", active_list: false }, cropRoom: 0 });
  // S16.3: the camera thumbnail, 2D and 2.5D, in every position at the default size and in the three sizes, light, blueprint and a dark theme.
  // The Hall camera sits by the plan's west wall, so left shows the pull-back into the card.
  for (const t of THEMES.filter((x) => ["light", "blueprint", "ha-dark"].includes(x.id))) for (const view of ["2d", "2.5d"])
    cardShots.push({ name: `card-ground-camthumb-${t.id}${view === "2.5d" ? "-2-5d" : ""}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view, cam: true, cfg: { camera_thumb: "on", active_list: false } });
  for (const t of THEMES.filter((x) => ["light", "blueprint"].includes(x.id))) for (const [size, pos] of [["small", "above"], ["large", "left"], ["medium", "right"]])
    cardShots.push({ name: `card-ground-camthumb-${size}-${pos}-${t.id}`, floor: "ground", which: "on", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, cam: true, cfg: { camera_thumb: "on", camera_thumb_size: size, camera_thumb_pos: pos, active_list: false } });
  // S35.4: the demo car in three states (home charging, away at Work, home with an unlocked door), 2D and 2.5D, light, blueprint and
  // midnight, each cropped to the car at 4x; and the nine models on the test-only layout (2D and 2.5D, light and blueprint).
  for (const t of [...THEMES.filter((x) => x.id === "blueprint" || x.id === "light"), { id: "midnight", theme: "midnight", dark: true, vars: "", page: "#111111" }]) for (const view of ["2d", "2.5d"]) {
    for (const which of ["carCharging", "carAway", "carDoor"])
      cardShots.push({ name: `card-test-${which}-${t.id}${view === "2.5d" ? "-2-5d" : ""}`, floor: "test", which, dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view, dpr: 4, cfg: { active_list: false }, cropCar: true });
    if (t.id !== "midnight") cardShots.push({ name: `card-ground-cars-${t.id}${view === "2.5d" ? "-2-5d" : ""}`, floor: "ground", which: "off", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page, view, dpr: 2, cfg: { active_list: false }, cars: true });
  }
  for (const s of cardShots) {
    const ctx = await browser.newContext({ viewport: { width: s.width ?? 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce", ...(s.dpr ? { deviceScaleFactor: s.dpr } : {}) });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}: console.error ${m.text()}`); });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:${s.page};${s.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, hass]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = hass;
      return el.updateComplete;
    }, [{ layout: s.cars ? carsLayout : s.turned ? turnedLayout : s.ghost ? ghostLayout : s.rooms ? roomLayout : s.floor === "ground" ? monLayout : layout, floor: s.floor, theme: s.theme, ...(s.view ? { view: s.view } : {}), ...(s.cfg ?? {}) }, ((h) => (s.cam ? withCam(h) : h))(lamp(hassFor(s.which, s.dark), s.tap === 0 || s.hover === 0))]);
    if (s.pick !== undefined) {
      // A real click on bare floor, found with elementFromPoint (CLAUDE.md finding 3), then the first row's popup Details.
      await page.evaluate(([reg]) => { const el = document.getElementById("c"); el.hass = { ...el.hass, ...reg }; return el.updateComplete; },
        [{ entities: { "light.demo_living": { entity_id: "light.demo_living", device_id: "d1" } }, devices: { d1: { id: "d1", manufacturer: "Signify", model: "Hue white ambiance", sw_version: "1.88.1", area_id: "living" } }, areas: { living: { area_id: "living", name: "Living" } } }]);
      const at = await page.evaluate((i) => {
        const sr = document.getElementById("c").shadowRoot, poly = sr.querySelector(`svg polygon[data-r="${i}"]`), r = poly.getBoundingClientRect();
        for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (sr.elementFromPoint(x, y) === poly) return { x, y };
        return null;
      }, s.pick);
      if (!at) errors.push(`${s.name}: no bare floor to click in room ${s.pick}`);
      else {
        await page.mouse.click(at.x, at.y);
        // S24.7: the row's chevron went; its details are under Details in the row's popup.
        await page.locator("floorplan-studio-card").locator(".fp-room-devices .fp-active-row").first().click();
        await page.locator("floorplan-studio-card").locator(".fp-pop .fp-pop-info > summary").click();
      }
      await page.mouse.move(0, 0);
    }
    if (s.openSheet) { // a real click on the rail's open button, as a person does
      await page.locator("floorplan-studio-card").locator(".fp-rail-open").click();
      await page.locator("floorplan-studio-card").locator(".fp-active-row").first().waitFor();
      await page.mouse.move(0, 0);
    }
    if (s.pill) {
      await page.locator("floorplan-studio-card").locator(".fp-floors button", { hasText: s.pill }).click();
      await page.locator("floorplan-studio-card").locator(".fp-room").waitFor();
      await page.mouse.move(0, 0);
    }
    if (s.stack) {
      // A real tap on the stack: the top icon at the stacked spot (CLAUDE.md finding 3), then the ring's pins.
      const at = await page.evaluate(() => {
        const sr = document.getElementById("c").shadowRoot, r = sr.querySelector('svg g[data-x="11"]').getBoundingClientRect(); // the last of the four stacked icons, the top one
        for (let a = 4; a < 12; a++) for (let c = 4; c < 12; c++) { const x = r.left + (r.width * a) / 16, y = r.top + (r.height * c) / 16; if (sr.elementFromPoint(x, y)?.closest("g[data-x]")) return { x, y }; }
        return null;
      });
      if (!at) errors.push(`${s.name}: no icon to tap on the stack`);
      else { await page.mouse.click(at.x, at.y); await page.locator("floorplan-studio-card").locator("svg .spider-pin").first().waitFor(); await page.mouse.move(0, 0); }
    }
    if (s.tap !== undefined || s.hover !== undefined) {
      // Real mouse at the icon's own spot (CLAUDE.md finding 3), after checking the icon is the top element there.
      const i = s.tap ?? s.hover;
      const at = await page.evaluate((i) => {
        const sr = document.getElementById("c").shadowRoot, r = sr.querySelector(`svg g[data-x="${i}"]`).getBoundingClientRect();
        for (let a = 4; a < 12; a++) for (let b = 4; b < 12; b++) { const x = r.left + (r.width * a) / 16, y = r.top + (r.height * b) / 16; if (sr.elementFromPoint(x, y)?.closest(`g[data-x="${i}"]`)) return { x, y }; }
        return null;
      }, i);
      if (!at) errors.push(`${s.name}: icon ${i} is covered`);
      else if (s.hover !== undefined) { await page.mouse.move(at.x + 30, at.y + 30); await page.mouse.move(at.x, at.y, { steps: 4 }); await page.locator("floorplan-studio-card").locator(".fp-tip").waitFor(); }
      else {
        await page.mouse.click(at.x, at.y);
        await page.locator("floorplan-studio-card").locator(".fp-pop").waitFor();
        if (s.tap2) { await page.locator("floorplan-studio-card").locator(".fp-pop-do").click(); await page.locator("floorplan-studio-card").locator(".fp-pop-confirm, .fp-pop-cancel").first().waitFor(); }
      }
    }
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`${s.name}: the plan drew ${nodes} nodes; something is wrong before you even look`);
    if (s.cropCar) { // the demo car, zoomed: its outline, marks and level value
      const b = await page.evaluate(() => { const sr = document.getElementById("c").shadowRoot, g = sr.querySelector("svg g.furn-car"); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      if (!b) errors.push(`${s.name}: no car in the plan`);
      else await page.screenshot({ path: `${OUT}/${s.name}.png`, clip: { x: Math.max(0, b.x - 30), y: Math.max(0, b.y - 30), width: b.width + 60, height: b.height + 70 } });
    } else if (s.cropRoom !== undefined) { // the card's own room, zoomed: its name, chips and heat value
      const b = await page.evaluate((i) => { const r = document.getElementById("c").shadowRoot.querySelector(`svg polygon[data-r="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, s.cropRoom);
      await page.screenshot({ path: `${OUT}/${s.name}.png`, clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
    } else await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${s.name}.png` });
    shots.push(s.name);
    await ctx.close();
  }
  // S12.3: the 3D view. The card has to be loaded as a module from a URL (its 3D chunk is found beside it), so these are
  // served from dist/ under a fake origin. Both floors, blueprint and light, from the default camera and from an orbit
  // (a real mouse drag), at 2x, with the demo's devices lit.
  const ORIGIN = "http://fp.test";
  const shots3d = [];
  for (const floor of Object.keys(layout.floors)) for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const orbit of [false, true])
    shots3d.push({ name: `card-${floor}-on-${t.id}-3d${orbit ? "-orbit" : ""}`, floor, t, orbit });
  // S12.4: a room picked with a real click, the Active list open (the pick ring, the room section, the model clear of the list).
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) shots3d.push({ name: `card-ground-on-${t.id}-3d-picked`, floor: "ground", t, orbit: false, pick: true });
  // S12.5: live state in 3D. Heating: every device on, the Living radiator heating, the Hall's motion edge (the Hall has a
  // `motion` list in roomLayout), a lit kitchen lamp; and night: only the kitchen lamp lit, so one room glows and the rest go dark.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) {
    shots3d.push({ name: `card-ground-heating-${t.id}-3d`, floor: "ground", t, orbit: false, which: "heating", rooms: true });
    shots3d.push({ name: `card-ground-heating-${t.id}-3d-orbit`, floor: "ground", t, orbit: true, which: "heating", rooms: true });
    shots3d.push({ name: `card-ground-night-${t.id}-3d`, floor: "ground", t, orbit: false, which: "night", rooms: true });
    shots3d.push({ name: `card-ground-night-${t.id}-3d-orbit`, floor: "ground", t, orbit: true, which: "night", rooms: true });
    // S13: textured floors, by day and with the kitchen lamp lit at night (its light on the walls).
    shots3d.push({ name: `card-ground-textured-${t.id}-3d`, floor: "ground", t, orbit: false, which: "heating", tex: true });
    shots3d.push({ name: `card-ground-textured-night-${t.id}-3d`, floor: "ground", t, orbit: false, which: "night", tex: true });
    shots3d.push({ name: `card-ground-textured-night-${t.id}-3d-orbit`, floor: "ground", t, orbit: true, which: "night", tex: true });
  }
  // S16.3: the camera thumbnail in 3D.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light"))
    shots3d.push({ name: `card-ground-camthumb-${t.id}-3d`, floor: "ground", t, orbit: false, cam: true, cfg: { camera_thumb: "on", active_list: false } });
  // S14.2: the popup after a real tap on the Living light in 3D, and the hover tooltip.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) {
    shots3d.push({ name: `card-ground-popup-${t.id}-3d`, floor: "ground", t, orbit: false, tap: 0 });
    shots3d.push({ name: `card-ground-tooltip-${t.id}-3d`, floor: "ground", t, orbit: false, hover: 0 });
  }
  // Review 27: the floors below the shown one, translucent and solid, at their own height and offset.
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const mode of ["ghost", "solid"])
    shots3d.push({ name: `card-first-below-${mode}-${t.id}-3d`, floor: "first", t, orbit: true, ghost: true, cfg: { floors_below: mode, active_list: false } });
  // S29.13: the hand-align house on its first floor with the floors below solid: the stairs of three floors, unaligned (no pose) and aligned (the truth as a pose).
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light" || x.id === "ha-dark")) for (const aligned of [false, true])
    shots3d.push({ name: `card-handhouse-first-below-solid-${aligned ? "aligned" : "unaligned"}-${t.id}-3d`, floor: "first", t, orbit: true, house: aligned ? handAligned : handHouse, cfg: { floors_below: "solid", active_list: false } });
  for (const s of shots3d) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}: console.error ${m.text()}`); });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><script type="module" src="/floorplan_studio_static/floorplan-studio-card.js?v=shots"></script><body style="margin:0;padding:12px;background:${s.t.page};${s.t.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>` });
      const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname);
      if (!m || !existsSync(resolve(DIST, m[1]))) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(resolve(DIST, m[1])) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, hass]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = hass;
      return el.updateComplete;
    }, [{ layout: s.house ?? (s.ghost ? ghostLayout : s.tex ? texLayout : s.rooms ? roomLayout : s.floor === "ground" ? monLayout : layout), floor: s.floor, theme: s.t.theme, view: "3d", active_list: !!s.pick, ...(s.cfg ?? {}) }, ((h) => (s.cam ? withCam(h) : h))(lamp(hassFor(s.which ?? "on", s.t.dark), s.tap === 0 || s.hover === 0))]);
    const holder = page.locator("floorplan-studio-card").locator(".fp-3d");
    try { await page.waitForFunction(() => +(document.getElementById("c").shadowRoot.querySelector(".fp-3d")?.dataset.drawn ?? 0) >= 1, null, { timeout: 15000 }); }
    catch { errors.push(`${s.name}: the 3D view never drew a frame (WebGL missing, or the chunk failed)`); }
    if (s.orbit) {
      const b = await holder.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 160, b.y + b.height / 2 - 40, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(300);
    }
    if (s.pick) {
      await page.waitForTimeout(600);
      const at = await page.evaluate(() => globalThis.__fp3d.project(60, 60, 1));
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(800);
      if (!(await holder.getAttribute("data-ring"))) errors.push(`${s.name}: the click at ${at.x},${at.y} picked no room`);
    }
    if (s.tap !== undefined || s.hover !== undefined) {
      await page.waitForTimeout(800); // the camera settles after its first frame
      const at = await page.evaluate((i) => globalThis.__fp3d.where("device", i), s.tap ?? s.hover);
      if (s.hover !== undefined) { await page.mouse.move(at.x + 60, at.y + 60); await page.mouse.move(at.x, at.y, { steps: 4 }); await page.locator("floorplan-studio-card").locator(".fp-tip").waitFor(); }
      else { await page.mouse.click(at.x, at.y); await page.locator("floorplan-studio-card").locator(".fp-pop").waitFor(); }
    } else     await page.mouse.move(0, 0);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${s.name}.png` });
    shots.push(s.name);
    await ctx.close();
  }
  // S39: the history replay. The demo home at a morning moment (kitchen lamp on, sun up) and a night one (lamp off, sun down), blueprint and
  // light, and the bar alone at 1280 and 380 wide. The connection is made in the page and answers history/history_during_period with rows in
  // Home Assistant's compressed shape ({ s, a?, lu } in float seconds). The slider is moved by its keys, as a person would.
  const replayShots = [];
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const [when, ups] of [["morning", 21], ["night", 15]]) replayShots.push({ name: `card-replay-${when}-${t.id}`, t, ups, width: 1100 });
  for (const width of [1280, 380]) replayShots.push({ name: `card-replay-bar-${width}`, t: THEMES.find((x) => x.id === "light"), ups: 21, width, bar: true });
  // R2.3: the slider with its markers (lamps, doors, motion band, a cluster of lamps) over a busy day, and the hovered cluster (the tooltip is the browser's own `title`, which a headless screenshot cannot draw).
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const width of [1280, 380]) for (const hover of [false, true]) replayShots.push({ name: `card-replay-markers-${t.id}-${width}${hover ? "-hover" : ""}`, t, ups: 21, width, bar: true, markers: true, hover });
  // R2.5: the 48 h bar, the recorder having purged the first 12 hours of the window (the grey part of the strip and the info line).
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light")) for (const width of [1280, 380]) replayShots.push({ name: `card-replay-48h-${t.id}-${width}`, t, ups: 45, width, bar: true, markers: true, h48: true });
  for (const s of replayShots) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: 800 }, colorScheme: s.t.dark ? "dark" : "light", reducedMotion: "reduce", deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}: console.error ${m.text()}`); });
    await page.clock.setFixedTime(new Date(2026, 9, 28, 12, 0, 0));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/floorplan_studio_static/floorplan-studio-card.js?v=shots"></script><body style="margin:0;padding:12px;background:${s.t.page};${s.t.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>` });
      const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname);
      if (!m || !existsSync(resolve(DIST, m[1]))) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(resolve(DIST, m[1])) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, hass, markers, h48]) => {
      const el = document.getElementById("c");
      const at = (h, m = 0) => (new Date(2026, 9, 28, h, m, 0).getTime()) / 1000;
      const rows = {
        "light.demo_kitchen": [{ s: "off", a: { friendly_name: "Kitchen" }, lu: at(0) - 7200 }, { s: "on", a: { friendly_name: "Kitchen", rgb_color: [255, 170, 60] }, lu: at(8) }, { s: "off", a: { friendly_name: "Kitchen" }, lu: at(10) }],
        "sun.sun": [{ s: "below_horizon", a: { azimuth: 10, elevation: -30 }, lu: at(0) - 7200 }, { s: "above_horizon", a: { azimuth: 90, elevation: 30 }, lu: at(7) }, { s: "below_horizon", a: { azimuth: 300, elevation: -5 }, lu: at(10, 30) }],
      };
      if (markers) {
        // Home Assistant's shapes: the first row is the state at the start (with `a`), later rows carry `s` and `lu`.
        const start = at(12) - 86400 - 60;
        const cycle = (...times) => [{ s: "off", a: {}, lu: start }, ...times.flatMap(([h, m]) => [{ s: "on", lu: at(h, m) }, { s: "off", lu: at(h, m + 3) }])].sort((x, y) => x.lu - y.lu);
        rows["light.demo_kitchen"] = cycle([17, 0], [18, 30], [6, 40], [7, 0], [7, 10], [7, 20], [19, 0], [22, 45]);
        rows["light.demo_living"] = cycle([18, 0], [18, 15], [2, 30]);
        rows["binary_sensor.demo_front_door"] = cycle([8, 0], [17, 55], [23, 30]);
        rows["binary_sensor.demo_patio_door"] = cycle([18, 5]);
        rows["binary_sensor.demo_hall_motion"] = cycle(...[6, 7, 8, 8, 9, 17, 17, 18, 18, 18, 19, 19, 20, 20, 21, 22].map((h, i) => [h, (i * 7) % 50]));
      }
      hass.locale = { language: "en", time_format: "24" };
      if (h48) {
        // Yesterday evening, then the recorder's purge: nothing before 27 Oct 00:00 (12 hours into the 48 h window).
        const yday = (h, m) => at(h, m) - 86400;
        rows["light.demo_living"].push(...[[18, 0], [20, 30]].flatMap(([h, m]) => [{ s: "on", lu: yday(h, m) }, { s: "off", lu: yday(h, m + 3) }]));
        rows["binary_sensor.demo_front_door"].push(...[[9, 0], [18, 10]].flatMap(([h, m]) => [{ s: "on", lu: yday(h, m) }, { s: "off", lu: yday(h, m + 2) }]));
        for (const id of Object.keys(rows)) rows[id].sort((x, y) => x.lu - y.lu);
      }
      const cut = at(0) - 86400; // 27 Oct 00:00
      // The reply as HA builds it: a row at the asked start (the state then), none before it; a purged recorder has none before `cut`.
      const reply = (id, startSec) => {
        const all = rows[id], first = { ...(all.find((r) => r.a) ?? all[0]) };
        const kept = all.filter((r) => r.lu >= Math.max(startSec, h48 ? cut : 0));
        return h48 && startSec < cut ? [{ ...first, lu: cut }, ...kept.filter((r) => r.lu > cut)] : [{ ...first, lu: startSec }, ...kept.filter((r) => r.lu > startSec)];
      };
      hass.connection = { sendMessagePromise: (m) => Promise.resolve(Object.fromEntries((m.entity_ids ?? []).filter((id) => rows[id]).map((id) => [id, markers ? reply(id, Date.parse(m.start_time) / 1000) : rows[id]]))) };
      el.setConfig(config); el.hass = hass;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme: s.t.theme, active_list: false }, hassFor("on", s.t.dark), !!s.markers, !!s.h48]);
    await page.locator("floorplan-studio-card svg polygon[data-r]").first().waitFor();
    await page.locator("floorplan-studio-card fp-menu button").first().click();
    await page.locator("floorplan-studio-card [data-value='replay']").click();
    const range = page.locator("floorplan-studio-card input.fp-rp-range");
    await page.waitForFunction(() => !document.getElementById("c").shadowRoot.querySelector("input.fp-rp-range")?.disabled);
    if (s.h48) {
      await page.locator("floorplan-studio-card .fp-rp-len button", { hasText: "48 h" }).click();
      await page.waitForFunction(() => !document.getElementById("c").shadowRoot.querySelector("input.fp-rp-range")?.disabled);
    }
    await range.focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < s.ups; i++) await page.keyboard.press("PageUp");
    await page.mouse.move(0, 0);
    // The hovered shot: the mouse over the last cluster, as a person would find it.
    if (s.h48) await page.locator("floorplan-studio-card .fp-rp-info").click();
    if (s.hover) await page.locator("floorplan-studio-card .fp-rp-tick").last().hover();
    if (s.bar) await page.locator("floorplan-studio-card .fp-replay").screenshot({ path: `${OUT}/${s.name}.png` });
    else await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${s.name}.png` });
    shots.push(s.name);
    await ctx.close();
  }
  for (const theme of ["blueprint", "light", "ha"]) {
    const name = `editor-${theme}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.goto(pathToFileURL(resolve(EDITOR)).href);
    await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
    await page.screenshot({ path: `${OUT}/${name}.png` });
    shots.push(name);
    await ctx.close();
  }
  // S31.11 (criterion 12): the card's new frame on a phone (390 x 844) and a tablet (768 x 1024), touch devices (`pointer: coarse`), in
  // blueprint, light and ha-dark, the demo's ground floor with its lights on, every state reached by real input (finding 3): the
  // phone at peek, half and full (a real drag on the handle), a room, the Device level and the ⋯ menu; the tablet with the rail, the
  // side sheet opened, a room, the ⋯ menu, a device popup and the plan's focus ring after Tab and an arrow.
  {
    const FRAME_THEMES = THEMES.filter((x) => ["blueprint", "light", "ha-dark"].includes(x.id));
    const PHONE = { width: 390, height: 844 }, TABLET = { width: 768, height: 1024 };
    const settle = (page) => page.evaluate(async () => { await document.getElementById("c").updateComplete; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    // A point on the device's own icon where it is the top element, then a real touch tap there.
    const tapDevice = async (page, i) => {
      const at = await page.evaluate((i) => {
        const sr = document.getElementById("c").shadowRoot, r = sr.querySelector(`svg g[data-x="${i}"]`).getBoundingClientRect();
        for (let a = 4; a < 12; a++) for (let b = 4; b < 12; b++) { const x = r.left + (r.width * a) / 16, y = r.top + (r.height * b) / 16; if (sr.elementFromPoint(x, y)?.closest(`g[data-x="${i}"]`)) return { x, y }; }
        return null;
      }, i);
      if (!at) return false;
      await page.touchscreen.tap(at.x, at.y);
      return true;
    };
    const tapRoom = async (page, i) => {
      const at = await page.evaluate((i) => {
        const sr = document.getElementById("c").shadowRoot, poly = sr.querySelector(`svg polygon[data-r="${i}"]`), r = poly.getBoundingClientRect();
        for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (sr.elementFromPoint(x, y) === poly) return { x, y };
        return null;
      }, i);
      if (!at) return false;
      await page.touchscreen.tap(at.x, at.y);
      return true;
    };
    const STEPS = {
      phone: {
        peek: async () => true,
        half: async (page) => { await page.locator("#c .fp-handle").tap(); return true; },
        full: async (page) => {
          await page.locator("#c .fp-handle").tap(); await settle(page);
          const b = await page.locator("#c .fp-handle").boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
          await page.mouse.move(x, y); await page.mouse.down();
          for (let k = 1; k <= 10; k++) await page.mouse.move(x, y - k * 40);
          await page.mouse.up(); return true;
        },
        room: (page) => tapRoom(page, 1),
        device: (page) => tapDevice(page, 1),
        menu: async (page) => { await page.locator("#c fp-menu button").first().tap(); await page.locator("#c fp-menu [role=menu]").waitFor(); return true; },
      },
      tablet: {
        rail: async () => true,
        sheet: async (page) => { await page.locator("#c .fp-rail-open").tap(); return true; },
        room: (page) => tapRoom(page, 1),
        menu: async (page) => { await page.locator("#c fp-menu button").first().tap(); await page.locator("#c fp-menu [role=menu]").waitFor(); return true; },
        popup: async (page) => { const ok = await tapDevice(page, 1); if (ok) await page.locator("#c .fp-pop").waitFor(); return ok; },
        focus: async (page) => {
          await page.locator("#c fp-menu button").first().focus();
          await page.keyboard.press("Tab");
          await page.locator("#c .fp-focus").waitFor();
          await page.keyboard.press("ArrowRight");
          return true;
        },
      },
    };
    for (const [kind, size] of [["phone", PHONE], ["tablet", TABLET]]) for (const state of Object.keys(STEPS[kind])) for (const t of FRAME_THEMES) {
      const name = `card-frame-${kind}-${state}-${t.id}`;
      const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, colorScheme: t.dark ? "dark" : "light", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: console.error ${m.text()}`); });
      await page.setContent(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:${t.page};${t.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
      await page.addScriptTag({ content: cardJs, type: "module" });
      await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
      await page.evaluate(([config, hass]) => { const el = document.getElementById("c"); el.setConfig(config); el.hass = hass; return el.updateComplete; },
        [{ layout: monLayout, floor: "ground", theme: t.theme }, hassFor("on", t.dark)]);
      await page.locator("#c svg polygon[data-r]").first().waitFor();
      await settle(page);
      if (!(await STEPS[kind][state](page))) errors.push(`${name}: could not reach the state by a real input`);
      await settle(page);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      shots.push(name);
      await ctx.close();
    }
  }
  // Review 27: the Studio with the floor below on (View, Floor below) and with the Align tab open, over the L-shaped house whose
  // first floor is 137 cm out. Real clicks on the menu items.
  for (const theme of ["blueprint", "light", "ha"]) for (const mode of ["ghost", "align"]) {
    const name = `editor-${mode}-${theme}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.addInitScript(([t, g]) => { localStorage.setItem("floorplan-studio:theme", t); if (g) localStorage.setItem("floorplan-studio:ghost-floor", "true"); }, [theme, mode === "ghost"]);
    await page.goto(pathToFileURL(resolve(EDITOR)).href);
    await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
    await page.evaluate((l) => { document.querySelector("floorplan-studio-editor").layout = l; }, alignHouse);
    await page.locator('.chip[data-f="first"]').click();
    if (mode === "align") { await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); await page.locator("#alignPanel").waitFor(); }
    await page.mouse.move(0, 0);
    if ((await page.locator("floorplan-studio-editor svg g.ghost").count()) !== 1) errors.push(`${name}: no ghost drawn`);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    shots.push(name);
    await ctx.close();
  }
  // S29.13: the Align panel on the hand-align house's first floor, after a real click on Align stairs (so the stair report and the status line show
  // numbers), at 1280 and 768 px wide (S37.3: under 700 the Studio shows a message, not the editor; the page pads it 24 px a side), in a light, a dark (blueprint) and the HA dark theme. The whole page is shot, so a wrapped toolbar and a panel
  // below the fold both show. The theme names are the Studio's.
  for (const width of [1280, 768]) for (const [theme, scheme, label] of [["light", "light", "light"], ["blueprint", "light", "blueprint"], ["ha", "dark", "ha-dark"]]) {
    const name = `editor-handalign-panel-${label}-${width}px`;
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.goto(pathToFileURL(resolve(EDITOR)).href);
    await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
    await page.evaluate((l) => { document.querySelector("floorplan-studio-editor").layout = l; }, handHouse);
    await page.locator("#fixPlan").uncheck(); // the plan opens locked, and a locked plan refuses Align
    await page.locator('.chip[data-f="first"]').click();
    await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); await page.locator("#alignPanel").waitFor();
    const b = page.locator("#alignStairsBtn"); await b.scrollIntoViewIfNeeded();
    const r = await b.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await page.locator("#status").filter({ hasText: "Aligned" }).waitFor();
    await page.locator("#alignPanel").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    if ((await page.locator("floorplan-studio-editor svg g.ghost").count()) !== 1) errors.push(`${name}: no ghost drawn`);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    shots.push(name);
    await ctx.close();
  }
  // S30.10: the Align panel on the hand-align house's ground floor from no pose: the turn line and the other-turn line showing ("preview"),
  // then after a real click on Apply ("applied": Already aligned, Apply disabled). 1280 and 768 px, blueprint, light and ha-dark.
  for (const state of ["preview", "applied"]) for (const width of [1280, 768]) for (const [theme, scheme, label] of [["blueprint", "light", "blueprint"], ["light", "light", "light"], ["ha", "dark", "ha-dark"]]) {
    const name = `editor-align-turn-${state}-${label}-${width}px`;
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.goto(pathToFileURL(resolve(EDITOR)).href);
    await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
    await page.evaluate((l) => { document.querySelector("floorplan-studio-editor").layout = l; }, handHouse);
    await page.locator("#fixPlan").uncheck();
    await page.locator('.chip[data-f="ground"]').click();
    await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); await page.locator("#alignPanel").waitFor();
    await page.locator("#alignScore").waitFor();
    if (state === "preview") {
      if (!/^Turn 2\.5° anticlockwise/.test(await page.locator("#alignMove").innerText())) errors.push(`${name}: no turn line`);
      if (!/half turn/.test(await page.locator("#alignAlt").innerText())) errors.push(`${name}: no other-turn line`);
    } else {
      const b = page.locator("#alignApply"); await b.scrollIntoViewIfNeeded();
      const r = await b.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      await page.locator("#status").filter({ hasText: "Aligned to" }).waitFor();
      if ((await page.locator("#alignMove").innerText()) !== "Already aligned") errors.push(`${name}: not Already aligned after Apply`);
    }
    await page.locator("#alignPanel").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    shots.push(name);
    await ctx.close();
  }
  // S34.7: the heat map. renderFloor drawn straight onto a page (the card takes the option in S34.8, the Studio in S34.10): the plan
  // exactly as every host draws it, minus the chrome. Both floors, `off` (the same plan with no heat, the "before"), temperature and
  // humidity on the `on` states, in blueprint, light, midnight and ha-dark; one night shot (no veil); and 4x crops of the coldest and
  // hottest room on an extremes state (Living 27.5 and Bedroom 14 degrees, Bathroom 72 and 28 %), every theme.
  const { buildSync } = await import("esbuild");
  const planJs = buildSync({ entryPoints: ["src/core/render.ts"], bundle: true, format: "iife", globalName: "FPR", write: false, logLevel: "silent" }).outputFiles[0].text;
  const HEAT_THEMES = [...THEMES.filter((x) => x.id !== "ha-light"), { id: "midnight", theme: "midnight", dark: true, vars: "", page: "#0d1522" }];
  const extremes = (_unused, wet) => ({ ...STATES.off, "sensor.demo_living_temperature": ["27.5", {}], "sensor.demo_bedroom_temperature": ["14", {}], "sensor.demo_bathroom_humidity": [wet ? "72" : "28", {}] });
  const heatShots = [];
  for (const floor of ["ground", "first"]) for (const kind of ["off", "temperature", "humidity"]) for (const t of HEAT_THEMES)
    heatShots.push({ name: `heat-${floor}-${kind}-on-${t.id}`, floor, kind, which: "on", t, dpr: 1 });
  for (const kind of ["off", "temperature"]) heatShots.push({ name: `heat-ground-${kind}-night-blueprint`, floor: "ground", kind, which: "night", t: HEAT_THEMES[0], night: true, dpr: 1 });
  for (const t of HEAT_THEMES) {
    heatShots.push({ name: `heat-ground-temperature-living-hot-4x-${t.id}`, floor: "ground", kind: "temperature", st: extremes(), t, room: 0, dpr: 4 });
    heatShots.push({ name: `heat-first-temperature-bedroom-cold-4x-${t.id}`, floor: "first", kind: "temperature", st: extremes(), t, room: 0, dpr: 4 });
    heatShots.push({ name: `heat-first-humidity-bathroom-wet-4x-${t.id}`, floor: "first", kind: "humidity", st: extremes(null, true), t, room: 1, dpr: 4 });
    heatShots.push({ name: `heat-first-humidity-bathroom-dry-4x-${t.id}`, floor: "first", kind: "humidity", st: extremes(null, false), t, room: 1, dpr: 4 });
  }
  // S42.2: the temperature-range tint. The card passes `tempWarn` from S42.4; until then this harness does what the card will. The range
  // (17 to 26 degrees) is not written into demo/layout.json, which migrate.test.ts compares with its v1 twin: the extremes state puts
  // Living (27.5) over it and Bedroom (14) under it, and the harness hands renderFloor the room ids that `tempWarn` would flag.
  // Each, with and without the temperature heat map, at 1x and as a 4x crop.
  const TINT = { ground: { cls: "hot", room: 0 }, first: { cls: "cold", room: 0 } };
  for (const [floor, w] of Object.entries(TINT)) for (const kind of ["off", "temperature"]) for (const t of HEAT_THEMES) {
    const warn = { [layout.floors[floor].rooms[w.room].id]: w.cls };
    heatShots.push({ name: `tint-${floor}-${w.cls}-${kind}-${t.id}`, floor, kind, st: extremes(), warn, t, dpr: 1 });
    heatShots.push({ name: `tint-${floor}-${w.cls}-${kind}-4x-${t.id}`, floor, kind, st: extremes(), warn, t, room: w.room, dpr: 4 });
  }
  for (const s of heatShots) {
    const f = layout.floors[s.floor];
    const ctx = await browser.newContext({ viewport: { width: 940, height: 700 }, colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: s.dpr });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name}: ${e}`));
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:${s.t.page};${s.t.vars}"><svg id="p" width="900" viewBox="-20 -20 940 690"></svg></body>`);
    await page.addScriptTag({ content: planJs });
    const states = s.st ?? STATES[s.which];
    await page.evaluate(([floor, kind, states, theme, dark, night, ratio, tempWarn]) => {
      const st = {}; for (const [id, v] of Object.entries(states)) { const a = Array.isArray(v) ? v : [v]; st[id] = { state: a[0], attributes: a[1] ?? {}, last_changed: new Date().toISOString() }; }
      const sty = document.createElement("style"); sty.textContent = FPR.FLOORPLAN_CSS; document.head.append(sty);
      document.getElementById("p").innerHTML = FPR.renderFloor(floor, { scale: ratio, px: ratio, state: st, theme, dark, night, roomGlow: true, heat: kind, tempWarn });
    }, [f, s.kind, states, s.t.theme, s.t.dark, !!s.night, 900 / 940, s.warn]);
    if (s.room !== undefined) {
      const box = await page.evaluate((i) => { const r = document.querySelector(`#p polygon[data-r="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, s.room);
      await page.screenshot({ path: `${OUT}/${s.name}.png`, clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 } });
    } else await page.screenshot({ path: `${OUT}/${s.name}.png`, clip: { x: 0, y: 0, width: 924, height: 678 } });
    shots.push(s.name);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// Compare with the baseline byte for byte. Same machine, same build, same pixels: any difference is a change.
const same = (n) => existsSync(`${BASE}/${n}.png`) && readFileSync(`${BASE}/${n}.png`).equals(readFileSync(`${OUT}/${n}.png`));
const hasBase = existsSync(BASE);
const changed = hasBase ? shots.filter((n) => !same(n)) : [];
const cell = (n) => {
  const tag = !hasBase ? "" : !existsSync(`${BASE}/${n}.png`) ? " <b>NEW</b>" : same(n) ? "" : " <b>CHANGED</b>";
  return `<figure><img src="${n}.png" alt="${n}"><figcaption>${n}${tag}</figcaption></figure>`;
};
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>floorplan shots</title>
<style>body{font:13px system-ui;margin:16px}section{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:440px}img{width:100%;border:1px solid #ccc}b{color:#c33}</style>
<h1>floorplan shots</h1>${hasBase ? `<p>${changed.length} of ${shots.length} differ from shots/baseline.</p>` : "<p>No baseline yet: run with --accept once you have looked.</p>"}
<section>${shots.map(cell).join("")}</section>`);

if (args.has("--accept")) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  for (const f of readdirSync(OUT).filter((n) => n.endsWith(".png"))) copyFileSync(`${OUT}/${f}`, `${BASE}/${f}`);
  console.log(`baseline updated: ${shots.length} images`);
}

console.log(`${shots.length} images in ${OUT}/ (open ${OUT}/index.html)`);
if (hasBase && !args.has("--accept")) console.log(changed.length ? `differs from baseline: ${changed.join(", ")}` : "identical to baseline");
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
  process.exit(1);
}
if (args.has("--strict") && changed.length) process.exit(1);
