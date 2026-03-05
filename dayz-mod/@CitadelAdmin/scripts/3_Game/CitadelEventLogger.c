/**
 * CitadelEventLogger — Comprehensive game event logging to JSONL.
 *
 * Lives in 3_Game so it's available to all subsequent layers (4_World hooks,
 * 5_Mission connect/disconnect handlers) and to 3_Game callers like
 * CitadelCore.Exit() and CitadelFPSTracker.CheckFlush().
 *
 * ENFORCE SCRIPT CONSTRAINTS:
 *   - string.Format() cannot contain escaped quotes in the format string.
 *     JSON is built via string concatenation instead (matches GameLabs pattern).
 *   - string.Format() max 6 params (%1-%6).
 *   - Utility methods declared before callers for compile-order safety.
 *
 * Flush triggers:
 *   - Buffer reaches BATCH_SIZE (20 events)
 *   - FLUSH_INTERVAL (2s) elapsed — checked from DayZGame.OnUpdate()
 *   - CitadelCore.Exit() for graceful shutdown
 */
class CitadelEventLogger
{
    static const string EVENT_FILE = "$profile:Citadel/events.jsonl";

    static ref array<string> s_EventBuffer = new array<string>();
    static float s_LastFlushTime = 0;
    static const int BATCH_SIZE = 20;
    static const float FLUSH_INTERVAL = 2.0;

    // ─── Utility ─────────────────────────────────────────

    static string EscapeJson(string input)
    {
        string output = input;
        output.Replace("\"", "'");
        output.Replace("\n", " ");
        output.Replace("\r", " ");
        output.Replace("\t", " ");
        return output;
    }

    private static string GetTimestamp()
    {
        int h, mi, s, d, mo, y;
        GetHourMinuteSecondUTC(h, mi, s);
        GetYearMonthDayUTC(y, mo, d);
        return string.Format(
            "%1-%2-%3T%4:%5:%6Z",
            y.ToStringLen(4),
            mo.ToStringLen(2),
            d.ToStringLen(2),
            h.ToStringLen(2),
            mi.ToStringLen(2),
            s.ToStringLen(2),
        );
    }

    // ─── Buffer Management ──────────────────────────────

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

    static void CheckFlush()
    {
        if (s_EventBuffer.Count() == 0) return;

        float now = GetGame().GetTickTime();
        if ((now - s_LastFlushTime) >= FLUSH_INTERVAL)
        {
            FlushBuffer();
        }
    }

    protected static void AppendLine(string line)
    {
        s_EventBuffer.Insert(line);
        if (s_EventBuffer.Count() >= BATCH_SIZE)
        {
            FlushBuffer();
        }
    }

    // ─── JSON helpers (avoid \" inside string.Format) ────

    private static string JStr(string key, string val)
    {
        return "\"" + key + "\":\"" + val + "\"";
    }

    private static string JNum(string key, string val)
    {
        return "\"" + key + "\":" + val;
    }

    private static string JPos(vector pos)
    {
        return "\"position\":{\"x\":" + pos[0].ToString() + ",\"y\":" + pos[1].ToString() + ",\"z\":" + pos[2].ToString() + "}";
    }

    // ─── Player Events ──────────────────────────────────

