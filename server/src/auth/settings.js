import { HttpError } from '../errors.js';
import { isKnownSetting, isValidSetting } from '../../../shared/settings.js';

export { SETTING_TYPES } from '../../../shared/settings.js';

/**
 * Validate settings sent by the client. Every key is optional, unknown keys are rejected.
 * @param {unknown} settings
 * @returns {Object} The settings, unchanged
 */
export function parseSettings(settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new HttpError(400, 'VALIDATION', 'settings must be an object');
  }
  for (const [key, value] of Object.entries(settings)) {
    if (!isKnownSetting(key)) throw new HttpError(400, 'VALIDATION', `Unknown setting: ${key.slice(0, 64)}`);
    if (!isValidSetting(key, value)) throw new HttpError(400, 'VALIDATION', `Invalid value for ${key}`);
  }
  return settings;
}
