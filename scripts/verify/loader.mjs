// Node resolve hook: the app's source uses Vite-style extensionless relative
// imports, which plain Node ESM rejects. Retry failed relative resolutions
// with `.js` and `/index.js` appended so `node --import ./register.mjs` can run
// the compile/sample pipeline headlessly.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      for (const suffix of ['.js', '/index.js']) {
        try {
          return await nextResolve(specifier + suffix, context)
        } catch {
          // fall through to the original error
        }
      }
    }
    throw err
  }
}
