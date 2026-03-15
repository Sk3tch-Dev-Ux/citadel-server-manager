/**
 * Input sanitization for Discord bot inputs.
 */

/** Escape Discord markdown characters and mention syntax in text */
function escapeMarkdown(text) {
  if (typeof text !== 'string') return String(text || '');
  return text
    .replace(/([*_~`|\\>[\]])/g, '\\$1')  // Markdown chars + brackets
    .replace(/@(everyone|here)/gi, '@\u200B$1')  // Block @everyone/@here
    .replace(/<(@[!&]?|#)\d+>/g, '');  // Strip <@userId>, <@!userId>, <@&roleId>, <#channelId>
}

/** Sanitize broadcast messages: strip control chars, limit length */
function sanitizeBroadcast(message) {
  if (typeof message !== 'string') return '';
  let clean = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return clean.slice(0, 256);
}

/** Validate Steam64 ID format (17-digit numeric starting with 7656119) */
function isValidSteam64(id) {
  return typeof id === 'string' && /^7656119\d{10}$/.test(id);
}

/** Validate coordinate is a finite number */
function isValidCoordinate(val) {
  const num = parseFloat(val);
  return !isNaN(num) && isFinite(num);
}

/** Validate workshop ID (numeric string) */
function isValidWorkshopId(id) {
  return typeof id === 'string' && /^\d{1,15}$/.test(id);
}

module.exports = { escapeMarkdown, sanitizeBroadcast, isValidSteam64, isValidCoordinate, isValidWorkshopId };
