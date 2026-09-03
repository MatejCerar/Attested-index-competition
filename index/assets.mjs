// RWA-only board: there are no fixed crypto symbols. The selectable universe is
// the RWA catalog (see catalog.mjs). ASSETS stays exported as an empty list so
// any legacy importer keeps working but can never select crypto.
export const ASSETS = [];

export const isAsset = (s) => ASSETS.includes(s);
