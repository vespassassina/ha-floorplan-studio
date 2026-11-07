// What the 3D chunk takes from core, handed over by the card (see scene-build.ts). Only the card imports this file, so the
// helpers it names are the copies the 2D plan already uses: one in the page. Every name here is used by the 2D or 2.5D plan too.
import { deviceZ, doorSpan, edgeHeight, floorHeight, floorSlab, furnitureBottom, furnitureHeight, openingSpan, radiatorSpan, unlinkedHeight, wallHeight } from "./heights";
import { acMode, attachedTest, classOf, deviceMarkup, inside, lightFill, lightOpacity, MOTION_PULSE_S, MOTION_PULSES, motionRooms, personRoom, pieceOn, polyCentre, roomAt, roomReadout, ROOM_OWNS } from "./render";
import { resolveStairDirection } from "./stairs";
import { darkenedHex, furnitureBlocks } from "./furniture-blocks";
import { thumbBox, thumbUrl } from "./camera-thumb";
import {
  bodyAir, bodyOf, bodyPlacement, FURNITURE_SOLID, KERB_HIGH, FRAME_PROUD, FRAME_WIDTH, KERB_OUT, OPENING_FILL, OPENING_FRAMED, RADIATOR_DEEP, SPEAKER_HEIGHT, SPEAKER_SIDE, TV_HEIGHT, TV_THICK, TV_WIDTH, UNLINKED_BASE, WELL_DEPTH,
  pieceDevice, stairBlocks, turnAbout, tvPlacement, within,
} from "./solids";
import { DEVICE_TYPES, fxScale, ROOM_KINDS, WALL_KINDS } from "./schema";
import { doorStateOf } from "./door-state";
import { textureTile } from "./textures";
import { treeShape } from "./tree";
import { wallColourMap, wallEdgeKey } from "./wall-colour";
import { carParts, carSpec } from "./car";
import { furniturePaint } from "./furniture-paint";
import { worktopFrame, worktopPts } from "./polygon";
import { carStatus } from "./car-status";
import { linkedStatus } from "./link";
import type { LiveDeps } from "./live-build";
import type { SceneDeps } from "./scene-build";

export const sceneDeps: SceneDeps = {
  deviceZ, doorSpan, edgeHeight, floorHeight, floorSlab, furnitureBottom, furnitureHeight, openingSpan, radiatorSpan, unlinkedHeight, wallHeight,
  attachedTest, inside, resolveStairDirection,
  bodyOf, bodyPlacement, FURNITURE_SOLID, KERB_HIGH, FRAME_PROUD, FRAME_WIDTH, KERB_OUT, OPENING_FILL, OPENING_FRAMED, RADIATOR_DEEP, SPEAKER_HEIGHT, SPEAKER_SIDE, TV_HEIGHT, TV_THICK, TV_WIDTH, UNLINKED_BASE, WELL_DEPTH,
  pieceDevice, stairBlocks, turnAbout, tvPlacement, within, furnitureBlocks, darkenedHex,
  DEVICE_TYPES, ROOM_KINDS, WALL_KINDS, treeShape, carParts, carSpec, wallColourMap, wallEdgeKey, furniturePaint, worktopFrame, worktopPts,
};
export const liveDeps: LiveDeps = {
  acMode, attachedTest, classOf, deviceMarkup, lightFill, lightOpacity, MOTION_PULSE_S, MOTION_PULSES, motionRooms, personRoom, pieceDevice, bodyAir, pieceOn, polyCentre, roomAt, roomReadout, ROOM_OWNS, doorStateOf, fxScale, carStatus, linkedStatus, thumbBox, thumbUrl,
};
export const textureDeps = { texture: textureTile };
export type TextureDeps = typeof textureDeps;
