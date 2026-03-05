/**
 * CitadelEventLogger — Comprehensive game event logging to JSONL.
 *
 * Lives in 3_Game so it's available to all subsequent layers (4_World hooks,
 * 5_Mission connect/disconnect handlers) and to 3_Game callers like
 * CitadelCore.Exit() and CitadelFPSTracker.CheckFlush().
 *
 * PERFORMANCE: Two major optimizations vs. original:
 *   1. BATCHED I/O — Events buffer in memory and flush together
 *      (one file open/close per batch, not per event)
 *   2. string.Format() — Each log method builds JSON in 1-2 calls
 *      instead of 8-15 string concatenations (Enforce strings are immutable,
 *      each += allocates a new string on the heap)
 *
 * Flush triggers:
 *   - Buffer reaches BATCH_SIZE (20 events)
 *   - FLUSH_INTERVAL (2s) elapsed — checked from DayZGame.OnUpdate()
 *   - CitadelCore.Exit() for graceful shutdown
 *
 * NOTE: Utility methods (EscapeJson, GetTimestamp, AppendLine, FlushBuffer,
 * CheckFlush) are declared BEFORE Log* methods because the Enforce Script
 * compiler resolves method calls top-to-bottom within a class.
 *
 * Event types:
 *   kill, suicide, death, connect, playtime, chat,
 *   hit, baseBuilt, baseDestroyed, dynamicEvent,
 *   speedFlag, session, vehicleEnter, vehicleExit
 */
class CitadelEventLogger
{
    static const string EVENT_FILE = "$profile:Citadel/events.jsonl";

    // ─── Write Buffer ────────────────────────────────────
    static ref array<string> s_EventBuffer = new array<string>();
    static float s_LastFlushTime = 0;
    static const int BATCH_SIZE = 20;
    static const float FLUSH_INTERVAL = 2.0;

    // ─── Utility (must be above Log* methods for compile order) ───

    static string EscapeJson(string input)
    {
        string output = input;
        output.Replace("\"", "'");
        output.Replace("\n", " ");
        output.Replace("\r", " ");
        output.Replace("\t", " ");
        return output;
    }

    // ─── Timestamp (self-contained, no dependency on CitadelLogger) ───

    private static string GetTimestamp()
    {
        int h, mi, s, d, mo, y;
        GetHourMinuteSecondUTC(h, mi, s);
        GetYearMonthDayUTC(y, mo, d);
        return string.Format("%1-%2-%3T%4:%5:%6Z", y.ToStringLen(4), mo.ToStringLen(2), d.ToStringLen(2), h.ToStringLen(2), mi.ToStringLen(2), s.ToStringLen(2));
    }

    // ─── Buffer Management ──────────────────────────────

    /**
     * Write all buffered events to disk in a single file open/close.
     * Called from CheckFlush(), AppendLine() overflow, and CitadelCore.Exit().
     */
    static void FlushBuffer()
    {
        if (s_EventBuffer.Count() == 0) return;

        FileHandle file = OpenFile(EVENT_FILE, FileMode.APPEND);
        if (file != 0)
        {
            for (int i = 0; i < s_EventBuffer.Count(); i++)
            {
                FPrintln(file, s_EventBuffer.Get(i));
            }
            CloseFile(file);
        }
        s_EventBuffer.Clear();
        s_LastFlushTime = GetGame().GetTickTime();
    }

    /**
     * Called from DayZGame.OnUpdate() every server tick.
     * Flushes buffered events if FLUSH_INTERVAL has elapsed.
     * Cost: one float comparison per frame (~zero overhead).
     */
    static void CheckFlush()
    {
        if (s_EventBuffer.Count() == 0) return;

        float now = GetGame().GetTickTime();
        if ((now - s_LastFlushTime) >= FLUSH_INTERVAL)
        {
            FlushBuffer();
        }
    }

