import path from 'node:path'
import fs from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import colors from 'picocolors'
import * as cheerio from 'cheerio'
import beautify from 'js-beautify'
import { getElectronNodeTarget, getElectronChromeTarget, supportESM, getElectronMajorVersion } from '../electron'
import { loadPackageData } from '../utils'

import { type Plugin, normalizePath } from 'vite'
import { type Options as TsupOptions } from 'tsup'
import { type Plugin as EsbuildPlugin } from 'esbuild'

type Plugins = NonNullable<TsupOptions['plugins']>

export interface ElectronPluginOptions {
  root?: string
}

function findInput(root: string, scope = 'renderer'): string {
  const rendererDir = path.resolve(root, 'src', scope, 'index.html')
  if (fs.existsSync(rendererDir)) {
    return rendererDir
  }
  return ''
}

export function electronMainTsupPlugin(_options?: ElectronPluginOptions): Plugins {
  return [
    {
      name: 'tsup:electron-main-preset-config',
      esbuildOptions(options): void {
        const root = _options?.root || process.cwd()
        options.absWorkingDir = root

        if (!options.target) {
          const nodeTarget = getElectronNodeTarget()
          options.target = nodeTarget
        }

        if (!options.format) {
          const pkg = loadPackageData() || { type: 'commonjs' }
          const format = pkg.type && pkg.type === 'module' && supportESM() ? 'esm' : 'cjs'
          options.format = format
        }

        options.bundle === void 0 && (options.bundle = true)
        const external = options.external || []
        options.external = external.concat(['electron', ...builtinModules.flatMap(m => [m, `node:${m}`])])
        const inject = options.inject || []
        options.inject = inject.concat(
          getElectronMajorVersion() >= 30
            ? ['electron-vite-tsup/cjs-shim-20_11.mjs']
            : ['electron-vite-tsup/cjs-shim.mjs']
        )
      }
    }
  ]
}

export function electronPreloadTsupPlugin(_options?: ElectronPluginOptions): Plugins {
  return [
    {
      name: 'tsup:electron-preload-preset-config',
      esbuildOptions(options): void {
        const root = _options?.root || process.cwd()
        options.absWorkingDir = root

        if (!options.target) {
          const nodeTarget = getElectronNodeTarget()
          options.target = nodeTarget
        }

        if (!options.format) {
          const pkg = loadPackageData() || { type: 'commonjs' }
          const format = pkg.type && pkg.type === 'module' && supportESM() ? 'esm' : 'cjs'
          options.format = format
        }

        options.bundle === void 0 && (options.bundle = true)
        const external = options.external || []
        options.external = external.concat(['electron', ...builtinModules.flatMap(m => [m, `node:${m}`])])

        if (options.format === 'esm') {
          const inject = options.inject || []
          options.inject = inject.concat(
            getElectronMajorVersion() >= 30
              ? ['electron-vite-tsup/cjs-shim-20_11.mjs']
              : ['electron-vite-tsup/cjs-shim.mjs']
          )
        }
      }
    }
  ]
}

export function electronRendererTsupPlugin(_options?: ElectronPluginOptions): Plugins {
  return [
    {
      name: 'tsup:electron-renderer-preset-config',
      esbuildOptions(options): void {
        const root = _options?.root || process.cwd()
        options.absWorkingDir = root
        options.jsx === void 0 && (options.jsx = 'automatic')
      }
    }
  ]
}

