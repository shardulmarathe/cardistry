// Entry for `node --import ./scripts/verify/register.mjs <script>` — installs
// the resolve hook that lets Node load the app's Vite-style extensionless
// ESM imports (e.g. `import ... from '../engine/layouts'`).
import { register } from 'node:module'

register(new URL('./loader.mjs', import.meta.url))