    /**
     * Add a JSON line to the write buffer.
     * Auto-flushes when buffer is full.
     */
    protected static void AppendLine(string line)
    {
        s_EventBuffer.Insert(line);

        // Flush immediately if buffer is full
        if (s_EventBuffer.Count() >= BATCH_SIZE)
        {
            FlushBuffer();
        }
    }

    // ─── Player Events ────────────────────────────────

    static void LogKill(string killerSteamId, string killerName, string victimSteamId, string victimName, float distance, string weapon)
    {
        AppendLine(string.Format(
            "{\"type\":\"kill\",\"steamId\":\"%1\",\"name\":\"%2\",\"victimSteamId\":\"%3\",\"victimName\":\"%4\",\"distance\":%5,\"weapon\":\"%6\",\"timestamp\":\"%7\"}",
            killerSteamId, EscapeJson(killerName), victimSteamId, EscapeJson(victimName),
            distance.ToString(), EscapeJson(weapon), GetTimestamp()
        ));
    }

    static void LogSuicide(string steamId, string name)
    {
        AppendLine(string.Format(
            "{\"type\":\"suicide\",\"steamId\":\"%1\",\"name\":\"%2\",\"timestamp\":\"%3\"}",
            steamId, EscapeJson(name), GetTimestamp()
        ));
    }

    static void LogDeath(string steamId, string name, string cause)
    {
        AppendLine(string.Format(
            "{\"type\":\"death\",\"steamId\":\"%1\",\"name\":\"%2\",\"cause\":\"%3\",\"timestamp\":\"%4\"}",
            steamId, EscapeJson(name), EscapeJson(cause), GetTimestamp()
        ));
    }

    static void LogConnect(string steamId, string name)
    {
        AppendLine(string.Format(
            "{\"type\":\"connect\",\"steamId\":\"%1\",\"name\":\"%2\",\"timestamp\":\"%3\"}",
            steamId, EscapeJson(name), GetTimestamp()
        ));
    }

    static void LogDisconnect(string steamId, string name, int sessionSeconds)
    {
        AppendLine(string.Format(
            "{\"type\":\"playtime\",\"steamId\":\"%1\",\"name\":\"%2\",\"seconds\":%3,\"timestamp\":\"%4\"}",
            steamId, EscapeJson(name), sessionSeconds.ToString(), GetTimestamp()
        ));
    }

    static void LogChat(string steamId, string name, string message, string channel)
    {
        AppendLine(string.Format(
            "{\"type\":\"chat\",\"steamId\":\"%1\",\"name\":\"%2\",\"message\":\"%3\",\"channel\":\"%4\",\"timestamp\":\"%5\"}",
            steamId, EscapeJson(name), EscapeJson(message), channel, GetTimestamp()
        ));
    }

    // ─── Combat Events ────────────────────────────────

    static void LogHit(string victimSteamId, string victimName, string attackerSteamId, string attackerName, string weapon, string ammo, string zone, float damage)
    {
        // Split into two Format calls — LogHit has 10 fields, exceeds 9-param limit
        string front = string.Format(
            "{\"type\":\"hit\",\"steamId\":\"%1\",\"name\":\"%2\",\"attackerSteamId\":\"%3\",\"attackerName\":\"%4\",\"weapon\":\"%5\",",
            victimSteamId, EscapeJson(victimName), attackerSteamId, EscapeJson(attackerName), EscapeJson(weapon)
        );
        AppendLine(front + string.Format(
            "\"ammo\":\"%1\",\"zone\":\"%2\",\"damage\":%3,\"timestamp\":\"%4\"}",
            EscapeJson(ammo), EscapeJson(zone), damage.ToString(), GetTimestamp()
        ));
    }

    // ─── Base Building Events ─────────────────────────

