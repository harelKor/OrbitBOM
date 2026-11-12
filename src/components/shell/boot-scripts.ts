// The scripts the root layout puts in <head> so a saved shade, card size and colour apply before
// the page paints. They live outside the "use client" sliders: a server component importing a
// string from a client module gets a client reference, not the string.
export const SHADE_KEY = "orbit-shade";
export const APPEARANCE_KEY = "orbit-appearance";
export const DEFAULT_HUE = 264; // Orbit blue, #0000cc

// Runs before the page paints so a saved shade never flashes. A theme saved by the old light /
// dark button becomes the matching end of the slider.
export const SHADE_SCRIPT = `try{var r=document.documentElement,s=localStorage.getItem("${SHADE_KEY}"),t=localStorage.getItem("orbit-theme");if(s==null&&(t==="light"||t==="dark"))s=t==="dark"?"100":"0";if(s!=null){r.dataset.shade=s;r.dataset.theme=Number(s)>=50?"dark":"light";r.style.setProperty("--shade",s+"%")}}catch(e){}`;

// Runs before the page paints, next to the theme script, so the saved size and colour never flash.
export const APPEARANCE_SCRIPT = `try{var a=JSON.parse(localStorage.getItem("${APPEARANCE_KEY}")||"null");if(a){var r=document.documentElement;if(a.scale)r.style.setProperty("--card-scale",a.scale);if(a.text&&a.text!==1)r.style.setProperty("--card-text",a.text);if(a.hue!=null&&a.hue!==${DEFAULT_HUE}){r.dataset.hue="";r.style.setProperty("--hue",a.hue)}}}catch(e){}`;

// Small PC screens (a 1280px-wide window, often a laptop at 150% scaling) shrink the whole app so
// it looks like it does on a 1700px one, not cropped or oversized (Harel, 2026-11-12): the root
// font size goes down with the window's width, to 75% at most, and --ui carries the same factor
// for the few sizes kept in px (card widths, the side columns). Phones and tablets (touch) and
// windows 1696px or wider stay at 100%. Runs before the page paints and again on every resize.
export const UI_SCALE_MIN_WIDTH = 1696;
export const UI_SCALE_SCRIPT = `try{(function(){var r=document.documentElement,f=matchMedia("(pointer: fine)"),u=function(){var w=innerWidth,s=f.matches&&w>=1024?Math.min(1,Math.max(.75,w/${UI_SCALE_MIN_WIDTH})):1;r.style.fontSize=s<1?16*s+"px":"";r.style.setProperty("--ui",String(s))};u();addEventListener("resize",u);f.addEventListener("change",u)})()}catch(e){}`;

// The factor UI_SCALE_SCRIPT set: px measured on screen ÷ uiScale() = px as the app thinks of them.
export function uiScale() {
  if (typeof document === "undefined") return 1;
  return parseFloat(document.documentElement.style.getPropertyValue("--ui")) || 1;
}