export function electronRendererEsbuildPlugin(_options?: ElectronPluginOptions): EsbuildPlugin[] {
  return [
    {
      name: 'esbuild:electron-renderer-generate-html',
      setup(build): void {
        build.onEnd(async result => {
          const { metafile } = result
          if (!metafile) return

          const { initialOptions } = build
          const outdir = initialOptions.outdir ? initialOptions.outdir : path.resolve(process.cwd(), 'out', 'renderer'),
            root = _options?.root || process.cwd(),
            htmlSource = path.resolve(_options?.root || './src/renderer', 'index.html'),
            entryPoints = (initialOptions.entryPoints as TsupOptions['entry']) || []

          let entrys: string[] = []

          if (Array.isArray(entryPoints)) {
            entrys = entryPoints
          } else {
            Object.entries(entryPoints).forEach(([, point]) => {
              entrys.push(point)
            })
          }

          const $ = cheerio.load(fs.readFileSync(htmlSource, 'utf-8'))

          $.root()
            .find(
              'script[src][type="module"], script[src]:not([type])[nomodule], script[src][type="text/javascript"][nomodule], script[src][type="application/javascript"][nomodule]'
            )
            .get()
            .filter(element => !$(element).attr('src') || path.isAbsolute($(element).attr('src')!))
            .forEach(element => $(element).remove())

          const { outputs } = metafile

          Object.entries(outputs).map(([outputFile, output]) => {
            if (outputFile.endsWith('.css')) {
              // add css link tag to html file
              const href = path.resolve(root, outputFile).replace(outdir, './assets')
              $('head').append(`<link rel="stylesheet" crossorigin href="${href}">`)
              return
            }

            if (!output.entryPoint) return

            if (!entrys?.includes(output.entryPoint)) return

            // add js script tag to html file
            const src = path.resolve(root, outputFile).replace(outdir, './assets')
            $('head').append(`<script type="module" crossorigin src="${src}"></script>`)
          })

          const html = path.resolve(outdir, '..')
          await mkdir(html, { recursive: true })
          await writeFile(path.resolve(html, 'index.html'), beautify.html($.html().replace(/\n\s*$/gm, '')))
        })
      }
    }
  ]
}

export function electronRendererVitePlugin(options?: ElectronPluginOptions): Plugin[] {
  return [
    {
      name: 'vite:electron-renderer-preset-config',
      enforce: 'pre',
      config(config): void {
        const root = options?.root || process.cwd()

        config.base =
          config.mode === 'production' || process.env.NODE_ENV_ELECTRON_VITE === 'production' ? './' : config.base
        config.root = config.root || './src/renderer'

        const chromeTarget = getElectronChromeTarget()

        const emptyOutDir = (): boolean => {
          let outDir = config.build?.outDir
          if (outDir) {
            if (!path.isAbsolute(outDir)) {
              outDir = path.resolve(root, outDir)
            }
            const resolvedRoot = normalizePath(path.resolve(root))
            return normalizePath(outDir).startsWith(resolvedRoot + '/')
          }
          return true
        }

        const buildConfig = {
          outDir: path.resolve(root, 'out', 'renderer'),
          target: chromeTarget,
          modulePreload: { polyfill: false },
          rollupOptions: {
            input: findInput(root)
          },
          reportCompressedSize: false,
          minify: false,
          emptyOutDir: emptyOutDir()
        }

        config.build = buildConfig

        config.envDir = config.envDir || path.resolve(root)

        config.envPrefix = config.envPrefix || ['RENDERER_VITE_', 'VITE_']
      }
    },
    {
      name: 'vite:electron-renderer-resolved-config',
      enforce: 'post',
      configResolved(config): void {
        if (config.base !== './' && config.base !== '/') {
          config.logger.warn(colors.yellow('(!) Should not set "base" option for the electron vite renderer config.'))
        }

        const build = config.build
        if (!build.target) {
          throw new Error('build.target option is required in the electron vite renderer config.')
        } else {
          const targets = Array.isArray(build.target) ? build.target : [build.target]
          if (targets.some(t => !t.startsWith('chrome') && !/^es((202\d{1})|next)$/.test(t))) {
            throw new Error('The electron vite renderer config build.target must be "chrome?" or "es?".')
          }
        }

        const rollupOptions = build.rollupOptions
        if (!rollupOptions.input) {
          config.logger.warn(colors.yellow(`index.html file is not found in ${colors.dim('/src/renderer')} directory.`))
          throw new Error('build.rollupOptions.input option is required in the electron vite renderer config.')
        }
      }
    }
  ]
}