    static void LogBaseBuilt(string steamId, string className, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"baseBuilt\",\"steamId\":\"%1\",\"className\":\"%2\",\"position\":{\"x\":%3,\"y\":%4,\"z\":%5},\"timestamp\":\"%6\"}",
            steamId, EscapeJson(className), pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    static void LogBaseDestroyed(string ownerSteamId, string className, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"baseDestroyed\",\"steamId\":\"%1\",\"className\":\"%2\",\"position\":{\"x\":%3,\"y\":%4,\"z\":%5},\"timestamp\":\"%6\"}",
            ownerSteamId, EscapeJson(className), pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    // ─── Dynamic World Events ─────────────────────────

    static void LogDynamicEvent(string action, string className, string displayName, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"dynamicEvent\",\"action\":\"%1\",\"className\":\"%2\",\"displayName\":\"%3\",\"position\":{\"x\":%4,\"y\":%5,\"z\":%6},\"timestamp\":\"%7\"}",
            action, EscapeJson(className), EscapeJson(displayName),
            pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    // ─── Anti-Cheat Events ────────────────────────────

    static void LogSpeedFlag(string steamId, string name, float speed, vector pos, int triggerCount)
    {
        AppendLine(string.Format(
            "{\"type\":\"speedFlag\",\"steamId\":\"%1\",\"name\":\"%2\",\"speed\":%3,\"triggers\":%4,\"position\":{\"x\":%5,\"y\":%6,\"z\":%7},\"timestamp\":\"%8\"}",
            steamId, EscapeJson(name), speed.ToString(), triggerCount.ToString(),
            pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    // ─── Session Statistics ───────────────────────────

    static void LogSession(string steamId, string name, int durationSeconds, string statsJson)
    {
        AppendLine(string.Format(
            "{\"type\":\"session\",\"steamId\":\"%1\",\"name\":\"%2\",\"duration\":%3,\"stats\":%4,\"timestamp\":\"%5\"}",
            steamId, EscapeJson(name), durationSeconds.ToString(), statsJson, GetTimestamp()
        ));
    }

    // ─── Vehicle Events ───────────────────────────────

    static void LogVehicleEnter(string steamId, string name, string vehicleType, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"vehicleEnter\",\"steamId\":\"%1\",\"name\":\"%2\",\"vehicleType\":\"%3\",\"position\":{\"x\":%4,\"y\":%5,\"z\":%6},\"timestamp\":\"%7\"}",
            steamId, EscapeJson(name), EscapeJson(vehicleType),
            pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    static void LogVehicleExit(string steamId, string name, string vehicleType, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"vehicleExit\",\"steamId\":\"%1\",\"name\":\"%2\",\"vehicleType\":\"%3\",\"position\":{\"x\":%4,\"y\":%5,\"z\":%6},\"timestamp\":\"%7\"}",
            steamId, EscapeJson(name), EscapeJson(vehicleType),
            pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    // ─── Admin Action Audit ──────────────────────────

    static void LogAdminAction(string adminName, string action, string target, string details)
    {
        AppendLine(string.Format(
            "{\"type\":\"adminAction\",\"admin\":\"%1\",\"action\":\"%2\",\"target\":\"%3\",\"details\":\"%4\",\"timestamp\":\"%5\"}",
            EscapeJson(adminName), EscapeJson(action), EscapeJson(target), EscapeJson(details), GetTimestamp()
        ));
    }

    // ─── Respawn Event ──────────────────────────────

    static void LogRespawn(string steamId, string name, vector pos)
    {
        AppendLine(string.Format(
            "{\"type\":\"respawn\",\"steamId\":\"%1\",\"name\":\"%2\",\"position\":{\"x\":%3,\"y\":%4,\"z\":%5},\"timestamp\":\"%6\"}",
            steamId, EscapeJson(name), pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetTimestamp()
        ));
    }

    // ─── Disconnect Event ───────────────────────────

    static void LogPlayerDisconnect(string steamId, string name)
    {
        AppendLine(string.Format(
            "{\"type\":\"disconnect\",\"steamId\":\"%1\",\"name\":\"%2\",\"timestamp\":\"%3\"}",
            steamId, EscapeJson(name), GetTimestamp()
        ));
    }
};
