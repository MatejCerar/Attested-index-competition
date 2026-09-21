// Local node --test helper. The extension sources use scaffold-form "./x.js"
// specifiers (node's type stripping does not fall back to .ts), so map a
// missing relative .js import to its .ts sibling. Import this BEFORE
// dynamically importing any extension module. Inert if copied into the
// scaffold, where compiled .js files resolve first.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        return next(specifier.slice(0, -3) + ".ts", context);
      }
      throw e;
    }
  },
});
