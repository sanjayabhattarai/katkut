const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Copies DEVELOPMENT_TEAM, CODE_SIGN_STYLE, and CODE_SIGN_ENTITLEMENTS from the Release build
 * configuration onto every other configuration (Debug, etc.) after every prebuild.
 *
 * Why this exists: two confirmed, independent cases this session where Xcode/Expo only configure
 * the Release build configuration and leave Debug stale:
 *   1. @expo/config-plugins' entitlements base mod resolves its write target via
 *      Entitlements.getEntitlementsPath(), which defaults to buildConfiguration: 'Release' and is
 *      never called with 'Debug' — so any entitlement (Sign in with Apple, etc.) added by a config
 *      plugin only lands in Release's entitlements file, leaving Debug's empty.
 *   2. Xcode's own Signing & Capabilities editor, when selecting a Team, was observed writing
 *      DEVELOPMENT_TEAM only into whichever build configuration was "active" at the time (Release,
 *      in practice) — leaving Debug with no team at all ("Signing requires a development team"),
 *      even though the Team dropdown visibly showed the correct selection.
 * Debug is what a normal Xcode Cmd+R / device run builds, so either gap silently breaks local
 * testing while Release/TestFlight builds work fine — the two look identical from the Signing &
 * Capabilities UI, which is what made both confusing to diagnose. Syncing from Release onto every
 * other configuration on every prebuild means this class of drift can't recur, regardless of
 * whether the next cause is a config plugin default or another Xcode UI quirk.
 */
const SYNCED_KEYS = ['DEVELOPMENT_TEAM', 'CODE_SIGN_STYLE', 'CODE_SIGN_ENTITLEMENTS'];

const withUnifiedIosSigning = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    const releaseValues = {};
    for (const key in configurations) {
      const entry = configurations[key];
      if (entry?.buildSettings?.CODE_SIGN_ENTITLEMENTS && entry.name === 'Release') {
        for (const settingKey of SYNCED_KEYS) {
          if (entry.buildSettings[settingKey] !== undefined) {
            releaseValues[settingKey] = entry.buildSettings[settingKey];
          }
        }
      }
    }

    if (Object.keys(releaseValues).length === 0) {
      console.warn('[withUnifiedIosSigning] No Release build configuration found — skipping (project template may have changed).');
      return config;
    }

    for (const key in configurations) {
      const entry = configurations[key];
      if (entry?.buildSettings?.CODE_SIGN_ENTITLEMENTS && entry.name !== 'Release') {
        for (const settingKey of SYNCED_KEYS) {
          if (releaseValues[settingKey] !== undefined) {
            entry.buildSettings[settingKey] = releaseValues[settingKey];
          }
        }
      }
    }

    return config;
  });
};

module.exports = withUnifiedIosSigning;
