// S48: Lazy plan legend overlay explaining rings, glow, and Attention colours. Zero runtime imports.
import type { html as Html } from "lit";

export const LEGEND_CHUNK = "fp-legend-v1";

export interface LegendTools {
  html: typeof Html;
  t(key: string): string;
}

export const LEGEND_CSS = `
.fp-legend-ov{position:absolute;inset:12px;margin:auto;width:min(340px,calc(100% - 24px));max-height:calc(100% - 24px);height:fit-content;z-index:5;display:flex;flex-direction:column;background:color-mix(in srgb,var(--fp-room) 94%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--fp-idle);border-radius:12px;color:var(--fp-ink);font:12px/1.35 var(--fp-font,system-ui,sans-serif);box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden}
.fp-legend-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--fp-idle);font-weight:600}
.fp-legend-x{appearance:none;background:none;border:0;color:var(--fp-ink);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center}
.fp-legend-x svg{width:16px;height:16px}
.fp-legend-bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.fp-legend-grp{display:flex;flex-direction:column;gap:5px}
.fp-legend-gh{font-size:11px;font-weight:600;color:var(--fp-text);text-transform:uppercase;letter-spacing:.03em}
.fp-legend-row{display:flex;align-items:center;gap:8px}
.fp-legend-sw{width:20px;height:20px;flex:none;display:block}
`;

export function legendOverlayView({ html, t }: LegendTools, closeIcon: string, onClose: () => void): unknown {
  return html`<style>${LEGEND_CSS}</style><div class="fp-legend-ov" role="dialog" aria-label=${t("Plan legend")} data-pop>
    <div class="fp-legend-hd">
      <span>${t("Plan legend")}</span>
      <button type="button" class="fp-legend-x" aria-label=${t("Close")} title=${t("Close")} @click=${onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${closeIcon} fill="currentColor"/></svg></button>
    </div>
    <div class="fp-legend-bd">
      <div class="fp-legend-grp">
        <div class="fp-legend-gh">${t("Glow")}</div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="var(--fp-dev-light)" fill-opacity=".35"/><circle cx="10" cy="10" r="4" fill="var(--fp-dev-light)"/></svg><span>${t("Lights on")}</span></div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="3" fill="var(--fp-floor-heat,var(--fp-warn))" fill-opacity=".45"/></svg><span>${t("Heated floor or heat map")}</span></div>
      </div>
      <div class="fp-legend-grp">
        <div class="fp-legend-gh">${t("Rings")}</div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="var(--fp-dev-motion)" stroke-width="1.8" stroke-dasharray="3 2"/><circle cx="10" cy="10" r="3" fill="var(--fp-dev-motion)"/></svg><span>${t("Motion pulse")}</span></div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="var(--fp-dev-speaker,var(--fp-primary))" stroke-width="1.8" stroke-dasharray="7 4"/></svg><span>${t("Sound or siren waves")}</span></div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><line x1="3" y1="10" x2="17" y2="10" stroke="var(--fp-dev-contact,var(--fp-warn))" stroke-width="3" stroke-linecap="round"/></svg><span>${t("Open door or window")}</span></div>
      </div>
      <div class="fp-legend-grp">
        <div class="fp-legend-gh">${t("Attention")}</div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="var(--fp-warn)" stroke="var(--fp-ink)" stroke-width="1.5"/></svg><span>${t("Needs attention")}</span></div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="var(--fp-danger)" stroke="var(--fp-ink)" stroke-width="1.5"/></svg><span>${t("Alarm or hazard")}</span></div>
        <div class="fp-legend-row"><svg class="fp-legend-sw" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="var(--fp-idle)" fill-opacity=".45" stroke="var(--fp-idle)" stroke-width="1.5"/></svg><span>${t("Unavailable")}</span></div>
      </div>
    </div>
  </div>`;
}
