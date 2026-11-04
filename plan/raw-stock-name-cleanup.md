# Raw stock name cleanup: planned changes (not run yet)

Read from the live inventory on 2026-10-30. Sizes and lengths stay in each item's specs.

## Renames (5 items)

| Now | After |
|---|---|
| 1/2" Hex shaft – 900mm | 1/2" Hex shaft |
| 1/2" ThunderHex shaft – 900mm | 1/2" ThunderHex shaft |
| 3/8" Hex shaft – 900mm | 3/8" Hex shaft |
| 3/8" ThunderHex shaft – 900mm | 3/8" ThunderHex shaft |
| 12.7mm 500×500mm Plate | 12.7mm Aluminum plate |

Also tidied: the double space in "40x40mm 5mm wall  Box tube", "50x25mm 1.5mm wall  Box tube" and
"80x80mm 2mm wall  Box tube".

Every other plate, sheet, tube, shaft and block name already has no sheet size or length.

## Merges (24 pairs of items that only differ by length, 500mm vs 700mm)

Each pair becomes one item. Its stock becomes pieces by length (for example "700mm ×2, 500mm ×5"),
measured against the 700mm length, and parts, history and moves move to the kept item.

- Carbon Fiber round tubes, 16 pairs: 8x1, 10x1, 10x1.5, 12x1, 15x1, 16x1, 20x1, 20x1.5, 25x1,
  25x1.5, 30x1, 30x1.5, 40x1, 40x1.5, 50x1, 50x1.5.
  In stock today: 10x1.5 (1⅓ of 500), 12x1 (1 of 500), 15x1 (2 of 500), 16x1 (11 of 500),
  20x1 (4 of 500), 25x1 (9 of 500), 25x1.5 (5 of 500 + 2 of 700), 30x1 (1 of 500),
  30x1.5 (9 of 500), 40x1.5 (3 of 500), 8x1 (9 of 500). The rest are at 0.
- Carbon Fiber "Ø.. tube (other walls)", 6 pairs: Ø10, Ø20, Ø25, Ø30, Ø40, Ø50. All at 0 stock.
- Carbon square tubes, 2 pairs: 22×22×1.3 (2¾ of 700 + 2 7/12 of 500), 28×28×1.5 (4¼ of 500, 0 of 700).

Everything is backed up first (one undo point) and each change gets a history line.

Open question: the 6 "(other walls)" pairs are all at 0 stock and look like placeholders. Merge
them like the rest, or delete them?
