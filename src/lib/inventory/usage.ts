// Inventory allocation (ref §5): "Stock is allocated to matching parts in every robot's BOM.
// Each unit can only be used once per robot — but the same units are available again to
// another robot." Computed on read, never stored (plan §3), so counts can't drift.

export type UsagePart = {
  partId: string;
  inventoryItemId: string;
  quantity: number;
  robotId: string;
  robotName: string;
  systemName: string;
  partName: string;
};

export type RobotAllocation = { robotId: string; robotName: string; needed: number; allocated: number };

export type ItemUsage = {
  parts: UsagePart[];
  robots: RobotAllocation[];
  used: number; // the most any single robot draws from this item
};

export function computeUsage(stock: Map<string, number>, parts: UsagePart[]): Map<string, ItemUsage> {
  const result = new Map<string, ItemUsage>();
  for (const part of parts) {
    let usage = result.get(part.inventoryItemId);
    if (!usage) {
      usage = { parts: [], robots: [], used: 0 };
      result.set(part.inventoryItemId, usage);
    }
    usage.parts.push(part);
    let robot = usage.robots.find((r) => r.robotId === part.robotId);
    if (!robot) {
      robot = { robotId: part.robotId, robotName: part.robotName, needed: 0, allocated: 0 };
      usage.robots.push(robot);
    }
    robot.needed += part.quantity;
  }
  for (const [itemId, usage] of result) {
    const inStock = stock.get(itemId) ?? 0;
    for (const robot of usage.robots) robot.allocated = Math.min(robot.needed, inStock);
    usage.used = Math.max(0, ...usage.robots.map((r) => r.allocated));
  }
  return result;
}

// How many of a part's units the inventory covers, filling the robot's parts in order.
export function allocateToParts(inStock: number, parts: { partId: string; quantity: number }[]) {
  let left = inStock;
  return new Map(
    parts.map((p) => {
      const take = Math.min(p.quantity, Math.max(left, 0));
      left -= take;
      return [p.partId, take] as const;
    }),
  );
}
