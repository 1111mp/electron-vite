import type { ChildProcess } from 'node:child_process'
import { type ViteDevServer, createServer as ViteCreateServer, createLogger } from 'vite'
import { build, type Options } from 'tsup'
import colors from 'picocolors'
import { type InlineConfig, resolveConfig } from './config'
import { resolveHostname } from './utils'
import { startElectron } from './electron'

export async function createServer(
  inlineConfig: InlineConfig = {},
  options: { rendererOnly?: boolean }
): Promise<void> {
  process.env.NODE_ENV_ELECTRON_VITE = 'development'
  const config = await resolveConfig(inlineConfig, 'serve', 'development')
  if (config.config) {
    const logger = createLogger(inlineConfig.logLevel)

    let server: ViteDevServer | undefined
    let ps: ChildProcess | undefined

    const errorHook = (e): void => {
      logger.error(`${colors.bgRed(colors.white(' ERROR '))} ${colors.red(e.message)}`)
    }

    const mainViteConfig = config.config?.main
    if (mainViteConfig && !options.rendererOnly) {
      const watchHook = (): void => {
        logger.info(colors.green(`\nrebuild the electron main process successfully`))

        if (ps) {
          logger.info(colors.cyan(`\n  waiting for electron to exit...`))

          ps.removeAllListeners()
          ps.kill()
          ps = startElectron(inlineConfig.root)

          logger.info(colors.green(`\nrestart electron app...`))
        }
      }

      await doBuild(mainViteConfig, watchHook, errorHook)

      logger.info(colors.green(`\nbuild the electron main process successfully`))
    }

    const preloadViteConfig = config.config?.preload
    if (preloadViteConfig && !options.rendererOnly) {
      logger.info(colors.gray(`\n-----\n`))

      const watchHook = (): void => {
        logger.info(colors.green(`\nrebuild the electron preload files successfully`))

        if (server) {
          logger.info(colors.cyan(`\n  trigger renderer reload`))

          server.ws.send({ type: 'full-reload' })
        }
      }

      await doBuild(preloadViteConfig, watchHook, errorHook)

      logger.info(colors.green(`\nbuild the electron preload files successfully`))
    }

    if (options.rendererOnly) {
      logger.warn(
        `\n${colors.yellow(colors.bold('warn'))}:${colors.yellow(
          ' you have skipped the main process and preload scripts building'
        )}`
      )
    }

    const rendererViteConfig = config.config?.renderer
    if (rendererViteConfig) {
      logger.info(colors.gray(`\n-----\n`))

      server = await ViteCreateServer({ ...rendererViteConfig, build: undefined })

      if (!server.httpServer) {
        throw new Error('HTTP server not available')
      }

      await server.listen()

      const conf = server.config.server

      const protocol = conf.https ? 'https:' : 'http:'
      const host = resolveHostname(conf.host)
      const port = conf.port
      process.env.ELECTRON_RENDERER_URL = `${protocol}//${host}:${port}`

      const slogger = server.config.logger

      slogger.info(colors.green(`dev server running for the electron renderer process at:\n`), {
        clear: !slogger.hasWarned && !options.rendererOnly
      })

      server.printUrls()
    }

    ps = startElectron(inlineConfig.root)

    logger.info(colors.green(`\nstart electron app...\n`))
  }
}

async function doBuild(options: Options, watchHook: () => void, errorHook: (e: Error) => void): Promise<void> {
  return new Promise(resolve => {
    if (options.watch) {
      let firstBundle = true
      const onSuccess = async (): Promise<void> => {
        if (firstBundle) {
          firstBundle = false
          resolve()
        } else {
          watchHook()
        }
      }

      options.onSuccess = onSuccess
    }

    build(options)
      .then(() => {
        if (!options.watch) {
          resolve()
        }
      })
      .catch(e => errorHook(e))
  })
}
