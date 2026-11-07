/** The Add > Furniture menu's names and areas. Its own module, with only core types, so a Node test can import it. */
import type { FurnitureSymbol } from "../core";

/** S26.17: what each piece of furniture is called in the Add menu. A table, not the symbol with its hyphen swapped, so a
 *  new symbol fails the iterating test until someone writes its name. */
export const FURNITURE_LABELS: Record<FurnitureSymbol, string> = {
  table: "Table", sofa: "Sofa", bed: "Bed", cabinet: "Cabinet", chair: "Chair", sink: "Sink", toilet: "Toilet", shower: "Shower", bathtub: "Bathtub", "sofa-l": "Corner sofa", "coffee-table": "Coffee table", bookcase: "Bookcase", buffet: "Buffet", wardrobe: "Wardrobe", dresser: "Chest of drawers", nightstand: "Nightstand", desk: "Desk", armchair: "Armchair", counter: "Kitchen counter", stove: "Stove", fridge: "Fridge", dishwasher: "Dishwasher", washer: "Washing machine", dryer: "Dryer", rug: "Rug", plant: "Plant", treadmill: "Treadmill", "barbell-rack": "Barbell rack", "weight-rack": "Dumbbell rack", "chaise-longue": "Chaise longue", "cube-shelf": "Cube shelf", mirror: "Mirror", "mirror-stand": "Standing mirror", "robot-vacuum": "Robot vacuum", "robot-dock": "Robot dock",
  tv: "TV", computer: "Computer", speaker: "Speaker", tree: "Tree", "patio-wood": "Patio, wood", "patio-concrete": "Patio, concrete", car: "Car", worktop: "Worktop",
};

/** Where each piece goes in the Add menu: one area of the house each, the areas in walking order. A table, so a new
 *  symbol fails the iterating test until someone files it. The menu sorts each area A to Z (`furnitureMenu`). */
export const FURNITURE_AREAS: readonly (readonly [string, readonly FurnitureSymbol[]])[] = [
  ["Living", ["sofa", "sofa-l", "armchair", "chaise-longue", "coffee-table", "tv", "speaker", "bookcase", "cube-shelf", "rug", "plant"]],
  ["Kitchen and dining", ["table", "chair", "buffet", "counter", "worktop", "sink", "stove", "fridge", "dishwasher"]],
  ["Bedroom", ["bed", "nightstand", "wardrobe", "dresser", "mirror-stand"]],
  ["Bathroom", ["toilet", "shower", "bathtub", "mirror"]],
  ["Office", ["desk", "computer", "cabinet"]],
  ["Gym", ["treadmill", "barbell-rack", "weight-rack"]],
  ["Laundry and cleaning", ["washer", "dryer", "robot-vacuum", "robot-dock"]],
  ["Outdoor", ["tree", "patio-wood", "patio-concrete", "car"]],
];
export const furnitureMenu = () => FURNITURE_AREAS.map(([a, s]) => [a, [...s].sort((x, y) => FURNITURE_LABELS[x].localeCompare(FURNITURE_LABELS[y]))] as const);
