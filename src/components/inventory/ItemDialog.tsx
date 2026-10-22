"use client";

import { useActionState, useState } from "react";
import { formatStock } from "@/lib/inventory/stock";
import { Dialog } from "@/components/Dialog";
import { MATERIALS } from "@/config/materials";
import { PART_TYPES, buildItemName, getPartType } from "@/config/partTypes";
import { INVENTORY_CATEGORIES, inventoryCategoryOf } from "@/config/inventory";
import { saveItem, type ActionResult } from "@/app/(app)/inventory/actions";
import type { Item, Lookups } from "./types";

// "Add / Edit inventory item" (ref §5, screenshot 11). Choosing a part type adds its detail
// fields and picks the category; types with a name pattern build the item name until the member
// types their own.
export function ItemDialog({
  open,
  item,
  defaultCategory,
  lookups: { conditions, locations },
  onClose,
}: {
  open: boolean;
  item: Item | null;
  defaultCategory: string | null;
  lookups: Lookups;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(item?.templateId ?? "");
  // The category follows the part type until someone picks one.
  const [category, setCategory] = useState(item ? (item.categorySet ?? "") : (defaultCategory ?? ""));
  const [values, setValues] = useState<Record<string, string>>(item?.templateValues ?? {});
  const [material, setMaterial] = useState(item?.material ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [nameTouched, setNameTouched] = useState(!!item);

  const type = templateId ? getPartType(templateId) : undefined;
  const autoName = type ? buildItemName(type, values, material) : undefined;
  const shownName = !nameTouched && autoName ? autoName : name;

  const [state, action, pending] = useActionState(async (prev: ActionResult | undefined, formData: FormData) => {
    const result = await saveItem(item?.id ?? null, prev, formData);
    if (!result.error) onClose();
    return result;
  }, undefined);

  return (
    <Dialog open={open} onClose={onClose} title={item ? "Edit inventory item" : "Add inventory item"} wide>
      <form action={action} className="space-y-3">
        <div>
          <label className="label" htmlFor="inv-name">
            Part name *
          </label>
          <input
            id="inv-name"
            name="name"
            required
            value={shownName}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            className="input"
          />
          {autoName && nameTouched && autoName !== name && (
            <button
              type="button"
              className="mt-1 text-xs text-accent-soft hover:text-accent-soft"
              onClick={() => setNameTouched(false)}
            >
              Use &ldquo;{autoName}&rdquo;
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inv-stock">
              In stock{type?.sheet && " (sheets)"}
            </label>
            <input
              id="inv-stock"
              name="inStock"
              inputMode={type?.sheet ? "text" : "numeric"}
              defaultValue={formatStock(item?.inStock ?? 0, !!type?.sheet)}
              placeholder={type?.sheet ? "2 3/4" : "0"}
              className="input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="label" htmlFor="inv-condition">
              Condition
            </label>
            <select id="inv-condition" name="conditionId" defaultValue={item?.conditionId ?? ""} className="input">
              <option value="">Not set</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-category">
              Category
            </label>
            <select id="inv-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              <option value="">Guess from the type or name</option>
              {INVENTORY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-location">
              Location
            </label>
            <select id="inv-location" name="locationId" defaultValue={item?.locationId ?? ""} className="input">
              <option value="">Not set</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-type">
              Part type
            </label>
            <select
              id="inv-type"
              name="templateId"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                if (!category && e.target.value) setCategory(inventoryCategoryOf({ category: null, templateId: e.target.value, name: "" }));
              }}
              className="input"
            >
              <option value="">None</option>
              {PART_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-material">
              Material
            </label>
            {type?.materialSource ? (
              <select
                id="inv-material"
                name="material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                className="input"
              >
                <option value="">Not set</option>
                {(MATERIALS[type.materialSource] ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="inv-material"
                name="material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="Optional, e.g. 6061"
                className="input"
              />
            )}
          </div>
        </div>

        {type && type.fields.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Part type details</div>
            <div className="grid grid-cols-2 gap-3">
              {type.fields.map((f) => (
                <div key={f.id}>
                  <label className="label" htmlFor={`tv-${f.id}`}>
                    {f.label}
                  </label>
                  {f.options ? (
                    <select
                      id={`tv-${f.id}`}
                      name={`tv.${f.id}`}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                      className="input"
                    >
                      <option value="">Not set</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`tv-${f.id}`}
                      name={`tv.${f.id}`}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                      className="input"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="inv-vendor-url">
            Vendor link
          </label>
          <input
            id="inv-vendor-url"
            name="vendorUrl"
            type="url"
            defaultValue={item?.vendorUrl ?? ""}
            placeholder="https://…"
            className="input"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inv-vendor">
              Vendor
            </label>
            <input id="inv-vendor" name="vendorName" defaultValue={item?.vendorName ?? ""} placeholder="e.g. WCP" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="inv-price">
              Price ($)
            </label>
            <input
              id="inv-price"
              name="price"
              type="number"
              min={0}
              step="0.01"
              defaultValue={item?.price ?? ""}
              className="input"
            />
          </div>
        </div>

        {state?.error && <p className="text-sm text-rose-700">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save item"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
