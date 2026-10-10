// What the 3D chunk takes from core, handed over by the card (see scene-build.ts). Only the card imports this file, so the
// helpers it names are the copies the 2D plan already uses: one in the page. Every name here is used by the 2D or 2.5D plan too.
import { deviceZ, doorSpan, edgeHeight, floorHeight, floorSlab, furnitureBottom, furnitureHeight, openingSpan, radiatorSpan, unlinkedHeight, wallHeight } from "./heights";
import { acMode, attachedTest, deviceMarkup, inside, lightFill, lightOpacity, MOTION_PULSE_S, MOTION_PULSES, motionRooms, personRoom, pieceOn, polyCentre, roomAt, roomReadout, ROOM_OWNS } from "./render";
import { resolveStairDirection } from "./stairs";
import {
  DEVICE_SOLID, FURNITURE_SOLID, KERB_HIGH, FRAME_PROUD, FRAME_WIDTH, KERB_OUT, OPENING_FILL, OPENING_FRAMED, RADIATOR_DEEP, SPEAKER_HEIGHT, SPEAKER_SIDE, TV_HEIGHT, TV_THICK, TV_WIDTH, UNLINKED_BASE, WELL_DEPTH,
  pieceDevice, stairBlocks, turnAbout, tvPlacement, within,
} from "./solids";
import { DEVICE_TYPES, fxScale, ROOM_KINDS, WALL_KINDS } from "./schema";
import { doorStateOf } from "./door-state";
import { textureTile } from "./textures";
import { treeShape } from "./tree";
import type { LiveDeps } from "./live-build";
import type { SceneDeps } from "./scene-build";

export const sceneDeps: SceneDeps = {
  deviceZ, doorSpan, edgeHeight, floorHeight, floorSlab, furnitureBottom, furnitureHeight, openingSpan, radiatorSpan, unlinkedHeight, wallHeight,
  attachedTest, inside, resolveStairDirection,
  DEVICE_SOLID, FURNITURE_SOLID, KERB_HIGH, FRAME_PROUD, FRAME_WIDTH, KERB_OUT, OPENING_FILL, OPENING_FRAMED, RADIATOR_DEEP, SPEAKER_HEIGHT, SPEAKER_SIDE, TV_HEIGHT, TV_THICK, TV_WIDTH, UNLINKED_BASE, WELL_DEPTH,
  pieceDevice, stairBlocks, turnAbout, tvPlacement, within,
  DEVICE_TYPES, ROOM_KINDS, WALL_KINDS, treeShape,
};
export const liveDeps: LiveDeps = {
  acMode, attachedTest, deviceMarkup, lightFill, lightOpacity, MOTION_PULSE_S, MOTION_PULSES, motionRooms, personRoom, pieceDevice, pieceOn, polyCentre, roomAt, roomReadout, ROOM_OWNS, doorStateOf, fxScale,
};
export const textureDeps = { texture: textureTile };
export type TextureDeps = typeof textureDeps;
