import { createRequire } from 'node:module'

globalThis.require = createRequire(import.meta.url)
globalThis.__filename = import.meta.filename
globalThis.__dirname = import.meta.dirname
