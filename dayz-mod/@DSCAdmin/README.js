/**
 * DSCAdmin — DayZ Server Mod
 *
 * This is a DayZ server-side mod that provides the game-side execution
 * layer for the DSC Sidecar command queue.
 *
 * Architecture:
 *   Sidecar writes {id}.cmd.json → DSC/commands/
 *   This mod reads them, executes in-game actions, writes {id}.res.json → DSC/responses/
 *   This mod also periodically writes player data → DSC/players.json
 *
 * Installation:
 *   1. Copy the @DSCAdmin folder to your DayZ server directory
 *   2. Add @DSCAdmin to your -mod= launch parameter
 *   3. The mod auto-creates the DSC/ data directory in your profiles folder
 *
 * Directory Structure:
 *   @DSCAdmin/
 *     mod.cpp              — Steam Workshop metadata
 *     Addons/
 *       dscadmin.pbo       — Packed addon (pack from scripts/ using AddonBuilder)
 *     Keys/
 *       dscadmin.bikey     — Public key for signature verification
 *
 * Source Structure (before PBO packing):
 *   scripts/
 *     config.cpp           — CfgPatches + CfgMods registration
 *     4_World/
 *       DSCAdmin/
 *         DSCCommandRunner.c      — Main scheduler: reads commands, dispatches
 *         DSCPlayerTracker.c      — Writes player session data periodically
 *         DSCEventLogger.c        — Logs kills/deaths/events to events.jsonl
 *         actions/
 *           DSCPlayerActions.c    — Heal, kill, teleport, spawn, strip, explode, kick
 *           DSCVehicleActions.c   — Delete, repair, refuel, unstuck, explode vehicles
 *           DSCWorldActions.c     — Time, weather, wipe AI/vehicles, spawn world items
 */

// This file is documentation only — the actual mod files are in the
// @DSCAdmin/ directory alongside this README.
