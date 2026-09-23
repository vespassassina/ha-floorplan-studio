export interface GuideStep { title: string; body: string }

/**
 * The Help panel's steps, in order. Plain words for someone who has never seen the tool: say what they click and
 * what they will see happen, never "canvas", "polygon" or "viewport".
 */
export const GUIDE_STEPS: GuideStep[] = [
  { title: "Draw the outside wall", body: "Open Draw, then click Draw outline. Click each corner of your home in order, going around the outside." },
  { title: "Close the outline", body: "Click back on the very first corner you placed, or press Enter. The shape fills in grey once it is closed. If it looks wrong, press Escape and start over." },
  { title: "Add the walls inside", body: "Open Draw, then pick a wall kind. Click one end of the wall, then click the other end. Keep clicking to add more walls; press Escape when you are done." },
  { title: "Add doors and windows", body: "Open Add, then Openings, then Door or Window. Click on a wall and it snaps into place there. Drag it along the wall to move it." },
  { title: "Add stairs, zones and rooms", body: "Open Add, then Areas, then Stairs or Zone. Click each corner of the shape in order, the same way you drew the outline." },
  { title: "Add furniture", body: "Open Add, scroll to the bottom, and pick something from the Furniture list. It appears on the plan; drag it where you want it, and use the buttons on its panel to turn it." },
  { title: "Add a device", body: "Open Add, then Devices, and pick one from the list, or open the Device menu to place one already in your catalog. Drag it where it belongs." },
  { title: "Attach it to Home Assistant", body: "Click the device you placed. Its panel opens on the right with a field for its entity — pick the right one from the list, so the plan shows its real state." },
  { title: "Add another floor", body: "Click the + next to the floor tabs at the top of the screen, and give the new floor a name. Click a tab any time to switch floors." },
  { title: "Save your plan", body: "Open File, then Save. Running inside Home Assistant, this stores your plan for next time. In a plain browser window, use Export instead to download a copy." },
];
