/**
 * CitadelBanManager — server-side ban list with kick-on-connect enforcement.
 *
 * This closes a previously half-built loop: CitadelMissionServer.InvokeOnConnect
 * and CitadelPlayerActions (ban/unban/getBans) already call GetCitadelBanManager(),
 * but the manager itself was never defined. It is now.
 *
 * Source of truth is $profile:Citadel/bans.json, which the Citadel Agent writes
 * (the union of local + Trust-Network community bans, with reasons). The mod
 * loads it on mission init and enforces it before a banned player is registered,
 * showing the ban reason. In-game admin bans (AddBan/RemoveBan) update the list
 * and persist immediately so they survive a restart even before the next agent
 * sync.
 *
 * File shape (matches the agent writer):
 *   { "bans": [ { "player_id": "765...", "player_name": "...",
 *                 "reason": "...", "banned_at": "2026-05-29 12:00:00" } ] }
 *
 * Mirrors the JsonFileLoader pattern used by CitadelServerConfig /
 * CitadelMapMarkerManager.
 */

// ─── Data Classes (for JsonFileLoader) ───────────────────

class CitadelBanEntry
{
    string player_id = "";
    string player_name = "";
    string reason = "";
    string banned_at = "";
}

class CitadelBanFile
{
    ref array<ref CitadelBanEntry> bans;
}

// ─── Manager Singleton ───────────────────────────────────

class CitadelBanManager
{
    private static const string BANS_PATH = "$profile:Citadel/bans.json";

    // Authoritative ordered list (for GetAllBans / persistence) plus a lookup
    // map keyed by SteamID for O(1) connect checks.
    private ref array<ref CitadelBanEntry> m_Bans;
    private ref map<string, ref CitadelBanEntry> m_ById;

    void CitadelBanManager()
    {
        m_Bans = new array<ref CitadelBanEntry>;
        m_ById = new map<string, ref CitadelBanEntry>;
    }

    // ─── Loading ─────────────────────────────────────────

    void LoadBans()
    {
        m_Bans.Clear();
        m_ById.Clear();

        if (!FileExist(BANS_PATH))
        {
            Print("[Citadel] No bans.json found — ban list empty");
            return;
        }

        CitadelBanFile file = new CitadelBanFile();
        JsonFileLoader<CitadelBanFile>.JsonLoadFile(BANS_PATH, file);

        if (file.bans)
        {
            for (int i = 0; i < file.bans.Count(); i++)
            {
                CitadelBanEntry entry = file.bans.Get(i);
                if (entry && entry.player_id != "")
                {
                    m_Bans.Insert(entry);
                    m_ById.Set(entry.player_id, entry);
                }
            }
        }

        Print("[Citadel] Loaded " + m_Bans.Count().ToString() + " ban(s) from bans.json");
    }

    protected void Save()
    {
        MakeDirectory("$profile:Citadel");
        CitadelBanFile file = new CitadelBanFile();
        file.bans = m_Bans;
        JsonFileLoader<CitadelBanFile>.JsonSaveFile(BANS_PATH, file);
    }

    // ─── Enforcement queries ─────────────────────────────

    bool IsPlayerBanned(string steamId)
    {
        if (steamId == "") return false;
        return m_ById.Contains(steamId);
    }

    string GetBanReason(string steamId)
    {
        CitadelBanEntry entry = m_ById.Get(steamId);
        if (entry && entry.reason != "") return entry.reason;
        return "Banned";
    }

    // ─── Mutation (in-game admin actions) ────────────────

    void AddBan(string steamId, string playerName, string reason)
    {
        if (steamId == "") return;

        // Update in place if already banned, else append.
        CitadelBanEntry entry = m_ById.Get(steamId);
        if (!entry)
        {
            entry = new CitadelBanEntry();
            entry.player_id = steamId;
            m_Bans.Insert(entry);
            m_ById.Set(steamId, entry);
        }
        entry.player_name = playerName;
        entry.reason = reason;
        entry.banned_at = CitadelBanManager.NowUtc();
        Save();
    }

    bool RemoveBan(string steamId)
    {
        if (!m_ById.Contains(steamId)) return false;
        m_ById.Remove(steamId);
        for (int i = m_Bans.Count() - 1; i >= 0; i--)
        {
            if (m_Bans.Get(i).player_id == steamId)
                m_Bans.Remove(i);
        }
        Save();
        return true;
    }

    array<ref CitadelBanEntry> GetAllBans()
    {
        return m_Bans;
    }

    // ─── Helpers ─────────────────────────────────────────

    // "YYYY-MM-DD HH:MM:SS" in UTC, matching the agent's banned_at format.
    // Uses the same ToStringLen idiom as CitadelEventLogger.GetTimestamp.
    static string NowUtc()
    {
        int y, mo, d, h, mi, s;
        GetYearMonthDayUTC(y, mo, d);
        GetHourMinuteSecondUTC(h, mi, s);
        return string.Format("%1-%2-%3 %4:%5:%6",
            y.ToStringLen(4), mo.ToStringLen(2), d.ToStringLen(2),
            h.ToStringLen(2), mi.ToStringLen(2), s.ToStringLen(2));
    }
}

// ─── Global accessor (lazy singleton) ────────────────────
// Mirrors GetMarkerManager() in CitadelMapMarkerManager.c.

private static ref CitadelBanManager g_CitadelBanManager;

static ref CitadelBanManager GetCitadelBanManager()
{
    if (!g_CitadelBanManager)
        g_CitadelBanManager = new CitadelBanManager();
    return g_CitadelBanManager;
}
