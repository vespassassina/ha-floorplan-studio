import { describe, expect, it } from "vitest";
import { attentionNotify } from "../../src/editor/automations";

describe("attentionNotify (S47)", () => {
  it("builds a state-triggered notification automation config", () => {
    const cfg = attentionNotify({
      name: "Front door",
      entity: "binary_sensor.front_door",
      toState: "on",
      forMinutes: 5,
      target: "notify.mobile_app_phone",
    });
    expect(cfg.alias).toBe("Notify: Front door (on)");
    expect(cfg.trigger).toEqual([
      { platform: "state", entity_id: "binary_sensor.front_door", to: "on", for: { minutes: 5 } },
    ]);
    expect(cfg.action).toEqual([
      {
        service: "notify.mobile_app_phone",
        data: { title: "Front door", message: "Front door is on" },
      },
    ]);
  });

  it("defaults target to notify.notify and omits zero duration", () => {
    const cfg = attentionNotify({ name: "Leak", entity: "binary_sensor.leak", toState: "on" });
    expect(cfg.trigger).toEqual([{ platform: "state", entity_id: "binary_sensor.leak", to: "on" }]);
    expect((cfg.action[0] as { service: string }).service).toBe("notify.notify");
  });
});
