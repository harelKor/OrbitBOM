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
export const APPEARANCE_SCRIPT = `try{var a=JSON.parse(localStorage.getItem("${APPEARANCE_KEY}")||"null");if(a){var r=document.documentElement;if(a.scale)r.style.setProperty("--card-scale",a.scale);if(a.hue!=null&&a.hue!==${DEFAULT_HUE}){r.dataset.hue="";r.style.setProperty("--hue",a.hue)}}}catch(e){}`;
