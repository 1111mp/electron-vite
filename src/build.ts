import { build as tsupBuild } from 'tsup'
import { InlineConfig, resolveConfig } from './config'

/**
 * Bundles the electron app for production.
 */
export async function build(inlineConfig: InlineConfig = {}): Promise<void> {
  process.env.NODE_ENV_ELECTRON_VITE = 'production'
  const config = await resolveConfig(inlineConfig, 'build', 'production')
  if (config.config) {
    const mainViteConfig = config.config?.main
    if (mainViteConfig) {
      if (mainViteConfig.watch) {
        mainViteConfig.watch = undefined
      }
      await tsupBuild(mainViteConfig)
    }
    const preloadViteConfig = config.config?.preload
    if (preloadViteConfig) {
      if (preloadViteConfig.watch) {
        preloadViteConfig.watch = undefined
      }
      await tsupBuild(preloadViteConfig)
    }
    const rendererViteConfig = config.config?.renderer
    if (rendererViteConfig && rendererViteConfig.build) {
      if (rendererViteConfig.build.watch) {
        rendererViteConfig.build.watch = undefined
      }
      await tsupBuild(rendererViteConfig.build)
    }
  }
}
