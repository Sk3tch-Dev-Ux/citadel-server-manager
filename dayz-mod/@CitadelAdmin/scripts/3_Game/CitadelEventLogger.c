/**
 * CitadelEventLogger — Comprehensive game event logging to JSONL.
 *
 * Lives in 3_Game so it's available to all subsequent layers (4_World hooks,
 * 5_Mission connect/disconnect handlers) and to 3_Game callers like
 * CitadelCore.Exit() and CitadelFPSTracker.CheckFlush().
 *
 * ENFORCE SCRIPT CONSTRAINTS:
 *   - string.Format() cannot contain escaped quotes in the format string.
 *   - string.Format() max 6 params (%1-%6).
 *   - Multi-line expressions only work inside parentheses (e.g. function calls).
 *     String concatenation across lines requires separate += statements.
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

    // ─── JSON helpers ───────────────────────────────────

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
        string l = "{" + JStr("type", "kill");
        l += "," + JStr("steamId", killerSteamId);
        l += "," + JStr("name", EscapeJson(killerName));
        l += "," + JStr("victimSteamId", victimSteamId);
        l += "," + JStr("victimName", EscapeJson(victimName));
        l += "," + JNum("distance", distance.ToString());
        l += "," + JStr("weapon", EscapeJson(weapon));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogSuicide(string steamId, string name)
    {
        string l = "{" + JStr("type", "suicide");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogDeath(string steamId, string name, string cause)
    {
        string l = "{" + JStr("type", "death");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("cause", EscapeJson(cause));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogConnect(string steamId, string name)
    {
        string l = "{" + JStr("type", "connect");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogDisconnect(string steamId, string name, int sessionSeconds)
    {
        string l = "{" + JStr("type", "playtime");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JNum("seconds", sessionSeconds.ToString());
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogChat(string steamId, string name, string message, string channel)
    {
        string l = "{" + JStr("type", "chat");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("message", EscapeJson(message));
        l += "," + JStr("channel", channel);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Combat Events ──────────────────────────────────

    static void LogHit(string victimSteamId, string victimName, string attackerSteamId, string attackerName, string weapon, string ammo, string zone, float damage)
    {
        string l = "{" + JStr("type", "hit");
        l += "," + JStr("steamId", victimSteamId);
        l += "," + JStr("name", EscapeJson(victimName));
        l += "," + JStr("attackerSteamId", attackerSteamId);
        l += "," + JStr("attackerName", EscapeJson(attackerName));
        l += "," + JStr("weapon", EscapeJson(weapon));
        l += "," + JStr("ammo", EscapeJson(ammo));
        l += "," + JStr("zone", EscapeJson(zone));
        l += "," + JNum("damage", damage.ToString());
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Base Building Events ───────────────────────────

    static void LogBaseBuilt(string steamId, string className, vector pos)
    {
        string l = "{" + JStr("type", "baseBuilt");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("className", EscapeJson(className));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogBaseDestroyed(string ownerSteamId, string className, vector pos)
    {
        string l = "{" + JStr("type", "baseDestroyed");
        l += "," + JStr("steamId", ownerSteamId);
        l += "," + JStr("className", EscapeJson(className));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Dynamic World Events ───────────────────────────

    static void LogDynamicEvent(string action, string className, string displayName, vector pos)
    {
        string l = "{" + JStr("type", "dynamicEvent");
        l += "," + JStr("action", action);
        l += "," + JStr("className", EscapeJson(className));
        l += "," + JStr("displayName", EscapeJson(displayName));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Anti-Cheat Events ──────────────────────────────

    static void LogSpeedFlag(string steamId, string name, float speed, vector pos, int triggerCount)
    {
        string l = "{" + JStr("type", "speedFlag");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JNum("speed", speed.ToString());
        l += "," + JNum("triggers", triggerCount.ToString());
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Session Statistics ─────────────────────────────

    static void LogSession(string steamId, string name, int durationSeconds, string statsJson)
    {
        string l = "{" + JStr("type", "session");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JNum("duration", durationSeconds.ToString());
        l += ",\"stats\":" + statsJson;
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Vehicle Events ─────────────────────────────────

    static void LogVehicleEnter(string steamId, string name, string vehicleType, vector pos)
    {
        string l = "{" + JStr("type", "vehicleEnter");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("vehicleType", EscapeJson(vehicleType));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    static void LogVehicleExit(string steamId, string name, string vehicleType, vector pos)
    {
        string l = "{" + JStr("type", "vehicleExit");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("vehicleType", EscapeJson(vehicleType));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Admin Action Audit ─────────────────────────────

    static void LogAdminAction(string adminName, string action, string target, string details)
    {
        string l = "{" + JStr("type", "adminAction");
        l += "," + JStr("admin", EscapeJson(adminName));
        l += "," + JStr("action", EscapeJson(action));
        l += "," + JStr("target", EscapeJson(target));
        l += "," + JStr("details", EscapeJson(details));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Respawn Event ──────────────────────────────────

    static void LogRespawn(string steamId, string name, vector pos)
    {
        string l = "{" + JStr("type", "respawn");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JPos(pos);
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }

    // ─── Disconnect Event ───────────────────────────────

    static void LogPlayerDisconnect(string steamId, string name)
    {
        string l = "{" + JStr("type", "disconnect");
        l += "," + JStr("steamId", steamId);
        l += "," + JStr("name", EscapeJson(name));
        l += "," + JStr("timestamp", GetTimestamp()) + "}";
        AppendLine(l);
    }
};
