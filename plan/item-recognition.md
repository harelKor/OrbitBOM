# Scan anything: item recognition from the phone camera

Status (2026-11-11): Phase 0 test page and Phase 1 (Scan on phones) shipped together at Harel's
ask; the teeth counter runs live in Scan too (Phase 2's first part). Accuracy on real parts not yet
checked.

The goal: Inventory's **Scan** button stops being barcode-only. Point the phone at a part (a gear,
a Kraken, a CANcoder, a bearing, a bag of bolts), and when it's done the **Add an item** window
opens already filled in: category, specs, name, store link, price, photo. The member checks it
and taps Save.

## Can it be done?

Yes, but not with one engine. Two different problems hide in "recognise the item":

| Kind of item | What works | What doesn't |
|---|---|---|
| Products with a label or a brand look (motors, motor controllers, sensors, encoders, batteries, glue, tools) | A **vision AI model** reads the label and knows the product ("Kraken X60", "CANcoder", "Loctite 243") | Two versions that look the same with no label (NEO vs NEO 1.1): it has to ask |
| Bearings, bolts with a number on them | The model reads "6802 2RS" → `bearings.ts` sizes | Unmarked bolts: length needs a scale (see Phase 3) |
| Gears, pulleys, sprockets | **Counting teeth with plain image maths on the phone** (no AI): accurate on a plain background, photographed from above | AI models are bad at counting teeth: they guess ("about 40"). Never trust them for this |
| Size in mm/inches (bore, OD, bolt length) | Only with something of known size in the photo (a printed scan mat) | A bare photo has no scale |
| Barcodes / SKUs on vendor bags | The existing zxing reader, unchanged | |

So the engine runs three readers on the same capture and merges them:

1. **Barcode** (on the phone, already there): runs live the whole time. If it finds a code it wins,
   as today.
2. **Teeth counter** (on the phone, new, no library): for round toothed parts.
3. **Vision model** (in the cloud, free tier, through our server): everything else.

## Which AI, and does it stay free?

Paid APIs (Claude, OpenAI) are out: they cost per photo. Free options with image input:

- **Google Gemini API, free tier** (recommended). A key from Google AI Studio with **no billing
  account attached** cannot be charged: past the limit it answers "429 quota", it never bills.
  Flash models read labels and know FRC products well. Catches:
  - The free limits have been cut several times (Dec 2025) and Google no longer publishes exact
    numbers. Reports range from ~20 to ~1,500 requests a day for Flash; the real number shows in
    AI Studio. Even 20 a day covers a shop day of adding items; more needs a check in the spike.
  - On the free tier Google may use the prompts (the photos) to improve its products. Photos of
    robot parts on a bench are fine; the app should say so on the scan screen and never send faces
    on purpose (frame the part, small crop).
- **Cloudflare Workers AI** (fallback): the team already has a Cloudflare account for R2. 10,000
  "neurons" a day free, billed only on the paid Workers plan, which we don't have. Its open vision
  models read labels worse than Gemini. Kept as a second provider behind the same interface, used
  when Gemini is out for the day.

Both are called from **our server**, never from the browser, so the key stays on the VM (like
Onshape's). The photo is shrunk in the browser to ~768 px JPEG (~100 KB) first, so the small VM only
forwards it.

## How it works, step by step

1. Member taps **Scan** (same button, same place, phone width). The camera opens as today.
2. Live: barcode reader runs; if the part looks round and toothed, an outline and a live
   "36 teeth" label show over it.
3. Member taps **Capture** (or the barcode hits first). Screen shows the frozen photo and
   "Reading…" (2–5 s).
4. Browser sends the shrunk photo to `POST /api/inventory/recognize` (a route handler, not a
   server action: slow work must not block saves). The server:
   - checks `requireMember` and the team's daily count (a small `recognitions` row per scan; also
     an accuracy log, see below);
   - asks the model for **JSON only**, giving it *our* category list and each category's field
     choices (from `inventory_categories`), so it answers in our words: `{ categoryId, specs,
     brand, product, partNumber, searchQuery, textSeen, confidence }`;
   - merges the phone's tooth count / barcode into the specs (the phone's count wins over the
     model's);
   - runs `parseQuick` on the text it read to fill any missing fields, the way the add box does;
   - looks for it on **our shelf first** (same matching as the add box search). If we already have
     it, the answer says so;
   - searches the team's stores with `searchQuery` (`searchProducts`, the add box's search) and
     takes the best offer: link, price, product photo.
