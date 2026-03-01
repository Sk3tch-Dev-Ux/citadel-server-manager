/**
 * CitadelAdmin — DayZ Server Mod
 *
 * This is a DayZ server-side mod that provides the game-side execution
 * layer for the Citadel Sidecar command queue.
 *
 * Architecture:
 *   Sidecar writes {id}.cmd.json → Citadel/commands/
 *   This mod reads them, executes in-game actions, writes {id}.res.json → Citadel/responses/
 *   This mod also periodically writes player data → Citadel/players.json
 *
 * Installation:
 *   1. Copy the @CitadelAdmin folder to your DayZ server directory
 *   2. Add @CitadelAdmin to your -mod= launch parameter
 *   3. The mod auto-creates the Citadel/ data directory in your profiles folder
 *
 * Directory Structure:
 *   @CitadelAdmin/
 *     mod.cpp              — Steam Workshop metadata
 *     Addons/
 *       citadeladmin.pbo   — Packed addon (pack from scripts/ using AddonBuilder)
 *     Keys/
 *       citadeladmin.bikey — Public key for signature verification
 *
 * Source Structure (before PBO packing):
 *   scripts/
 *     config.cpp           — CfgPatches + CfgMods registration
 *     4_World/
 *       CitadelAdmin/
 *         CitadelCommandRunner.c      — Main scheduler: reads commands, dispatches
 *         CitadelPlayerTracker.c      — Writes player session data periodically
 *         CitadelEventLogger.c        — Logs kills/deaths/events to events.jsonl
 *         actions/
 *           CitadelPlayerActions.c    — Heal, kill, teleport, spawn, strip, explode, kick
 *           CitadelVehicleActions.c   — Delete, repair, refuel, unstuck, explode vehicles
 *           CitadelWorldActions.c     — Time, weather, wipe AI/vehicles, spawn world items
 */

// This file is documentation only — the actual mod files are in the
// @CitadelAdmin/ directory alongside this README.