    static void LogKill(string killerSteamId, string killerName, string victimSteamId, string victimName, float distance, string weapon)
    {
        string line = "{"
            + JStr("type", "kill") + ","
            + JStr("steamId", killerSteamId) + ","
            + JStr("name", EscapeJson(killerName)) + ","
            + JStr("victimSteamId", victimSteamId) + ","
            + JStr("victimName", EscapeJson(victimName)) + ","
            + JNum("distance", distance.ToString()) + ","
            + JStr("weapon", EscapeJson(weapon)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogSuicide(string steamId, string name)
    {
        string line = "{"
            + JStr("type", "suicide") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogDeath(string steamId, string name, string cause)
    {
        string line = "{"
            + JStr("type", "death") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("cause", EscapeJson(cause)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogConnect(string steamId, string name)
    {
        string line = "{"
            + JStr("type", "connect") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogDisconnect(string steamId, string name, int sessionSeconds)
    {
        string line = "{"
            + JStr("type", "playtime") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JNum("seconds", sessionSeconds.ToString()) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogChat(string steamId, string name, string message, string channel)
    {
        string line = "{"
            + JStr("type", "chat") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("message", EscapeJson(message)) + ","
            + JStr("channel", channel) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Combat Events ──────────────────────────────────

    static void LogHit(string victimSteamId, string victimName, string attackerSteamId, string attackerName, string weapon, string ammo, string zone, float damage)
    {
        string line = "{"
            + JStr("type", "hit") + ","
            + JStr("steamId", victimSteamId) + ","
            + JStr("name", EscapeJson(victimName)) + ","
            + JStr("attackerSteamId", attackerSteamId) + ","
            + JStr("attackerName", EscapeJson(attackerName)) + ","
            + JStr("weapon", EscapeJson(weapon)) + ","
            + JStr("ammo", EscapeJson(ammo)) + ","
            + JStr("zone", EscapeJson(zone)) + ","
            + JNum("damage", damage.ToString()) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Base Building Events ───────────────────────────

    static void LogBaseBuilt(string steamId, string className, vector pos)
    {
        string line = "{"
            + JStr("type", "baseBuilt") + ","
            + JStr("steamId", steamId) + ","
            + JStr("className", EscapeJson(className)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogBaseDestroyed(string ownerSteamId, string className, vector pos)
    {
        string line = "{"
            + JStr("type", "baseDestroyed") + ","
            + JStr("steamId", ownerSteamId) + ","
            + JStr("className", EscapeJson(className)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Dynamic World Events ───────────────────────────

    static void LogDynamicEvent(string action, string className, string displayName, vector pos)
    {
        string line = "{"
            + JStr("type", "dynamicEvent") + ","
            + JStr("action", action) + ","
            + JStr("className", EscapeJson(className)) + ","
            + JStr("displayName", EscapeJson(displayName)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Anti-Cheat Events ──────────────────────────────

    static void LogSpeedFlag(string steamId, string name, float speed, vector pos, int triggerCount)
    {
        string line = "{"
            + JStr("type", "speedFlag") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JNum("speed", speed.ToString()) + ","
            + JNum("triggers", triggerCount.ToString()) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Session Statistics ─────────────────────────────

    static void LogSession(string steamId, string name, int durationSeconds, string statsJson)
    {
        string line = "{"
            + JStr("type", "session") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JNum("duration", durationSeconds.ToString()) + ","
            + "\"stats\":" + statsJson + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Vehicle Events ─────────────────────────────────

    static void LogVehicleEnter(string steamId, string name, string vehicleType, vector pos)
    {
        string line = "{"
            + JStr("type", "vehicleEnter") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("vehicleType", EscapeJson(vehicleType)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    static void LogVehicleExit(string steamId, string name, string vehicleType, vector pos)
    {
        string line = "{"
            + JStr("type", "vehicleExit") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("vehicleType", EscapeJson(vehicleType)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Admin Action Audit ─────────────────────────────

    static void LogAdminAction(string adminName, string action, string target, string details)
    {
        string line = "{"
            + JStr("type", "adminAction") + ","
            + JStr("admin", EscapeJson(adminName)) + ","
            + JStr("action", EscapeJson(action)) + ","
            + JStr("target", EscapeJson(target)) + ","
            + JStr("details", EscapeJson(details)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Respawn Event ──────────────────────────────────

    static void LogRespawn(string steamId, string name, vector pos)
    {
        string line = "{"
            + JStr("type", "respawn") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JPos(pos) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }

    // ─── Disconnect Event ───────────────────────────────

    static void LogPlayerDisconnect(string steamId, string name)
    {
        string line = "{"
            + JStr("type", "disconnect") + ","
            + JStr("steamId", steamId) + ","
            + JStr("name", EscapeJson(name)) + ","
            + JStr("timestamp", GetTimestamp())
            + "}";
        AppendLine(line);
    }
};
