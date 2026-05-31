'use strict';

/**
 * DayZ engine auto-tuning.
 *
 * CF Architect detects the host CPU and writes the DayZ engine's job-system
 * sizing into dayzsetting.xml — which is a big part of why their servers perform
 * well out of the box. Citadel previously left this entirely manual. This module
 * computes a sensible job-system block from the host's logical core count and
 * writes it into the deployment's dayzsetting.xml, non-destructively.
 *
 * The patch is a targeted string replacement of just the <jobsystem> element, so
 * the rest of an existing dayzsetting.xml is preserved untouched. If the file or
 * the block is absent we create them. The block carries an explicit
 * "auto-adjusted by Citadel" comment so operators know it is managed.
 *
 * Per-server opt-out: set `engineAutoTune: false` on the server record.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./logger');

const TUNE_COMMENT = 'These values have been automatically adjusted by Citadel, please revise with care.';

/**
 * Compute job-system sizing for a given logical core count.
 * Mirrors the ratios CF uses: reserve half the cores, and size the queues at
 * 1024 entries per core (global) / per reserved core (thread).
 * @param {number} cores - logical CPU count (defaults to the host's)
 */
function computeJobSystem(cores = os.cpus().length) {
  const maxcores = Math.max(1, Math.min(cores | 0 || 1, 64)); // sane clamp
  const reservedcores = Math.max(1, Math.floor(maxcores / 2));
  const globalqueue = maxcores * 1024;
  const threadqueue = reservedcores * 1024;
  return { maxcores, reservedcores, globalqueue, threadqueue };
}

/** Render the <jobsystem> XML block for the given sizing. */
function renderJobSystemBlock(js, indent = '  ') {
  return (
    `${indent}<jobsystem globalqueue="${js.globalqueue}" threadqueue="${js.threadqueue}">\n` +
    `${indent}  <!--${TUNE_COMMENT}-->\n` +
    `${indent}  <pc maxcores="${js.maxcores}" reservedcores="${js.reservedcores}"></pc>\n` +
    `${indent}</jobsystem>`
  );
}

/**
 * Produce the new dayzsetting.xml content given the existing content (or null)
 * and a computed job-system block. Pure function — does no I/O — so it is easy
 * to test.
 * @returns {string} the new file content
 */
function patchDayzSetting(existing, js) {
  const block = renderJobSystemBlock(js);
  if (existing && existing.trim()) {
    if (/<jobsystem[\s\S]*?<\/jobsystem>/i.test(existing)) {
      // Replace the existing block in place, preserving its indentation.
      return existing.replace(/([^\S\r\n]*)<jobsystem[\s\S]*?<\/jobsystem>/i, (_m, lead) =>
        renderJobSystemBlock(js, lead || '  '));
    }
    if (/<\/setting>/i.test(existing)) {
      // Inject before the closing </setting>.
      return existing.replace(/<\/setting>/i, `${block}\n</setting>`);
    }
    // Unknown shape — append the block so it is at least present.
    return `${existing.trimEnd()}\n${block}\n`;
  }
  // No file yet — write a minimal, valid document.
  return `<?xml version="1.0"?>\n<setting>\n${block}\n</setting>\n`;
}

/**
 * Apply engine auto-tuning to a server's deployment.
 * Idempotent: if the file already contains the exact computed block, nothing is
 * written. Best-effort and never throws.
 *
 * @param {object} srv - server record (needs installDir; honors engineAutoTune)
 * @returns {{applied:boolean, reason?:string, jobSystem?:object}}
 */
function applyEngineTuning(srv) {
  if (!srv || !srv.installDir) return { applied: false, reason: 'no-install-dir' };
  if (srv.engineAutoTune === false) return { applied: false, reason: 'disabled' };

  const file = path.join(srv.installDir, 'dayzsetting.xml');
  const js = computeJobSystem();
  let existing = null;
  try { existing = fs.readFileSync(file, 'utf8'); } catch { /* no file yet */ }

  // Respect a manually-authored job-system block. If an existing <jobsystem>
  // exists and does NOT carry our managed marker comment, the operator tuned it
  // by hand — leave it alone rather than clobbering their values every start.
  if (existing && /<jobsystem[\s\S]*?<\/jobsystem>/i.test(existing) && !existing.includes(TUNE_COMMENT)) {
    return { applied: false, reason: 'manual-override', jobSystem: js };
  }

  const next = patchDayzSetting(existing, js);
  if (existing != null && next === existing) {
    return { applied: false, reason: 'unchanged', jobSystem: js };
  }
  try {
    fs.writeFileSync(file, next);
    logger.info({ serverId: srv.id, file, ...js }, 'engine-tuner: dayzsetting.xml job-system tuned');
    return { applied: true, jobSystem: js };
  } catch (err) {
    logger.warn({ err: err.message, file }, 'engine-tuner: failed to write dayzsetting.xml');
    return { applied: false, reason: err.message, jobSystem: js };
  }
}

module.exports = { computeJobSystem, renderJobSystemBlock, patchDayzSetting, applyEngineTuning };