5. The phone opens:
   - **New item:** the add box's **Add an item** window (`ItemForm` with an `emptyDraft` filled from
     the answer), with the scan photo attached as the item's photo and the store link/price. The
     member fixes anything wrong and taps **Save**. Same save path as today (`saveItem` →
     `createItem`), so history, undo and the list glow all work.
   - **Already on the shelf:** that item's window with "Found: 3 on shelf B2", Quantity focused, so
     adding stock is one tap. (Open question 2.)
   - **Not sure** (low confidence): the top 2–3 guesses as rows to pick from, then the form.
   - **Failed / out of free quota:** the form with whatever the phone found (barcode, teeth) and
     the add box's typing as today. Scanning never blocks adding.

## The teeth counter (on the phone)

Plain maths on the captured frame, in the browser (shop machines stay light, per Hosting rules):

1. Grey scale, threshold against the background (Otsu), keep the biggest blob = the part.
2. Its centre (centroid), then the edge distance from the centre at 720 angles around it → a wavy
   ring profile.
3. The teeth are the repeating wave: count it with a Fourier transform of the profile (the
   strongest frequency = tooth count), checked by counting peaks.
4. The hole in the middle: 6 corners = hex bore, round = round bore (a "max-spline"/"rounded hex"
   later if needed).
5. Report confidence; below it, show the count but leave the field for the member.

Works best with the part flat, from above, on a plain contrasting surface (a sheet of paper on the
bench). Belts and chain: out of scope. ~200–300 lines, unit-tested on saved photos.

**Category and pitch:** the model says gear vs pulley vs sprocket (and reads "HTD", "20DP", "#25"
when etched). Without a scale, pitch comes from what it read or the member picks it (chips, one
tap). With the scan mat (Phase 3) the outer diameter + tooth count gives the pitch on its own.

## Phases

**Phase 0 — spike, about a day, nothing shipped.**
- Harel makes a free AI Studio key (no billing), entered on the VM with `enter-secrets.sh`
  (`GEMINI_API_KEY`).
- `/dev/scan` page: take a photo, see the raw model answer and the teeth counter's answer.
- Test on ~30 real shop parts (5 motors/controllers, 5 sensors, 5 gears/pulleys/sprockets, 5
  bearings, 5 shop supplies, 5 random). Write down hits and misses here, and the real daily limit
  shown in AI Studio.
- **Go/no-go:** if the model gets most labelled products right and the counter gets clean gears
  exactly right, continue; if not, stop here with nothing in the live app.

**Phase 1 — Scan opens a filled form.** The recognize route, the prompt built from our categories,
shelf + store matching, the camera screen with Capture, the filled Add an item window. Barcode keeps
working exactly as now. Daily quota message. Members' MCP gets nothing new (it has no camera).

**Phase 2 — the teeth counter** in the live camera view and merged into the answer.

**Phase 3 — only if wanted:** a printed A4 **scan mat** (four corner marks, a known size) on the
bench gives real millimetres: bore size, OD → pitch, bolt length, bearing sizes without a number.
Plus "already have it → add stock".

**Accuracy log:** each scan keeps what was guessed and what the member saved (no photo, just the
fields), so we can see which categories it gets wrong and fix the prompt. One small table
(next migration 0084, RLS on).

## What it costs

Nothing: Gemini free key with no billing account; Cloudflare Workers AI free allocation; photos
are not stored beyond the item photo the member keeps (already R2, already free); one small table
in Supabase. No new paid resource anywhere.

## Decisions (Harel, 2026-11-11)

1. Gemini free tier: yes.
2. Already on the shelf: open the existing item (to add stock), not a new one.
3. Scan mat: probably later, but nothing may depend on it. Everything must work without a scale.
