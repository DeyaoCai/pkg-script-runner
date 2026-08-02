export {
  BRAND_PRESET_PROD,
  BRAND_PRESET_TEST,
  LEGACY_BRAND_PRESET_PROD,
  applyBrandColorToRoot,
  brandColorForTone,
  brandToneFromColor,
  normalizeBrandColor,
  type BrandTone,
  type StyleRoot,
} from './brand.js';

export {
  applyBrandColor,
  applyColorEnv,
  applyGlass,
  applyTheme,
  bootDocumentTheme,
  readCssVar,
  readTone,
  type BootThemeOptions,
  type ColorEnv,
  type DocumentRoot,
  type UiTheme,
} from './theme.js';
