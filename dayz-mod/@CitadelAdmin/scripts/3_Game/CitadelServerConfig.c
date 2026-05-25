/**
 * CitadelServerConfig — per-server module config pushed from Citadel Cloud.
 *
 * The cloud sends a `server_config` config_sync; the agent's cloud-bridge
 * config-sync writes the bare PluginServerConfig to
 * $profile:Citadel/server_config.json. This mirrors that shape as Enforce
 * classes, loads it via JsonFileLoader, and exposes match/enforce helpers used
 * by CitadelMissionServer on connect (whitelist, name filters) and chat
 * (chat filters).
 *
 * LIMITATIONS (Enforce constraints):
 *   - No regex engine: `isRegex` rules are matched as case-insensitive
 *     substring contains, same as plain rules.
 *   - VPN/proxy, geoblocking, Steam gating and ping limiting need the player
 *     IP / Steam API / ping, which aren't available at the script layer — those
 *     modules are enforced cloud/agent-side, not here.
 *   - Arrays may be null when a key is absent from JSON; accessors null-guard.
 */

class CitadelChatFilterRule
{
    string pattern = "";
    bool isRegex = false;
    string action = "block"; // block | warn | kick
}

class CitadelNameFilterRule
{
    string pattern = "";
    bool isRegex = false;
    string action = "block"; // block | kick
}

class CitadelWhitelistCfg
{
    bool enabled = false;
    ref array<string> steamIds;
    string kickMessage = "";
}

class CitadelServerConfig
{
    ref array<ref CitadelChatFilterRule> chatFilters;
    ref array<ref CitadelNameFilterRule> nameFilters;
    ref CitadelWhitelistCfg whitelist;
    string timezone = "UTC";

    [NonSerialized()]
    private bool m_Loaded = false;

    [NonSerialized()]
    private static const string CONFIG_PATH = "$profile:Citadel/server_config.json";

    bool IsLoaded() { return m_Loaded; }

    void LoadFromDisk()
    {
        if (!FileExist(CONFIG_PATH)) { m_Loaded = false; return; }
        JsonFileLoader<CitadelServerConfig>.JsonLoadFile(CONFIG_PATH, this);
        m_Loaded = true;
    }

    // Case-insensitive substring match. Empty needle never matches.
    private static bool Matches(string haystack, string needle)
    {
        if (needle == "" || haystack == "") return false;
        string h = haystack;
        string n = needle;
        h.ToLower();
        n.ToLower();
        return h.Contains(n);
    }

    bool IsBlockedByWhitelist(string steamId)
    {
        if (!whitelist || !whitelist.enabled) return false;
        if (!whitelist.steamIds) return true; // enabled but empty → nobody allowed
        for (int i = 0; i < whitelist.steamIds.Count(); i++)
        {
            if (whitelist.steamIds.Get(i) == steamId) return false;
        }
        return true;
    }

    string GetWhitelistKickMessage()
    {
        if (whitelist && whitelist.kickMessage != "") return whitelist.kickMessage;
        return "This server is whitelisted.";
    }

    CitadelNameFilterRule MatchName(string name)
    {
        if (!nameFilters) return null;
        for (int i = 0; i < nameFilters.Count(); i++)
        {
            CitadelNameFilterRule r = nameFilters.Get(i);
            if (r && Matches(name, r.pattern)) return r;
        }
        return null;
    }

    CitadelChatFilterRule MatchChat(string message)
    {
        if (!chatFilters) return null;
        for (int i = 0; i < chatFilters.Count(); i++)
        {
            CitadelChatFilterRule r = chatFilters.Get(i);
            if (r && Matches(message, r.pattern)) return r;
        }
        return null;
    }
}
