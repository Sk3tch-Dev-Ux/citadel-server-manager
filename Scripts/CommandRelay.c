// =============================================================================
// CommandRelay.c - Main poller class
// Handles config loading, HTTP polling, command execution, and acknowledgment
// =============================================================================

// Helper function to format floats with 3 decimal places
static string FormatCoord(float value)
{
    // Handle sign
    string sign = "";
    if (value < 0)
    {
        sign = "-";
        value = -value;
    }
    
    // Get whole part
    int whole = (int)value;
    
    // Get fractional part (3 decimals) using integer math only
    float remainder = value - whole;
    int frac = (int)(remainder * 1000 + 0.5);
    
    // Handle rounding overflow (e.g., 0.9999 -> 1.000)
    if (frac >= 1000)
    {
        frac = 0;
        whole = whole + 1;
    }
    
    // Build fractional string with leading zeros
    string fracStr;
    if (frac < 10)
        fracStr = "00" + frac.ToString();
    else if (frac < 100)
        fracStr = "0" + frac.ToString();
    else
        fracStr = frac.ToString();
    
    return sign + whole.ToString() + "." + fracStr;
}

// Rounds a float to specified decimal places
// Example: RoundToPlaces(3264.86134, 2) -> 3264.86
static float RoundToPlaces(float value, int places)
{
    float multiplier = Math.Pow(10, places);
    return Math.Round(value * multiplier) / multiplier;
}

// Formats a float to string with specified decimal places (for JSON output)
// Example: FloatToString(493.19999, 1) -> "493.2"
static string FloatToString(float value, int places)
{
    string sign = "";
    if (value < 0)
    {
        sign = "-";
        value = -value;
    }
    
    int whole = (int)value;
    float remainder = value - whole;
    
    int multiplier = 1;
    int i = 0;
    while (i < places)
    {
        multiplier = multiplier * 10;
        i = i + 1;
    }
    
    int frac = (int)(remainder * multiplier + 0.5);
    
    // Handle rounding overflow
    if (frac >= multiplier)
    {
        frac = 0;
        whole = whole + 1;
    }
    
    // Build fractional string with leading zeros
    string fracStr = frac.ToString();
    while (fracStr.Length() < places)
    {
        fracStr = "0" + fracStr;
    }
    
    return sign + whole.ToString() + "." + fracStr;
}

// API-optimized vector formatting (2 decimal places for smaller payloads)
// Saves ~18 bytes per position vs full precision
static string Vector3InfoForApi(vector pos)
{
    string x = FloatToString(pos[0], 2);
    string y = FloatToString(pos[1], 2);
    string z = FloatToString(pos[2], 2);
    return "{\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + "}";
}

// Standard vector formatting with near-zero cleanup
// Uses engine default precision (~6 decimals)
static string Vector3Info(vector vec)
{
    // Round near-zero values to exactly zero for cleaner output
    if (vec[0] < 0.001 && vec[0] > -0.001)
    {
        vec[0] = 0;
    }
    if (vec[1] < 0.001 && vec[1] > -0.001)
    {
        vec[1] = 0;
    }
    if (vec[2] < 0.001 && vec[2] > -0.001)
    {
        vec[2] = 0;
    }
    return string.Format("{\"x\":%1,\"y\":%2,\"z\":%3}", vec[0], vec[1], vec[2]);
}

// Escape string for safe JSON output
// Handles special characters, control codes, and unprintable characters
// Critical for preventing JSON parsing errors from player names, chat messages, etc.
static string JsonEscape(string input)
{
    if (input == "")
    {
        return "";
    }
    
    int len = input.Length();
    
    // Fast path: check if escaping is needed at all
    // Most strings (player names, item types) don't need escaping
    bool needsEscape = false;
    int checkCode;
    int i;
    for (i = 0; i < len; i++)
    {
        checkCode = input.Get(i).ToAscii();
        // Check for characters that need escaping: ", \, /, control chars (< 32)
        if (checkCode == 34 || checkCode == 92 || checkCode == 47 || checkCode < 32)
        {
            needsEscape = true;
            break;
        }
    }
    
    // If no escaping needed, return original string (fast path)
    if (!needsEscape)
    {
        return input;
    }
    
    // Slow path: build escaped string
    ref array<string> parts = new array<string>();
    string ch;
    int charCode;
    
    for (i = 0; i < len; i++)
    {
        ch = input.Get(i);
        charCode = ch.ToAscii();
        
        // Handle special JSON characters that must be escaped
        if (charCode == 34) // "
        {
            parts.Insert("\\");
            parts.Insert("\"");
        }
        else if (charCode == 92) // \
        {
            parts.Insert("\\");
            parts.Insert("\\");
        }
        else if (charCode == 47) // /
        {
            parts.Insert("\\");
            parts.Insert("/");
        }
        else if (charCode == 10) // newline
        {
            parts.Insert("\\");
            parts.Insert("n");
        }
        else if (charCode == 13) // carriage return
        {
            parts.Insert("\\");
            parts.Insert("r");
        }
        else if (charCode == 9) // tab
        {
            parts.Insert("\\");
            parts.Insert("t");
        }
        else if (charCode == 8) // backspace
        {
            parts.Insert("\\");
            parts.Insert("b");
        }
        else if (charCode == 12) // form feed
        {
            parts.Insert("\\");
            parts.Insert("f");
        }
        else if (charCode >= 0 && charCode < 32)
        {
            // Replace other unprintable control characters with space
            parts.Insert(" ");
        }
        else
        {
            parts.Insert(ch);
        }
    }
    
    // Join array parts into final string
    string result = "";
    int partCount = parts.Count();
    for (i = 0; i < partCount; i++)
    {
        result = result + parts.Get(i);
    }
    
    delete parts;
    return result;
}

// Helper function to get player direction as 0-360 degrees
static int GetPlayerDirection(PlayerBase player)
{
    if (!player) return 0;
    
    vector dir = player.GetDirection();
    float angle = Math.Atan2(dir[0], dir[2]) * Math.RAD2DEG;
    
    // Convert from -180..180 to 0..360
    if (angle < 0) angle += 360;
    
    return Math.Round(angle);
}

class CommandRelayConfig
{
    string server_id;
    int poll_interval_seconds;
    string commands_url;
    string ack_url;
    string api_key;
    bool command_logging_enabled;
    bool player_events_enabled;
    bool debug_logging_enabled;
}

class CommandRelayBanEntry
{
    string player_id;
    string player_name;
    string reason;
    string banned_at;
}

class CommandRelayBans
{
    ref array<ref CommandRelayBanEntry> bans;
    
    void CommandRelayBans()
    {
        bans = new array<ref CommandRelayBanEntry>();
    }
}

class CommandRelayProcessed
{
    ref array<string> processed_ids;
    
    void CommandRelayProcessed()
    {
        processed_ids = new array<string>();
    }
}

// Cache player identity info for use when identity becomes null on disconnect
class CommandRelayPlayerCache
{
    string steamId;
    string name;
}

// Cache entry for storage location (persistent ID -> position + class)
class CommandRelayStorageCache
{
    string persistent_id;
    string class_name;
    float x;
    float y;
    float z;
}

// Container for storage cache file
class CommandRelayStorageCacheFile
{
    ref array<ref CommandRelayStorageCache> storages;
    
    void CommandRelayStorageCacheFile()
    {
        storages = new array<ref CommandRelayStorageCache>();
    }
}

// O(1) command dispatch - map string type to enum for switch
enum CommandRelayCmd
{
    CMD_broadcast, CMD_message_player, CMD_spawn_item, CMD_spawn_item_at, CMD_give_item,
    CMD_strip_player, CMD_drop_player_gear, CMD_delete_item, CMD_kick_player, CMD_teleport,
    CMD_teleport_to_player, CMD_heal_player, CMD_dry_player, CMD_kill_player, CMD_freeze_player, CMD_unfreeze_player,
    CMD_break_legs, CMD_make_sick, CMD_cure_player, CMD_set_stat, CMD_set_blood_type,
    CMD_force_drink, CMD_force_eat, CMD_spawn_zombie, CMD_spawn_horde, CMD_clear_zombies,
    CMD_loot_magnet, CMD_flatten_trees, CMD_spawn_animal, CMD_spawn_zombie_at, CMD_spawn_animal_at,
    CMD_explode, CMD_launch_player, CMD_set_time, CMD_set_weather, CMD_spawn_vehicle,
    CMD_repair_vehicle, CMD_delete_vehicle, CMD_spawn_building, CMD_spawn_heli_crash, CMD_spawn_gas_zone,
    CMD_open_doors, CMD_close_doors, CMD_spawn_supply_crate, CMD_spawn_supply_crate_json, CMD_ban_player, CMD_unban_player,
    CMD_set_godmode, CMD_remove_godmode, CMD_set_invisible, CMD_remove_invisible, CMD_respawn_player,
    CMD_knockout_player, CMD_wake_player, CMD_set_bleeding, CMD_stop_bleeding, CMD_ragdoll_player,
    CMD_set_stamina_infinite, CMD_remove_stamina_infinite, CMD_spawn_fire, CMD_spawn_smoke,
    CMD_set_fog, CMD_set_wind, CMD_delete_objects_radius, CMD_get_base_objects, CMD_get_all_storage_objects,
    CMD_get_storage_contents, CMD_clear_inventory, CMD_spawn_item_attached, CMD_fill_magazines, CMD_spawn_loot_pile,
    CMD_get_player_full, CMD_get_player_position, CMD_get_player_info, CMD_get_online_players, CMD_get_all_players,
    CMD_get_player_gear, CMD_get_player_gear_full, CMD_get_player_hands_data, CMD_get_item_details, CMD_get_server_info, CMD_get_player_inventory,
    CMD_get_player_stats, CMD_get_nearby_vehicles, CMD_get_vehicle_info, CMD_get_nearby_players, CMD_get_nearby_loot,
    CMD_get_nearby_entities, CMD_get_nearby_entities_at, CMD_get_nearby_loot_at, CMD_get_bans,
    CMD_repair_item,
    CMD_apply_player_loadout_json,
    CMD_UNKNOWN
}

class CommandRelay
{
    // Static instance so modded PlayerBase can reach us for death events
    static CommandRelay s_Instance;
    
    protected ref CommandRelayConfig m_Config;
    protected ref CommandRelayProcessed m_Processed;
    protected ref CommandRelayCallback m_Callback;
    protected bool m_Running;
    
    // Session tracking - stores connect time (in seconds since epoch) per player (keyed by Steam ID)
    protected ref map<string, int> m_SessionConnectTimes;
    
    // Player info cache - keyed by entity ID (player.GetID()), stores Steam ID and name
    // Entity ID persists even when identity becomes null on disconnect
    protected ref map<string, ref CommandRelayPlayerCache> m_PlayerCache;
    
    protected static const string CONFIG_PATH = "$profile:DayZCommandRelay/config.json";
    protected static const string PROCESSED_PATH = "$profile:DayZCommandRelay/processed.json";
    protected static const string COMMAND_LOG_PATH = "$profile:DayZCommandRelay/command_log.txt";
    protected static const string STORAGE_CACHE_PATH = "$profile:DayZCommandRelay/storage_cache.json";
    protected static const string BANS_PATH = "$profile:DayZCommandRelay/bans.json";
    
    // Ban list - loaded from bans.json, checked on player connect
    protected ref CommandRelayBans m_Bans;
    
    // Storage location cache - maps persistent ID to position for fast lookups
    protected ref map<string, ref CommandRelayStorageCache> m_StorageLocationCache;
    
    // Chunked storage scan state - sector-by-sector to avoid blocking (full-map fetch = 3M objects = kicks)
    protected string m_StorageScanCommandId;
    protected int m_StorageScanSectorX;
    protected int m_StorageScanSectorZ;
    protected int m_StorageScanObjectIndex;
    protected ref array<Object> m_StorageScanCurrentObjects;
    protected ref array<ref CommandRelayStorageCache> m_StorageScanResults;
    protected ref map<string, bool> m_StorageScanSeenIds;
    protected int m_StorageScanGridSize;
    protected static const int STORAGE_SCAN_OBJECTS_PER_CHUNK = 600;
    protected static const int STORAGE_SCAN_DELAY_MS = 250;
    
    // Fast lookup map for processed command IDs (O(1) instead of O(n) array search)
    protected ref map<string, bool> m_ProcessedLookup;
    
    // O(1) command dispatch: string type -> enum for switch
    protected ref map<string, int> m_CommandLookup;
    
    void CommandRelay()
    {
        m_Config = new CommandRelayConfig();
        m_Config.server_id = "SERVER1";
        m_Config.poll_interval_seconds = 10;
        m_Config.commands_url = "https://example.com/api/dayz/commands";
        m_Config.ack_url = "https://example.com/api/dayz/ack";
        m_Config.api_key = "REPLACE_ME";
        m_Config.command_logging_enabled = true;
        m_Config.player_events_enabled = true;
        m_Config.debug_logging_enabled = true;
        
        m_Processed = new CommandRelayProcessed();
        m_ProcessedLookup = new map<string, bool>();
        m_Bans = new CommandRelayBans();
        m_Callback = new CommandRelayCallback(this);
        m_Running = false;
        m_SessionConnectTimes = new map<string, int>();
        m_PlayerCache = new map<string, ref CommandRelayPlayerCache>();
        m_StorageLocationCache = new map<string, ref CommandRelayStorageCache>();
        m_CommandLookup = new map<string, int>();
        s_Instance = this;
    }
    
    void ~CommandRelay()
    {
        Stop();
        if (s_Instance == this)
        {
            s_Instance = null;
        }
    }
    
    // Only prints when debug_logging_enabled is true in config.json
    protected void Log(string msg)
    {
        if (m_Config && m_Config.debug_logging_enabled)
        {
            Print("[DayZCommandRelay] " + msg);
        }
    }
    
    // Static wrapper for callbacks (REST, etc.) that cannot access this directly
    static void StaticLog(string msg)
    {
        if (s_Instance) s_Instance.Log(msg);
    }
    
    static void StaticExecuteStorageChunk()
    {
        if (s_Instance) s_Instance.ExecuteGetAllStorageObjectsChunk();
    }
    
    static void StaticExecuteStorageSendResponse()
    {
        if (s_Instance) s_Instance.ExecuteGetAllStorageObjectsSendResponse();
    }
    
    void Start()
    {
        if (m_Running)
        {
            return;
        }
        
        LoadConfig();
        LoadProcessed();
        LoadStorageCache();
        LoadBans();
        InitCommandLookup();
        
        m_Running = true;
        
        // Enforce minimum poll interval of 2 seconds
        static const int MIN_POLL_INTERVAL_SECONDS = 2;
        if (m_Config.poll_interval_seconds < MIN_POLL_INTERVAL_SECONDS)
        {
            Log("WARNING: poll_interval_seconds too low (" + m_Config.poll_interval_seconds.ToString() + "), using minimum of " + MIN_POLL_INTERVAL_SECONDS.ToString());
            m_Config.poll_interval_seconds = MIN_POLL_INTERVAL_SECONDS;
        }
        
        float interval = m_Config.poll_interval_seconds * 1000; // Convert to ms
        
        Log("Started - server_id=" + m_Config.server_id + " url=" + m_Config.commands_url + " poll=" + m_Config.poll_interval_seconds.ToString() + "s");
        
        // Start first poll immediately, then schedule repeating
        Poll();
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(this.PollRepeat, interval, true);
    }
    
    void PollRepeat()
    {
        Poll();
    }
    
    void Stop()
    {
        if (!m_Running) return;
        
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(this.PollRepeat);
        m_Running = false;
        Log("Stopped");
    }
    
    // Session tracking - called when player connects
    void OnPlayerConnect(PlayerBase player, PlayerIdentity identity)
    {
        if (!player)
        {
            Log("ERROR: OnPlayerConnect - player is null");
            return;
        }
        
        if (!identity)
        {
            Log("ERROR: OnPlayerConnect - identity is null");
            return;
        }
        
        string steamId = identity.GetPlainId();
        string playerName = JsonEscape(identity.GetName());
        string entityId = player.GetID().ToString();
        
        // Check ban list - disconnect immediately if banned
        string banReason = "";
        if (IsPlayerBanned(steamId, banReason))
        {
            Log("BANNED player attempted to connect: " + playerName + " (" + steamId + ") - Reason: " + banReason);
            GetGame().AdminLog("[DayZCommandRelay] Rejected banned player: " + playerName + " (" + steamId + ")");
            GetGame().DisconnectPlayer(identity);
            return;
        }
        
        int currentTime = GetGame().GetTime() / 1000; // Convert ms to seconds
        
        // Cache by entity ID so we can look up on disconnect when identity is null
        CommandRelayPlayerCache cache = new CommandRelayPlayerCache();
        cache.steamId = steamId;
        cache.name = playerName;
        m_PlayerCache.Set(entityId, cache);
        
        // Session tracking by Steam ID
        m_SessionConnectTimes.Set(steamId, currentTime);
        
        // Send player_login event if enabled
        if (m_Config.player_events_enabled)
        {
            SendPlayerLoginEvent(player, identity);
        }
    }
    
    // Session tracking - called when player disconnects
    void OnPlayerDisconnect(PlayerBase player)
    {
        if (!player)
        {
            Log("ERROR: OnPlayerDisconnect - player is null");
            return;
        }
        
        // Look up cached identity info by entity ID (works even when identity is null)
        string entityId = player.GetID().ToString();
        string steamId = "";
        string playerName = "";
        
        // Try to get from identity first (may be null on disconnect)
        PlayerIdentity identity = player.GetIdentity();
        if (identity)
        {
            steamId = identity.GetPlainId();
            playerName = JsonEscape(identity.GetName());
        }
        
        // Fall back to cache if identity was null (cache already has escaped name)
        if (steamId == "" && m_PlayerCache.Contains(entityId))
        {
            CommandRelayPlayerCache cache = m_PlayerCache.Get(entityId);
            if (cache)
            {
                steamId = cache.steamId;
                playerName = cache.name;
            }
        }
        
        // If we still don't have a Steam ID, we can't send the event
        if (steamId == "")
        {
            Log("WARNING: OnPlayerDisconnect - no cached identity for entity " + entityId);
            return;
        }
        
        int sessionMinutes = GetSessionMinutes(steamId);
        
        // Send player_logout event if enabled
        if (m_Config.player_events_enabled)
        {
            SendPlayerLogoutEventCached(player, steamId, playerName, sessionMinutes);
        }
        
        // Clean up session tracking and cache
        if (m_SessionConnectTimes.Contains(steamId))
        {
            m_SessionConnectTimes.Remove(steamId);
        }
        if (m_PlayerCache.Contains(entityId))
        {
            m_PlayerCache.Remove(entityId);
        }
    }
    
    // Get session duration in minutes for a player
    int GetSessionMinutes(string playerId)
    {
        if (!m_SessionConnectTimes.Contains(playerId))
        {
            return -1; // Unknown, wasn't tracked
        }
        
        int connectTime = m_SessionConnectTimes.Get(playerId);
        int currentTime = GetGame().GetTime() / 1000;
        int seconds = currentTime - connectTime;
        return seconds / 60;
    }
    
    // Send player login event to API
    protected void SendPlayerLoginEvent(PlayerBase player, PlayerIdentity identity)
    {
        if (!m_Config || m_Config.ack_url == "")
        {
            return;
        }
        
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: SendPlayerLoginEvent - GetRestApi() returned null");
            return;
        }
        
        RestContext ctx = api.GetRestContext(m_Config.ack_url);
        if (!ctx)
        {
            Log("ERROR: SendPlayerLoginEvent - No REST context");
            return;
        }
        
        string playerId = identity.GetPlainId();
        string playerName = JsonEscape(identity.GetName());
        
        // Get position and stats
        vector pos = "0 0 0";
        float health = 0;
        float blood = 0;
        int isBleeding = 0;
        
        if (player)
        {
            pos = player.GetPosition();
            health = player.GetHealth("GlobalHealth", "Health");
            blood = player.GetHealth("GlobalHealth", "Blood");
            if (player.IsBleeding())
            {
                isBleeding = 1;
            }
        }
        
        // Build timestamp
        string timestamp = BuildISOTimestamp();
        
        // Build JSON payload with optimized float precision
        string posJson = Vector3InfoForApi(pos);
        
        string payload = "{\"server_id\":\"" + m_Config.server_id + "\"";
        payload = payload + ",\"data\":{\"type\":\"player_login\"";
        payload = payload + ",\"player_id\":\"" + playerId + "\"";
        payload = payload + ",\"name\":\"" + playerName + "\"";
        payload = payload + ",\"position\":" + posJson;
        payload = payload + ",\"health\":" + FloatToString(health, 1);
        payload = payload + ",\"blood\":" + FloatToString(blood, 1);
        payload = payload + ",\"bleeding\":" + isBleeding.ToString();
        payload = payload + ",\"timestamp\":\"" + timestamp + "\"}}";
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&event=player_login";
        
        ctx.POST(new CommandRelayEventCallback("player_login", playerId), path, payload);
        Log("Player login event: " + playerName + " (" + playerId + ")");
    }
    
    // Send player logout event to API
    protected void SendPlayerLogoutEvent(PlayerBase player, PlayerIdentity identity, int sessionMinutes)
    {
        if (!m_Config || m_Config.ack_url == "")
        {
            return;
        }
        
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: SendPlayerLogoutEvent - GetRestApi() returned null");
            return;
        }
        
        RestContext ctx = api.GetRestContext(m_Config.ack_url);
        if (!ctx)
        {
            Log("ERROR: SendPlayerLogoutEvent - No REST context");
            return;
        }
        
        string playerId = identity.GetPlainId();
        string playerName = JsonEscape(identity.GetName());
        
        // Get position and stats
        vector pos = "0 0 0";
        float health = 0;
        float blood = 0;
        int isBleeding = 0;
        int isAlive = 1;
        
        if (player)
        {
            pos = player.GetPosition();
            health = player.GetHealth("GlobalHealth", "Health");
            blood = player.GetHealth("GlobalHealth", "Blood");
            if (player.IsBleeding())
            {
                isBleeding = 1;
            }
            if (!player.IsAlive())
            {
                isAlive = 0;
            }
        }
        
        // Build timestamp
        string timestamp = BuildISOTimestamp();
        
        // Build JSON payload with optimized float precision
        string posJson = Vector3InfoForApi(pos);
        
        string payload = "{\"server_id\":\"" + m_Config.server_id + "\"";
        payload = payload + ",\"data\":{\"type\":\"player_logout\"";
        payload = payload + ",\"player_id\":\"" + playerId + "\"";
        payload = payload + ",\"name\":\"" + playerName + "\"";
        payload = payload + ",\"position\":" + posJson;
        payload = payload + ",\"health\":" + FloatToString(health, 1);
        payload = payload + ",\"blood\":" + FloatToString(blood, 1);
        payload = payload + ",\"bleeding\":" + isBleeding.ToString();
        payload = payload + ",\"alive\":" + isAlive.ToString();
        payload = payload + ",\"session_minutes\":" + sessionMinutes.ToString();
        payload = payload + ",\"timestamp\":\"" + timestamp + "\"}}";
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&event=player_logout";
        
        ctx.POST(new CommandRelayEventCallback("player_logout", playerId), path, payload);
        Log("Player logout event: " + playerName + " (" + playerId + ") session=" + sessionMinutes.ToString() + "min");
    }
    
    // Send player logout event using cached player info (for when identity is null on disconnect)
    protected void SendPlayerLogoutEventCached(PlayerBase player, string playerId, string playerName, int sessionMinutes)
    {
        if (!m_Config || m_Config.ack_url == "")
        {
            return;
        }
        
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: SendPlayerLogoutEventCached - GetRestApi() returned null");
            return;
        }
        
        RestContext ctx = api.GetRestContext(m_Config.ack_url);
        if (!ctx)
        {
            Log("ERROR: SendPlayerLogoutEventCached - No REST context");
            return;
        }
        
        // Get position and stats from player object (may still be valid even if identity is null)
        vector pos = "0 0 0";
        float health = 0;
        float blood = 0;
        int isBleeding = 0;
        int isAlive = 1;
        
        if (player)
        {
            pos = player.GetPosition();
            health = player.GetHealth("GlobalHealth", "Health");
            blood = player.GetHealth("GlobalHealth", "Blood");
            if (player.IsBleeding())
            {
                isBleeding = 1;
            }
            if (!player.IsAlive())
            {
                isAlive = 0;
            }
        }
        
        // Build timestamp
        string timestamp = BuildISOTimestamp();
        
        // Build JSON payload with optimized float precision
        string posJson = Vector3InfoForApi(pos);
        
        string payload = "{\"server_id\":\"" + m_Config.server_id + "\"";
        payload = payload + ",\"data\":{\"type\":\"player_logout\"";
        payload = payload + ",\"player_id\":\"" + playerId + "\"";
        payload = payload + ",\"name\":\"" + playerName + "\"";
        payload = payload + ",\"position\":" + posJson;
        payload = payload + ",\"health\":" + FloatToString(health, 1);
        payload = payload + ",\"blood\":" + FloatToString(blood, 1);
        payload = payload + ",\"bleeding\":" + isBleeding.ToString();
        payload = payload + ",\"alive\":" + isAlive.ToString();
        payload = payload + ",\"session_minutes\":" + sessionMinutes.ToString();
        payload = payload + ",\"timestamp\":\"" + timestamp + "\"}}";
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&event=player_logout";
        
        ctx.POST(new CommandRelayEventCallback("player_logout", playerId), path, payload);
        Log("Player logout event (cached): " + playerName + " (" + playerId + ") session=" + sessionMinutes.ToString() + "min");
    }
    
    // Called from modded PlayerBase when a player dies
    void OnPlayerDeath(PlayerBase player, Object killer, string lastHitZone, string lastHitAmmo, int lastHitDamageType, EntityAI lastHitSource)
    {
        if (!player)
        {
            Log("ERROR: OnPlayerDeath - player is null");
            return;
        }
        
        if (!m_Config.player_events_enabled)
        {
            return;
        }
        
        // Get victim identity info from cache (identity may be null)
        string victimId = "";
        string victimName = "";
        string entityId = player.GetID().ToString();
        
        PlayerIdentity identity = player.GetIdentity();
        if (identity)
        {
            victimId = identity.GetPlainId();
            victimName = JsonEscape(identity.GetName());
        }
        else if (m_PlayerCache.Contains(entityId))
        {
            CommandRelayPlayerCache cache = m_PlayerCache.Get(entityId);
            victimId = cache.steamId;
            victimName = cache.name;
        }
        
        if (victimId == "")
        {
            Log("ERROR: OnPlayerDeath - could not resolve victim identity");
            return;
        }
        
        // Determine cause of death and killer info
        string causeOfDeath = "unknown";
        string killerType = "unknown";
        string killerName = "";
        string killerId = "";
        string weaponName = "";
        string weaponClass = "";
        string ammoType = lastHitAmmo;
        string hitZone = lastHitZone;
        float killDistance = 0;
        vector killerPos = vector.Zero;
        
        // Self-death (starvation, dehydration, bleeding out, drowning)
        if (killer == player)
        {
            killerType = "self";
            killerName = "";
            
            if (player.GetDrowningWaterLevelCheck())
            {
                causeOfDeath = "drowning";
            }
            else if (ammoType != "")
            {
                causeOfDeath = "bleeding";
            }
            else
            {
                causeOfDeath = "environment";
            }
        }
        else if (killer)
        {
            // Try to find the player who owns the weapon
            PlayerBase killerPlayer = null;
            EntityAI killerEntity = EntityAI.Cast(killer);
            
            if (killerEntity)
            {
                killerPlayer = PlayerBase.Cast(killerEntity.GetHierarchyParent());
            }
            
            if (!killerPlayer)
            {
                killerPlayer = PlayerBase.Cast(killer);
            }
            
            if (killerPlayer && killerPlayer != player)
            {
                // Killed by another player
                killerType = "player";
                killerPos = killerPlayer.GetPosition();
                
                PlayerIdentity killerIdentity = killerPlayer.GetIdentity();
                if (killerIdentity)
                {
                    killerId = killerIdentity.GetPlainId();
                    killerName = JsonEscape(killerIdentity.GetName());
                }
                else
                {
                    // Try cache
                    string killerEntityId = killerPlayer.GetID().ToString();
                    if (m_PlayerCache.Contains(killerEntityId))
                    {
                        CommandRelayPlayerCache killerCache = m_PlayerCache.Get(killerEntityId);
                        killerId = killerCache.steamId;
                        killerName = killerCache.name;
                    }
                }
                
                killDistance = vector.Distance(player.GetPosition(), killerPlayer.GetPosition());
                
                // Determine weapon
                if (lastHitSource)
                {
                    if (lastHitSource.IsWeapon())
                    {
                        causeOfDeath = "shot";
                        weaponName = lastHitSource.GetDisplayName();
                        weaponClass = lastHitSource.GetType();
                    }
                    else if (lastHitSource.IsMeleeWeapon())
                    {
                        causeOfDeath = "melee";
                        weaponName = lastHitSource.GetDisplayName();
                        weaponClass = lastHitSource.GetType();
                    }
                    else
                    {
                        causeOfDeath = "melee";
                        weaponName = "fists";
                        weaponClass = "MeleeFist";
                    }
                }
                else
                {
                    causeOfDeath = "melee";
                    weaponName = "fists";
                    weaponClass = "MeleeFist";
                }
            }
            else if (killerEntity && killerEntity.IsZombie())
            {
                killerType = "infected";
                killerName = killer.GetType();
                causeOfDeath = "infected";
            }
            else if (killerEntity && killerEntity.IsAnimal())
            {
                killerType = "animal";
                killerName = killer.GetDisplayName();
                causeOfDeath = "animal";
            }
            else
            {
                // Explosion, fall damage, vehicle, etc.
                killerType = "other";
                killerName = killer.GetType();
                causeOfDeath = "other";
                
                if (lastHitDamageType == DamageType.EXPLOSION)
                {
                    causeOfDeath = "explosion";
                }
            }
        }
        
        // Get session minutes
        int sessionMinutes = GetSessionMinutes(victimId);
        
        SendPlayerDeathEvent(player, victimId, victimName, causeOfDeath, killerType, killerId, killerName, killerPos, weaponName, weaponClass, ammoType, hitZone, killDistance, sessionMinutes);
    }
    
    // Send player death event POST to API
    protected void SendPlayerDeathEvent(PlayerBase player, string victimId, string victimName, string causeOfDeath, string killerType, string killerId, string killerName, vector killerPos, string weaponName, string weaponClass, string ammoType, string hitZone, float killDistance, int sessionMinutes)
    {
        if (!m_Config || m_Config.ack_url == "")
        {
            return;
        }
        
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: SendPlayerDeathEvent - GetRestApi() returned null");
            return;
        }
        
        RestContext ctx = api.GetRestContext(m_Config.ack_url);
        if (!ctx)
        {
            Log("ERROR: SendPlayerDeathEvent - No REST context");
            return;
        }
        
        // Get victim position
        vector pos = "0 0 0";
        if (player)
        {
            pos = player.GetPosition();
        }
        
        string timestamp = BuildISOTimestamp();
        string posJson = Vector3InfoForApi(pos);
        
        // Build JSON payload
        string payload = "{\"server_id\":\"" + m_Config.server_id + "\"";
        payload = payload + ",\"data\":{\"type\":\"player_death\"";
        payload = payload + ",\"player_id\":\"" + victimId + "\"";
        payload = payload + ",\"name\":\"" + victimName + "\"";
        payload = payload + ",\"position\":" + posJson;
        payload = payload + ",\"cause_of_death\":\"" + causeOfDeath + "\"";
        payload = payload + ",\"killer_type\":\"" + killerType + "\"";
        
        if (killerId != "")
        {
            payload = payload + ",\"killer_id\":\"" + killerId + "\"";
        }
        
        if (killerName != "")
        {
            payload = payload + ",\"killer_name\":\"" + killerName + "\"";
        }
        
        if (killerPos != vector.Zero)
        {
            string killerPosJson = Vector3InfoForApi(killerPos);
            payload = payload + ",\"killer_position\":" + killerPosJson;
        }
        
        if (weaponName != "")
        {
            payload = payload + ",\"weapon_name\":\"" + weaponName + "\"";
            payload = payload + ",\"weapon_class\":\"" + weaponClass + "\"";
        }
        
        if (ammoType != "")
        {
            payload = payload + ",\"ammo_type\":\"" + ammoType + "\"";
        }
        
        if (hitZone != "")
        {
            payload = payload + ",\"hit_zone\":\"" + hitZone + "\"";
        }
        
        if (killDistance > 0)
        {
            payload = payload + ",\"distance\":" + FloatToString(killDistance, 1);
        }
        
        payload = payload + ",\"session_minutes\":" + sessionMinutes.ToString();
        payload = payload + ",\"timestamp\":\"" + timestamp + "\"}}";
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&event=player_death";
        
        ctx.POST(new CommandRelayEventCallback("player_death", victimId), path, payload);
        Log("Player death event: " + victimName + " (" + victimId + ") cause=" + causeOfDeath + " killer=" + killerName);
    }
    
    // Build ISO 8601 timestamp string
    protected string BuildISOTimestamp()
    {
        int year = 0;
        int month = 0;
        int day = 0;
        int hour = 0;
        int minute = 0;
        int second = 0;
        GetYearMonthDay(year, month, day);
        GetHourMinuteSecond(hour, minute, second);
        
        string timestamp = year.ToString() + "-";
        if (month < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + month.ToString() + "-";
        if (day < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + day.ToString() + "T";
        if (hour < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + hour.ToString() + ":";
        if (minute < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + minute.ToString() + ":";
        if (second < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + second.ToString() + "Z";
        
        return timestamp;
    }
    
    // Log command execution to file for audit/debugging (JSON Lines format)
    protected void LogCommand(string commandType, string commandId, string playerId, string params, string status)
    {
        if (!m_Config.command_logging_enabled)
        {
            return;
        }
        
        // Get current time components
        int year = 0;
        int month = 0;
        int day = 0;
        int hour = 0;
        int minute = 0;
        int second = 0;
        GetYearMonthDay(year, month, day);
        GetHourMinuteSecond(hour, minute, second);
        
        // Format ISO timestamp: YYYY-MM-DDTHH:MM:SS
        string timestamp = year.ToString() + "-";
        if (month < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + month.ToString() + "-";
        if (day < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + day.ToString() + " ";
        if (hour < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + hour.ToString() + ":";
        if (minute < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + minute.ToString() + ":";
        if (second < 10)
        {
            timestamp = timestamp + "0";
        }
        timestamp = timestamp + second.ToString();
        
        // Build JSON line
        string logLine = "{\"timestamp\":\"" + timestamp + "\"";
        logLine = logLine + ",\"type\":\"" + commandType + "\"";
        logLine = logLine + ",\"id\":\"" + commandId + "\"";
        if (playerId != "")
        {
            logLine = logLine + ",\"player_id\":\"" + playerId + "\"";
        }
        if (params != "")
        {
            logLine = logLine + ",\"params\":\"" + params + "\"";
        }
        logLine = logLine + ",\"status\":\"" + status + "\"}";
        
        // Write to log file
        FileHandle logFile = OpenFile(COMMAND_LOG_PATH, FileMode.APPEND);
        if (logFile != 0)
        {
            FPrintln(logFile, logLine);
            CloseFile(logFile);
        }
        else
        {
            Log("ERROR: Failed to open command log file");
        }
    }
    
    protected void LoadConfig()
    {
        if (!FileExist("$profile:DayZCommandRelay"))
        {
            MakeDirectory("$profile:DayZCommandRelay");
        }
        
        if (FileExist(CONFIG_PATH))
        {
            JsonFileLoader<CommandRelayConfig>.JsonLoadFile(CONFIG_PATH, m_Config);
            Log("Loaded config");
        }
        else
        {
            JsonFileLoader<CommandRelayConfig>.JsonSaveFile(CONFIG_PATH, m_Config);
            Log("Created default config - edit config.json!");
        }
    }
    
    protected void LoadProcessed()
    {
        // Wipe processed.json on server init - start fresh each server start
        // Ensures queued commands from previous session are re-processed
        m_Processed.processed_ids = new array<string>();
        m_ProcessedLookup = new map<string, bool>();
        SaveProcessed();
        Log("Wiped processed.json for fresh start");
    }
    
    protected void SaveProcessed()
    {
        JsonFileLoader<CommandRelayProcessed>.JsonSaveFile(PROCESSED_PATH, m_Processed);
    }
    
    // =========================================================================
    // Ban System - bans.json management
    // =========================================================================
    
    protected void LoadBans()
    {
        if (FileExist(BANS_PATH))
        {
            JsonFileLoader<CommandRelayBans>.JsonLoadFile(BANS_PATH, m_Bans);
            Log("Loaded " + m_Bans.bans.Count().ToString() + " ban entries");
        }
        else
        {
            SaveBans();
            Log("Created empty bans.json");
        }
    }
    
    protected void SaveBans()
    {
        JsonFileLoader<CommandRelayBans>.JsonSaveFile(BANS_PATH, m_Bans);
    }
    
    protected void InitCommandLookup()
    {
        m_CommandLookup.Set("broadcast", CommandRelayCmd.CMD_broadcast);
        m_CommandLookup.Set("message_player", CommandRelayCmd.CMD_message_player);
        m_CommandLookup.Set("spawn_item", CommandRelayCmd.CMD_spawn_item);
        m_CommandLookup.Set("spawn_item_at", CommandRelayCmd.CMD_spawn_item_at);
        m_CommandLookup.Set("give_item", CommandRelayCmd.CMD_give_item);
        m_CommandLookup.Set("strip_player", CommandRelayCmd.CMD_strip_player);
        m_CommandLookup.Set("drop_player_gear", CommandRelayCmd.CMD_drop_player_gear);
        m_CommandLookup.Set("delete_item", CommandRelayCmd.CMD_delete_item);
        m_CommandLookup.Set("kick_player", CommandRelayCmd.CMD_kick_player);
        m_CommandLookup.Set("teleport", CommandRelayCmd.CMD_teleport);
        m_CommandLookup.Set("teleport_to_player", CommandRelayCmd.CMD_teleport_to_player);
        m_CommandLookup.Set("heal_player", CommandRelayCmd.CMD_heal_player);
        m_CommandLookup.Set("dry_player", CommandRelayCmd.CMD_dry_player);
        m_CommandLookup.Set("kill_player", CommandRelayCmd.CMD_kill_player);
        m_CommandLookup.Set("freeze_player", CommandRelayCmd.CMD_freeze_player);
        m_CommandLookup.Set("unfreeze_player", CommandRelayCmd.CMD_unfreeze_player);
        m_CommandLookup.Set("break_legs", CommandRelayCmd.CMD_break_legs);
        m_CommandLookup.Set("make_sick", CommandRelayCmd.CMD_make_sick);
        m_CommandLookup.Set("cure_player", CommandRelayCmd.CMD_cure_player);
        m_CommandLookup.Set("set_stat", CommandRelayCmd.CMD_set_stat);
        m_CommandLookup.Set("set_blood_type", CommandRelayCmd.CMD_set_blood_type);
        m_CommandLookup.Set("force_drink", CommandRelayCmd.CMD_force_drink);
        m_CommandLookup.Set("force_eat", CommandRelayCmd.CMD_force_eat);
        m_CommandLookup.Set("spawn_zombie", CommandRelayCmd.CMD_spawn_zombie);
        m_CommandLookup.Set("spawn_horde", CommandRelayCmd.CMD_spawn_horde);
        m_CommandLookup.Set("clear_zombies", CommandRelayCmd.CMD_clear_zombies);
        m_CommandLookup.Set("loot_magnet", CommandRelayCmd.CMD_loot_magnet);
        m_CommandLookup.Set("flatten_trees", CommandRelayCmd.CMD_flatten_trees);
        m_CommandLookup.Set("spawn_animal", CommandRelayCmd.CMD_spawn_animal);
        m_CommandLookup.Set("spawn_zombie_at", CommandRelayCmd.CMD_spawn_zombie_at);
        m_CommandLookup.Set("spawn_animal_at", CommandRelayCmd.CMD_spawn_animal_at);
        m_CommandLookup.Set("explode", CommandRelayCmd.CMD_explode);
        m_CommandLookup.Set("launch_player", CommandRelayCmd.CMD_launch_player);
        m_CommandLookup.Set("set_time", CommandRelayCmd.CMD_set_time);
        m_CommandLookup.Set("set_weather", CommandRelayCmd.CMD_set_weather);
        m_CommandLookup.Set("spawn_vehicle", CommandRelayCmd.CMD_spawn_vehicle);
        m_CommandLookup.Set("repair_vehicle", CommandRelayCmd.CMD_repair_vehicle);
        m_CommandLookup.Set("delete_vehicle", CommandRelayCmd.CMD_delete_vehicle);
        m_CommandLookup.Set("spawn_building", CommandRelayCmd.CMD_spawn_building);
        m_CommandLookup.Set("spawn_heli_crash", CommandRelayCmd.CMD_spawn_heli_crash);
        m_CommandLookup.Set("spawn_gas_zone", CommandRelayCmd.CMD_spawn_gas_zone);
        m_CommandLookup.Set("open_doors", CommandRelayCmd.CMD_open_doors);
        m_CommandLookup.Set("close_doors", CommandRelayCmd.CMD_close_doors);
        m_CommandLookup.Set("spawn_supply_crate", CommandRelayCmd.CMD_spawn_supply_crate);
        m_CommandLookup.Set("spawn_supply_crate_json", CommandRelayCmd.CMD_spawn_supply_crate_json);
        m_CommandLookup.Set("ban_player", CommandRelayCmd.CMD_ban_player);
        m_CommandLookup.Set("unban_player", CommandRelayCmd.CMD_unban_player);
        m_CommandLookup.Set("set_godmode", CommandRelayCmd.CMD_set_godmode);
        m_CommandLookup.Set("remove_godmode", CommandRelayCmd.CMD_remove_godmode);
        m_CommandLookup.Set("set_invisible", CommandRelayCmd.CMD_set_invisible);
        m_CommandLookup.Set("remove_invisible", CommandRelayCmd.CMD_remove_invisible);
        m_CommandLookup.Set("respawn_player", CommandRelayCmd.CMD_respawn_player);
        m_CommandLookup.Set("knockout_player", CommandRelayCmd.CMD_knockout_player);
        m_CommandLookup.Set("wake_player", CommandRelayCmd.CMD_wake_player);
        m_CommandLookup.Set("set_bleeding", CommandRelayCmd.CMD_set_bleeding);
        m_CommandLookup.Set("stop_bleeding", CommandRelayCmd.CMD_stop_bleeding);
        m_CommandLookup.Set("ragdoll_player", CommandRelayCmd.CMD_ragdoll_player);
        m_CommandLookup.Set("set_stamina_infinite", CommandRelayCmd.CMD_set_stamina_infinite);
        m_CommandLookup.Set("remove_stamina_infinite", CommandRelayCmd.CMD_remove_stamina_infinite);
        m_CommandLookup.Set("spawn_fire", CommandRelayCmd.CMD_spawn_fire);
        m_CommandLookup.Set("spawn_smoke", CommandRelayCmd.CMD_spawn_smoke);
        m_CommandLookup.Set("set_fog", CommandRelayCmd.CMD_set_fog);
        m_CommandLookup.Set("set_wind", CommandRelayCmd.CMD_set_wind);
        m_CommandLookup.Set("delete_objects_radius", CommandRelayCmd.CMD_delete_objects_radius);
        m_CommandLookup.Set("get_base_objects", CommandRelayCmd.CMD_get_base_objects);
        m_CommandLookup.Set("get_all_storage_objects", CommandRelayCmd.CMD_get_all_storage_objects);
        m_CommandLookup.Set("get_storage_contents", CommandRelayCmd.CMD_get_storage_contents);
        m_CommandLookup.Set("clear_inventory", CommandRelayCmd.CMD_clear_inventory);
        m_CommandLookup.Set("spawn_item_attached", CommandRelayCmd.CMD_spawn_item_attached);
        m_CommandLookup.Set("fill_magazines", CommandRelayCmd.CMD_fill_magazines);
        m_CommandLookup.Set("spawn_loot_pile", CommandRelayCmd.CMD_spawn_loot_pile);
        m_CommandLookup.Set("get_player_full", CommandRelayCmd.CMD_get_player_full);
        m_CommandLookup.Set("get_player_position", CommandRelayCmd.CMD_get_player_position);
        m_CommandLookup.Set("get_player_info", CommandRelayCmd.CMD_get_player_info);
        m_CommandLookup.Set("get_online_players", CommandRelayCmd.CMD_get_online_players);
        m_CommandLookup.Set("get_all_players", CommandRelayCmd.CMD_get_all_players);
        m_CommandLookup.Set("get_player_gear", CommandRelayCmd.CMD_get_player_gear);
        m_CommandLookup.Set("get_player_gear_full", CommandRelayCmd.CMD_get_player_gear_full);
        m_CommandLookup.Set("get_player_hands_data", CommandRelayCmd.CMD_get_player_hands_data);
        m_CommandLookup.Set("get_item_details", CommandRelayCmd.CMD_get_item_details);
        m_CommandLookup.Set("get_server_info", CommandRelayCmd.CMD_get_server_info);
        m_CommandLookup.Set("get_player_inventory", CommandRelayCmd.CMD_get_player_inventory);
        m_CommandLookup.Set("get_player_stats", CommandRelayCmd.CMD_get_player_stats);
        m_CommandLookup.Set("get_nearby_vehicles", CommandRelayCmd.CMD_get_nearby_vehicles);
        m_CommandLookup.Set("get_vehicle_info", CommandRelayCmd.CMD_get_vehicle_info);
        m_CommandLookup.Set("get_nearby_players", CommandRelayCmd.CMD_get_nearby_players);
        m_CommandLookup.Set("get_nearby_loot", CommandRelayCmd.CMD_get_nearby_loot);
        m_CommandLookup.Set("get_nearby_entities", CommandRelayCmd.CMD_get_nearby_entities);
        m_CommandLookup.Set("get_nearby_entities_at", CommandRelayCmd.CMD_get_nearby_entities_at);
        m_CommandLookup.Set("get_nearby_loot_at", CommandRelayCmd.CMD_get_nearby_loot_at);
        m_CommandLookup.Set("get_bans", CommandRelayCmd.CMD_get_bans);
        m_CommandLookup.Set("repair_item", CommandRelayCmd.CMD_repair_item);
        m_CommandLookup.Set("apply_player_loadout_json", CommandRelayCmd.CMD_apply_player_loadout_json);
    }
    
    protected bool IsPlayerBanned(string playerId, out string reason)
    {
        reason = "";
        int banCount = m_Bans.bans.Count();
        for (int i = 0; i < banCount; i++)
        {
            CommandRelayBanEntry entry = m_Bans.bans.Get(i);
            if (entry.player_id == playerId)
            {
                reason = entry.reason;
                return true;
            }
        }
        return false;
    }
    
    protected void AddBan(string playerId, string playerName, string reason)
    {
        // Check if already banned
        string existingReason = "";
        if (IsPlayerBanned(playerId, existingReason))
        {
            Log("Player already banned: " + playerId);
            return;
        }
        
        CommandRelayBanEntry entry = new CommandRelayBanEntry();
        entry.player_id = playerId;
        entry.player_name = playerName;
        entry.reason = reason;
        entry.banned_at = BuildISOTimestamp();
        
        m_Bans.bans.Insert(entry);
        SaveBans();
        Log("Added ban for: " + playerName + " (" + playerId + ") - Reason: " + reason);
    }
    
    protected bool RemoveBan(string playerId)
    {
        int banCount = m_Bans.bans.Count();
        for (int i = 0; i < banCount; i++)
        {
            CommandRelayBanEntry entry = m_Bans.bans.Get(i);
            if (entry.player_id == playerId)
            {
                m_Bans.bans.Remove(i);
                SaveBans();
                Log("Removed ban for: " + entry.player_name + " (" + playerId + ")");
                return true;
            }
        }
        Log("No ban found for: " + playerId);
        return false;
    }
    
    // Load storage location cache from file
    protected void LoadStorageCache()
    {
        if (FileExist(STORAGE_CACHE_PATH))
        {
            CommandRelayStorageCacheFile cacheFile = new CommandRelayStorageCacheFile();
            JsonFileLoader<CommandRelayStorageCacheFile>.JsonLoadFile(STORAGE_CACHE_PATH, cacheFile);
            
            if (cacheFile.storages)
            {
                int count = cacheFile.storages.Count();
                for (int i = 0; i < count; i++)
                {
                    CommandRelayStorageCache entry = cacheFile.storages.Get(i);
                    if (entry && entry.persistent_id != "")
                    {
                        m_StorageLocationCache.Set(entry.persistent_id, entry);
                    }
                }
                Log("Loaded storage cache: " + count.ToString() + " entries");
            }
        }
        else
        {
            Log("No storage cache file found, starting fresh");
        }
    }
    
    // Save storage location cache to file
    protected void SaveStorageCache()
    {
        CommandRelayStorageCacheFile cacheFile = new CommandRelayStorageCacheFile();
        
        // Convert map to array for JSON serialization
        int count = m_StorageLocationCache.Count();
        for (int i = 0; i < count; i++)
        {
            string key = m_StorageLocationCache.GetKey(i);
            CommandRelayStorageCache entry = m_StorageLocationCache.Get(key);
            if (entry)
            {
                cacheFile.storages.Insert(entry);
            }
        }
        
        JsonFileLoader<CommandRelayStorageCacheFile>.JsonSaveFile(STORAGE_CACHE_PATH, cacheFile);
        Log("Saved storage cache: " + count.ToString() + " entries");
    }
    
    // Update cache entry for a storage object
    protected void UpdateStorageCache(string persistentId, string className, vector position)
    {
        CommandRelayStorageCache entry;
        
        if (m_StorageLocationCache.Contains(persistentId))
        {
            entry = m_StorageLocationCache.Get(persistentId);
        }
        else
        {
            entry = new CommandRelayStorageCache();
            entry.persistent_id = persistentId;
        }
        
        entry.class_name = className;
        entry.x = position[0];
        entry.y = position[1];
        entry.z = position[2];
        
        m_StorageLocationCache.Set(persistentId, entry);
    }
    
    // Remove a storage from cache (e.g., if it no longer exists)
    protected void RemoveFromStorageCache(string persistentId)
    {
        if (m_StorageLocationCache.Contains(persistentId))
        {
            m_StorageLocationCache.Remove(persistentId);
        }
    }
    
    // Get cached position for a storage, returns false if not in cache
    protected bool GetCachedStoragePosition(string persistentId, out vector position, out string className)
    {
        position = vector.Zero;
        className = "";
        
        if (!m_StorageLocationCache.Contains(persistentId))
        {
            return false;
        }
        
        CommandRelayStorageCache entry = m_StorageLocationCache.Get(persistentId);
        if (!entry)
        {
            return false;
        }
        
        position[0] = entry.x;
        position[1] = entry.y;
        position[2] = entry.z;
        className = entry.class_name;
        return true;
    }
    
    protected bool IsProcessed(string id)
    {
        return m_ProcessedLookup.Contains(id);
    }
    
    protected void MarkProcessed(string id)
    {
        if (!m_ProcessedLookup.Contains(id))
        {
            m_ProcessedLookup.Set(id, true);
            m_Processed.processed_ids.Insert(id);
            SaveProcessed();
        }
    }
    
    // Helper to find a player by Steam64 ID from a cached player list
    // Returns null if not found
    protected PlayerBase FindPlayerById(array<Man> players, string playerId)
    {
        if (!players)
        {
            return null;
        }
        
        int count = players.Count();
        for (int i = 0; i < count; i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb && pb.GetIdentity())
            {
                if (pb.GetIdentity().GetPlainId() == playerId)
                {
                    return pb;
                }
            }
        }
        
        return null;
    }
    
    void Poll()
    {
        if (!m_Config)
        {
            Log("ERROR: No config");
            return;
        }
        
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: GetRestApi() returned null");
            return;
        }
        
        string url = m_Config.commands_url;
        RestContext ctx = api.GetRestContext(url);
        if (!ctx)
        {
            Log("ERROR: No REST context");
            return;
        }
        
        string params = "?server_id=" + m_Config.server_id + "&api_key=" + m_Config.api_key;
        
        ctx.SetHeader("application/json");
        Log("Polling: " + url + params);
        ctx.GET(m_Callback, params);
    }
    
    void ProcessCommands(string data)
    {
        Log("ProcessCommands received: " + data.Length().ToString() + " bytes");
        Log("Raw data: " + data);
        if (data == "") return;
        
        ref CommandRelayResponse response = new CommandRelayResponse();
        response.commands = new array<ref CommandRelayCommand>();
        
        // Manual JSON parse since JsonLoadData doesn't exist
        // Expected format: {"commands":[{"id":"x","type":"broadcast","msg":"text"}]}
        int cmdStart = data.IndexOf("[");
        int cmdEnd = data.LastIndexOf("]");
        Log("cmdStart=" + cmdStart.ToString() + " cmdEnd=" + cmdEnd.ToString());
        if (cmdStart == -1 || cmdEnd == -1) return;
        
        string cmdArray = data.Substring(cmdStart + 1, cmdEnd - cmdStart - 1);
        Log("cmdArray length=" + cmdArray.Length().ToString());
        if (cmdArray == "") return;
        
        // Parse each command object by finding matching braces
        int pos = 0;
        int len = cmdArray.Length();
        
        while (pos < len)
        {
            // Find start of next object
            int objStart = cmdArray.IndexOfFrom(pos, "{");
            if (objStart == -1) break;
            
            // Find end of this object (matching closing brace)
            int objEnd = FindJsonObjectEnd(cmdArray, objStart);
            if (objEnd == -1) break;
            
            // Extract the object content (without braces)
            string objContent = cmdArray.Substring(objStart + 1, objEnd - objStart - 1);
            Log("objContent: " + objContent);
            
            CommandRelayCommand cmd = new CommandRelayCommand();
            
            cmd.id = ExtractJsonString(objContent, "id");
            cmd.type = ExtractJsonString(objContent, "type");
            cmd.player_id = ExtractJsonString(objContent, "player_id");
            cmd.param_1 = ExtractJsonString(objContent, "param_1");
            cmd.param_2 = ExtractJsonString(objContent, "param_2");
            
            Log("Parsed: id=" + cmd.id + " type=" + cmd.type);
            
            if (cmd.id != "" && cmd.type != "")
            {
                response.commands.Insert(cmd);
            }
            
            // Move past this object
            pos = objEnd + 1;
        }
        
        if (!response.commands) return;
        
        int count = response.commands.Count();
        Log("Found " + count.ToString() + " commands");
        if (count == 0) return;
        
        // Cache player list once for all commands in this batch
        array<Man> cachedPlayers = new array<Man>();
        GetGame().GetPlayers(cachedPlayers);
        
        for (int j = 0; j < count; j++)
        {
            CommandRelayCommand c = response.commands.Get(j);
            Log("Checking cmd " + c.id + " isProcessed=" + IsProcessed(c.id).ToString());
            if (c && !IsProcessed(c.id))
            {
                Log("CMD: " + c.id + " type=" + c.type);
                
                if (!m_CommandLookup.Contains(c.type))
                {
                    Log("Unknown command type: " + c.type);
                    continue;
                }
                int cmdType = m_CommandLookup.Get(c.type);
                switch (cmdType)
                {
                    case CommandRelayCmd.CMD_broadcast:
                        ExecuteBroadcast(cachedPlayers, c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_item:
                        ExecuteSpawnItem(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_kick_player:
                        ExecuteKickPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_teleport:
                        ExecuteTeleport(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_heal_player:
                        ExecuteHealPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_dry_player:
                        ExecuteDryPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_kill_player:
                        ExecuteKillPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_give_item:
                        ExecuteGiveItem(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_strip_player:
                        ExecuteStripPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_drop_player_gear:
                        ExecuteDropPlayerGear(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_zombie:
                        ExecuteSpawnZombie(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_animal:
                        ExecuteSpawnAnimal(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_explode:
                        ExecuteExplode(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_launch_player:
                        ExecuteLaunchPlayer(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_stat:
                        ExecuteSetStat(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "=" + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_time:
                        ExecuteSetTime(c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_weather:
                        ExecuteSetWeather(c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_vehicle:
                        ExecuteSpawnVehicle(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_freeze_player:
                        ExecuteFreezePlayer(cachedPlayers, c.player_id, true);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_unfreeze_player:
                        ExecuteFreezePlayer(cachedPlayers, c.player_id, false);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_message_player:
                        ExecuteMessagePlayer(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_position:
                        ExecuteGetPlayerPosition(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_info:
                        ExecuteGetPlayerInfo(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_online_players:
                        ExecuteGetOnlinePlayers(cachedPlayers, c.id);
                        LogCommand(c.type, c.id, "", "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_all_players:
                        ExecuteGetAllPlayers(cachedPlayers, c.id);
                        LogCommand(c.type, c.id, "", "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_gear:
                        ExecuteGetPlayerGear(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_teleport_to_player:
                        ExecuteTeleportToPlayer(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_horde:
                        ExecuteSpawnHorde(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_clear_zombies:
                        ExecuteClearZombies(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_flatten_trees:
                        ExecuteFlattenTrees(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_repair_vehicle:
                        ExecuteRepairVehicle(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_building:
                        ExecuteSpawnBuilding(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_delete_vehicle:
                        ExecuteDeleteVehicle(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_item_at:
                        ExecuteSpawnItemAt(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_break_legs:
                        ExecuteBreakLegs(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_make_sick:
                        ExecuteMakeSick(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_cure_player:
                        ExecuteCurePlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_blood_type:
                        ExecuteSetBloodType(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_force_drink:
                        ExecuteForceDrink(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_force_eat:
                        ExecuteForceEat(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_server_info:
                        ExecuteGetServerInfo(cachedPlayers, c.id);
                        LogCommand(c.type, c.id, "", "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_supply_crate:
                        ExecuteSpawnSupplyCrate(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_supply_crate_json:
                        ExecuteSpawnSupplyCrateJson(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_ban_player:
                        ExecuteBanPlayer(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_unban_player:
                        ExecuteUnbanPlayer(c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_godmode:
                        ExecuteSetGodmode(cachedPlayers, c.player_id, true);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_remove_godmode:
                        ExecuteSetGodmode(cachedPlayers, c.player_id, false);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_invisible:
                        ExecuteSetInvisible(cachedPlayers, c.player_id, true);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_remove_invisible:
                        ExecuteSetInvisible(cachedPlayers, c.player_id, false);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_respawn_player:
                        ExecuteRespawnPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_clear_inventory:
                        ExecuteClearInventory(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_item_attached:
                        ExecuteSpawnItemAttached(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_fill_magazines:
                        ExecuteFillMagazines(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_loot_pile:
                        ExecuteSpawnLootPile(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_inventory:
                        ExecuteGetPlayerInventory(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_stats:
                        ExecuteGetPlayerStats(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_full:
                        ExecuteGetPlayerFull(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_vehicles:
                        ExecuteGetNearbyVehicles(cachedPlayers, c.id, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_vehicle_info:
                        ExecuteGetVehicleInfo(cachedPlayers, c.id, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_item_details:
                        ExecuteGetItemDetails(cachedPlayers, c.id, c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_knockout_player:
                        ExecuteKnockoutPlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_wake_player:
                        ExecuteWakePlayer(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_bleeding:
                        ExecuteSetBleeding(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_stop_bleeding:
                        ExecuteStopBleeding(cachedPlayers, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_ragdoll_player:
                        ExecuteRagdollPlayer(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_stamina_infinite:
                        ExecuteSetStaminaInfinite(cachedPlayers, c.player_id, true);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_remove_stamina_infinite:
                        ExecuteSetStaminaInfinite(cachedPlayers, c.player_id, false);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_fire:
                        ExecuteSpawnFire(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_smoke:
                        ExecuteSpawnSmoke(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_fog:
                        ExecuteSetFog(c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_set_wind:
                        ExecuteSetWind(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_delete_objects_radius:
                        ExecuteDeleteObjectsRadius(cachedPlayers, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_base_objects:
                        ExecuteGetBaseObjects(cachedPlayers, c.id, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_storage_contents:
                        ExecuteGetStorageContents(cachedPlayers, c.id, c.param_1, c.player_id, c.param_2);
                        if (c.param_2 != "")
                        {
                            LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        }
                        else
                        {
                            LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        }
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_all_storage_objects:
                        StartGetAllStorageObjects(c.id);
                        LogCommand(c.type, c.id, "", "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_players:
                        ExecuteGetNearbyPlayers(cachedPlayers, c.id, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_loot:
                        ExecuteGetNearbyLoot(cachedPlayers, c.id, c.player_id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, c.player_id, c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_entities:
                        ExecuteGetNearbyEntities(cachedPlayers, c.id, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_entities_at:
                        ExecuteGetNearbyEntitiesAt(c.id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_nearby_loot_at:
                        ExecuteGetNearbyLootAt(c.id, c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_delete_item:
                        ExecuteDeleteItem(cachedPlayers, c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_repair_item:
                        ExecuteRepairItem(cachedPlayers, c.param_1);
                        LogCommand(c.type, c.id, "", c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_zombie_at:
                        ExecuteSpawnZombieAt(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_animal_at:
                        ExecuteSpawnAnimalAt(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_apply_player_loadout_json:
                        ExecuteApplyPlayerLoadoutJson(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_gear_full:
                        ExecuteGetPlayerGearFull(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_player_hands_data:
                        ExecuteGetPlayerHandsData(cachedPlayers, c.id, c.player_id);
                        LogCommand(c.type, c.id, c.player_id, "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_get_bans:
                        ExecuteGetBans(c.id);
                        LogCommand(c.type, c.id, "", "", "success");
                        MarkProcessed(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_heli_crash:
                        ExecuteSpawnHeliCrash(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_spawn_gas_zone:
                        ExecuteSpawnGasZone(c.param_1, c.param_2);
                        LogCommand(c.type, c.id, "", c.param_1 + "," + c.param_2, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_open_doors:
                        ExecuteSetDoorsInRadius(cachedPlayers, c.player_id, c.param_1, true);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_close_doors:
                        ExecuteSetDoorsInRadius(cachedPlayers, c.player_id, c.param_1, false);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    case CommandRelayCmd.CMD_loot_magnet:
                        ExecuteLootMagnet(cachedPlayers, c.player_id, c.param_1);
                        LogCommand(c.type, c.id, c.player_id, c.param_1, "success");
                        MarkProcessed(c.id);
                        SendAck(c.id);
                        break;
                    default:
                        Log("Unhandled command: " + c.type);
                        break;
                }
            }
        }
    }
    
    protected string ExtractJsonString(string json, string key)
    {
        int valueStart = FindJsonStringValueStart(json, key);
        if (valueStart == -1)
        {
            return "";
        }
        
        int valueEnd;
        return ReadJsonStringValue(json, valueStart, valueEnd);
    }

    // Finds the index of the first character after the opening quote of a string value for a given key.
    // Supports: "key":"value" and "key": "value"
    // Returns -1 if not found or value is not a JSON string.
    protected int FindJsonStringValueStart(string json, string key)
    {
        string search = "\"" + key + "\":";
        int start = json.IndexOf(search);
        if (start == -1)
        {
            return -1;
        }
        
        start = start + search.Length();
        
        // Skip whitespace
        int len = json.Length();
        while (start < len)
        {
            string ch = json.Get(start);
            int code = ch.ToAscii();
            if (code != 32 && code != 9 && code != 10 && code != 13)
            {
                break;
            }
            start++;
        }
        
        if (start >= len || json.Get(start) != "\"")
        {
            return -1;
        }
        
        // Return index after opening quote
        return start + 1;
    }

    // Reads a JSON string value starting at valueStart (index after the opening quote).
    // Returns the unescaped string and sets valueEnd to the index of the closing quote.
    protected string ReadJsonStringValue(string json, int valueStart, out int valueEnd)
    {
        ref array<string> parts = new array<string>();
        bool escape = false;
        
        int len = json.Length();
        int i;
        for (i = valueStart; i < len; i++)
        {
            string ch = json.Get(i);
            int code = ch.ToAscii();
            
            if (escape)
            {
                escape = false;
                
                if (code == 34) parts.Insert("\"");          // \"
                else if (code == 92) parts.Insert("\\");      // \\
                else if (code == 47) parts.Insert("/");       // \/
                else if (code == 110) parts.Insert("\n");     // \n
                else if (code == 114) parts.Insert("\r");     // \r
                else if (code == 116) parts.Insert("\t");     // \t
                else if (code == 98) parts.Insert("\b");      // \b
                else if (code == 102) parts.Insert("\f");     // \f
                else parts.Insert(ch);                        // Unknown escape, pass through
                
                continue;
            }
            
            if (code == 92) // backslash
            {
                escape = true;
                continue;
            }
            
            if (code == 34) // closing quote
            {
                valueEnd = i;
                return string.Join("", parts);
            }
            
            parts.Insert(ch);
        }
        
        valueEnd = -1;
        return "";
    }

    // Finds the end index of a JSON object starting at objStart (index of '{').
    // Handles nested objects and braces inside JSON strings correctly.
    protected int FindJsonObjectEnd(string json, int objStart)
    {
        int len = json.Length();
        int depth = 0;
        bool inString = false;
        bool escape = false;
        
        for (int i = objStart; i < len; i++)
        {
            string ch = json.Get(i);
            int code = ch.ToAscii();
            
            if (escape)
            {
                escape = false;
                continue;
            }
            
            if (code == 92) // backslash
            {
                if (inString)
                {
                    escape = true;
                }
                continue;
            }
            
            if (code == 34) // quote
            {
                inString = !inString;
                continue;
            }
            
            if (inString)
            {
                continue;
            }
            
            if (code == 123) // {
            {
                depth++;
            }
            else if (code == 125) // }
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    protected void ExecuteBroadcast(array<Man> players, string msg)
    {
        Log("Broadcast: " + msg);
        
        int count = players.Count();
        for (int i = 0; i < count; i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb && pb.GetIdentity())
            {
                Param1<string> p1 = new Param1<string>(msg);
                GetGame().RPCSingleParam(pb, ERPCs.RPC_USER_ACTION_MESSAGE, p1, true, pb.GetIdentity());
            }
        }
        
        Log("Broadcast sent to " + count.ToString() + " players");
    }
    
    protected void ExecuteSpawnItem(array<Man> players, string playerId, string itemClass)
    {
        Log("Spawning item: " + itemClass + " for player: " + playerId);
        
        for (int i = 0; i < players.Count(); i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb)
            {
                // If playerId is empty or "all", spawn for everyone
                // Otherwise only spawn for matching player
                if (playerId == "" || playerId == "all")
                {
                    vector pos = pb.GetPosition();
                    GetGame().CreateObject(itemClass, pos, false);
                    Log("Spawned " + itemClass + " at player");
                }
                else if (pb.GetIdentity() && pb.GetIdentity().GetPlainId() == playerId)
                {
                    vector pos2 = pb.GetPosition();
                    GetGame().CreateObject(itemClass, pos2, false);
                    Log("Spawned " + itemClass + " at target player");
                    return;
                }
            }
        }
    }
    
    protected void ExecuteKickPlayer(array<Man> players, string steamId)
    {
        Log("Kicking player: " + steamId);
        
        PlayerBase pb = FindPlayerById(players, steamId);
        if (pb && pb.GetIdentity())
        {
            Log("Found player, kicking: " + pb.GetIdentity().GetName());
            GetGame().DisconnectPlayer(pb.GetIdentity());
            return;
        }
        
        Log("Player not found with steam ID: " + steamId);
    }
    
    protected void ExecuteTeleport(array<Man> players, string playerId, string coords)
    {
        Log("Teleporting player: " + playerId + " to: " + coords);
        
        array<string> parts = new array<string>();
        coords.Split(",", parts);
        
        if (parts.Count() < 3)
        {
            Log("Invalid coords format, expected x,y,z");
            return;
        }
        
        vector pos = Vector(parts.Get(0).ToFloat(), parts.Get(1).ToFloat(), parts.Get(2).ToFloat());
        float surfaceY = GetGame().SurfaceY(pos[0], pos[2]);
        vector safePos = Vector(pos[0], surfaceY, pos[2]);
        
        if (playerId == "" || playerId == "all")
        {
            for (int i = 0; i < players.Count(); i++)
            {
                PlayerBase p = PlayerBase.Cast(players.Get(i));
                if (p)
                {
                    p.SetPosition(safePos);
                    Log("Teleported " + p.GetIdentity().GetName() + " to " + safePos.ToString());
                }
            }
            return;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetPosition(safePos);
            Log("Teleported " + pb.GetIdentity().GetName() + " to " + safePos.ToString());
            return;
        }
        
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteHealPlayer(array<Man> players, string playerId)
    {
        Log("Healing player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Stop bleeding first so restored blood is not immediately drained
            pb.GetBleedingManagerServer().RemoveAllSources();
            
            // Heal all health zones
            pb.SetHealth("GlobalHealth", "Health", pb.GetMaxHealth("GlobalHealth", "Health"));
            float maxBlood = pb.GetMaxHealth("GlobalHealth", "Blood");
            if (maxBlood <= 0)
                maxBlood = 5000;
            pb.SetHealth("GlobalHealth", "Blood", maxBlood);
            pb.SetHealth("", "Blood", maxBlood);
            // Shock zone: max health = conscious, 0 = unconscious
            pb.SetHealth("GlobalHealth", "Shock", pb.GetMaxHealth("GlobalHealth", "Shock"));
            
            // Heal limbs
            pb.SetHealth("LeftArm", "Health", pb.GetMaxHealth("LeftArm", "Health"));
            pb.SetHealth("RightArm", "Health", pb.GetMaxHealth("RightArm", "Health"));
            pb.SetHealth("LeftLeg", "Health", pb.GetMaxHealth("LeftLeg", "Health"));
            pb.SetHealth("RightLeg", "Health", pb.GetMaxHealth("RightLeg", "Health"));
            pb.SetHealth("Torso", "Health", pb.GetMaxHealth("Torso", "Health"));
            pb.SetHealth("Head", "Health", pb.GetMaxHealth("Head", "Health"));
            
            // Remove all diseases
            pb.RemoveAllAgents();
            
            // Max out food and water
            pb.GetStatWater().Set(pb.GetStatWater().GetMax());
            pb.GetStatEnergy().Set(pb.GetStatEnergy().GetMax());
            
            Log("Fully healed: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteDryPlayer(array<Man> players, string playerId)
    {
        Log("Drying player clothing: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        pb.GetStatWet().Set(pb.GetStatWet().GetMin());
        
        array<EntityAI> items = new array<EntityAI>();
        pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
        int dried = 0;
        for (int i = 0; i < items.Count(); i++)
        {
            EntityAI entity = items.Get(i);
            if (!entity)
                continue;
            ItemBase item = ItemBase.Cast(entity);
            if (item)
            {
                item.SetWet(0);
                dried++;
            }
        }
        Log("Dried player and " + dried.ToString() + " items: " + pb.GetIdentity().GetName());
    }
    
    protected void ExecuteKillPlayer(array<Man> players, string playerId)
    {
        Log("Killing player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetHealth("GlobalHealth", "Health", 0);
            Log("Killed: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGiveItem(array<Man> players, string playerId, string itemClass, string quantity)
    {
        Log("Giving item: " + itemClass + " to: " + playerId);
        
        int qty = 1;
        if (quantity != "")
        {
            qty = quantity.ToInt();
        }
        if (qty < 1)
        {
            qty = 1;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            for (int q = 0; q < qty; q++)
            {
                pb.GetInventory().CreateInInventory(itemClass);
            }
            Log("Gave " + qty.ToString() + "x " + itemClass + " to " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteStripPlayer(array<Man> players, string playerId)
    {
        Log("Stripping player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.RemoveAllItems();
            Log("Stripped: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteDropPlayerGear(array<Man> players, string playerId)
    {
        Log("Dropping gear for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        vector basePos = pb.GetPosition();
        
        // Drop item in hands first
        EntityAI handsItem = pb.GetItemInHands();
        if (handsItem)
        {
            pb.ServerDropEntity(handsItem);
            float handsRadius = Math.RandomFloat(0.15, 0.5);
            float handsAngle = Math.RandomFloat(0, Math.PI2);
            float handsOffsetX = Math.Cos(handsAngle) * handsRadius;
            float handsOffsetZ = Math.Sin(handsAngle) * handsRadius;
            vector handsDropPos = basePos + Vector(handsOffsetX, 0, handsOffsetZ);
            handsItem.SetPosition(handsDropPos);
        }
        
        // Drop all attachments (clothing, backpack, etc.) and their contents
        // Iterate in reverse since we're removing items
        int attachmentCount = pb.GetInventory().AttachmentCount();
        for (int i = attachmentCount - 1; i >= 0; i--)
        {
            EntityAI attachment = pb.GetInventory().GetAttachmentFromIndex(i);
            if (!attachment)
            {
                continue;
            }
            
            // Drop items inside the attachment's cargo first
            CargoBase cargo = attachment.GetInventory().GetCargo();
            if (cargo)
            {
                int cargoItemCount = cargo.GetItemCount();
                for (int c = cargoItemCount - 1; c >= 0; c--)
                {
                    EntityAI cargoItem = cargo.GetItem(c);
                    if (!cargoItem)
                    {
                        continue;
                    }
                    
                    // Drop the cargo item
                    pb.ServerDropEntity(cargoItem);
                    
                    // Apply random spread offset
                    float cargoRadius = Math.RandomFloat(0.15, 0.5);
                    float cargoAngle = Math.RandomFloat(0, Math.PI2);
                    float cargoOffsetX = Math.Cos(cargoAngle) * cargoRadius;
                    float cargoOffsetZ = Math.Sin(cargoAngle) * cargoRadius;
                    vector cargoDropPos = basePos + Vector(cargoOffsetX, 0, cargoOffsetZ);
                    cargoItem.SetPosition(cargoDropPos);
                }
            }
            
            // Drop the attachment itself (clothing piece, backpack, etc.)
            pb.ServerDropEntity(attachment);
            
            float attachRadius = Math.RandomFloat(0.15, 0.5);
            float attachAngle = Math.RandomFloat(0, Math.PI2);
            float attachOffsetX = Math.Cos(attachAngle) * attachRadius;
            float attachOffsetZ = Math.Sin(attachAngle) * attachRadius;
            vector attachDropPos = basePos + Vector(attachOffsetX, 0, attachOffsetZ);
            attachment.SetPosition(attachDropPos);
        }
        
        Log("Dropped all gear for: " + pb.GetIdentity().GetName());
    }
    
    protected void ExecuteSpawnZombie(array<Man> players, string playerId, string count, string coords)
    {
        Log("Spawning zombies");
        
        int num = 1;
        if (count != "")
        {
            num = count.ToInt();
        }
        if (num < 1)
        {
            num = 1;
        }
        if (num > 50)
        {
            num = 50;
        }
        
        vector pos;
        
        // Use coords if provided, otherwise use player position
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                pos = Vector(parts.Get(0).ToFloat(), parts.Get(1).ToFloat(), parts.Get(2).ToFloat());
            }
        }
        
        if (pos == vector.Zero && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                pos = pb.GetPosition();
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("No valid position for zombie spawn");
            return;
        }
        
        for (int z = 0; z < num; z++)
        {
            vector spawnPos = pos + Vector(Math.RandomFloat(-10, 10), 0, Math.RandomFloat(-10, 10));
            GetGame().CreateObject("ZmbM_CitizenASkinny_Brown", spawnPos, false, true);
        }
        Log("Spawned " + num.ToString() + " zombies");
    }
    
    protected void ExecuteSpawnAnimal(array<Man> players, string playerId, string animalType, string coords)
    {
        Log("Spawning animal: " + animalType);
        
        if (animalType == "")
        {
            animalType = "Animal_BoarF";
        }
        
        vector pos;
        
        // Use coords if provided, otherwise use player position
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                pos = Vector(parts.Get(0).ToFloat(), parts.Get(1).ToFloat(), parts.Get(2).ToFloat());
            }
        }
        
        if (pos == vector.Zero && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                pos = pb.GetPosition();
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("No valid position for animal spawn");
            return;
        }
        
        pos = pos + Vector(Math.RandomFloat(-5, 5), 0, Math.RandomFloat(-5, 5));
        GetGame().CreateObject(animalType, pos, false, true);
        Log("Spawned " + animalType);
    }
    
    // Delete a specific item by its persistent ID
    // Searches player inventories first, then world objects
    protected void ExecuteDeleteItem(array<Man> players, string persistentId)
    {
        Log("Deleting item: " + persistentId);
        
        if (persistentId == "")
        {
            Log("ERROR: ExecuteDeleteItem - no persistent ID provided");
            return;
        }
        
        // Search all players' inventories first
        for (int i = 0; i < players.Count(); i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (!pb)
            {
                continue;
            }
            
            array<EntityAI> items = new array<EntityAI>();
            pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
            
            for (int j = 0; j < items.Count(); j++)
            {
                EntityAI item = items.Get(j);
                if (!item)
                {
                    continue;
                }
                
                string itemId = GetItemPersistentID(item);
                if (itemId == persistentId)
                {
                    string className = item.GetType();
                    GetGame().ObjectDelete(item);
                    Log("Deleted item " + className + " (" + persistentId + ") from player inventory");
                    return;
                }
            }
        }
        
        // Search world objects near all players (200m radius per player)
        // This avoids the massive 50000m world scan
        for (int p = 0; p < players.Count(); p++)
        {
            PlayerBase searchPlayer = PlayerBase.Cast(players.Get(p));
            if (!searchPlayer)
            {
                continue;
            }
            
            static const float DELETE_ITEM_SEARCH_RADIUS = 200;
            vector searchPos = searchPlayer.GetPosition();
            array<Object> objects = new array<Object>();
            array<CargoBase> proxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(searchPos, DELETE_ITEM_SEARCH_RADIUS, objects, proxyCargos);
            
            for (int k = 0; k < objects.Count(); k++)
            {
                EntityAI entity = EntityAI.Cast(objects.Get(k));
                if (!entity)
                {
                    continue;
                }
                
                string entityId = GetItemPersistentID(entity);
                if (entityId == persistentId)
                {
                    string entityClass = entity.GetType();
                    GetGame().ObjectDelete(entity);
                    Log("Deleted item " + entityClass + " (" + persistentId + ") from world");
                    return;
                }
            }
        }
        
        Log("Item not found for deletion: " + persistentId);
    }
    
    // Repair a specific item by its persistent ID
    // Searches player inventories first, then world objects
    protected void ExecuteRepairItem(array<Man> players, string persistentId)
    {
        Log("Repairing item: " + persistentId);
        
        if (persistentId == "")
        {
            Log("ERROR: ExecuteRepairItem - no persistent ID provided");
            return;
        }
        
        // Search all players' inventories first
        for (int i = 0; i < players.Count(); i++)
        {
            PlayerBase rpPb = PlayerBase.Cast(players.Get(i));
            if (!rpPb)
            {
                continue;
            }
            
            array<EntityAI> rpItems = new array<EntityAI>();
            rpPb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, rpItems);
            
            for (int j = 0; j < rpItems.Count(); j++)
            {
                EntityAI rpItem = rpItems.Get(j);
                if (!rpItem)
                {
                    continue;
                }
                
                string rpItemId = GetItemPersistentID(rpItem);
                if (rpItemId == persistentId)
                {
                    string rpClassName = rpItem.GetType();
                    DamageSystem.ResetAllZones(rpItem);
                    Log("Repaired item " + rpClassName + " (" + persistentId + ") in player inventory");
                    return;
                }
            }
        }
        
        // Search world objects near all players (200m radius per player)
        for (int p = 0; p < players.Count(); p++)
        {
            PlayerBase rpSearchPlayer = PlayerBase.Cast(players.Get(p));
            if (!rpSearchPlayer)
            {
                continue;
            }
            
            static const float REPAIR_ITEM_SEARCH_RADIUS = 200;
            vector rpSearchPos = rpSearchPlayer.GetPosition();
            array<Object> rpObjects = new array<Object>();
            array<CargoBase> rpProxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(rpSearchPos, REPAIR_ITEM_SEARCH_RADIUS, rpObjects, rpProxyCargos);
            
            for (int k = 0; k < rpObjects.Count(); k++)
            {
                EntityAI rpEntity = EntityAI.Cast(rpObjects.Get(k));
                if (!rpEntity)
                {
                    continue;
                }
                
                string rpEntityId = GetItemPersistentID(rpEntity);
                if (rpEntityId == persistentId)
                {
                    string rpEntityClass = rpEntity.GetType();
                    DamageSystem.ResetAllZones(rpEntity);
                    Log("Repaired item " + rpEntityClass + " (" + persistentId + ") in world");
                    return;
                }
            }
        }
        
        Log("Item not found for repair: " + persistentId);
    }
    
    // Spawn zombies at specific coordinates (no player required)
    protected void ExecuteSpawnZombieAt(string count, string coords)
    {
        Log("Spawning zombies at coordinates");
        
        if (coords == "")
        {
            Log("ERROR: ExecuteSpawnZombieAt - no coordinates provided");
            return;
        }
        
        int num = 1;
        if (count != "")
        {
            num = count.ToInt();
        }
        if (num < 1)
        {
            num = 1;
        }
        if (num > 50)
        {
            num = 50;
        }
        
        array<string> parts = new array<string>();
        coords.Split(",", parts);
        if (parts.Count() < 3)
        {
            Log("ERROR: ExecuteSpawnZombieAt - invalid coordinates: " + coords);
            return;
        }
        
        float posX = parts.Get(0).ToFloat();
        float posY = parts.Get(1).ToFloat();
        float posZ = parts.Get(2).ToFloat();
        
        // Get ground level if Y is 0
        if (posY == 0)
        {
            posY = GetGame().SurfaceY(posX, posZ);
        }
        vector pos = Vector(posX, posY, posZ);
        
        for (int z = 0; z < num; z++)
        {
            vector spawnPos = pos + Vector(Math.RandomFloat(-10, 10), 0, Math.RandomFloat(-10, 10));
            GetGame().CreateObject("ZmbM_CitizenASkinny_Brown", spawnPos, false, true);
        }
        Log("Spawned " + num.ToString() + " zombies at " + coords);
    }
    
    // Spawn animal at specific coordinates (no player required)
    protected void ExecuteSpawnAnimalAt(string animalType, string coords)
    {
        Log("Spawning animal at coordinates");
        
        if (coords == "")
        {
            Log("ERROR: ExecuteSpawnAnimalAt - no coordinates provided");
            return;
        }
        
        if (animalType == "")
        {
            animalType = "Animal_BoarF";
        }
        
        array<string> parts = new array<string>();
        coords.Split(",", parts);
        if (parts.Count() < 3)
        {
            Log("ERROR: ExecuteSpawnAnimalAt - invalid coordinates: " + coords);
            return;
        }
        
        float posX = parts.Get(0).ToFloat();
        float posY = parts.Get(1).ToFloat();
        float posZ = parts.Get(2).ToFloat();
        
        // Get ground level if Y is 0
        if (posY == 0)
        {
            posY = GetGame().SurfaceY(posX, posZ);
        }
        vector pos = Vector(posX, posY, posZ);
        
        pos = pos + Vector(Math.RandomFloat(-5, 5), 0, Math.RandomFloat(-5, 5));
        GetGame().CreateObject(animalType, pos, false, true);
        Log("Spawned " + animalType + " at " + coords);
    }
    
    protected void ExecuteExplode(array<Man> players, string playerId, string damage)
    {
        Log("Creating explosion near: " + playerId);
        
        float dmg = 100;
        if (damage != "")
        {
            dmg = damage.ToFloat();
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition() + Vector(Math.RandomFloat(-3, 3), 0, Math.RandomFloat(-3, 3));
            
            // Create explosion by spawning a grenade at the position
            Grenade_Base grenade = Grenade_Base.Cast(GetGame().CreateObject("M67Grenade", pos, false, true, true));
            if (grenade)
            {
                // Set fuse to 0 for immediate detonation
                grenade.SetHealth("", "", 0);
            }
            Log("Explosion created");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteLaunchPlayer(array<Man> players, string playerId, string powerStr, string angleStr)
    {
        Log("Launching player: " + playerId);
        
        // Parse power (velocity multiplier) - default 50, max 500
        float power = 50;
        if (powerStr != "")
        {
            power = powerStr.ToFloat();
        }
        if (power < 1)
        {
            power = 1;
        }
        if (power > 500)
        {
            power = 500;
        }
        
        // Parse angle (degrees from vertical) - default 0 (straight up), range 0-80
        float angle = 0;
        if (angleStr != "")
        {
            angle = angleStr.ToFloat();
        }
        if (angle < 0)
        {
            angle = 0;
        }
        if (angle > 80)
        {
            angle = 80;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Get player's facing direction for horizontal component
            vector orientation = pb.GetOrientation();
            float yaw = orientation[0] * Math.DEG2RAD;
            
            // Calculate velocity components based on angle
            float angleRad = angle * Math.DEG2RAD;
            float horizontalVel = power * Math.Sin(angleRad);
            float verticalVel = power * Math.Cos(angleRad);
            
            // Calculate direction in player's facing direction
            float velX = horizontalVel * Math.Sin(yaw);
            float velZ = horizontalVel * Math.Cos(yaw);
            vector launchVel = Vector(velX, verticalVel, velZ);
            
            // dBodyApplyImpulse expects impulse (mass × velocity), not velocity.
            // Velocity values must be scaled by mass to produce correct launch.
            if (dBodyIsSet(pb))
            {
                float mass = dBodyGetMass(pb);
                if (mass < 1.0) mass = 80.0;
                vector impulse = Vector(velX * mass, verticalVel * mass, velZ * mass);
                dBodyApplyImpulse(pb, impulse);
            }
            else
            {
                // Fallback: set velocity directly (e.g. if no rigid body)
                vector currentVel = GetVelocity(pb);
                SetVelocity(pb, currentVel + launchVel);
            }
            
            Log("Launched " + pb.GetIdentity().GetName() + " power=" + power.ToString() + " angle=" + angle.ToString());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void WakePlayerFromLaunch(PlayerBase pb)
    {
        if (pb && pb.IsAlive())
        {
            DayZPlayerSyncJunctures.SendPlayerUnconsciousness(pb, false);
        }
    }
    
    protected void ExecuteSetStat(array<Man> players, string playerId, string stat, string value)
    {
        Log("Setting stat: " + stat + " = " + value + " for: " + playerId);
        
        float val = value.ToFloat();
        
        for (int i = 0; i < players.Count(); i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb && pb.GetIdentity() && pb.GetIdentity().GetPlainId() == playerId)
            {
                // Handle different stat types
                if (stat == "health")
                {
                    pb.SetHealth("GlobalHealth", "Health", val);
                }
                else if (stat == "blood")
                {
                    pb.SetHealth("GlobalHealth", "Blood", val);
                }
                else if (stat == "shock")
                {
                    pb.SetHealth("GlobalHealth", "Shock", val);
                }
                else if (stat == "water")
                {
                    pb.GetStatWater().Set(val);
                }
                else if (stat == "energy")
                {
                    pb.GetStatEnergy().Set(val);
                }
                else if (stat == "stamina")
                {
                    pb.GetStatStamina().Set(val);
                }
                else
                {
                    Log("Unknown stat: " + stat);
                    return;
                }
                
                Log("Set " + stat + " to " + val.ToString() + " for " + pb.GetIdentity().GetName());
                return;
            }
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSetTime(string hour)
    {
        Log("Setting time to hour: " + hour);
        
        int h = hour.ToInt();
        if (h < 0) h = 0;
        if (h > 23) h = 23;
        
        GetGame().GetWorld().SetDate(2024, 7, 15, h, 0);
        Log("Time set to " + h.ToString() + ":00");
    }
    
    
        protected void ExecuteSetWeather(string weatherType)
        {
            Log("Setting weather to: " + weatherType);

            Weather weather = GetGame().GetWeather();
            if (!weather)
            {
                Log("ERROR: Weather object is null");
                return;
            }

            // Freeze weather updates so the engine doesn't overwrite our values
            weather.SetWeatherUpdateFreeze(true);

            // Use a long minDuration so the weather controller can't override us
            // 3600 seconds = 1 hour of locked weather
            static const float WEATHER_LOCK_DURATION = 3600;
            // Small transition time so it doesn't look jarring
            static const float WEATHER_TRANSITION_TIME = 30;

            if (weatherType == "clear")
            {
                weather.GetOvercast().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetRain().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetFog().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
            }
            else if (weatherType == "cloudy")
            {
                weather.GetOvercast().Set(0.5, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetRain().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetFog().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
            }
            else if (weatherType == "rain")
            {
                // Set overcast first with no transition so rain threshold is met immediately
                weather.GetOvercast().Set(0.8, 0, WEATHER_LOCK_DURATION);
                // Lower rain threshold so rain can start at our overcast level
                weather.SetRainThresholds(0.5, 1.0, 60);
                weather.GetRain().Set(0.7, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetFog().Set(0.1, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
            }
            else if (weatherType == "storm")
            {
                // Set overcast immediately so rain threshold is met
                weather.GetOvercast().Set(1.0, 0, WEATHER_LOCK_DURATION);
                weather.SetRainThresholds(0.5, 1.0, 60);
                weather.GetRain().Set(1.0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetFog().Set(0.2, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
            }
            else if (weatherType == "fog")
            {
                weather.GetOvercast().Set(0.3, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                weather.GetRain().Set(0, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
                // cfgweather typically limits fog to 0.02-0.08; expand limits so 0.8 takes effect
                weather.GetFog().SetLimits(0, 1);
                weather.GetFog().SetForecastChangeLimits(0, 0);
                weather.GetFog().Set(0.8, WEATHER_TRANSITION_TIME, WEATHER_LOCK_DURATION);
            }
            else
            {
                Log("ERROR: Unknown weather type: " + weatherType);
                // Unfreeze since we didn't set anything
                weather.SetWeatherUpdateFreeze(false);
                return;
            }

            Log("Weather set to " + weatherType + " (frozen for " + WEATHER_LOCK_DURATION.ToString() + "s)");
        }


    
    protected void ExecuteSpawnVehicle(array<Man> players, string playerId, string vehicleClass, string coords)
    {
        string logMsg = "Spawning vehicle: " + vehicleClass + " at: " + coords;
        if (playerId != "")
        {
            logMsg = logMsg + " (player: " + playerId + ")";
        }
        Log(logMsg);
        
        if (vehicleClass == "")
        {
            vehicleClass = "OffroadHatchback";
        }
        
        vector pos = vector.Zero;
        
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero && playerId != "" && players)
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                vector pPos = pb.GetPosition();
                vector orientation = pb.GetOrientation();
                float yaw = orientation[0] * Math.DEG2RAD;
                pos = pPos + Vector(Math.Sin(yaw) * 5, 0, Math.Cos(yaw) * 5);
                pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("ERROR: Invalid coords for vehicle spawn - provide param_2 as x,y,z or player_id for spawn near player");
            return;
        }
        
        Object obj = GetGame().CreateObject(vehicleClass, pos, false, true);
        if (!obj)
        {
            Log("ERROR: Failed to create vehicle object: " + vehicleClass);
            return;
        }
        
        obj.SetPosition(pos);
        obj.Update();
        if (obj.CanAffectPathgraph())
        {
            obj.SetAffectPathgraph(true, false);
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(GetGame().UpdatePathgraphRegionByObject, 100, false, obj);
        }
        
        Car vehicle = Car.Cast(obj);
        if (vehicle)
        {
            vehicle.Fill(CarFluid.FUEL, vehicle.GetFluidCapacity(CarFluid.FUEL));
            vehicle.Fill(CarFluid.OIL, vehicle.GetFluidCapacity(CarFluid.OIL));
            vehicle.Fill(CarFluid.BRAKE, vehicle.GetFluidCapacity(CarFluid.BRAKE));
            vehicle.Fill(CarFluid.COOLANT, vehicle.GetFluidCapacity(CarFluid.COOLANT));
            Log("Vehicle spawned and fluids filled: " + vehicleClass);
        }
        else
        {
            Log("Vehicle spawned (non-Car type): " + vehicleClass);
        }
    }
    
    protected void ExecuteFreezePlayer(array<Man> players, string playerId, bool freeze)
    {
        string action;
        if (freeze)
        {
            action = "Freezing";
        }
        else
        {
            action = "Unfreezing";
        }
        
        Log("" + action + " player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            if (freeze)
            {
                pb.SetOrientation(pb.GetOrientation());
                pb.DisableSimulation(true);
            }
            else
            {
                pb.DisableSimulation(false);
            }
            Log("Player " + action.ToLower() + ": " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteMessagePlayer(array<Man> players, string playerId, string msg)
    {
        Log("Messaging player: " + playerId + " - " + msg);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            Param1<string> p1 = new Param1<string>(msg);
            GetGame().RPCSingleParam(pb, ERPCs.RPC_USER_ACTION_MESSAGE, p1, true, pb.GetIdentity());
            Log("Message sent to: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetPlayerPosition(array<Man> players, string commandId, string playerId)
    {
        Log("Getting position for player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            string name = JsonEscape(pb.GetIdentity().GetName());
            int dir = GetPlayerDirection(pb);
            
            // Format position with optimized precision
            string posJson = Vector3InfoForApi(pos);
            
            string data = "{\"type\":\"player_position\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"position\":" + posJson;
            data = data + ",\"dir\":" + dir.ToString() + "}";
            
            SendQueryResponse(commandId, data);
            Log("Sent position for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_position\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetPlayerInfo(array<Man> players, string commandId, string playerId)
    {
        Log("Getting info for player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            string name = JsonEscape(pb.GetIdentity().GetName());
            float health = pb.GetHealth("GlobalHealth", "Health");
            float blood = pb.GetHealth("GlobalHealth", "Blood");
            float shock = pb.GetHealth("GlobalHealth", "Shock");
            int sessionMins = GetSessionMinutes(playerId);
            int dir = GetPlayerDirection(pb);
            
            int isAlive = 1;
            if (!pb.IsAlive())
            {
                isAlive = 0;
            }
            
            // Get item in hands
            string handsItem = "";
            EntityAI itemInHands = pb.GetItemInHands();
            if (itemInHands)
            {
                handsItem = itemInHands.GetType();
            }
            
            // Format with optimized precision
            string posJson = Vector3InfoForApi(pos);
            
            string data = "{\"type\":\"player_info\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"alive\":" + isAlive.ToString();
            data = data + ",\"health\":" + FloatToString(health, 1);
            data = data + ",\"blood\":" + FloatToString(blood, 1);
            data = data + ",\"shock\":" + FloatToString(shock, 1);
            data = data + ",\"session_minutes\":" + sessionMins.ToString();
            data = data + ",\"item_in_hands\":\"" + handsItem + "\"";
            data = data + ",\"position\":" + posJson;
            data = data + ",\"dir\":" + dir.ToString() + "}";
            SendQueryResponse(commandId, data);
            Log("Sent info for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_info\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetOnlinePlayers(array<Man> players, string commandId)
    {
        Log("Getting online players list");
        
        string playerList = "";
        int count = players.Count();
        
        for (int i = 0; i < count; i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb && pb.GetIdentity())
            {
                if (playerList != "")
                {
                    playerList = playerList + ",";
                }
                
                string pid = pb.GetIdentity().GetPlainId();
                string name = JsonEscape(pb.GetIdentity().GetName());
                vector pos = pb.GetPosition();
                string posJson = Vector3InfoForApi(pos);
                
                string entry = "{\"player_id\":\"" + pid + "\"";
                entry = entry + ",\"name\":\"" + name + "\"";
                entry = entry + ",\"position\":" + posJson + "}";
                playerList = playerList + entry;
            }
        }
        
        string data = "{\"type\":\"online_players\",\"count\":" + count.ToString();
        data = data + ",\"players\":[" + playerList + "]}";
        SendQueryResponse(commandId, data);
        Log("Sent online players: " + count.ToString());
    }
    
    // =============================================================================
    // get_all_players - Returns all players with id, name, position, and health
    // 
    // This command returns comprehensive player data including health stats.
    // For servers with many players, the JSON is built incrementally using
    // array joining to avoid engine string length limits.
    //
    // Response format:
    // {
    //   "type": "all_players",
    //   "count": 5,
    //   "players": [
    //     {
    //       "player_id": "76561197968868491",
    //       "name": "PlayerName",
    //       "x": "1234.567",
    //       "y": "100.000",
    //       "z": "5678.901",
    //       "dir": 180,
    //       "health": "100.000",
    //       "blood": "5000.000",
    //       "shock": "0.000",
    //       "alive": 1
    //     },
    //     ...
    //   ]
    // }
    // =============================================================================
    protected void ExecuteGetAllPlayers(array<Man> players, string commandId)
    {
        Log("Getting all players with health data");
        
        int count = players.Count();
        
        // Use array to collect player entries, then join at the end
        // This avoids string length issues with many players
        ref array<string> playerEntries = new array<string>();
        
        for (int i = 0; i < count; i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb && pb.GetIdentity())
            {
                string pid = pb.GetIdentity().GetPlainId();
                string name = JsonEscape(pb.GetIdentity().GetName());
                vector pos = pb.GetPosition();
                int dir = GetPlayerDirection(pb);
                
                // Health stats with optimized precision
                float health = pb.GetHealth("GlobalHealth", "Health");
                float blood = pb.GetHealth("GlobalHealth", "Blood");
                float shock = pb.GetHealth("GlobalHealth", "Shock");
                
                string posJson = Vector3InfoForApi(pos);
                
                int isAlive = 1;
                if (!pb.IsAlive())
                {
                    isAlive = 0;
                }
                
                // Build entry for this player
                string entry = "{\"player_id\":\"" + pid + "\"";
                entry = entry + ",\"name\":\"" + name + "\"";
                entry = entry + ",\"position\":" + posJson;
                entry = entry + ",\"dir\":" + dir.ToString();
                entry = entry + ",\"health\":" + FloatToString(health, 1);
                entry = entry + ",\"blood\":" + FloatToString(blood, 1);
                entry = entry + ",\"shock\":" + FloatToString(shock, 1);
                entry = entry + ",\"alive\":" + isAlive.ToString() + "}";
                
                playerEntries.Insert(entry);
            }
        }
        
        // Join all player entries with commas
        string playerList = "";
        int entryCount = playerEntries.Count();
        for (int j = 0; j < entryCount; j++)
        {
            if (j > 0)
            {
                playerList = playerList + ",";
            }
            playerList = playerList + playerEntries.Get(j);
        }
        
        string data = "{\"type\":\"all_players\",\"count\":" + count.ToString();
        data = data + ",\"players\":[" + playerList + "]}";
        SendQueryResponse(commandId, data);
        Log("Sent all players with health: " + count.ToString());
    }
    
    // Helper function to get persistent ID as string
    protected string GetItemPersistentID(EntityAI item)
    {
        if (!item) return "";
        int b1, b2, b3, b4;
        item.GetPersistentID(b1, b2, b3, b4);
        return b1.ToString() + "-" + b2.ToString() + "-" + b3.ToString() + "-" + b4.ToString();
    }
    
    protected void ExecuteGetPlayerGear(array<Man> players, string commandId, string playerId)
    {
        Log("Getting gear for player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            string name = JsonEscape(pb.GetIdentity().GetName());
            
            // Get items in each slot with persistent IDs
            string hands = "";
            string handsId = "";
            string head = "";
            string headId = "";
            string face = "";
            string faceId = "";
            string eyes = "";
            string eyesId = "";
            string gloves = "";
            string glovesId = "";
            string feet = "";
            string feetId = "";
            string body = "";
            string bodyId = "";
            string legs = "";
            string legsId = "";
            string back = "";
            string backId = "";
            string vest = "";
            string vestId = "";
            string hips = "";
            string hipsId = "";
            string melee = "";
            string meleeId = "";
            string shoulder = "";
            string shoulderId = "";
            
            EntityAI item;
            
            item = pb.GetItemInHands();
            if (item)
            {
                hands = item.GetType();
                handsId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.HEADGEAR);
            if (item)
            {
                head = item.GetType();
                headId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.MASK);
            if (item)
            {
                face = item.GetType();
                faceId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.EYEWEAR);
            if (item)
            {
                eyes = item.GetType();
                eyesId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.GLOVES);
            if (item)
            {
                gloves = item.GetType();
                glovesId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.FEET);
            if (item)
            {
                feet = item.GetType();
                feetId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.BODY);
            if (item)
            {
                body = item.GetType();
                bodyId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.LEGS);
            if (item)
            {
                legs = item.GetType();
                legsId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.BACK);
            if (item)
            {
                back = item.GetType();
                backId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.VEST);
            if (item)
            {
                vest = item.GetType();
                vestId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.HIPS);
            if (item)
            {
                hips = item.GetType();
                hipsId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.MELEE);
            if (item)
            {
                melee = item.GetType();
                meleeId = GetItemPersistentID(item);
            }
            
            item = pb.GetInventory().FindAttachment(InventorySlots.SHOULDER);
            if (item)
            {
                shoulder = item.GetType();
                shoulderId = GetItemPersistentID(item);
            }
            
            string data = "{\"type\":\"player_gear\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"hands\":{\"class\":\"" + hands + "\",\"id\":\"" + handsId + "\"}";
            data = data + ",\"head\":{\"class\":\"" + head + "\",\"id\":\"" + headId + "\"}";
            data = data + ",\"face\":{\"class\":\"" + face + "\",\"id\":\"" + faceId + "\"}";
            data = data + ",\"eyes\":{\"class\":\"" + eyes + "\",\"id\":\"" + eyesId + "\"}";
            data = data + ",\"gloves\":{\"class\":\"" + gloves + "\",\"id\":\"" + glovesId + "\"}";
            data = data + ",\"feet\":{\"class\":\"" + feet + "\",\"id\":\"" + feetId + "\"}";
            data = data + ",\"body\":{\"class\":\"" + body + "\",\"id\":\"" + bodyId + "\"}";
            data = data + ",\"legs\":{\"class\":\"" + legs + "\",\"id\":\"" + legsId + "\"}";
            data = data + ",\"back\":{\"class\":\"" + back + "\",\"id\":\"" + backId + "\"}";
            data = data + ",\"vest\":{\"class\":\"" + vest + "\",\"id\":\"" + vestId + "\"}";
            data = data + ",\"hips\":{\"class\":\"" + hips + "\",\"id\":\"" + hipsId + "\"}";
            data = data + ",\"melee\":{\"class\":\"" + melee + "\",\"id\":\"" + meleeId + "\"}";
            data = data + ",\"shoulder\":{\"class\":\"" + shoulder + "\",\"id\":\"" + shoulderId + "\"}}";
            
            SendQueryResponse(commandId, data);
            Log("Sent gear for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_gear\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    // =============================================================================
    // BUILD ITEM DETAIL JSON (recursive helper for get_player_gear_full)
    // =============================================================================
    
    protected string BuildItemDetailJson(EntityAI item, int depth)
    {
        if (!item)
        {
            return "null";
        }
        
        // Safety cap to prevent infinite recursion
        static const int MAX_RECURSION_DEPTH = 5;
        if (depth > MAX_RECURSION_DEPTH)
        {
            Log("WARNING: Max recursion depth reached for: " + item.GetType());
            return "{\"class\":\"" + item.GetType() + "\",\"id\":\"" + GetItemPersistentID(item) + "\",\"truncated\":true}";
        }
        
        string className = item.GetType();
        string persistentId = GetItemPersistentID(item);
        string displayName = JsonEscape(item.GetDisplayName());
        
        // Health
        float health = item.GetHealth("", "");
        float maxHealth = item.GetMaxHealth("", "");
        float healthPercent = 0;
        if (maxHealth > 0)
        {
            healthPercent = (health / maxHealth) * 100;
        }
        
        // Quantity (stackable items like ammo, food, etc)
        float quantity = 0;
        float maxQuantity = 0;
        ItemBase itemBase = ItemBase.Cast(item);
        if (itemBase)
        {
            if (itemBase.HasQuantity())
            {
                quantity = itemBase.GetQuantity();
                maxQuantity = itemBase.GetQuantityMax();
            }
        }
        
        // Magazine info (if item IS a magazine)
        int magAmmoCount = 0;
        int magAmmoMax = 0;
        string magAmmoType = "";
        Magazine mag = Magazine.Cast(item);
        if (mag)
        {
            magAmmoCount = mag.GetAmmoCount();
            magAmmoMax = mag.GetAmmoMax();
            magAmmoType = mag.ConfigGetString("ammo");
        }
        
        // Weapon-specific info
        string chamberedRounds = "";
        int chamberAmmoCount = 0;
        string attachedMagJson = "";
        Weapon_Base weapon = Weapon_Base.Cast(item);
        if (weapon)
        {
            int muzzleCount = weapon.GetMuzzleCount();
            int muzzleIndex;
            for (muzzleIndex = 0; muzzleIndex < muzzleCount; muzzleIndex++)
            {
                if (weapon.IsChamberFull(muzzleIndex))
                {
                    chamberAmmoCount++;
                    float chamberDamage;
                    string chamberType;
                    if (weapon.GetCartridgeInfo(muzzleIndex, chamberDamage, chamberType))
                    {
                        if (chamberedRounds != "")
                        {
                            chamberedRounds = chamberedRounds + ",";
                        }
                        chamberedRounds = chamberedRounds + chamberType;
                    }
                }
            }
            
            // Attached magazine on weapon — recurse into it for full detail
            Magazine weaponMag = weapon.GetMagazine(0);
            if (weaponMag)
            {
                int nextDepth = depth + 1;
                attachedMagJson = BuildItemDetailJson(weaponMag, nextDepth);
            }
        }
        
        // Build attachments array (recursive)
        string attachmentList = "";
        int attachmentCount = 0;
        int totalAttachments = item.GetInventory().AttachmentCount();
        int attachmentIndex;
        for (attachmentIndex = 0; attachmentIndex < totalAttachments; attachmentIndex++)
        {
            EntityAI attachment = item.GetInventory().GetAttachmentFromIndex(attachmentIndex);
            if (attachment)
            {
                // Skip the magazine we already handled on weapons
                if (weapon)
                {
                    Magazine checkMag = Magazine.Cast(attachment);
                    if (checkMag)
                    {
                        Magazine weaponMagCheck = weapon.GetMagazine(0);
                        if (weaponMagCheck && checkMag == weaponMagCheck)
                        {
                            continue;
                        }
                    }
                }
                
                if (attachmentList != "")
                {
                    attachmentList = attachmentList + ",";
                }
                int attDepth = depth + 1;
                attachmentList = attachmentList + BuildItemDetailJson(attachment, attDepth);
                attachmentCount++;
            }
        }
        
        // Build cargo contents array (recursive)
        string cargoList = "";
        int cargoCount = 0;
        CargoBase cargo = item.GetInventory().GetCargo();
        if (cargo)
        {
            int cargoItemCount = cargo.GetItemCount();
            int cargoIndex;
            for (cargoIndex = 0; cargoIndex < cargoItemCount; cargoIndex++)
            {
                EntityAI cargoItem = cargo.GetItem(cargoIndex);
                if (cargoItem)
                {
                    if (cargoList != "")
                    {
                        cargoList = cargoList + ",";
                    }
                    int cargoDepth = depth + 1;
                    cargoList = cargoList + BuildItemDetailJson(cargoItem, cargoDepth);
                    cargoCount++;
                }
            }
        }
        
        // Assemble JSON
        string json = "{\"class\":\"" + className + "\"";
        json = json + ",\"id\":\"" + persistentId + "\"";
        json = json + ",\"display_name\":\"" + displayName + "\"";
        json = json + ",\"health\":" + FloatToString(health, 1);
        json = json + ",\"max_health\":" + FloatToString(maxHealth, 1);
        json = json + ",\"health_percent\":" + FloatToString(healthPercent, 1);
        json = json + ",\"quantity\":" + FloatToString(quantity, 1);
        json = json + ",\"max_quantity\":" + FloatToString(maxQuantity, 1);
        
        // Magazine fields
        if (mag)
        {
            json = json + ",\"ammo_count\":" + magAmmoCount.ToString();
            json = json + ",\"ammo_max\":" + magAmmoMax.ToString();
            json = json + ",\"ammo_type\":\"" + magAmmoType + "\"";
        }
        
        // Weapon fields
        if (weapon)
        {
            json = json + ",\"chamber_count\":" + chamberAmmoCount.ToString();
            json = json + ",\"chambered\":\"" + chamberedRounds + "\"";
            if (attachedMagJson != "")
            {
                json = json + ",\"magazine\":" + attachedMagJson;
            }
        }
        
        // Attachments
        json = json + ",\"attachment_count\":" + attachmentCount.ToString();
        json = json + ",\"attachments\":[" + attachmentList + "]";
        
        // Cargo
        json = json + ",\"cargo_count\":" + cargoCount.ToString();
        json = json + ",\"cargo\":[" + cargoList + "]}";
        
        return json;
    }
    
    // =============================================================================
    // GET PLAYER GEAR FULL (detailed recursive inventory dump)
    // =============================================================================
    
    protected void ExecuteGetPlayerGearFull(array<Man> players, string commandId, string playerId)
    {
        Log("Getting full gear detail for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            string notFoundData = "{\"type\":\"player_gear_full\"";
            notFoundData = notFoundData + ",\"player_id\":\"" + playerId + "\"";
            notFoundData = notFoundData + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFoundData);
            Log("Player not found: " + playerId);
            return;
        }
        
        string playerName = JsonEscape(pb.GetIdentity().GetName());
        
        // Build each slot with full recursive detail
        string handsJson = "null";
        EntityAI handsItem = pb.GetItemInHands();
        if (handsItem)
        {
            handsJson = BuildItemDetailJson(handsItem, 0);
        }
        
        string headJson = "null";
        EntityAI headItem = pb.GetInventory().FindAttachment(InventorySlots.HEADGEAR);
        if (headItem)
        {
            headJson = BuildItemDetailJson(headItem, 0);
        }
        
        string faceJson = "null";
        EntityAI faceItem = pb.GetInventory().FindAttachment(InventorySlots.MASK);
        if (faceItem)
        {
            faceJson = BuildItemDetailJson(faceItem, 0);
        }
        
        string eyesJson = "null";
        EntityAI eyesItem = pb.GetInventory().FindAttachment(InventorySlots.EYEWEAR);
        if (eyesItem)
        {
            eyesJson = BuildItemDetailJson(eyesItem, 0);
        }
        
        string glovesJson = "null";
        EntityAI glovesItem = pb.GetInventory().FindAttachment(InventorySlots.GLOVES);
        if (glovesItem)
        {
            glovesJson = BuildItemDetailJson(glovesItem, 0);
        }
        
        string feetJson = "null";
        EntityAI feetItem = pb.GetInventory().FindAttachment(InventorySlots.FEET);
        if (feetItem)
        {
            feetJson = BuildItemDetailJson(feetItem, 0);
        }
        
        string bodyJson = "null";
        EntityAI bodyItem = pb.GetInventory().FindAttachment(InventorySlots.BODY);
        if (bodyItem)
        {
            bodyJson = BuildItemDetailJson(bodyItem, 0);
        }
        
        string legsJson = "null";
        EntityAI legsItem = pb.GetInventory().FindAttachment(InventorySlots.LEGS);
        if (legsItem)
        {
            legsJson = BuildItemDetailJson(legsItem, 0);
        }
        
        string backJson = "null";
        EntityAI backItem = pb.GetInventory().FindAttachment(InventorySlots.BACK);
        if (backItem)
        {
            backJson = BuildItemDetailJson(backItem, 0);
        }
        
        string vestJson = "null";
        EntityAI vestItem = pb.GetInventory().FindAttachment(InventorySlots.VEST);
        if (vestItem)
        {
            vestJson = BuildItemDetailJson(vestItem, 0);
        }
        
        string hipsJson = "null";
        EntityAI hipsItem = pb.GetInventory().FindAttachment(InventorySlots.HIPS);
        if (hipsItem)
        {
            hipsJson = BuildItemDetailJson(hipsItem, 0);
        }
        
        string meleeJson = "null";
        EntityAI meleeItem = pb.GetInventory().FindAttachment(InventorySlots.MELEE);
        if (meleeItem)
        {
            meleeJson = BuildItemDetailJson(meleeItem, 0);
        }
        
        string shoulderJson = "null";
        EntityAI shoulderItem = pb.GetInventory().FindAttachment(InventorySlots.SHOULDER);
        if (shoulderItem)
        {
            shoulderJson = BuildItemDetailJson(shoulderItem, 0);
        }
        
        // Assemble response
        string data = "{\"type\":\"player_gear_full\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"name\":\"" + playerName + "\"";
        data = data + ",\"hands\":" + handsJson;
        data = data + ",\"head\":" + headJson;
        data = data + ",\"face\":" + faceJson;
        data = data + ",\"eyes\":" + eyesJson;
        data = data + ",\"gloves\":" + glovesJson;
        data = data + ",\"feet\":" + feetJson;
        data = data + ",\"body\":" + bodyJson;
        data = data + ",\"legs\":" + legsJson;
        data = data + ",\"back\":" + backJson;
        data = data + ",\"vest\":" + vestJson;
        data = data + ",\"hips\":" + hipsJson;
        data = data + ",\"melee\":" + meleeJson;
        data = data + ",\"shoulder\":" + shoulderJson + "}";
        
        SendQueryResponse(commandId, data);
        Log("Sent full gear detail for: " + playerName);
    }

    // =============================================================================
    // APPLY PLAYER LOADOUT (JSON payload)
    // =============================================================================

    protected void ExecuteApplyPlayerLoadoutJson(array<Man> players, string playerId, string payload)
    {
        Log("Applying JSON loadout for: " + playerId);

        if (payload == "")
        {
            Log("Empty payload for player loadout");
            return;
        }

        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }

        if (!pb.GetInventory())
        {
            Log("Player inventory is null");
            return;
        }

        // Optional basic sanity: enforce maximum payload length to avoid abuse
        if (payload.Length() > 4096)
        {
            Log("Loadout payload too large, aborting");
            return;
        }

        ApplyLoadoutSlot(pb, payload, "head", InventorySlots.HEADGEAR);
        ApplyLoadoutSlot(pb, payload, "face", InventorySlots.MASK);
        ApplyLoadoutSlot(pb, payload, "eyes", InventorySlots.EYEWEAR);
        ApplyLoadoutSlot(pb, payload, "gloves", InventorySlots.GLOVES);
        ApplyLoadoutSlot(pb, payload, "feet", InventorySlots.FEET);
        ApplyLoadoutSlot(pb, payload, "body", InventorySlots.BODY);
        ApplyLoadoutSlot(pb, payload, "legs", InventorySlots.LEGS);
        ApplyLoadoutSlot(pb, payload, "back", InventorySlots.BACK);
        ApplyLoadoutSlot(pb, payload, "vest", InventorySlots.VEST);
        ApplyLoadoutSlot(pb, payload, "hips", InventorySlots.HIPS);
        ApplyLoadoutSlot(pb, payload, "melee", InventorySlots.MELEE);
        ApplyLoadoutSlot(pb, payload, "shoulder", InventorySlots.SHOULDER);

        Log("Applied JSON loadout for: " + pb.GetIdentity().GetName());
    }

    protected void ApplyLoadoutSlot(PlayerBase pb, string payload, string key, int slot)
    {
        string className = ExtractJsonString(payload, key);
        className.Trim();

        if (className == "")
        {
            return;
        }

        if (!pb || !pb.GetInventory())
        {
            return;
        }

        // Basic classname blacklist for safety
        if (className.IndexOf("Wreck_") == 0 || className.IndexOf("Land_") == 0)
        {
            Log("Disallowed loadout class for slot '" + key + "': " + className);
            return;
        }

        EntityAI existing = pb.GetInventory().FindAttachment(slot);
        if (existing)
        {
            GetGame().ObjectDelete(existing);
        }

        EntityAI created = pb.GetInventory().CreateInInventory(className);
        if (!created)
        {
            Log("Failed to create item for slot '" + key + "' with class: " + className);
        }
        else
        {
            Log("Set slot '" + key + "' to: " + className);
        }
    }
    
    protected void ExecuteGetPlayerHandsData(array<Man> players, string commandId, string playerId)
    {
        Log("Getting hands data for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            string notFound = "{\"type\":\"player_hands_data\"";
            notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
            notFound = notFound + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFound);
            Log("Player not found: " + playerId);
            return;
        }
        
        string playerName = JsonEscape(pb.GetIdentity().GetName());
        string handsJson = BuildHandsDataJson(pb.GetItemInHands());
        
        string data = "{\"type\":\"player_hands_data\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"name\":\"" + playerName + "\"";
        data = data + ",\"hands\":" + handsJson + "}";
        
        SendQueryResponse(commandId, data);
        Log("Sent hands data for: " + playerName);
    }
    
    protected string BuildHandsDataJson(EntityAI item)
    {
        if (!item)
            return "null";
        
        string className = item.GetType();
        string persistentId = GetItemPersistentID(item);
        string displayName = JsonEscape(item.GetDisplayName());
        float health = item.GetHealth("", "");
        float maxHealth = item.GetMaxHealth("", "");
        float healthPercent = 0;
        if (maxHealth > 0)
            healthPercent = (health / maxHealth) * 100;
        
        float weight = 0;
        ItemBase itemBase = ItemBase.Cast(item);
        if (itemBase)
            weight = itemBase.GetWeightEx();
        
        string json = "{\"class\":\"" + className + "\"";
        json = json + ",\"id\":\"" + persistentId + "\"";
        json = json + ",\"display_name\":\"" + displayName + "\"";
        json = json + ",\"health\":" + FloatToString(health, 2);
        json = json + ",\"max_health\":" + FloatToString(maxHealth, 2);
        json = json + ",\"health_percent\":" + FloatToString(healthPercent, 2);
        json = json + ",\"weight\":" + FloatToString(weight, 1);
        
        Weapon_Base weapon = Weapon_Base.Cast(item);
        if (weapon)
        {
            int currentMuzzle = weapon.GetCurrentMuzzle();
            string modeName = JsonEscape(weapon.GetCurrentModeName(currentMuzzle));
            int modeIndex = weapon.GetCurrentMode(currentMuzzle);
            bool modeAuto = weapon.GetCurrentModeAutoFire(currentMuzzle);
            int burstSize = weapon.GetCurrentModeBurstSize(currentMuzzle);
            int modeCount = weapon.GetMuzzleModeCount(currentMuzzle);
            float reloadTime = weapon.GetReloadTime(currentMuzzle);
            float rateOfFire = 0;
            if (reloadTime > 0)
                rateOfFire = 1.0 / reloadTime;
            
            float chamberDamage = 0;
            string chamberType = "";
            if (weapon.IsChamberFull(currentMuzzle) && weapon.GetCartridgeInfo(currentMuzzle, chamberDamage, chamberType)) { }
            
            float weaponLength = 0;
            if (weapon.ConfigIsExisting("WeaponLength"))
                weaponLength = weapon.ConfigGetFloat("WeaponLength");
            
            json = json + ",\"fire_mode\":\"" + modeName + "\"";
            json = json + ",\"fire_mode_index\":" + modeIndex.ToString();
            string modeAutoStr = "false";
            if (modeAuto)
                modeAutoStr = "true";
            json = json + ",\"fire_mode_auto\":" + modeAutoStr;
            json = json + ",\"fire_mode_burst_size\":" + burstSize.ToString();
            json = json + ",\"mode_count\":" + modeCount.ToString();
            json = json + ",\"reload_time\":" + FloatToString(reloadTime, 4);
            json = json + ",\"rate_of_fire\":" + FloatToString(rateOfFire, 2);
            json = json + ",\"chamber_damage\":" + FloatToString(chamberDamage, 4);
            json = json + ",\"weapon_length\":" + FloatToString(weaponLength, 2);
            
            int chamberCount = 0;
            string chamberedRounds = "";
            int muzzleCount = weapon.GetMuzzleCount();
            for (int mi = 0; mi < muzzleCount; mi++)
            {
                if (weapon.IsChamberFull(mi))
                {
                    chamberCount++;
                    float dmg;
                    string cType;
                    if (weapon.GetCartridgeInfo(mi, dmg, cType))
                    {
                        if (chamberedRounds != "") chamberedRounds = chamberedRounds + ",";
                        chamberedRounds = chamberedRounds + cType;
                    }
                }
            }
            json = json + ",\"chamber_count\":" + chamberCount.ToString();
            json = json + ",\"chambered\":\"" + JsonEscape(chamberedRounds) + "\"";
            
            Magazine weaponMag = weapon.GetMagazine(0);
            if (weaponMag)
            {
                json = json + ",\"magazine_ammo_count\":" + weaponMag.GetAmmoCount().ToString();
                json = json + ",\"magazine_ammo_max\":" + weaponMag.GetAmmoMax().ToString();
                json = json + ",\"magazine_ammo_type\":\"" + JsonEscape(weaponMag.ConfigGetString("ammo")) + "\"";
            }
        }
        
        json = json + "}";
        return json;
    }
    
    protected void ExecuteTeleportToPlayer(array<Man> players, string playerId, string targetPlayerId)
    {
        Log("Teleporting player: " + playerId + " to player: " + targetPlayerId);
        
        PlayerBase source = FindPlayerById(players, playerId);
        PlayerBase target = FindPlayerById(players, targetPlayerId);
        
        if (source && target)
        {
            vector targetPos = target.GetPosition();
            float surfaceY = GetGame().SurfaceY(targetPos[0] + 2, targetPos[2]);
            vector safePos = Vector(targetPos[0] + 2, surfaceY, targetPos[2]);
            source.SetPosition(safePos);
            Log("Teleported " + source.GetIdentity().GetName() + " to " + target.GetIdentity().GetName());
        }
        else
        {
            Log("Could not find one or both players");
        }
    }
    
    protected void ExecuteSpawnHorde(array<Man> players, string playerId, string count)
    {
        Log("Spawning zombie horde near: " + playerId);
        
        int num = 20;
        if (count != "")
        {
            num = count.ToInt();
        }
        if (num < 1)
        {
            num = 1;
        }
        if (num > 100)
        {
            num = 100;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            
            array<string> zombieTypes = new array<string>();
            zombieTypes.Insert("ZmbM_CitizenASkinny_Brown");
            zombieTypes.Insert("ZmbM_CitizenBFat_Blue");
            zombieTypes.Insert("ZmbF_CitizenANormal_Blue");
            zombieTypes.Insert("ZmbM_HermitSkinny_Beige");
            zombieTypes.Insert("ZmbM_HunterOld_Autumn");
            zombieTypes.Insert("ZmbF_JournalistNormal_Blue");
            zombieTypes.Insert("ZmbM_Jacket_black");
            zombieTypes.Insert("ZmbM_PolicemanFat");
            
            for (int z = 0; z < num; z++)
            {
                vector spawnPos = pos + Vector(Math.RandomFloat(-25, 25), 0, Math.RandomFloat(-25, 25));
                string zombieType = zombieTypes.Get(Math.RandomInt(0, zombieTypes.Count()));
                GetGame().CreateObject(zombieType, spawnPos, false, true);
            }
            Log("Spawned horde of " + num.ToString() + " zombies");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteClearZombies(array<Man> players, string playerId, string radius)
    {
        Log("Clearing zombies near: " + playerId);
        
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 500)
        {
            rad = 500;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        vector centerPos = pb.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(centerPos, rad, objects, proxyCargos);
        
        int count = 0;
        for (int j = 0; j < objects.Count(); j++)
        {
            ZombieBase zombie = ZombieBase.Cast(objects.Get(j));
            if (zombie)
            {
                GetGame().ObjectDelete(zombie);
                count++;
            }
        }
        Log("Cleared " + count.ToString() + " zombies");
    }
    
    protected void ExecuteFlattenTrees(array<Man> players, string playerId, string radius)
    {
        Log("Flattening trees near: " + playerId);
        
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        vector centerPos = pb.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(centerPos, rad, objects, proxyCargos);
        
        int count = 0;
        for (int j = 0; j < objects.Count(); j++)
        {
            Object obj = objects.Get(j);
            if (obj)
            {
                // Check if it's a tree (TreeHard or TreeSoft)
                TreeHard treeHard = TreeHard.Cast(obj);
                TreeSoft treeSoft = TreeSoft.Cast(obj);
                
                if (treeHard)
                {
                    // Cut down the tree
                    treeHard.DecreaseHealth("", "", treeHard.GetMaxHealth("", ""));
                    count++;
                }
                else if (treeSoft)
                {
                    // Cut down the tree
                    treeSoft.DecreaseHealth("", "", treeSoft.GetMaxHealth("", ""));
                    count++;
                }
            }
        }
        Log("Flattened " + count.ToString() + " trees");
    }
    
    protected void ExecuteRepairVehicle(array<Man> players, string playerId)
    {
        Log("Repairing vehicle near: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            
            array<Object> objects = new array<Object>();
            array<CargoBase> proxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(pos, 20, objects, proxyCargos);
            
            for (int j = 0; j < objects.Count(); j++)
            {
                Car vehicle = Car.Cast(objects.Get(j));
                if (vehicle)
                {
                    vehicle.SetHealth("", "", vehicle.GetMaxHealth("", ""));
                    vehicle.Fill(CarFluid.FUEL, vehicle.GetFluidCapacity(CarFluid.FUEL));
                    vehicle.Fill(CarFluid.OIL, vehicle.GetFluidCapacity(CarFluid.OIL));
                    vehicle.Fill(CarFluid.BRAKE, vehicle.GetFluidCapacity(CarFluid.BRAKE));
                    vehicle.Fill(CarFluid.COOLANT, vehicle.GetFluidCapacity(CarFluid.COOLANT));
                    Log("Repaired and refueled vehicle: " + vehicle.GetType());
                    return;
                }
            }
            Log("No vehicle found nearby");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSpawnBuilding(array<Man> players, string playerId, string buildingClass, string coords)
    {
        string logMsg = "Spawning building: " + buildingClass + " at: " + coords;
        if (playerId != "")
        {
            logMsg = logMsg + " (player: " + playerId + ")";
        }
        Log(logMsg);
        
        if (buildingClass == "") buildingClass = "Land_Shed_W4";
        
        vector pos = vector.Zero;
        
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero && playerId != "" && players)
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                vector pPos = pb.GetPosition();
                vector orientation = pb.GetOrientation();
                float yaw = orientation[0] * Math.DEG2RAD;
                pos = pPos + Vector(Math.Sin(yaw) * 5, 0, Math.Cos(yaw) * 5);
                pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("ERROR: Invalid coords for building spawn - provide param_2 as x,y,z or player_id for spawn near player");
            return;
        }
        
        GetGame().CreateObjectEx(buildingClass, pos, ECE_PLACE_ON_SURFACE);
        Log("Building spawned: " + buildingClass);
    }
    
    protected void ExecuteSpawnHeliCrash(string heliType, string coords)
    {
        Log("Spawning heli crash at: " + coords);
        
        // Determine wreck class from type parameter
        string wreckClass = "Wreck_Mi8_Crashed";
        if (heliType == "old")
        {
            wreckClass = "Wreck_Mi8";
        }
        else if (heliType == "uh1y")
        {
            wreckClass = "Wreck_UH1Y";
        }
        
        vector pos;
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 2)
            {
                float posX = parts.Get(0).ToFloat();
                float posZ;
                // Support both "X,Z" and "X,Y,Z" formats
                if (parts.Count() >= 3)
                {
                    posZ = parts.Get(2).ToFloat();
                }
                else
                {
                    posZ = parts.Get(1).ToFloat();
                }
                // Get terrain height at X,Z - place directly on ground
                float posY = GetGame().SurfaceY(posX, posZ);
                pos = Vector(posX, posY, posZ);
                Log("Terrain height at coords: " + posY.ToString());
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("ERROR: Invalid coords for heli crash spawn");
            return;
        }
        
        // Spawn the wreck directly on ground with ECE_NOLIFETIME to prevent CE cleanup
        Log("Creating wreck at spawn pos: " + pos.ToString());
        int spawnFlags = ECE_CREATEPHYSICS | ECE_UPDATEPATHGRAPH | ECE_NOLIFETIME;
        Object wreck = GetGame().CreateObjectEx(wreckClass, pos, spawnFlags);
        if (!wreck)
        {
            Log("ERROR: Failed to create wreck: " + wreckClass);
            return;
        }
        
        vector finalPos = wreck.GetPosition();
        Log("Wreck spawned: " + wreckClass + " at final pos: " + finalPos.ToString());
        
        // Trigger the crash sound event so nearby players hear it
        CrashBase crashSite = CrashBase.Cast(wreck);
        if (crashSite)
        {
            crashSite.RequestSoundEvent();
            Log("Crash sound event triggered");
        }
        else
        {
            Log("WARNING: Could not cast to CrashBase for sound");
        }
        
        // Scatter typical heli crash loot around the wreck
        array<string> lootTable = new array<string>();
        lootTable.Insert("VSS");
        lootTable.Insert("FN_FAL");
        lootTable.Insert("SVD");
        lootTable.Insert("M4A1");
        lootTable.Insert("AKM");
        lootTable.Insert("LAR");
        lootTable.Insert("VSD");
        lootTable.Insert("Mag_VSS_10Rnd");
        lootTable.Insert("Mag_FAL_20Rnd");
        lootTable.Insert("Mag_SVD_10Rnd");
        lootTable.Insert("NVGoggles");
        lootTable.Insert("PlateCarrierVest");
        lootTable.Insert("HighCapacityVest_Black");
        lootTable.Insert("GhillieSuit_Mossy");
        lootTable.Insert("M67Grenade");
        lootTable.Insert("RGD5Grenade");
        
        static const int LOOT_ITEM_COUNT = 6;
        static const float LOOT_SCATTER_RADIUS = 5.0;
        
        for (int i = 0; i < LOOT_ITEM_COUNT; i++)
        {
            int randomIndex = Math.RandomInt(0, lootTable.Count());
            string itemClass = lootTable.Get(randomIndex);
            float offsetX = Math.RandomFloat(-LOOT_SCATTER_RADIUS, LOOT_SCATTER_RADIUS);
            float offsetZ = Math.RandomFloat(-LOOT_SCATTER_RADIUS, LOOT_SCATTER_RADIUS);
            vector lootPos = pos + Vector(offsetX, 0, offsetZ);
            GetGame().CreateObject(itemClass, lootPos, false);
            Log("Heli crash loot spawned: " + itemClass);
        }
        
        Log("Heli crash complete with " + LOOT_ITEM_COUNT.ToString() + " loot items");
    }
    
    // Stored data for delayed gas zone spawn
    protected vector m_PendingGasZonePos;
    
    static const float GAS_ZONE_ARTILLERY_DELAY = 5.0;
    static const float GAS_ZONE_AIRBORNE_OFFSET = 50.0;
    
    protected void ExecuteSpawnGasZone(string zoneType, string coords)
    {
        Log("Spawning gas zone at: " + coords);
        
        vector pos;
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 2)
            {
                float posX = parts.Get(0).ToFloat();
                float posZ;
                // Support both "X,Z" and "X,Y,Z" formats (same as heli crash)
                if (parts.Count() >= 3)
                {
                    posZ = parts.Get(2).ToFloat();
                }
                else
                {
                    posZ = parts.Get(1).ToFloat();
                }
                float posY = GetGame().SurfaceY(posX, posZ);
                pos = Vector(posX, posY, posZ);
                Log("Gas zone terrain height: " + posY.ToString());
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("ERROR: Invalid coords for gas zone spawn");
            return;
        }
        
        if (zoneType == "local")
        {
            // Small gas cloud (10m radius, ~6 min lifetime) - same as chem gas grenade
            // Use same CreateObject call as vanilla (Grenade_ChemGas.c)
            ContaminatedArea_Local localZone = ContaminatedArea_Local.Cast(GetGame().CreateObject("ContaminatedArea_Local", pos));
            if (localZone)
            {
                Log("Local gas zone spawned at: " + pos.ToString());
            }
            else
            {
                Log("ERROR: Failed to create ContaminatedArea_Local");
            }
        }
        else
        {
            // Full dynamic gas zone (120m radius) - bypasses CEApi.SpawnGroup which is diag-only
            // Play artillery sound first, then spawn zone after delay
            PlayGasZoneArtillerySound(pos);
            
            // Store position and schedule delayed spawn
            // Timer.Run requires Managed/Entity - CommandRelay is a plain class. Use CallLater instead (works with plain objects).
            m_PendingGasZonePos = pos;
            int delayMs = (int)(GAS_ZONE_ARTILLERY_DELAY * 1000);
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(this.DoDelayedGasZoneSpawn, delayMs, false);
            
            Log("Artillery incoming, gas zone will spawn in " + GAS_ZONE_ARTILLERY_DELAY.ToString() + " seconds");
        }
    }
    
    protected void PlayGasZoneArtillerySound(vector targetPos)
    {
        // Find closest artillery firing position (same logic as vanilla)
        vector artilleryPos = targetPos;
        array<vector> artilleryPoints = GetGame().GetMission().GetWorldData().GetArtyFiringPos();
        
        if (artilleryPoints && artilleryPoints.Count() > 0)
        {
            int closestIndex = 0;
            float closestDist = 0;
            
            foreach (int i, vector point : artilleryPoints)
            {
                float dist = vector.DistanceSq(point, targetPos);
                if (closestDist == 0 || dist < closestDist)
                {
                    closestDist = dist;
                    closestIndex = i;
                }
            }
            artilleryPos = artilleryPoints.Get(closestIndex);
        }
        
        // Calculate shell travel time based on distance
        float shellSpeed = 100.0;
        float travelTime = vector.Distance(artilleryPos, targetPos) / shellSpeed;
        float totalDelay = travelTime + GAS_ZONE_ARTILLERY_DELAY;
        
        // Send artillery sound RPC - Param3<firingPos, targetPos, delay>
        Param3<vector, vector, float> soundParams = new Param3<vector, vector, float>(artilleryPos, targetPos, totalDelay);
        array<ref Param> rpcParams = new array<ref Param>();
        rpcParams.Insert(soundParams);
        GetGame().RPC(null, ERPCs.RPC_SOUND_ARTILLERY_SINGLE, rpcParams, true);
        
        Log("Artillery sound sent from " + artilleryPos.ToString() + " to " + targetPos.ToString());
    }
    
    // Public entry point for MissionServer timer callback (Timer requires EntityBase target)
    void DoDelayedGasZoneSpawn()
    {
        SpawnDynamicGasZoneDelayed();
    }
    
    protected void SpawnDynamicGasZoneDelayed()
    {
        vector pos = m_PendingGasZonePos;
        vector offsetPos = pos;
        offsetPos[1] = offsetPos[1] + GAS_ZONE_AIRBORNE_OFFSET;
        
        // Play contamination/explosion sound at impact point
        Param1<vector> contaminationParams = new Param1<vector>(offsetPos);
        array<ref Param> rpcParams = new array<ref Param>();
        rpcParams.Insert(contaminationParams);
        GetGame().RPC(null, ERPCs.RPC_SOUND_CONTAMINATION, rpcParams, true);
        
        // Spawn the gas zone using CreateObject (bypasses diag-only SpawnGroup)
        ContaminatedArea_Dynamic gasZone = ContaminatedArea_Dynamic.Cast(GetGame().CreateObject("ContaminatedArea_Dynamic", pos));
        if (gasZone)
        {
            // Manually initialize the zone since EEOnCECreate won't be called
            // First set up the zone data with proper particle IDs
            EffectAreaParams params = new EffectAreaParams();
            params.m_ParamName = string.Format("CommandRelay Dynamic Area (%1)", pos.ToString());
            params.m_ParamPartId = ParticleList.CONTAMINATED_AREA_GAS_BIGASS;
            params.m_ParamAroundPartId = ParticleList.CONTAMINATED_AREA_GAS_AROUND;
            params.m_ParamTinyPartId = ParticleList.CONTAMINATED_AREA_GAS_TINY;
            params.m_ParamPosHeight = 7;
            params.m_ParamNegHeight = 10;
            params.m_ParamRadius = 120;
            params.m_ParamInnerRings = 1;
            params.m_ParamInnerSpace = 40;
            params.m_ParamOuterSpace = 30;
            params.m_ParamOuterOffset = 0;
            params.m_ParamTriggerType = "ContaminatedTrigger_Dynamic";
            params.m_ParamPpeRequesterType = "PPERequester_ContaminatedAreaTint";
            
            gasZone.SetupZoneData(params);
            
            // Set to LIVE state and initialize
            gasZone.SetDecayState(eAreaDecayStage.LIVE);
            gasZone.InitZone();
            
            // Sync to clients
            gasZone.SetSynchDirty();
            
            Log("Dynamic gas zone spawned and initialized at: " + pos.ToString());
        }
        else
        {
            Log("ERROR: Failed to create ContaminatedArea_Dynamic");
        }
        
        // Spawn chem grenades as loot (same as vanilla)
        SpawnGasZoneLoot(pos);
        
        m_PendingGasZonePos = vector.Zero;
    }
    
    protected void SpawnGasZoneLoot(vector centerPos)
    {
        static const int GRENADE_COUNT_MIN = 2;
        static const int GRENADE_COUNT_MAX = 5;
        static const float LOOT_RADIUS_MIN = 5.0;
        static const float LOOT_RADIUS_MAX = 15.0;
        
        int grenadeCount = Math.RandomIntInclusive(GRENADE_COUNT_MIN, GRENADE_COUNT_MAX);
        
        for (int i = 0; i < grenadeCount; i++)
        {
            vector randomDir = vector.RandomDir2D();
            float randomDist = Math.RandomFloatInclusive(LOOT_RADIUS_MIN, LOOT_RADIUS_MAX);
            vector spawnPos = centerPos + (randomDir * randomDist);
            GetGame().CreateObjectEx("Grenade_ChemGas", spawnPos, ECE_PLACE_ON_SURFACE);
        }
        
        Log("Spawned " + grenadeCount.ToString() + " chem grenades around gas zone");
    }
    
    protected void ExecuteSetDoorsInRadius(array<Man> players, string playerId, string radiusStr, bool openDoors)
    {
        string action;
        if (openDoors)
        {
            action = "Opening";
        }
        else
        {
            action = "Closing";
        }
        Log("" + action + " doors near player: " + playerId);
        
        static const float DEFAULT_DOOR_RADIUS = 30.0;
        static const float MAX_DOOR_RADIUS = 100.0;
        
        float radius = DEFAULT_DOOR_RADIUS;
        if (radiusStr != "")
        {
            radius = radiusStr.ToFloat();
        }
        if (radius <= 0)
        {
            radius = DEFAULT_DOOR_RADIUS;
        }
        if (radius > MAX_DOOR_RADIUS)
        {
            radius = MAX_DOOR_RADIUS;
        }
        
        PlayerBase player = FindPlayerById(players, playerId);
        if (!player)
        {
            Log("ERROR: Player not found: " + playerId);
            return;
        }
        
        vector playerPos = player.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(playerPos, radius, objects, proxyCargos);
        
        int buildingCount = 0;
        int doorCount = 0;
        
        for (int i = 0; i < objects.Count(); i++)
        {
            Building building = Building.Cast(objects.Get(i));
            if (!building)
            {
                continue;
            }
            
            int numDoors = building.GetDoorCount();
            if (numDoors <= 0)
            {
                continue;
            }
            
            buildingCount++;
            
            for (int j = 0; j < numDoors; j++)
            {
                if (openDoors)
                {
                    bool isLocked = building.IsDoorLocked(j);
                    if (isLocked)
                    {
                        building.UnlockDoor(j);
                    }
                    
                    bool isAlreadyOpen = building.IsDoorOpen(j);
                    if (!isAlreadyOpen)
                    {
                        building.OpenDoor(j);
                        doorCount++;
                    }
                }
                else
                {
                    bool isAlreadyClosed = building.IsDoorClosed(j);
                    if (!isAlreadyClosed)
                    {
                        building.CloseDoor(j);
                        doorCount++;
                    }
                }
            }
        }
        
        Log("" + action + " " + doorCount.ToString() + " doors across " + buildingCount.ToString() + " buildings");
    }
    
    protected void ExecuteLootMagnet(array<Man> players, string playerId, string radiusStr)
    {
        Log("Loot magnet for: " + playerId);
        
        float rad = 25;
        if (radiusStr != "")
        {
            rad = radiusStr.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 100)
        {
            rad = 100;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        vector playerPos = pb.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(playerPos, rad, objects, proxyCargos);
        
        int count = 0;
        float pileRadius = 0.5;
        
        for (int i = 0; i < objects.Count(); i++)
        {
            Object obj = objects.Get(i);
            if (!obj)
            {
                continue;
            }
            
            // Skip players
            if (PlayerBase.Cast(obj))
            {
                continue;
            }
            
            // Skip zombies
            if (ZombieBase.Cast(obj))
            {
                continue;
            }
            
            // Skip animals
            if (AnimalBase.Cast(obj))
            {
                continue;
            }
            
            // Skip vehicles
            if (Car.Cast(obj))
            {
                continue;
            }
            
            // Skip buildings and base building
            if (Building.Cast(obj) || BaseBuildingBase.Cast(obj))
            {
                continue;
            }
            
            // Skip large containers (tents, barrels, etc)
            if (TentBase.Cast(obj) || Container_Base.Cast(obj))
            {
                continue;
            }
            
            // Must be an EntityAI (item)
            EntityAI entity = EntityAI.Cast(obj);
            if (!entity)
            {
                continue;
            }
            
            // Skip items that are in someone's inventory
            EntityAI parent = entity.GetHierarchyParent();
            if (parent)
            {
                continue;
            }
            
            // Calculate random offset for pile spread
            float angle = Math.RandomFloat(0, Math.PI2);
            float dist = Math.RandomFloat(0.1, pileRadius);
            float offsetX = Math.Cos(angle) * dist;
            float offsetZ = Math.Sin(angle) * dist;
            
            vector newPos = playerPos + Vector(offsetX, 0, offsetZ);
            entity.SetPosition(newPos);
            count++;
        }
        
        Log("Loot magnet collected " + count.ToString() + " items");
    }
    
    protected void ExecuteDeleteVehicle(array<Man> players, string playerId, string radius)
    {
        Log("Deleting vehicles near: " + playerId);
        
        float rad = 10;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 100)
        {
            rad = 100;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            
            array<Object> objects = new array<Object>();
            array<CargoBase> proxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(pos, rad, objects, proxyCargos);
            
            int count = 0;
            for (int j = 0; j < objects.Count(); j++)
            {
                Car vehicle = Car.Cast(objects.Get(j));
                if (vehicle)
                {
                    GetGame().ObjectDelete(vehicle);
                    count++;
                }
            }
            Log("Deleted " + count.ToString() + " vehicles");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSpawnItemAt(string itemClass, string coords)
    {
        Log("Spawning item: " + itemClass + " at: " + coords);
        
        if (itemClass == "")
        {
            Log("No item class specified");
            return;
        }
        
        if (coords == "")
        {
            Log("No coordinates specified");
            return;
        }
        
        array<string> parts = new array<string>();
        coords.Split(",", parts);
        if (parts.Count() < 3)
        {
            Log("Invalid coordinates format: " + coords);
            return;
        }
        
        float posX = parts.Get(0).ToFloat();
        float posY = parts.Get(1).ToFloat();
        float posZ = parts.Get(2).ToFloat();
        vector pos = Vector(posX, posY, posZ);
        
        // Get ground level at position if Y is 0
        if (posY == 0)
        {
            posY = GetGame().SurfaceY(posX, posZ);
            pos = Vector(posX, posY, posZ);
        }
        
        Log("Creating item at position: " + pos.ToString());
        
        EntityAI item = EntityAI.Cast(GetGame().CreateObject(itemClass, pos, false, true));
        if (item)
        {
            Log("Item spawned: " + itemClass + " at " + pos.ToString());
        }
        else
        {
            Log("Failed to spawn item: " + itemClass + " (invalid classname?)");
        }
    }
    
    protected void ExecuteBreakLegs(array<Man> players, string playerId)
    {
        Log("Breaking legs for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetHealth("LeftLeg", "Health", 0);
            pb.SetHealth("RightLeg", "Health", 0);
            Log("Broke legs for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteMakeSick(array<Man> players, string playerId, string diseaseType)
    {
        Log("Making player sick: " + playerId + " with: " + diseaseType);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            if (diseaseType == "" || diseaseType == "cholera")
            {
                pb.InsertAgent(eAgents.CHOLERA, 1);
            }
            else if (diseaseType == "influenza")
            {
                pb.InsertAgent(eAgents.INFLUENZA, 1);
            }
            else if (diseaseType == "salmonella")
            {
                pb.InsertAgent(eAgents.SALMONELLA, 1);
            }
            else if (diseaseType == "wound")
            {
                pb.InsertAgent(eAgents.WOUND_AGENT, 1);
            }
            Log("Made " + pb.GetIdentity().GetName() + " sick with " + diseaseType);
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteCurePlayer(array<Man> players, string playerId)
    {
        Log("Curing player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.RemoveAllAgents();
            Log("Cured: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSetBloodType(array<Man> players, string playerId, string bloodType)
    {
        Log("Setting blood type for: " + playerId + " to: " + bloodType);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Blood type values: 0=O+, 1=O-, 2=A+, 3=A-, 4=B+, 5=B-, 6=AB+, 7=AB-
            int type = 0;
            if (bloodType == "O+")
            {
                type = 0;
            }
            else if (bloodType == "O-")
            {
                type = 1;
            }
            else if (bloodType == "A+")
            {
                type = 2;
            }
            else if (bloodType == "A-")
            {
                type = 3;
            }
            else if (bloodType == "B+")
            {
                type = 4;
            }
            else if (bloodType == "B-")
            {
                type = 5;
            }
            else if (bloodType == "AB+")
            {
                type = 6;
            }
            else if (bloodType == "AB-")
            {
                type = 7;
            }
            
            pb.SetBloodType(type);
            Log("Set blood type for " + pb.GetIdentity().GetName() + " to " + bloodType);
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteForceDrink(array<Man> players, string playerId)
    {
        Log("Force drinking for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.GetStatWater().Set(pb.GetStatWater().GetMax());
            Log("Fully hydrated: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteForceEat(array<Man> players, string playerId)
    {
        Log("Force eating for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.GetStatEnergy().Set(pb.GetStatEnergy().GetMax());
            Log("Fully fed: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetServerInfo(array<Man> players, string commandId)
    {
        Log("Getting server info");
        
        int playerCount = players.Count();
        
        int year, month, day, hour, minute;
        GetGame().GetWorld().GetDate(year, month, day, hour, minute);
        
        // Server uptime in seconds
        int uptimeMs = GetGame().GetTime();
        int uptimeSec = uptimeMs / 1000;
        int uptimeMin = uptimeSec / 60;
        int uptimeHour = uptimeMin / 60;
        
        // FPS stats
        float fps = GetGame().GetLastFPS();
        float avgFps = GetGame().GetAvgFPS(64);
        float minFps = GetGame().GetMinFPS(64);
        float maxFps = GetGame().GetMaxFPS(64);
        float tickTime = GetGame().GetTickTime();
        
        // Weather info
        Weather weather = GetGame().GetWeather();
        float overcast = 0;
        float rain = 0;
        float fog = 0;
        float snowfall = 0;
        float windSpeed = 0;
        float windDirection = 0;
        float windMagnitude = 0;
        
        if (weather)
        {
            overcast = weather.GetOvercast().GetActual();
            rain = weather.GetRain().GetActual();
            fog = weather.GetFog().GetActual();
            snowfall = weather.GetSnowfall().GetActual();
            windSpeed = weather.GetWindSpeed();
            windDirection = weather.GetWindDirection().GetActual();
            windMagnitude = weather.GetWindMagnitude().GetActual();
        }
        
        // World info
        string mapName = GetGame().GetWorldName();
        bool isNight = GetGame().GetWorld().IsNight();
        int worldSize = GetGame().GetWorld().GetWorldSize();
        
        string data = "{\"type\":\"server_info\"";
        data = data + ",\"player_count\":" + playerCount.ToString();
        data = data + ",\"map\":\"" + mapName + "\"";
        data = data + ",\"is_night\":" + isNight.ToString();
        data = data + ",\"world_size\":" + worldSize.ToString();
        data = data + ",\"date\":\"" + year.ToString() + "-" + month.ToString() + "-" + day.ToString() + "\"";
        data = data + ",\"time\":\"" + hour.ToString() + ":" + minute.ToString() + "\"";
        data = data + ",\"uptime_hours\":" + uptimeHour.ToString();
        data = data + ",\"uptime_minutes\":" + (uptimeMin % 60).ToString();
        data = data + ",\"uptime_seconds\":" + (uptimeSec % 60).ToString();
        data = data + ",\"fps\":" + FloatToString(fps, 2);
        data = data + ",\"avg_fps\":" + FloatToString(avgFps, 2);
        data = data + ",\"min_fps\":" + FloatToString(minFps, 2);
        data = data + ",\"max_fps\":" + FloatToString(maxFps, 2);
        data = data + ",\"tick_time\":" + FloatToString(tickTime, 2);
        data = data + ",\"weather\":{";
        data = data + "\"overcast\":" + FloatToString(overcast, 2);
        data = data + ",\"rain\":" + FloatToString(rain, 2);
        data = data + ",\"fog\":" + FloatToString(fog, 2);
        data = data + ",\"snowfall\":" + FloatToString(snowfall, 2);
        data = data + ",\"wind_speed\":" + FloatToString(windSpeed, 2);
        data = data + ",\"wind_direction\":" + FloatToString(windDirection, 2);
        data = data + ",\"wind_magnitude\":" + FloatToString(windMagnitude, 2);
        data = data + "}}";
        
        SendQueryResponse(commandId, data);
        Log("Sent server info");
    }
    
    protected void ExecuteSpawnSupplyCrate(string crateType, string coords)
    {
        Log("Spawning supply crate at: " + coords);
        
        vector pos = vector.Zero;
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("Invalid coords for crate spawn");
            return;
        }
        
        string containerClass = "WoodenCrate";
        if (crateType == "military") containerClass = "SeaChest";
        else if (crateType == "medical") containerClass = "MedicalCase";
        else if (crateType == "ammo") containerClass = "AmmoBox";
        // food, survival, tools, hunter use WoodenCrate (default)
        
        Object obj = GetGame().CreateObject(containerClass, pos, false, true);
        if (!obj)
        {
            Log("Failed to create crate");
            return;
        }
        
        obj.SetPosition(pos);
        obj.Update();
        
        Container_Base crate = Container_Base.Cast(obj);
        
        // Fill with appropriate loot based on type
        if (crateType == "military" || crateType == "")
        {
            crate.GetInventory().CreateInInventory("AKM");
            crate.GetInventory().CreateInInventory("Mag_AKM_30Rnd");
            crate.GetInventory().CreateInInventory("Mag_AKM_30Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_762x39_20Rnd");
            crate.GetInventory().CreateInInventory("PlateCarrierVest");
            crate.GetInventory().CreateInInventory("AssaultBag_Black");
        }
        else if (crateType == "medical")
        {
            crate.GetInventory().CreateInInventory("Morphine");
            crate.GetInventory().CreateInInventory("Epinephrine");
            crate.GetInventory().CreateInInventory("SalineBagIV");
            crate.GetInventory().CreateInInventory("BandageDressing");
            crate.GetInventory().CreateInInventory("BandageDressing");
            crate.GetInventory().CreateInInventory("Tetracycline");
        }
        else if (crateType == "ammo")
        {
            crate.GetInventory().CreateInInventory("AmmoBox_762x39_20Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_762x39_20Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_556x45_20Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_556x45_20Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_308Win_20Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_9x19_25Rnd");
        }
        else if (crateType == "food")
        {
            crate.GetInventory().CreateInInventory("BakedBeansCan");
            crate.GetInventory().CreateInInventory("TacticalBaconCan");
            crate.GetInventory().CreateInInventory("TunaCan");
            crate.GetInventory().CreateInInventory("SardinesCan");
            crate.GetInventory().CreateInInventory("WaterBottle");
            crate.GetInventory().CreateInInventory("WaterBottle");
            crate.GetInventory().CreateInInventory("Apple");
            crate.GetInventory().CreateInInventory("Orange");
        }
        else if (crateType == "survival")
        {
            crate.GetInventory().CreateInInventory("Matchbox");
            crate.GetInventory().CreateInInventory("BandageDressing");
            crate.GetInventory().CreateInInventory("BandageDressing");
            crate.GetInventory().CreateInInventory("Rag");
            crate.GetInventory().CreateInInventory("Rag");
            crate.GetInventory().CreateInInventory("Rope");
            crate.GetInventory().CreateInInventory("HuntingKnife");
            crate.GetInventory().CreateInInventory("Compass");
            crate.GetInventory().CreateInInventory("Flashlight");
        }
        else if (crateType == "tools")
        {
            crate.GetInventory().CreateInInventory("Hammer");
            crate.GetInventory().CreateInInventory("Pliers");
            crate.GetInventory().CreateInInventory("Wrench");
            crate.GetInventory().CreateInInventory("Screwdriver");
            crate.GetInventory().CreateInInventory("DuctTape");
            crate.GetInventory().CreateInInventory("NailBox");
            crate.GetInventory().CreateInInventory("Lockpick");
            crate.GetInventory().CreateInInventory("EpoxyPutty");
            crate.GetInventory().CreateInInventory("HandSaw");
        }
        else if (crateType == "hunter")
        {
            crate.GetInventory().CreateInInventory("Mosin9130");
            crate.GetInventory().CreateInInventory("Mag_CLIP762x54_5Rnd");
            crate.GetInventory().CreateInInventory("Mag_CLIP762x54_5Rnd");
            crate.GetInventory().CreateInInventory("AmmoBox_762x54_20Rnd");
            crate.GetInventory().CreateInInventory("HuntingVest");
            crate.GetInventory().CreateInInventory("HuntingKnife");
            crate.GetInventory().CreateInInventory("HuntingBag");
        }
        
        Log("Supply crate spawned: " + containerClass);
    }

    // Spawn a crate at coords (param_1) and fill it using an encoded JSON object (param_2).
    // Expected payload (as a JSON object string):
    // {"crate":"SeaChest","items":[{"class":"AKM","qty":1},{"class":"Mag_AKM_30Rnd","qty":3}]}
    protected void ExecuteSpawnSupplyCrateJson(string coords, string payload)
    {
        Log("Spawning JSON supply crate at: " + coords);
        
        vector pos = vector.Zero;
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("Invalid coords for JSON crate spawn");
            return;
        }
        
        if (payload == "")
        {
            Log("Empty payload for JSON crate spawn");
            return;
        }
        
        // Only allow known safe container classes by default.
        // If crate is missing/invalid, default to WoodenCrate.
        string containerClass = ExtractJsonString(payload, "crate");
        if (containerClass == "")
        {
            containerClass = "WoodenCrate";
        }
        
        bool containerAllowed = (containerClass == "WoodenCrate" || containerClass == "SeaChest" || containerClass == "MedicalCase" || containerClass == "AmmoBox");
        if (!containerAllowed)
        {
            Log("Disallowed crate class: " + containerClass + " (defaulting to WoodenCrate)");
            containerClass = "WoodenCrate";
        }
        
        Object obj = GetGame().CreateObject(containerClass, pos, false, true);
        if (!obj)
        {
            Log("Failed to create JSON crate");
            return;
        }
        
        obj.SetPosition(pos);
        obj.Update();
        
        Container_Base crate = Container_Base.Cast(obj);
        if (!crate || !crate.GetInventory())
        {
            Log("Created crate but inventory is null");
            return;
        }
        
        // Parse items array from payload.
        int itemsIdx = payload.IndexOf("\"items\"");
        if (itemsIdx == -1)
        {
            Log("Payload missing items[]");
            return;
        }
        
        int arrayStart = payload.IndexOfFrom(itemsIdx, "[");
        int arrayEnd = payload.IndexOfFrom(itemsIdx, "]");
        if (arrayStart == -1 || arrayEnd == -1 || arrayEnd <= arrayStart)
        {
            Log("Invalid items[] in payload");
            return;
        }
        
        string itemsArray = payload.Substring(arrayStart + 1, arrayEnd - arrayStart - 1);
        
        int maxDistinct = 50;
        int maxQtyPerItem = 20;
        
        int posObj = 0;
        int lenObj = itemsArray.Length();
        int createdDistinct = 0;
        
        while (posObj < lenObj && createdDistinct < maxDistinct)
        {
            int itemStart = itemsArray.IndexOfFrom(posObj, "{");
            if (itemStart == -1) break;
            
            int itemEnd = FindJsonObjectEnd(itemsArray, itemStart);
            if (itemEnd == -1) break;
            
            string itemObj = itemsArray.Substring(itemStart + 1, itemEnd - itemStart - 1);
            
            string className = ExtractJsonString(itemObj, "class");
            if (className == "")
            {
                posObj = itemEnd + 1;
                continue;
            }
            
            int qty = ExtractJsonInt(itemObj, "qty");
            if (qty <= 0) qty = 1;
            if (qty > maxQtyPerItem) qty = maxQtyPerItem;
            
            // Create items; ignore failures (e.g. invalid classname)
            for (int k = 0; k < qty; k++)
            {
                EntityAI created = crate.GetInventory().CreateInInventory(className);
                if (!created)
                {
                    Log("Failed to create item: " + className);
                    break;
                }
            }
            
            createdDistinct++;
            posObj = itemEnd + 1;
        }
        
        Log("JSON supply crate spawned: " + containerClass);
    }

    // Extracts an integer value for a given key from a JSON object fragment.
    // Supports: "key":123 and "key": 123
    protected int ExtractJsonInt(string json, string key)
    {
        string search = "\"" + key + "\":";
        int start = json.IndexOf(search);
        if (start == -1)
        {
            return 0;
        }
        
        start = start + search.Length();
        
        // Skip whitespace
        int len = json.Length();
        while (start < len)
        {
            string ch = json.Get(start);
            int code = ch.ToAscii();
            if (code != 32 && code != 9 && code != 10 && code != 13)
            {
                break;
            }
            start++;
        }
        
        // Read optional minus + digits
        ref array<string> digits = new array<string>();
        if (start < len && json.Get(start) == "-")
        {
            digits.Insert("-");
            start++;
        }
        
        while (start < len)
        {
            string d = json.Get(start);
            int code2 = d.ToAscii();
            if (code2 >= 48 && code2 <= 57)
            {
                digits.Insert(d);
                start++;
            }
            else
            {
                break;
            }
        }
        
        if (digits.Count() == 0)
        {
            return 0;
        }
        
        string num = string.Join("", digits);
        return num.ToInt();
    }
    
    // =============================================================================
    // NEW PLAYER MANAGEMENT COMMANDS
    // =============================================================================
    
    protected void ExecuteBanPlayer(array<Man> players, string playerId, string reason)
    {
        Log("Banning player: " + playerId);
        
        // Add to ban list (works even if player is offline)
        string playerName = "Unknown";
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb && pb.GetIdentity())
        {
            playerName = pb.GetIdentity().GetName();
        }
        
        AddBan(playerId, playerName, reason);
        GetGame().AdminLog("[DayZCommandRelay] Banned: " + playerName + " (" + playerId + ") - Reason: " + reason);
        
        // Disconnect if currently online
        if (pb && pb.GetIdentity())
        {
            GetGame().DisconnectPlayer(pb.GetIdentity());
            Log("Banned and disconnected: " + playerName);
            return;
        }
        
        Log("Banned (offline): " + playerId);
    }
    
    protected void ExecuteUnbanPlayer(string playerId)
    {
        Log("Unbanning player: " + playerId);
        
        bool removed = RemoveBan(playerId);
        if (removed)
        {
            GetGame().AdminLog("[DayZCommandRelay] Unbanned player: " + playerId);
        }
        else
        {
            Log("No ban found for: " + playerId);
        }
    }
    
    protected void ExecuteGetBans(string commandId)
    {
        Log("Getting ban list");
        
        int banCount = m_Bans.bans.Count();
        
        string data = "{\"type\":\"ban_list\",\"count\":" + banCount.ToString() + ",\"bans\":[";
        
        for (int i = 0; i < banCount; i++)
        {
            CommandRelayBanEntry entry = m_Bans.bans.Get(i);
            
            if (i > 0)
            {
                data = data + ",";
            }
            
            data = data + "{\"player_id\":\"" + entry.player_id + "\"";
            data = data + ",\"player_name\":\"" + JsonEscape(entry.player_name) + "\"";
            data = data + ",\"reason\":\"" + JsonEscape(entry.reason) + "\"";
            data = data + ",\"banned_at\":\"" + entry.banned_at + "\"}";
        }
        
        data = data + "]}";
        
        SendQueryResponse(commandId, data);
    }
    
    protected void ExecuteSetGodmode(array<Man> players, string playerId, bool enable)
    {
        string action;
        if (enable)
        {
            action = "Enabling";
        }
        else
        {
            action = "Disabling";
        }
        
        Log("" + action + " godmode for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetAllowDamage(!enable);
            Log("Godmode " + action.ToLower() + " for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSetInvisible(array<Man> players, string playerId, bool enable)
    {
        string action;
        if (enable)
        {
            action = "Making invisible";
        }
        else
        {
            action = "Making visible";
        }
        
        Log("" + action + ": " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            if (enable)
            {
                pb.SetInvisible(true);
            }
            else
            {
                pb.SetInvisible(false);
            }
            Log("" + action + ": " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteRespawnPlayer(array<Man> players, string playerId)
    {
        Log("Respawning player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Kill the player to trigger respawn
            pb.SetHealth("GlobalHealth", "Health", 0);
            Log("Respawning: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    // =============================================================================
    // NEW INVENTORY COMMANDS
    // =============================================================================
    
    protected void ExecuteClearInventory(array<Man> players, string playerId)
    {
        Log("Clearing inventory for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Clear hands
            EntityAI hands = pb.GetItemInHands();
            if (hands)
            {
                pb.ServerDropEntity(hands);
            }
            
            // Clear all cargo items but keep clothing
            array<EntityAI> items = new array<EntityAI>();
            pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
            
            for (int j = 0; j < items.Count(); j++)
            {
                EntityAI item = items.Get(j);
                if (item && item != pb)
                {
                    // Skip clothing items - only delete cargo/inventory items
                    if (!item.IsClothing())
                    {
                        GetGame().ObjectDelete(item);
                    }
                }
            }
            Log("Cleared inventory for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSpawnItemAttached(array<Man> players, string playerId, string itemClass, string attachments)
    {
        Log("Spawning item with attachments: " + itemClass + " for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            EntityAI item = EntityAI.Cast(GetGame().CreateObject(itemClass, pos, false));
            
            if (item && attachments != "")
            {
                // Parse attachments (comma-separated)
                array<string> attachList = new array<string>();
                attachments.Split(",", attachList);
                
                for (int a = 0; a < attachList.Count(); a++)
                {
                    string attachClass = attachList.Get(a);
                    attachClass.Trim();
                    if (attachClass != "")
                    {
                        item.GetInventory().CreateAttachment(attachClass);
                    }
                }
            }
            Log("Spawned " + itemClass + " with attachments");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteFillMagazines(array<Man> players, string playerId)
    {
        Log("Filling magazines for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            array<EntityAI> items = new array<EntityAI>();
            pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
            
            int magCount = 0;
            for (int j = 0; j < items.Count(); j++)
            {
                Magazine mag = Magazine.Cast(items.Get(j));
                if (mag)
                {
                    mag.ServerSetAmmoCount(mag.GetAmmoMax());
                    magCount++;
                }
            }
            Log("Filled " + magCount.ToString() + " magazines for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSpawnLootPile(array<Man> players, string playerId, string lootType, string coords)
    {
        Log("Spawning loot pile");
        
        vector pos;
        
        // Use coords if provided
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                pos = Vector(parts.Get(0).ToFloat(), parts.Get(1).ToFloat(), parts.Get(2).ToFloat());
            }
        }
        
        // Otherwise use player position
        if (pos == vector.Zero && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                pos = pb.GetPosition();
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("No valid position for loot pile");
            return;
        }
        
        // Define loot arrays based on type
        array<string> lootItems = new array<string>();
        
        if (lootType == "military")
        {
            lootItems.Insert("AKM");
            lootItems.Insert("M4A1");
            lootItems.Insert("Mag_AKM_30Rnd");
            lootItems.Insert("Mag_STANAG_30Rnd");
            lootItems.Insert("PlateCarrierVest");
            lootItems.Insert("TacticalGloves_Black");
            lootItems.Insert("MilitaryBoots_Black");
        }
        else if (lootType == "medical")
        {
            lootItems.Insert("Morphine");
            lootItems.Insert("Epinephrine");
            lootItems.Insert("SalineBagIV");
            lootItems.Insert("BandageDressing");
            lootItems.Insert("Tetracycline");
            lootItems.Insert("Codeine");
        }
        else if (lootType == "food")
        {
            lootItems.Insert("TacticalBaconCan");
            lootItems.Insert("PeachesCan");
            lootItems.Insert("SpaghettiCan");
            lootItems.Insert("SodaCan_Cola");
            lootItems.Insert("WaterBottle");
            lootItems.Insert("Apple");
        }
        else // random/default
        {
            lootItems.Insert("Apple");
            lootItems.Insert("Canteen");
            lootItems.Insert("Rag");
            lootItems.Insert("KitchenKnife");
            lootItems.Insert("Compass");
            lootItems.Insert("Flashlight");
        }
        
        // Spawn items in a small area
        for (int j = 0; j < lootItems.Count(); j++)
        {
            vector spawnPos = pos + Vector(Math.RandomFloat(-2, 2), 0, Math.RandomFloat(-2, 2));
            GetGame().CreateObject(lootItems.Get(j), spawnPos, false);
        }
        
        Log("Spawned loot pile with " + lootItems.Count().ToString() + " items");
    }
    
    // =============================================================================
    // NEW QUERY COMMANDS
    // =============================================================================
    
    protected void ExecuteGetPlayerInventory(array<Man> players, string commandId, string playerId)
    {
        Log("Getting full inventory for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            string name = JsonEscape(pb.GetIdentity().GetName());
            
            array<EntityAI> items = new array<EntityAI>();
            pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
            
            string itemList = "";
            int itemCount = 0;
            
            for (int j = 0; j < items.Count(); j++)
            {
                EntityAI item = items.Get(j);
                if (item && item != pb)
                {
                    if (itemList != "")
                    {
                        itemList = itemList + ",";
                    }
                    
                    string itemType = item.GetType();
                    int quantity = 1;
                    
                    // Get quantity for stackable items
                    ItemBase itemBase = ItemBase.Cast(item);
                    if (itemBase && itemBase.HasQuantity())
                    {
                        quantity = itemBase.GetQuantity();
                    }
                    
                    string entry = "{\"class\":\"" + itemType + "\",\"quantity\":" + quantity.ToString() + "}";
                    itemList = itemList + entry;
                    itemCount++;
                }
            }
            
            string data = "{\"type\":\"player_inventory\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"item_count\":" + itemCount.ToString();
            data = data + ",\"items\":[" + itemList + "]}";
            
            SendQueryResponse(commandId, data);
            Log("Sent inventory for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_inventory\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetPlayerStats(array<Man> players, string commandId, string playerId)
    {
        Log("Getting all stats for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            string name = JsonEscape(pb.GetIdentity().GetName());
            
            float health = pb.GetHealth("GlobalHealth", "Health");
            float blood = pb.GetHealth("GlobalHealth", "Blood");
            float shock = pb.GetHealth("GlobalHealth", "Shock");
            float water = pb.GetStatWater().Get();
            float energy = pb.GetStatEnergy().Get();
            float stamina = pb.GetStatStamina().Get();
            float heatComfort = pb.GetStatHeatComfort().Get();
            float tremor = pb.GetStatTremor().Get();
            float wet = pb.GetStatWet().Get();
            
            int isAlive = 1;
            if (!pb.IsAlive())
            {
                isAlive = 0;
            }
            
            int isBleeding = 0;
            if (pb.IsBleeding())
            {
                isBleeding = 1;
            }
            
            int isUnconscious = 0;
            if (pb.IsUnconscious())
            {
                isUnconscious = 1;
            }
            
            int hasBrokenLegs = 0;
            if (pb.GetBrokenLegs() == eBrokenLegs.BROKEN_LEGS)
            {
                hasBrokenLegs = 1;
            }
            
            int bloodType = pb.GetBloodType();
            string bloodTypeStr = "O+";
            if (bloodType == 1)
            {
                bloodTypeStr = "O-";
            }
            else if (bloodType == 2)
            {
                bloodTypeStr = "A+";
            }
            else if (bloodType == 3)
            {
                bloodTypeStr = "A-";
            }
            else if (bloodType == 4)
            {
                bloodTypeStr = "B+";
            }
            else if (bloodType == 5)
            {
                bloodTypeStr = "B-";
            }
            else if (bloodType == 6)
            {
                bloodTypeStr = "AB+";
            }
            else if (bloodType == 7)
            {
                bloodTypeStr = "AB-";
            }
            
            string data = "{\"type\":\"player_stats\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"alive\":" + isAlive.ToString();
            data = data + ",\"health\":" + FloatToString(health, 1);
            data = data + ",\"blood\":" + FloatToString(blood, 1);
            data = data + ",\"shock\":" + FloatToString(shock, 1);
            data = data + ",\"water\":" + FloatToString(water, 1);
            data = data + ",\"energy\":" + FloatToString(energy, 1);
            data = data + ",\"stamina\":" + FloatToString(stamina, 1);
            data = data + ",\"heat_comfort\":" + FloatToString(heatComfort, 2);
            data = data + ",\"tremor\":" + FloatToString(tremor, 2);
            data = data + ",\"wet\":" + FloatToString(wet, 2);
            data = data + ",\"bleeding\":" + isBleeding.ToString();
            data = data + ",\"unconscious\":" + isUnconscious.ToString();
            data = data + ",\"broken_legs\":" + hasBrokenLegs.ToString();
            data = data + ",\"blood_type\":\"" + bloodTypeStr + "\"}";
            
            SendQueryResponse(commandId, data);
            Log("Sent stats for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_stats\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetPlayerFull(array<Man> players, string commandId, string playerId)
    {
        Log("Getting full player data for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Basic info
            string name = JsonEscape(pb.GetIdentity().GetName());
            vector pos = pb.GetPosition();
            int sessionMins = GetSessionMinutes(playerId);
            int dir = GetPlayerDirection(pb);
            
            // Item in hands
            string handsItem = "";
            EntityAI itemInHands = pb.GetItemInHands();
            if (itemInHands)
            {
                handsItem = itemInHands.GetType();
            }
            
            // Health stats
            float health = pb.GetHealth("GlobalHealth", "Health");
            float blood = pb.GetHealth("GlobalHealth", "Blood");
            float shock = pb.GetHealth("GlobalHealth", "Shock");
            
            // Survival stats
            float water = pb.GetStatWater().Get();
            float energy = pb.GetStatEnergy().Get();
            float stamina = pb.GetStatStamina().Get();
            float heatComfort = pb.GetStatHeatComfort().Get();
            float tremor = pb.GetStatTremor().Get();
            float wet = pb.GetStatWet().Get();
            
            // Status flags
            int isAlive = 0;
            if (pb.IsAlive())
            {
                isAlive = 1;
            }
            int isBleeding = 0;
            if (pb.IsBleeding())
            {
                isBleeding = 1;
            }
            int isUnconscious = 0;
            if (pb.IsUnconscious())
            {
                isUnconscious = 1;
            }
            int hasBrokenLegs = 0;
            if (pb.GetBrokenLegs() == eBrokenLegs.BROKEN_LEGS)
            {
                hasBrokenLegs = 1;
            }
            
            // Blood type
            int bloodType = pb.GetBloodType();
            string bloodTypeStr = "O+";
            if (bloodType == 1)
            {
                bloodTypeStr = "O-";
            }
            else if (bloodType == 2)
            {
                bloodTypeStr = "A+";
            }
            else if (bloodType == 3)
            {
                bloodTypeStr = "A-";
            }
            else if (bloodType == 4)
            {
                bloodTypeStr = "B+";
            }
            else if (bloodType == 5)
            {
                bloodTypeStr = "B-";
            }
            else if (bloodType == 6)
            {
                bloodTypeStr = "AB+";
            }
            else if (bloodType == 7)
            {
                bloodTypeStr = "AB-";
            }
            
            // Build JSON response with optimized precision
            string posJson = Vector3InfoForApi(pos);
            
            string data = "{\"type\":\"player_full\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"name\":\"" + name + "\"";
            data = data + ",\"session_minutes\":" + sessionMins.ToString();
            data = data + ",\"alive\":" + isAlive.ToString();
            data = data + ",\"position\":" + posJson;
            data = data + ",\"dir\":" + dir.ToString();
            data = data + ",\"item_in_hands\":\"" + handsItem + "\"";
            data = data + ",\"health\":" + FloatToString(health, 1);
            data = data + ",\"blood\":" + FloatToString(blood, 1);
            data = data + ",\"shock\":" + FloatToString(shock, 1);
            data = data + ",\"water\":" + FloatToString(water, 1);
            data = data + ",\"energy\":" + FloatToString(energy, 1);
            data = data + ",\"stamina\":" + FloatToString(stamina, 1);
            data = data + ",\"heat_comfort\":" + FloatToString(heatComfort, 2);
            data = data + ",\"tremor\":" + FloatToString(tremor, 2);
            data = data + ",\"wet\":" + FloatToString(wet, 2);
            data = data + ",\"bleeding\":" + isBleeding.ToString();
            data = data + ",\"unconscious\":" + isUnconscious.ToString();
            data = data + ",\"broken_legs\":" + hasBrokenLegs.ToString();
            data = data + ",\"blood_type\":\"" + bloodTypeStr + "\"}";
            
            SendQueryResponse(commandId, data);
            Log("Sent full data for: " + name);
            return;
        }
        
        string notFound = "{\"type\":\"player_full\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetNearbyVehicles(array<Man> players, string commandId, string playerId, string radius)
    {
        Log("Getting nearby vehicles for: " + playerId);
        
        float rad = 100;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 1000)
        {
            rad = 1000;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            
            array<Object> objects = new array<Object>();
            array<CargoBase> proxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(pos, rad, objects, proxyCargos);
            
            string vehicleList = "";
            int vehicleCount = 0;
            
            for (int j = 0; j < objects.Count(); j++)
            {
                Car vehicle = Car.Cast(objects.Get(j));
                if (vehicle)
                {
                    if (vehicleList != "")
                    {
                        vehicleList = vehicleList + ",";
                    }
                    
                    vector vPos = vehicle.GetPosition();
                    float dist = vector.Distance(pos, vPos);
                    
                    string entry = "{\"class\":\"" + vehicle.GetType() + "\"";
                    entry = entry + ",\"distance\":\"" + FormatCoord(dist) + "\"";
                    entry = entry + ",\"x\":\"" + FormatCoord(vPos[0]) + "\"";
                    entry = entry + ",\"y\":\"" + FormatCoord(vPos[1]) + "\"";
                    entry = entry + ",\"z\":\"" + FormatCoord(vPos[2]) + "\"}";
                    vehicleList = vehicleList + entry;
                    vehicleCount++;
                }
            }
            
            string data = "{\"type\":\"nearby_vehicles\"";
            data = data + ",\"player_id\":\"" + playerId + "\"";
            data = data + ",\"radius\":\"" + FormatCoord(rad) + "\"";
            data = data + ",\"count\":" + vehicleCount.ToString();
            data = data + ",\"vehicles\":[" + vehicleList + "]}";
            
            SendQueryResponse(commandId, data);
            Log("Sent nearby vehicles: " + vehicleCount.ToString());
            return;
        }
        
        string notFound = "{\"type\":\"nearby_vehicles\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetVehicleInfo(array<Man> players, string commandId, string playerId, string radius)
    {
        Log("Getting vehicle info near: " + playerId);
        
        float rad = 10;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 50)
        {
            rad = 50;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            vector pos = pb.GetPosition();
            
            array<Object> objects = new array<Object>();
            array<CargoBase> proxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(pos, rad, objects, proxyCargos);
            
            for (int j = 0; j < objects.Count(); j++)
            {
                Car vehicle = Car.Cast(objects.Get(j));
                if (vehicle)
                {
                    vector vPos = vehicle.GetPosition();
                    
                    float fuel = vehicle.GetFluidFraction(CarFluid.FUEL) * 100;
                    float oil = vehicle.GetFluidFraction(CarFluid.OIL) * 100;
                    float brake = vehicle.GetFluidFraction(CarFluid.BRAKE) * 100;
                    float coolant = vehicle.GetFluidFraction(CarFluid.COOLANT) * 100;
                    float health = vehicle.GetHealth("", "") / vehicle.GetMaxHealth("", "") * 100;
                    
                    // Get cargo items
                    string cargoList = "";
                    int cargoCount = 0;
                    
                    array<EntityAI> cargoItems = new array<EntityAI>();
                    vehicle.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, cargoItems);
                    
                    for (int k = 0; k < cargoItems.Count(); k++)
                    {
                        EntityAI item = cargoItems.Get(k);
                        if (item && item != vehicle)
                        {
                            if (cargoList != "")
                            {
                                cargoList = cargoList + ",";
                            }
                            cargoList = cargoList + "\"" + item.GetType() + "\"";
                            cargoCount++;
                        }
                    }
                    
                    string data = "{\"type\":\"vehicle_info\"";
                    data = data + ",\"class\":\"" + vehicle.GetType() + "\"";
                    data = data + ",\"x\":\"" + FormatCoord(vPos[0]) + "\"";
                    data = data + ",\"y\":\"" + FormatCoord(vPos[1]) + "\"";
                    data = data + ",\"z\":\"" + FormatCoord(vPos[2]) + "\"";
                    data = data + ",\"health\":\"" + FormatCoord(health) + "\"";
                    data = data + ",\"fuel\":\"" + FormatCoord(fuel) + "\"";
                    data = data + ",\"oil\":\"" + FormatCoord(oil) + "\"";
                    data = data + ",\"brake\":\"" + FormatCoord(brake) + "\"";
                    data = data + ",\"coolant\":\"" + FormatCoord(coolant) + "\"";
                    data = data + ",\"cargo_count\":" + cargoCount.ToString();
                    data = data + ",\"cargo\":[" + cargoList + "]}";
                    
                    SendQueryResponse(commandId, data);
                    Log("Sent vehicle info: " + vehicle.GetType());
                    return;
                }
            }
            
            string noVehicle = "{\"type\":\"vehicle_info\",\"error\":\"no_vehicle_nearby\"}";
            SendQueryResponse(commandId, noVehicle);
            Log("No vehicle found nearby");
            return;
        }
        
        string notFound = "{\"type\":\"vehicle_info\"";
        notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
        notFound = notFound + ",\"error\":\"player_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteGetItemDetails(array<Man> players, string commandId, string persistentId)
    {
        Log("Getting item details for: " + persistentId);
        
        if (persistentId == "")
        {
            string noId = "{\"type\":\"item_details\",\"error\":\"no_persistent_id\"}";
            SendQueryResponse(commandId, noId);
            return;
        }
        
        // Search all players' inventories first
        for (int i = 0; i < players.Count(); i++)
        {
            PlayerBase pb = PlayerBase.Cast(players.Get(i));
            if (pb)
            {
                array<EntityAI> items = new array<EntityAI>();
                pb.GetInventory().EnumerateInventory(InventoryTraversalType.PREORDER, items);
                
                for (int j = 0; j < items.Count(); j++)
                {
                    EntityAI item = items.Get(j);
                    if (item && GetItemPersistentID(item) == persistentId)
                    {
                        SendItemDetailsResponse(commandId, item, pb.GetIdentity().GetPlainId());
                        return;
                    }
                }
            }
        }
        
        // Search world objects if not found in player inventory
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(vector.Zero, 50000, objects, proxyCargos);
        
        for (int k = 0; k < objects.Count(); k++)
        {
            EntityAI entity = EntityAI.Cast(objects.Get(k));
            if (entity && GetItemPersistentID(entity) == persistentId)
            {
                SendItemDetailsResponse(commandId, entity, "");
                return;
            }
        }
        
        string notFound = "{\"type\":\"item_details\"";
        notFound = notFound + ",\"persistent_id\":\"" + persistentId + "\"";
        notFound = notFound + ",\"error\":\"item_not_found\"}";
        SendQueryResponse(commandId, notFound);
        Log("Item not found: " + persistentId);
    }
    
    protected void SendItemDetailsResponse(string commandId, EntityAI item, string ownerId)
    {
        vector pos = item.GetPosition();
        string className = item.GetType();
        string persistentId = GetItemPersistentID(item);
        
        // Basic health info
        float health = item.GetHealth("", "");
        float maxHealth = item.GetMaxHealth("", "");
        float healthPercent = 0;
        if (maxHealth > 0) healthPercent = (health / maxHealth) * 100;
        
        // Quantity (for stackable items like ammo, food, etc)
        float quantity = 0;
        float maxQuantity = 0;
        ItemBase itemBase = ItemBase.Cast(item);
        if (itemBase)
        {
            if (itemBase.HasQuantity())
            {
                quantity = itemBase.GetQuantity();
                maxQuantity = itemBase.GetQuantityMax();
            }
        }
        
        // Magazine specific info (if item IS a magazine)
        int ammoCount = 0;
        int ammoMax = 0;
        string ammoType = "";
        Magazine mag = Magazine.Cast(item);
        if (mag)
        {
            ammoCount = mag.GetAmmoCount();
            ammoMax = mag.GetAmmoMax();
            ammoType = mag.ConfigGetString("ammo");
        }
        
        // Weapon specific info
        string chamberedRound = "";
        int chamberAmmoCount = 0;
        string attachedMagId = "";
        Weapon_Base weapon = Weapon_Base.Cast(item);
        if (weapon)
        {
            // Check chamber
            int muzzleCount = weapon.GetMuzzleCount();
            for (int m = 0; m < muzzleCount; m++)
            {
                if (weapon.IsChamberFull(m))
                {
                    chamberAmmoCount++;
                    float damage;
                    string type;
                    if (weapon.GetCartridgeInfo(m, damage, type))
                    {
                        if (chamberedRound != "") chamberedRound = chamberedRound + ",";
                        chamberedRound = chamberedRound + type;
                    }
                }
            }
            
            // Check for attached magazine on weapon
            Magazine weaponMag = weapon.GetMagazine(0);
            if (weaponMag)
            {
                ammoCount = weaponMag.GetAmmoCount();
                ammoMax = weaponMag.GetAmmoMax();
                ammoType = weaponMag.ConfigGetString("ammo");
                attachedMagId = GetItemPersistentID(weaponMag);
            }
        }
        
        // Get attachments
        string attachmentList = "";
        int attachmentCount = 0;
        int attCount = item.GetInventory().AttachmentCount();
        for (int a = 0; a < attCount; a++)
        {
            EntityAI att = item.GetInventory().GetAttachmentFromIndex(a);
            if (att)
            {
                if (attachmentList != "") attachmentList = attachmentList + ",";
                attachmentList = attachmentList + "{\"class\":\"" + att.GetType() + "\",\"id\":\"" + GetItemPersistentID(att) + "\"}";
                attachmentCount++;
            }
        }
        
        // Get cargo contents
        string cargoList = "";
        int cargoCount = 0;
        CargoBase cargo = item.GetInventory().GetCargo();
        if (cargo)
        {
            int cargoItemCount = cargo.GetItemCount();
            for (int c = 0; c < cargoItemCount; c++)
            {
                EntityAI cargoItem = cargo.GetItem(c);
                if (cargoItem)
                {
                    if (cargoList != "") cargoList = cargoList + ",";
                    cargoList = cargoList + "{\"class\":\"" + cargoItem.GetType() + "\",\"id\":\"" + GetItemPersistentID(cargoItem) + "\"}";
                    cargoCount++;
                }
            }
        }
        
        // Build response
        string data = "{\"type\":\"item_details\"";
        data = data + ",\"persistent_id\":\"" + persistentId + "\"";
        data = data + ",\"class\":\"" + className + "\"";
        data = data + ",\"owner_id\":\"" + ownerId + "\"";
        data = data + ",\"x\":\"" + FormatCoord(pos[0]) + "\"";
        data = data + ",\"y\":\"" + FormatCoord(pos[1]) + "\"";
        data = data + ",\"z\":\"" + FormatCoord(pos[2]) + "\"";
        data = data + ",\"health\":\"" + FormatCoord(health) + "\"";
        data = data + ",\"max_health\":\"" + FormatCoord(maxHealth) + "\"";
        data = data + ",\"health_percent\":\"" + FormatCoord(healthPercent) + "\"";
        data = data + ",\"quantity\":\"" + FormatCoord(quantity) + "\"";
        data = data + ",\"max_quantity\":\"" + FormatCoord(maxQuantity) + "\"";
        data = data + ",\"ammo_count\":" + ammoCount.ToString();
        data = data + ",\"ammo_max\":" + ammoMax.ToString();
        data = data + ",\"ammo_type\":\"" + ammoType + "\"";
        if (attachedMagId != "") data = data + ",\"mag_id\":\"" + attachedMagId + "\"";
        data = data + ",\"chamber_count\":" + chamberAmmoCount.ToString();
        data = data + ",\"chambered\":\"" + chamberedRound + "\"";
        data = data + ",\"attachment_count\":" + attachmentCount.ToString();
        data = data + ",\"attachments\":[" + attachmentList + "]";
        data = data + ",\"cargo_count\":" + cargoCount.ToString();
        data = data + ",\"cargo\":[" + cargoList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent item details: " + className);
    }
    
    // =============================================================================
    // PLAYER EFFECTS COMMANDS
    // =============================================================================
    
    protected void ExecuteKnockoutPlayer(array<Man> players, string playerId)
    {
        Log("Knocking out player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetHealth("GlobalHealth", "Shock", 100);
            Log("Knocked out: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteWakePlayer(array<Man> players, string playerId)
    {
        Log("Waking player: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetHealth("GlobalHealth", "Shock", 0);
            Log("Woke up: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteSetBleeding(array<Man> players, string playerId, string sourceCount)
    {
        Log("Setting bleeding for: " + playerId);
        
        int count = 1;
        if (sourceCount != "")
        {
            count = sourceCount.ToInt();
        }
        if (count < 1)
        {
            count = 1;
        }
        if (count > 10)
        {
            count = 10;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            for (int j = 0; j < count; j++)
            {
                pb.GetBleedingManagerServer().AttemptAddBleedingSourceBySelection("Torso");
            }
            Log("Added " + count.ToString() + " bleeding sources to: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteStopBleeding(array<Man> players, string playerId)
    {
        Log("Stopping bleeding for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.GetBleedingManagerServer().RemoveAllSources();
            Log("Stopped bleeding for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void ExecuteRagdollPlayer(array<Man> players, string playerId, string duration)
    {
        Log("Ragdolling player: " + playerId);
        
        float dur = 5;
        if (duration != "")
        {
            dur = duration.ToFloat();
        }
        if (dur < 1)
        {
            dur = 1;
        }
        if (dur > 30)
        {
            dur = 30;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            // Apply shock to trigger unconscious ragdoll
            pb.SetHealth("GlobalHealth", "Shock", 100);
            
            // Schedule wake up
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(WakePlayerDelayed, dur * 1000, false, playerId);
            
            Log("Ragdolled " + pb.GetIdentity().GetName() + " for " + dur.ToString() + " seconds");
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    protected void WakePlayerDelayed(string playerId)
    {
        array<Man> players = new array<Man>();
        GetGame().GetPlayers(players);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            pb.SetHealth("GlobalHealth", "Shock", 0);
        }
    }
    
    protected void ExecuteSetStaminaInfinite(array<Man> players, string playerId, bool enable)
    {
        string action;
        if (enable)
        {
            action = "Enabling";
        }
        else
        {
            action = "Disabling";
        }
        
        Log("" + action + " infinite stamina for: " + playerId);
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (pb)
        {
            if (enable)
            {
                pb.GetStatStamina().Set(pb.GetStatStamina().GetMax());
                pb.SetStaminaState(true);
            }
            else
            {
                pb.SetStaminaState(false);
            }
            Log("" + action + " infinite stamina for: " + pb.GetIdentity().GetName());
            return;
        }
        Log("Player not found: " + playerId);
    }
    
    // =============================================================================
    // WORLD/ENVIRONMENT COMMANDS
    // =============================================================================
    
    protected void ExecuteSpawnFire(array<Man> players, string playerId, string fireType, string coords)
    {
        Log("Spawning fire");
        
        vector pos;
        
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                
                // Get ground level if Y is 0
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                pos = pb.GetPosition() + Vector(2, 0, 0);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("No valid position for fire");
            return;
        }
        
        string fireClass = "Fireplace";
        if (fireType == "barrel")
        {
            fireClass = "BarrelHoles_Red";
        }
        else if (fireType == "indoor")
        {
            fireClass = "FireplaceIndoor";
        }
        
        FireplaceBase fire = FireplaceBase.Cast(GetGame().CreateObject(fireClass, pos, false, true));
        if (fire)
        {
            // Add fuel and ignite
            fire.GetInventory().CreateInInventory("Firewood");
            fire.GetInventory().CreateInInventory("Firewood");
            fire.GetInventory().CreateInInventory("Firewood");
            fire.StartFire();
            Log("Fire spawned and lit: " + fireClass);
        }
    }
    
    protected void ExecuteSpawnSmoke(array<Man> players, string playerId, string color, string coords)
    {
        Log("Spawning smoke");
        
        vector pos;
        
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                float posX = parts.Get(0).ToFloat();
                float posY = parts.Get(1).ToFloat();
                float posZ = parts.Get(2).ToFloat();
                
                // Get ground level if Y is 0
                if (posY == 0)
                {
                    posY = GetGame().SurfaceY(posX, posZ);
                }
                pos = Vector(posX, posY, posZ);
            }
        }
        
        if (pos == vector.Zero && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                pos = pb.GetPosition() + Vector(2, 0, 0);
            }
        }
        
        if (pos == vector.Zero)
        {
            Log("No valid position for smoke");
            return;
        }
        
        string smokeClass = "SmokeGrenadeBase";
        if (color == "red")
        {
            smokeClass = "RDG2SmokeGrenade_Black";
        }
        else if (color == "green")
        {
            smokeClass = "M18SmokeGrenade_Green";
        }
        else if (color == "white")
        {
            smokeClass = "M18SmokeGrenade_White";
        }
        else if (color == "purple")
        {
            smokeClass = "M18SmokeGrenade_Purple";
        }
        else if (color == "yellow")
        {
            smokeClass = "M18SmokeGrenade_Yellow";
        }
        else
        {
            smokeClass = "RDG2SmokeGrenade_White";
        }
        
        SmokeGrenadeBase smoke = SmokeGrenadeBase.Cast(GetGame().CreateObject(smokeClass, pos, false, true));
        if (smoke)
        {
            smoke.Unpin();
            smoke.OnActivateFinished();
            Log("Smoke spawned: " + smokeClass);
        }
    }
    
    protected void ExecuteSetFog(string density)
    {
        Log("Setting fog density: " + density);
        
        float fog = 0.5;
        if (density != "")
        {
            fog = density.ToFloat();
        }
        if (fog < 0)
        {
            fog = 0;
        }
        if (fog > 1)
        {
            fog = 1;
        }
        
        Weather weather = GetGame().GetWeather();
        if (!weather)
        {
            Log("ERROR: Weather object is null");
            return;
        }
        
        // cfgweather.xml typically limits fog to 0.02-0.08, which clamps our Set() value.
        // Must expand limits to allow full 0-1 range before setting.
        weather.GetFog().SetLimits(0, 1);
        // Prevent weather controller from overriding our value
        weather.GetFog().SetForecastChangeLimits(0, 0);
        
        // Freeze weather so engine doesn't overwrite, lock for 1 hour
        weather.SetWeatherUpdateFreeze(true);
        weather.GetFog().Set(fog, 30, 3600);
        Log("Fog set to: " + fog.ToString() + " (frozen)");
    }
    
    protected void ExecuteSetWind(string speed, string direction)
    {
        Log("Setting wind");
        
        float spd = 10;
        if (speed != "")
        {
            spd = speed.ToFloat();
        }
        if (spd < 0)
        {
            spd = 0;
        }
        if (spd > 20)
        {
            spd = 20;
        }
        
        float dir = 0;
        if (direction != "")
        {
            dir = direction.ToFloat();
        }
        
        Weather weather = GetGame().GetWeather();
        if (!weather)
        {
            Log("ERROR: Weather object is null");
            return;
        }
        
        // SetWind sets both magnitude and direction with zero time/duration
        float dirRad = dir * Math.DEG2RAD;
        float windX = Math.Sin(dirRad) * spd;
        float windZ = Math.Cos(dirRad) * spd;
        vector windVec = Vector(windX, 0, windZ);
        weather.SetWind(windVec);
        Log("Wind set - speed: " + spd.ToString() + ", direction: " + dir.ToString());
    }
    
    // =============================================================================
    // BASE BUILDING COMMANDS
    // =============================================================================
    
    protected void ExecuteDeleteObjectsRadius(array<Man> players, string playerId, string radius, string objectType)
    {
        Log("Deleting objects near: " + playerId);
        
        float rad = 20;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 100)
        {
            rad = 100;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            Log("Player not found: " + playerId);
            return;
        }
        
        vector centerPos = pb.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(centerPos, rad, objects, proxyCargos);
        
        int count = 0;
        for (int j = 0; j < objects.Count(); j++)
        {
            Object obj = objects.Get(j);
            if (!obj)
            {
                continue;
            }
            
            // Skip players
            if (PlayerBase.Cast(obj))
            {
                continue;
            }
            
            // Check object type filter
            bool shouldDelete = false;
            
            if (objectType == "" || objectType == "all")
            {
                // Delete player-built items (BaseBuildingBase, tents, etc)
                if (BaseBuildingBase.Cast(obj) || TentBase.Cast(obj) || Container_Base.Cast(obj))
                {
                    shouldDelete = true;
                }
            }
            else if (objectType == "walls")
            {
                if (obj.IsKindOf("Fence") || obj.IsKindOf("Watchtower") || obj.IsKindOf("Wall"))
                {
                    shouldDelete = true;
                }
            }
            else if (objectType == "tents")
            {
                if (TentBase.Cast(obj))
                {
                    shouldDelete = true;
                }
            }
            else if (objectType == "containers")
            {
                if (Container_Base.Cast(obj))
                {
                    shouldDelete = true;
                }
            }
            
            if (shouldDelete)
            {
                GetGame().ObjectDelete(obj);
                count++;
            }
        }
        Log("Deleted " + count.ToString() + " objects");
    }
    
    protected void ExecuteGetBaseObjects(array<Man> players, string commandId, string playerId, string radius)
    {
        Log("Getting base objects near: " + playerId);
        
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        PlayerBase pb = FindPlayerById(players, playerId);
        if (!pb)
        {
            string notFound = "{\"type\":\"base_objects\"";
            notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
            notFound = notFound + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFound);
            Log("Player not found: " + playerId);
            return;
        }
        
        vector centerPos = pb.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(centerPos, rad, objects, proxyCargos);
        
        string objectList = "";
        int objectCount = 0;
        int cacheUpdates = 0;
        
        for (int j = 0; j < objects.Count(); j++)
        {
            Object obj = objects.Get(j);
            if (!obj)
            {
                continue;
            }
            
            // Only include player-built structures
            bool isBaseObject = false;
            string category = "";
            
            if (BaseBuildingBase.Cast(obj))
            {
                isBaseObject = true;
                category = "building";
            }
            else if (TentBase.Cast(obj))
            {
                isBaseObject = true;
                category = "tent";
            }
            else if (Container_Base.Cast(obj))
            {
                isBaseObject = true;
                category = "container";
            }
            
            if (isBaseObject)
            {
                if (objectList != "")
                {
                    objectList = objectList + ",";
                }
                
                vector oPos = obj.GetPosition();
                float dist = vector.Distance(centerPos, oPos);
                
                // Get persistent ID for the object
                EntityAI entityObj = EntityAI.Cast(obj);
                string objPersistentId = "";
                string objClassName = obj.GetType();
                if (entityObj)
                {
                    objPersistentId = GetItemPersistentID(entityObj);
                    
                    // Update storage location cache for fast lookups later
                    if (objPersistentId != "")
                    {
                        UpdateStorageCache(objPersistentId, objClassName, oPos);
                        cacheUpdates = cacheUpdates + 1;
                    }
                }
                
                string entry = "{\"class\":\"" + objClassName + "\"";
                entry = entry + ",\"id\":\"" + objPersistentId + "\"";
                entry = entry + ",\"category\":\"" + category + "\"";
                entry = entry + ",\"distance\":\"" + FormatCoord(dist) + "\"";
                entry = entry + ",\"x\":\"" + FormatCoord(oPos[0]) + "\"";
                entry = entry + ",\"y\":\"" + FormatCoord(oPos[1]) + "\"";
                entry = entry + ",\"z\":\"" + FormatCoord(oPos[2]) + "\"}";
                objectList = objectList + entry;
                objectCount = objectCount + 1;
            }
        }
        
        // Save cache if we added any entries
        if (cacheUpdates > 0)
        {
            SaveStorageCache();
            Log("Updated storage cache with " + cacheUpdates.ToString() + " entries");
        }
        
        string data = "{\"type\":\"base_objects\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"radius\":\"" + FormatCoord(rad) + "\"";
        data = data + ",\"count\":" + objectCount.ToString();
        data = data + ",\"objects\":[" + objectList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent base objects: " + objectCount.ToString());
    }
    
    // Starts chunked scan - sector-by-sector (8x8 grid) to avoid full-map fetch blocking/kicks
    protected void StartGetAllStorageObjects(string commandId)
    {
        m_StorageScanCommandId = commandId;
        m_StorageScanSectorX = 0;
        m_StorageScanSectorZ = 0;
        m_StorageScanObjectIndex = 0;
        m_StorageScanCurrentObjects = null;
        m_StorageScanResults = new array<ref CommandRelayStorageCache>();
        m_StorageScanSeenIds = new map<string, bool>();
        m_StorageScanGridSize = 8;
        
        Log("Starting sector storage scan (8x8 grid, 600 obj/chunk, 250ms between)...");
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(StaticExecuteStorageChunk, 2500, false);
    }
    
    // Sector-by-sector fetch + chunked process - avoids full-map 3M-object fetch that blocks/kicks
    protected void ExecuteGetAllStorageObjectsChunk()
    {
        if (!m_StorageScanResults)
        {
            Log("ERROR: Storage scan results null, aborting");
            return;
        }
        
        int worldSize = GetGame().GetWorld().GetWorldSize();
        if (worldSize < 10000) worldSize = 15360;
        int g = m_StorageScanGridSize;
        float cellSize = worldSize / g;
        float sectorRadius = cellSize * 0.8;
        
        while (true)
        {
            if (!m_StorageScanCurrentObjects || m_StorageScanObjectIndex >= m_StorageScanCurrentObjects.Count())
            {
                if (m_StorageScanSectorX >= g)
                {
                    Log("Storage scan complete: " + m_StorageScanResults.Count().ToString() + " storage objects");
                    ExecuteGetAllStorageObjectsFinish();
                    return;
                }
                
                float centerX = (m_StorageScanSectorX * cellSize) + (cellSize / 2.0);
                float centerZ = (m_StorageScanSectorZ * cellSize) + (cellSize / 2.0);
                vector sectorCenter = Vector(centerX, 0, centerZ);
                
                m_StorageScanCurrentObjects = new array<Object>();
                array<CargoBase> proxyCargos = new array<CargoBase>();
                GetGame().GetObjectsAtPosition(sectorCenter, sectorRadius, m_StorageScanCurrentObjects, proxyCargos);
                m_StorageScanObjectIndex = 0;
                Log("Storage sector " + m_StorageScanSectorX + "," + m_StorageScanSectorZ + ": " + m_StorageScanCurrentObjects.Count() + " objects");
            }
            
            int limit = m_StorageScanObjectIndex + STORAGE_SCAN_OBJECTS_PER_CHUNK;
            if (limit > m_StorageScanCurrentObjects.Count()) limit = m_StorageScanCurrentObjects.Count();
            
            for (int j = m_StorageScanObjectIndex; j < limit; j++)
            {
                Object obj = m_StorageScanCurrentObjects.Get(j);
                if (!obj) continue;
                EntityAI entity = EntityAI.Cast(obj);
                if (!entity || entity.GetHierarchyParent()) continue;
                bool isStorage = TentBase.Cast(obj) != null || Container_Base.Cast(obj) != null;
                if (!isStorage) continue;
                
                vector oPos = obj.GetPosition();
                string persistentId = GetItemPersistentID(entity);
                if (persistentId != "" && m_StorageScanSeenIds.Contains(persistentId)) continue;
                if (persistentId != "") m_StorageScanSeenIds.Set(persistentId, true);
                
                CommandRelayStorageCache entry = new CommandRelayStorageCache();
                entry.class_name = obj.GetType();
                entry.persistent_id = persistentId;
                entry.x = oPos[0];
                entry.y = oPos[1];
                entry.z = oPos[2];
                m_StorageScanResults.Insert(entry);
                if (persistentId != "") UpdateStorageCache(persistentId, entry.class_name, oPos);
            }
            
            m_StorageScanObjectIndex = limit;
            
            if (m_StorageScanObjectIndex >= m_StorageScanCurrentObjects.Count())
            {
                m_StorageScanCurrentObjects = null;
                m_StorageScanSectorZ++;
                if (m_StorageScanSectorZ >= g) { m_StorageScanSectorZ = 0; m_StorageScanSectorX++; }
            }
            
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(StaticExecuteStorageChunk, STORAGE_SCAN_DELAY_MS, false);
            return;
        }
    }
    
    protected void ExecuteGetAllStorageObjectsFinish()
    {
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(StaticExecuteStorageSendResponse, 500, false);
    }
    
    protected void ExecuteGetAllStorageObjectsSendResponse()
    {
        Log("ExecuteGetAllStorageObjectsSendResponse called");
        if (!m_StorageScanResults)
        {
            Log("ERROR: Storage scan results null - cannot send response");
            return;
        }
        
        string commandId = m_StorageScanCommandId;
        int objectCount = m_StorageScanResults.Count();
        
        if (objectCount > 0)
        {
            SaveStorageCache();
            Log("Updated storage cache with " + objectCount.ToString() + " entries");
        }
        
        string objectList = "";
        for (int i = 0; i < m_StorageScanResults.Count(); i++)
        {
            CommandRelayStorageCache entry = m_StorageScanResults.Get(i);
            if (objectList != "")
            {
                objectList = objectList + ",";
            }
            string jsonEntry = "{\"class\":\"" + JsonEscape(entry.class_name) + "\"";
            jsonEntry = jsonEntry + ",\"id\":\"" + JsonEscape(entry.persistent_id) + "\"";
            jsonEntry = jsonEntry + ",\"x\":\"" + FormatCoord(entry.x) + "\"";
            jsonEntry = jsonEntry + ",\"y\":\"" + FormatCoord(entry.y) + "\"";
            jsonEntry = jsonEntry + ",\"z\":\"" + FormatCoord(entry.z) + "\"}";
            objectList = objectList + jsonEntry;
        }
        
        string data = "{\"type\":\"all_storage_objects\"";
        data = data + ",\"count\":" + objectCount.ToString();
        data = data + ",\"objects\":[" + objectList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent all storage objects: " + objectCount.ToString());
        
        m_StorageScanCommandId = "";
        m_StorageScanResults = null;
        m_StorageScanSeenIds = null;
        m_StorageScanCurrentObjects = null;
    }
    
    protected void ExecuteGetStorageContents(array<Man> players, string commandId, string persistentId, string playerId, string positionParam)
    {
        Log("Getting storage contents for: " + persistentId);
        
        // Named constants for search radii
        static const float CACHED_SEARCH_RADIUS = 20.0;
        static const float PLAYER_SEARCH_RADIUS = 200.0;
        static const float POSITION_SEARCH_RADIUS = 25.0;
        
        if (persistentId == "")
        {
            string noId = "{\"type\":\"storage_contents\",\"error\":\"no_persistent_id\"}";
            SendQueryResponse(commandId, noId);
            return;
        }
        
        // Try to find storage using cache first (fast path)
        vector cachedPos;
        string cachedClassName;
        bool foundInCache = GetCachedStoragePosition(persistentId, cachedPos, cachedClassName);
        
        EntityAI foundEntity = null;
        
        if (foundInCache)
        {
            Log("Using cached position for storage lookup: " + FormatCoord(cachedPos[0]) + "," + FormatCoord(cachedPos[1]) + "," + FormatCoord(cachedPos[2]));
            
            // Search small radius around cached position
            array<Object> cachedObjects = new array<Object>();
            array<CargoBase> cachedProxyCargos = new array<CargoBase>();
            GetGame().GetObjectsAtPosition(cachedPos, CACHED_SEARCH_RADIUS, cachedObjects, cachedProxyCargos);
            
            for (int ci = 0; ci < cachedObjects.Count(); ci++)
            {
                EntityAI cachedEntity = EntityAI.Cast(cachedObjects.Get(ci));
                if (cachedEntity)
                {
                    string foundId = GetItemPersistentID(cachedEntity);
                    if (foundId == persistentId)
                    {
                        foundEntity = cachedEntity;
                        Log("Found storage at cached location");
                        break;
                    }
                }
            }
            
            // If not found at cached location, remove stale cache entry
            if (!foundEntity)
            {
                Log("Storage not at cached location, removing stale entry");
                RemoveFromStorageCache(persistentId);
                SaveStorageCache();
            }
        }
        
        // Fallback: search at position (param_2 = x,y,z) if provided
        if (!foundEntity && positionParam != "")
        {
            array<string> parts = new array<string>();
            positionParam.Split(",", parts);
            if (parts.Count() >= 3)
            {
                vector searchPos;
                searchPos[0] = parts.Get(0).ToFloat();
                searchPos[1] = parts.Get(1).ToFloat();
                searchPos[2] = parts.Get(2).ToFloat();
                Log("Searching at position: " + FormatCoord(searchPos[0]) + "," + FormatCoord(searchPos[1]) + "," + FormatCoord(searchPos[2]));
                
                array<Object> posObjects = new array<Object>();
                array<CargoBase> posProxyCargos = new array<CargoBase>();
                GetGame().GetObjectsAtPosition(searchPos, POSITION_SEARCH_RADIUS, posObjects, posProxyCargos);
                
                for (int oi = 0; oi < posObjects.Count(); oi++)
                {
                    EntityAI posEntity = EntityAI.Cast(posObjects.Get(oi));
                    if (posEntity)
                    {
                        string posId = GetItemPersistentID(posEntity);
                        if (posId == persistentId)
                        {
                            foundEntity = posEntity;
                            vector entityPos = foundEntity.GetPosition();
                            string entityClass = foundEntity.GetType();
                            UpdateStorageCache(persistentId, entityClass, entityPos);
                            SaveStorageCache();
                            Log("Found storage at given position, updated cache");
                            break;
                        }
                    }
                }
            }
        }
        
        // Fallback: search around player if cache miss and no position param
        if (!foundEntity && playerId != "")
        {
            PlayerBase pb = FindPlayerById(players, playerId);
            if (pb)
            {
                vector playerPos = pb.GetPosition();
                Log("Falling back to player-based search around: " + FormatCoord(playerPos[0]) + "," + FormatCoord(playerPos[1]) + "," + FormatCoord(playerPos[2]));
                
                array<Object> playerObjects = new array<Object>();
                array<CargoBase> playerProxyCargos = new array<CargoBase>();
                GetGame().GetObjectsAtPosition(playerPos, PLAYER_SEARCH_RADIUS, playerObjects, playerProxyCargos);
                
                for (int pi = 0; pi < playerObjects.Count(); pi++)
                {
                    EntityAI playerEntity = EntityAI.Cast(playerObjects.Get(pi));
                    if (playerEntity)
                    {
                        string playerId2 = GetItemPersistentID(playerEntity);
                        if (playerId2 == persistentId)
                        {
                            foundEntity = playerEntity;
                            
                            vector storagePos = foundEntity.GetPosition();
                            string storageClass = foundEntity.GetType();
                            UpdateStorageCache(persistentId, storageClass, storagePos);
                            SaveStorageCache();
                            Log("Found storage via player search, updated cache");
                            break;
                        }
                    }
                }
            }
        }
        
        // If still not found, return error
        if (!foundEntity)
        {
            string notFound = "{\"type\":\"storage_contents\"";
            notFound = notFound + ",\"id\":\"" + persistentId + "\"";
            if (playerId == "" && positionParam == "" && !foundInCache)
            {
                notFound = notFound + ",\"error\":\"not_in_cache_no_player_or_position\"}";
            }
            else
            {
                notFound = notFound + ",\"error\":\"storage_not_found\"}";
            }
            SendQueryResponse(commandId, notFound);
            Log("Storage not found: " + persistentId);
            return;
        }
        
        // Found the storage container - extract contents
        vector pos = foundEntity.GetPosition();
        string className = foundEntity.GetType();
        
        // Get health info
        float health = foundEntity.GetHealth("", "");
        float maxHealth = foundEntity.GetMaxHealth("", "");
        float healthPercent = 0;
        if (maxHealth > 0)
        {
            healthPercent = (health / maxHealth) * 100;
        }
        
        // Collect items into an array first to avoid string length issues
        ref array<string> itemNodes = new array<string>();
        
        // Get cargo contents
        CargoBase cargo = foundEntity.GetInventory().GetCargo();
        if (cargo)
        {
            int cargoItemCount = cargo.GetItemCount();
            for (int c = 0; c < cargoItemCount; c++)
            {
                EntityAI cargoItem = cargo.GetItem(c);
                if (cargoItem)
                {
                    // Get quantity for stackable items
                    float qty = 0;
                    float maxQty = 0;
                    ItemBase itemBase = ItemBase.Cast(cargoItem);
                    if (itemBase && itemBase.HasQuantity())
                    {
                        qty = itemBase.GetQuantity();
                        maxQty = itemBase.GetQuantityMax();
                    }
                    
                    // Get item health
                    float itemHealth = cargoItem.GetHealth("", "");
                    float itemMaxHealth = cargoItem.GetMaxHealth("", "");
                    float itemHealthPct = 0;
                    if (itemMaxHealth > 0)
                    {
                        itemHealthPct = (itemHealth / itemMaxHealth) * 100;
                    }
                    
                    // Build compact item entry
                    string itemEntry = "{\"class\":\"" + cargoItem.GetType() + "\"";
                    itemEntry = itemEntry + ",\"id\":\"" + GetItemPersistentID(cargoItem) + "\"";
                    itemEntry = itemEntry + ",\"qty\":" + qty.ToString();
                    itemEntry = itemEntry + ",\"hp\":" + Math.Round(itemHealthPct).ToString() + "}";
                    itemNodes.Insert(itemEntry);
                }
            }
        }
        
        // Get attachments (some storage like tents have attachment slots)
        int attCount = foundEntity.GetInventory().AttachmentCount();
        for (int a = 0; a < attCount; a++)
        {
            EntityAI att = foundEntity.GetInventory().GetAttachmentFromIndex(a);
            if (att)
            {
                float attHealth = att.GetHealth("", "");
                float attMaxHealth = att.GetMaxHealth("", "");
                float attHealthPct = 0;
                if (attMaxHealth > 0)
                {
                    attHealthPct = (attHealth / attMaxHealth) * 100;
                }
                
                string attEntry = "{\"class\":\"" + att.GetType() + "\"";
                attEntry = attEntry + ",\"id\":\"" + GetItemPersistentID(att) + "\"";
                attEntry = attEntry + ",\"qty\":0";
                attEntry = attEntry + ",\"hp\":" + Math.Round(attHealthPct).ToString() + "}";
                itemNodes.Insert(attEntry);
            }
        }
        
        int itemCount = itemNodes.Count();
        
        // Build items array by joining in chunks to avoid string limits
        string itemList = "";
        for (int j = 0; j < itemNodes.Count(); j++)
        {
            if (j > 0)
            {
                itemList = itemList + ",";
            }
            itemList = itemList + itemNodes.Get(j);
        }
        
        // Build response with rounded coordinates
        string data = "{\"type\":\"storage_contents\"";
        data = data + ",\"id\":\"" + persistentId + "\"";
        data = data + ",\"class\":\"" + className + "\"";
        data = data + ",\"x\":" + Math.Round(pos[0]).ToString();
        data = data + ",\"y\":" + Math.Round(pos[1]).ToString();
        data = data + ",\"z\":" + Math.Round(pos[2]).ToString();
        data = data + ",\"hp\":" + Math.Round(healthPercent).ToString();
        data = data + ",\"count\":" + itemCount.ToString();
        data = data + ",\"items\":[" + itemList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent storage contents: " + itemCount.ToString() + " items");
    }
    
    // =============================================================================
    // get_nearby_players - Returns players within a radius of the target player
    //
    // player_id = Steam64 ID of the center player
    // param_1   = Radius in meters (default: 100, min: 10, max: 1000)
    //
    // Response format:
    // {
    //   "type": "nearby_players",
    //   "player_id": "76561197968868491",
    //   "radius": 100,
    //   "count": 2,
    //   "players": [
    //     {
    //       "player_id": "76561198012345678",
    //       "name": "SurvivorJoe",
    //       "distance": 45.3,
    //       "x": 5010.0,
    //       "y": 200.0,
    //       "z": 5025.0
    //     }
    //   ]
    // }
    // =============================================================================
    protected void ExecuteGetNearbyPlayers(array<Man> players, string commandId, string playerId, string radius)
    {
        Log("Getting nearby players for: " + playerId);
        
        float rad = 100;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 1000)
        {
            rad = 1000;
        }
        
        PlayerBase sourcePlayer = FindPlayerById(players, playerId);
        if (!sourcePlayer)
        {
            string notFound = "{\"type\":\"nearby_players\"";
            notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
            notFound = notFound + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFound);
            Log("Player not found: " + playerId);
            return;
        }
        
        vector sourcePos = sourcePlayer.GetPosition();
        string playerList = "";
        int nearbyCount = 0;
        int totalPlayers = players.Count();
        
        for (int i = 0; i < totalPlayers; i++)
        {
            PlayerBase otherPlayer = PlayerBase.Cast(players.Get(i));
            if (!otherPlayer)
            {
                continue;
            }
            if (!otherPlayer.GetIdentity())
            {
                continue;
            }
            
            // Skip the source player
            string otherId = otherPlayer.GetIdentity().GetPlainId();
            if (otherId == playerId)
            {
                continue;
            }
            
            vector otherPos = otherPlayer.GetPosition();
            float dist = vector.Distance(sourcePos, otherPos);
            
            if (dist > rad)
            {
                continue;
            }
            
            if (playerList != "")
            {
                playerList = playerList + ",";
            }
            
            string otherName = JsonEscape(otherPlayer.GetIdentity().GetName());
            
            string entry = "{\"player_id\":\"" + otherId + "\"";
            entry = entry + ",\"name\":\"" + otherName + "\"";
            entry = entry + ",\"distance\":" + FormatCoord(dist);
            entry = entry + ",\"x\":" + FormatCoord(otherPos[0]);
            entry = entry + ",\"y\":" + FormatCoord(otherPos[1]);
            entry = entry + ",\"z\":" + FormatCoord(otherPos[2]) + "}";
            playerList = playerList + entry;
            nearbyCount++;
        }
        
        string data = "{\"type\":\"nearby_players\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"radius\":" + FormatCoord(rad);
        data = data + ",\"count\":" + nearbyCount.ToString();
        data = data + ",\"players\":[" + playerList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent nearby players: " + nearbyCount.ToString());
    }
    
    // =============================================================================
    // get_nearby_loot - Returns ground loot items within a radius of a player
    //
    // player_id = Steam64 ID of the center player
    // param_1   = Radius in meters (default: 50, min: 5, max: 200)
    //
    // Response format:
    // {
    //   "type": "nearby_loot",
    //   "player_id": "76561197968868491",
    //   "radius": 50,
    //   "count": 3,
    //   "items": [
    //     {
    //       "class": "AKM",
    //       "id": "123456-789012-345678-901234",
    //       "distance": 12.5,
    //       "x": 5010.0,
    //       "y": 200.0,
    //       "z": 5025.0
    //     }
    //   ]
    // }
    // =============================================================================
    protected void ExecuteGetNearbyLoot(array<Man> players, string commandId, string playerId, string radius, string limit)
    {
        Log("Getting nearby loot for: " + playerId);
        
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        int maxItems = 50;
        if (limit != "")
        {
            maxItems = limit.ToInt();
        }
        if (maxItems < 1)
        {
            maxItems = 1;
        }
        if (maxItems > 500)
        {
            maxItems = 500;
        }
        
        PlayerBase sourcePlayer = FindPlayerById(players, playerId);
        if (!sourcePlayer)
        {
            string notFound = "{\"type\":\"nearby_loot\"";
            notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
            notFound = notFound + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFound);
            Log("Player not found: " + playerId);
            return;
        }
        
        vector sourcePos = sourcePlayer.GetPosition();
        
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(sourcePos, rad, objects, proxyCargos);
        
        string itemList = "";
        int itemCount = 0;
        int objectCount = objects.Count();
        
        for (int i = 0; i < objectCount; i++)
        {
            Object obj = objects.Get(i);
            if (!obj)
            {
                continue;
            }
            
            // Skip players
            PlayerBase playerCheck = PlayerBase.Cast(obj);
            if (playerCheck)
            {
                continue;
            }
            
            // Skip vehicles
            Car vehicleCheck = Car.Cast(obj);
            if (vehicleCheck)
            {
                continue;
            }
            
            // Skip zombies/animals (living creatures)
            ZombieBase zombieCheck = ZombieBase.Cast(obj);
            if (zombieCheck)
            {
                continue;
            }
            
            AnimalBase animalCheck = AnimalBase.Cast(obj);
            if (animalCheck)
            {
                continue;
            }
            
            // Must be a valid EntityAI to get persistent ID
            EntityAI entity = EntityAI.Cast(obj);
            if (!entity)
            {
                continue;
            }
            
            // Must be an item (not a building or structure)
            ItemBase item = ItemBase.Cast(obj);
            if (!item)
            {
                continue;
            }
            
            vector itemPos = item.GetPosition();
            float dist = vector.Distance(sourcePos, itemPos);
            string persistentId = GetItemPersistentID(entity);
            string className = item.GetType();
            
            if (itemList != "")
            {
                itemList = itemList + ",";
            }
            
            string entry = "{\"class\":\"" + className + "\"";
            entry = entry + ",\"id\":\"" + persistentId + "\"";
            entry = entry + ",\"distance\":" + FormatCoord(dist);
            entry = entry + ",\"x\":" + FormatCoord(itemPos[0]);
            entry = entry + ",\"y\":" + FormatCoord(itemPos[1]);
            entry = entry + ",\"z\":" + FormatCoord(itemPos[2]) + "}";
            itemList = itemList + entry;
            itemCount++;
            
            if (itemCount >= maxItems)
            {
                break;
            }
        }
        
        string data = "{\"type\":\"nearby_loot\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"radius\":" + FormatCoord(rad);
        data = data + ",\"count\":" + itemCount.ToString();
        data = data + ",\"items\":[" + itemList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent nearby loot: " + itemCount.ToString() + " items");
    }
    
    // =============================================================================
    // get_nearby_entities - Returns all entity types within a radius of a player
    //
    // player_id = Steam64 ID of the center player
    // param_1   = Radius in meters (default: 50, min: 10, max: 200)
    //
    // Response format:
    // {
    //   "type": "nearby_entities",
    //   "player_id": "76561197968868491",
    //   "radius": 50,
    //   "players": { "count": 2, "list": [...] },
    //   "vehicles": { "count": 1, "list": [...] },
    //   "zombies": { "count": 5, "list": [...] },
    //   "animals": { "count": 3, "list": [...] },
    //   "bases": { "count": 1, "list": [...] },
    //   "items": { "count": 10, "list": [...] }
    // }
    // =============================================================================
    protected void ExecuteGetNearbyEntities(array<Man> players, string commandId, string playerId, string radius)
    {
        Log("Getting nearby entities for: " + playerId);
        
        // Parse and clamp radius
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        // Per-category limits to keep response size manageable
        static const int MAX_PER_CATEGORY = 50;
        
        // Find source player
        PlayerBase sourcePlayer = FindPlayerById(players, playerId);
        if (!sourcePlayer)
        {
            string notFound = "{\"type\":\"nearby_entities\"";
            notFound = notFound + ",\"player_id\":\"" + playerId + "\"";
            notFound = notFound + ",\"error\":\"player_not_found\"}";
            SendQueryResponse(commandId, notFound);
            Log("Player not found: " + playerId);
            return;
        }
        
        vector sourcePos = sourcePlayer.GetPosition();
        
        // Get all objects in radius
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(sourcePos, rad, objects, proxyCargos);
        
        // Category lists
        string playerList = "";
        string vehicleList = "";
        string zombieList = "";
        string animalList = "";
        string baseList = "";
        string itemList = "";
        
        int playerCount = 0;
        int vehicleCount = 0;
        int zombieCount = 0;
        int animalCount = 0;
        int baseCount = 0;
        int itemCount = 0;
        
        int objectCount = objects.Count();
        
        for (int i = 0; i < objectCount; i++)
        {
            Object obj = objects.Get(i);
            if (!obj)
            {
                continue;
            }
            
            vector objPos = obj.GetPosition();
            float dist = vector.Distance(sourcePos, objPos);
            string className = obj.GetType();
            
            // Check each category in order of specificity
            
            // Players
            PlayerBase playerCheck = PlayerBase.Cast(obj);
            if (playerCheck)
            {
                if (playerCheck == sourcePlayer)
                {
                    continue;
                }
                if (playerCount < MAX_PER_CATEGORY)
                {
                    string pSteamId = playerCheck.GetIdentity().GetPlainId();
                    string pName = playerCheck.GetIdentity().GetName();
                    
                    if (playerList != "")
                    {
                        playerList = playerList + ",";
                    }
                    string pEntry = "{\"name\":\"" + pName + "\"";
                    pEntry = pEntry + ",\"steam_id\":\"" + pSteamId + "\"";
                    pEntry = pEntry + ",\"distance\":" + FormatCoord(dist);
                    pEntry = pEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    pEntry = pEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    pEntry = pEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    playerList = playerList + pEntry;
                    playerCount++;
                }
                continue;
            }
            
            // Vehicles
            Car vehicleCheck = Car.Cast(obj);
            if (vehicleCheck)
            {
                if (vehicleCount < MAX_PER_CATEGORY)
                {
                    if (vehicleList != "")
                    {
                        vehicleList = vehicleList + ",";
                    }
                    EntityAI vehicleEntity = vehicleCheck;
                    string vehiclePersistentId = "";
                    if (vehicleEntity)
                    {
                        vehiclePersistentId = GetItemPersistentID(vehicleEntity);
                    }
                    string vEntry = "{\"class\":\"" + className + "\"";
                    vEntry = vEntry + ",\"id\":\"" + vehiclePersistentId + "\"";
                    vEntry = vEntry + ",\"distance\":" + FormatCoord(dist);
                    vEntry = vEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    vEntry = vEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    vEntry = vEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    vehicleList = vehicleList + vEntry;
                    vehicleCount++;
                }
                continue;
            }
            
            // Zombies
            ZombieBase zombieCheck = ZombieBase.Cast(obj);
            if (zombieCheck)
            {
                if (zombieCount < MAX_PER_CATEGORY)
                {
                    if (zombieList != "")
                    {
                        zombieList = zombieList + ",";
                    }
                    string zEntry = "{\"class\":\"" + className + "\"";
                    zEntry = zEntry + ",\"distance\":" + FormatCoord(dist);
                    zEntry = zEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    zEntry = zEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    zEntry = zEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    zombieList = zombieList + zEntry;
                    zombieCount++;
                }
                continue;
            }
            
            // Animals
            AnimalBase animalCheck = AnimalBase.Cast(obj);
            if (animalCheck)
            {
                if (animalCount < MAX_PER_CATEGORY)
                {
                    if (animalList != "")
                    {
                        animalList = animalList + ",";
                    }
                    string aEntry = "{\"class\":\"" + className + "\"";
                    aEntry = aEntry + ",\"distance\":" + FormatCoord(dist);
                    aEntry = aEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    aEntry = aEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    aEntry = aEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    animalList = animalList + aEntry;
                    animalCount++;
                }
                continue;
            }
            
            // Base building objects (walls, tents, containers, etc.)
            bool isBaseObject = false;
            string baseCategory = "";
            
            BaseBuildingBase baseBuildingCheck = BaseBuildingBase.Cast(obj);
            if (baseBuildingCheck)
            {
                isBaseObject = true;
                baseCategory = "building";
            }
            
            TentBase tentCheck = TentBase.Cast(obj);
            if (tentCheck)
            {
                isBaseObject = true;
                baseCategory = "tent";
            }
            
            Container_Base containerCheck = Container_Base.Cast(obj);
            if (containerCheck)
            {
                isBaseObject = true;
                baseCategory = "container";
            }
            
            if (isBaseObject)
            {
                if (baseCount < MAX_PER_CATEGORY)
                {
                    if (baseList != "")
                    {
                        baseList = baseList + ",";
                    }
                    EntityAI baseEntity = EntityAI.Cast(obj);
                    string basePersistentId = "";
                    if (baseEntity)
                    {
                        basePersistentId = GetItemPersistentID(baseEntity);
                    }
                    string bEntry = "{\"class\":\"" + className + "\"";
                    bEntry = bEntry + ",\"id\":\"" + basePersistentId + "\"";
                    bEntry = bEntry + ",\"category\":\"" + baseCategory + "\"";
                    bEntry = bEntry + ",\"distance\":" + FormatCoord(dist);
                    bEntry = bEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    bEntry = bEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    bEntry = bEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    baseList = baseList + bEntry;
                    baseCount++;
                }
                continue;
            }
            
            // Items (ground loot)
            ItemBase itemCheck = ItemBase.Cast(obj);
            if (itemCheck)
            {
                if (itemCount < MAX_PER_CATEGORY)
                {
                    EntityAI entity = EntityAI.Cast(obj);
                    string persistentId = "";
                    if (entity)
                    {
                        persistentId = GetItemPersistentID(entity);
                    }
                    
                    if (itemList != "")
                    {
                        itemList = itemList + ",";
                    }
                    string iEntry = "{\"class\":\"" + className + "\"";
                    iEntry = iEntry + ",\"id\":\"" + persistentId + "\"";
                    iEntry = iEntry + ",\"distance\":" + FormatCoord(dist);
                    iEntry = iEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    iEntry = iEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    iEntry = iEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    itemList = itemList + iEntry;
                    itemCount++;
                }
                continue;
            }
        }
        
        // Build response JSON
        string data = "{\"type\":\"nearby_entities\"";
        data = data + ",\"player_id\":\"" + playerId + "\"";
        data = data + ",\"radius\":" + FormatCoord(rad);
        
        data = data + ",\"players\":{\"count\":" + playerCount.ToString();
        data = data + ",\"list\":[" + playerList + "]}";
        
        data = data + ",\"vehicles\":{\"count\":" + vehicleCount.ToString();
        data = data + ",\"list\":[" + vehicleList + "]}";
        
        data = data + ",\"zombies\":{\"count\":" + zombieCount.ToString();
        data = data + ",\"list\":[" + zombieList + "]}";
        
        data = data + ",\"animals\":{\"count\":" + animalCount.ToString();
        data = data + ",\"list\":[" + animalList + "]}";
        
        data = data + ",\"bases\":{\"count\":" + baseCount.ToString();
        data = data + ",\"list\":[" + baseList + "]}";
        
        data = data + ",\"items\":{\"count\":" + itemCount.ToString();
        data = data + ",\"list\":[" + itemList + "]}}";
        
        SendQueryResponse(commandId, data);
        
        int totalCount = playerCount + vehicleCount + zombieCount + animalCount + baseCount + itemCount;
        Log("Sent nearby entities: " + totalCount.ToString() + " total");
    }
    
    // =============================================================================
    // get_nearby_entities_at - Returns all entity types within a radius of coordinates
    //
    // param_1 = Coordinates as "x,y,z"
    // param_2 = Radius in meters (default: 50, min: 10, max: 200)
    //
    // Response format same as get_nearby_entities but with "position" instead of "player_id"
    // =============================================================================
    protected void ExecuteGetNearbyEntitiesAt(string commandId, string coords, string radius)
    {
        Log("Getting nearby entities at: " + coords);
        
        // Parse coordinates
        vector sourcePos = "0 0 0";
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                sourcePos[0] = parts.Get(0).ToFloat();
                sourcePos[1] = parts.Get(1).ToFloat();
                sourcePos[2] = parts.Get(2).ToFloat();
            }
        }
        
        if (sourcePos[0] == 0 && sourcePos[2] == 0)
        {
            string badCoords = "{\"type\":\"nearby_entities_at\"";
            badCoords = badCoords + ",\"error\":\"invalid_coordinates\"}";
            SendQueryResponse(commandId, badCoords);
            Log("Invalid coordinates: " + coords);
            return;
        }
        
        // Parse and clamp radius
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 10)
        {
            rad = 10;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        // Per-category limits to keep response size manageable
        static const int MAX_PER_CATEGORY = 50;
        
        // Get all objects in radius
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(sourcePos, rad, objects, proxyCargos);
        
        // Category lists
        string playerList = "";
        string vehicleList = "";
        string zombieList = "";
        string animalList = "";
        string baseList = "";
        string itemList = "";
        
        int playerCount = 0;
        int vehicleCount = 0;
        int zombieCount = 0;
        int animalCount = 0;
        int baseCount = 0;
        int itemCount = 0;
        
        int objectCount = objects.Count();
        
        for (int i = 0; i < objectCount; i++)
        {
            Object obj = objects.Get(i);
            if (!obj)
            {
                continue;
            }
            
            vector objPos = obj.GetPosition();
            float dist = vector.Distance(sourcePos, objPos);
            string className = obj.GetType();
            
            // Players
            PlayerBase playerCheck = PlayerBase.Cast(obj);
            if (playerCheck)
            {
                if (playerCount < MAX_PER_CATEGORY)
                {
                    PlayerIdentity identity = playerCheck.GetIdentity();
                    if (identity)
                    {
                        string pSteamId = identity.GetPlainId();
                        string pName = identity.GetName();
                        
                        if (playerList != "")
                        {
                            playerList = playerList + ",";
                        }
                        string pEntry = "{\"name\":\"" + pName + "\"";
                        pEntry = pEntry + ",\"steam_id\":\"" + pSteamId + "\"";
                        pEntry = pEntry + ",\"distance\":" + FormatCoord(dist);
                        pEntry = pEntry + ",\"x\":" + FormatCoord(objPos[0]);
                        pEntry = pEntry + ",\"y\":" + FormatCoord(objPos[1]);
                        pEntry = pEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                        playerList = playerList + pEntry;
                        playerCount++;
                    }
                }
                continue;
            }
            
            // Vehicles
            Car vehicleCheck = Car.Cast(obj);
            if (vehicleCheck)
            {
                if (vehicleCount < MAX_PER_CATEGORY)
                {
                    if (vehicleList != "")
                    {
                        vehicleList = vehicleList + ",";
                    }
                    EntityAI vehicleEntity = vehicleCheck;
                    string vehiclePersistentId = "";
                    if (vehicleEntity)
                    {
                        vehiclePersistentId = GetItemPersistentID(vehicleEntity);
                    }
                    string vEntry = "{\"class\":\"" + className + "\"";
                    vEntry = vEntry + ",\"id\":\"" + vehiclePersistentId + "\"";
                    vEntry = vEntry + ",\"distance\":" + FormatCoord(dist);
                    vEntry = vEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    vEntry = vEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    vEntry = vEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    vehicleList = vehicleList + vEntry;
                    vehicleCount++;
                }
                continue;
            }
            
            // Zombies
            ZombieBase zombieCheck = ZombieBase.Cast(obj);
            if (zombieCheck)
            {
                if (zombieCount < MAX_PER_CATEGORY)
                {
                    if (zombieList != "")
                    {
                        zombieList = zombieList + ",";
                    }
                    string zEntry = "{\"class\":\"" + className + "\"";
                    zEntry = zEntry + ",\"distance\":" + FormatCoord(dist);
                    zEntry = zEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    zEntry = zEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    zEntry = zEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    zombieList = zombieList + zEntry;
                    zombieCount++;
                }
                continue;
            }
            
            // Animals
            AnimalBase animalCheck = AnimalBase.Cast(obj);
            if (animalCheck)
            {
                if (animalCount < MAX_PER_CATEGORY)
                {
                    if (animalList != "")
                    {
                        animalList = animalList + ",";
                    }
                    string aEntry = "{\"class\":\"" + className + "\"";
                    aEntry = aEntry + ",\"distance\":" + FormatCoord(dist);
                    aEntry = aEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    aEntry = aEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    aEntry = aEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    animalList = animalList + aEntry;
                    animalCount++;
                }
                continue;
            }
            
            // Base building objects
            bool isBaseObject = false;
            string baseCategory = "";
            
            BaseBuildingBase baseBuildingCheck = BaseBuildingBase.Cast(obj);
            if (baseBuildingCheck)
            {
                isBaseObject = true;
                baseCategory = "building";
            }
            
            TentBase tentCheck = TentBase.Cast(obj);
            if (tentCheck)
            {
                isBaseObject = true;
                baseCategory = "tent";
            }
            
            Container_Base containerCheck = Container_Base.Cast(obj);
            if (containerCheck)
            {
                isBaseObject = true;
                baseCategory = "container";
            }
            
            if (isBaseObject)
            {
                if (baseCount < MAX_PER_CATEGORY)
                {
                    if (baseList != "")
                    {
                        baseList = baseList + ",";
                    }
                    EntityAI baseEntity = EntityAI.Cast(obj);
                    string basePersistentId = "";
                    if (baseEntity)
                    {
                        basePersistentId = GetItemPersistentID(baseEntity);
                    }
                    string bEntry = "{\"class\":\"" + className + "\"";
                    bEntry = bEntry + ",\"id\":\"" + basePersistentId + "\"";
                    bEntry = bEntry + ",\"category\":\"" + baseCategory + "\"";
                    bEntry = bEntry + ",\"distance\":" + FormatCoord(dist);
                    bEntry = bEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    bEntry = bEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    bEntry = bEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    baseList = baseList + bEntry;
                    baseCount++;
                }
                continue;
            }
            
            // Items (ground loot)
            ItemBase itemCheck = ItemBase.Cast(obj);
            if (itemCheck)
            {
                if (itemCount < MAX_PER_CATEGORY)
                {
                    EntityAI entity = EntityAI.Cast(obj);
                    string persistentId = "";
                    if (entity)
                    {
                        persistentId = GetItemPersistentID(entity);
                    }
                    
                    if (itemList != "")
                    {
                        itemList = itemList + ",";
                    }
                    string iEntry = "{\"class\":\"" + className + "\"";
                    iEntry = iEntry + ",\"id\":\"" + persistentId + "\"";
                    iEntry = iEntry + ",\"distance\":" + FormatCoord(dist);
                    iEntry = iEntry + ",\"x\":" + FormatCoord(objPos[0]);
                    iEntry = iEntry + ",\"y\":" + FormatCoord(objPos[1]);
                    iEntry = iEntry + ",\"z\":" + FormatCoord(objPos[2]) + "}";
                    itemList = itemList + iEntry;
                    itemCount++;
                }
                continue;
            }
        }
        
        // Build response JSON
        string data = "{\"type\":\"nearby_entities_at\"";
        data = data + ",\"position\":{\"x\":" + FormatCoord(sourcePos[0]);
        data = data + ",\"y\":" + FormatCoord(sourcePos[1]);
        data = data + ",\"z\":" + FormatCoord(sourcePos[2]) + "}";
        data = data + ",\"radius\":" + FormatCoord(rad);
        
        data = data + ",\"players\":{\"count\":" + playerCount.ToString();
        data = data + ",\"list\":[" + playerList + "]}";
        
        data = data + ",\"vehicles\":{\"count\":" + vehicleCount.ToString();
        data = data + ",\"list\":[" + vehicleList + "]}";
        
        data = data + ",\"zombies\":{\"count\":" + zombieCount.ToString();
        data = data + ",\"list\":[" + zombieList + "]}";
        
        data = data + ",\"animals\":{\"count\":" + animalCount.ToString();
        data = data + ",\"list\":[" + animalList + "]}";
        
        data = data + ",\"bases\":{\"count\":" + baseCount.ToString();
        data = data + ",\"list\":[" + baseList + "]}";
        
        data = data + ",\"items\":{\"count\":" + itemCount.ToString();
        data = data + ",\"list\":[" + itemList + "]}}";
        
        SendQueryResponse(commandId, data);
        
        int totalCount = playerCount + vehicleCount + zombieCount + animalCount + baseCount + itemCount;
        Log("Sent nearby entities at position: " + totalCount.ToString() + " total");
    }
    
    // =============================================================================
    // get_nearby_loot_at - Returns ground loot items within a radius of coordinates
    //
    // param_1 = Coordinates as "x,y,z"
    // param_2 = Radius in meters (default: 50, min: 5, max: 200)
    //
    // Response format same as get_nearby_loot but with "position" instead of "player_id"
    // =============================================================================
    protected void ExecuteGetNearbyLootAt(string commandId, string coords, string radius)
    {
        Log("Getting nearby loot at: " + coords);
        
        // Parse coordinates
        vector sourcePos = "0 0 0";
        if (coords != "")
        {
            array<string> parts = new array<string>();
            coords.Split(",", parts);
            if (parts.Count() >= 3)
            {
                sourcePos[0] = parts.Get(0).ToFloat();
                sourcePos[1] = parts.Get(1).ToFloat();
                sourcePos[2] = parts.Get(2).ToFloat();
            }
        }
        
        if (sourcePos[0] == 0 && sourcePos[2] == 0)
        {
            string badCoords = "{\"type\":\"nearby_loot_at\"";
            badCoords = badCoords + ",\"error\":\"invalid_coordinates\"}";
            SendQueryResponse(commandId, badCoords);
            Log("Invalid coordinates: " + coords);
            return;
        }
        
        // Parse and clamp radius
        float rad = 50;
        if (radius != "")
        {
            rad = radius.ToFloat();
        }
        if (rad < 5)
        {
            rad = 5;
        }
        if (rad > 200)
        {
            rad = 200;
        }
        
        int maxItems = 100;
        
        // Get all objects in radius
        array<Object> objects = new array<Object>();
        array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(sourcePos, rad, objects, proxyCargos);
        
        string itemList = "";
        int itemCount = 0;
        int objectCount = objects.Count();
        
        for (int i = 0; i < objectCount; i++)
        {
            Object obj = objects.Get(i);
            if (!obj)
            {
                continue;
            }
            
            // Skip players
            PlayerBase playerCheck = PlayerBase.Cast(obj);
            if (playerCheck)
            {
                continue;
            }
            
            // Skip vehicles
            Car vehicleCheck = Car.Cast(obj);
            if (vehicleCheck)
            {
                continue;
            }
            
            // Skip zombies/animals
            ZombieBase zombieCheck = ZombieBase.Cast(obj);
            if (zombieCheck)
            {
                continue;
            }
            
            AnimalBase animalCheck = AnimalBase.Cast(obj);
            if (animalCheck)
            {
                continue;
            }
            
            // Must be a valid EntityAI to get persistent ID
            EntityAI entity = EntityAI.Cast(obj);
            if (!entity)
            {
                continue;
            }
            
            // Must be an item (not a building or structure)
            ItemBase item = ItemBase.Cast(obj);
            if (!item)
            {
                continue;
            }
            
            vector itemPos = item.GetPosition();
            float dist = vector.Distance(sourcePos, itemPos);
            string persistentId = GetItemPersistentID(entity);
            string className = item.GetType();
            
            if (itemList != "")
            {
                itemList = itemList + ",";
            }
            
            string entry = "{\"class\":\"" + className + "\"";
            entry = entry + ",\"id\":\"" + persistentId + "\"";
            entry = entry + ",\"distance\":" + FormatCoord(dist);
            entry = entry + ",\"x\":" + FormatCoord(itemPos[0]);
            entry = entry + ",\"y\":" + FormatCoord(itemPos[1]);
            entry = entry + ",\"z\":" + FormatCoord(itemPos[2]) + "}";
            itemList = itemList + entry;
            itemCount++;
            
            if (itemCount >= maxItems)
            {
                break;
            }
        }
        
        string data = "{\"type\":\"nearby_loot_at\"";
        data = data + ",\"position\":{\"x\":" + FormatCoord(sourcePos[0]);
        data = data + ",\"y\":" + FormatCoord(sourcePos[1]);
        data = data + ",\"z\":" + FormatCoord(sourcePos[2]) + "}";
        data = data + ",\"radius\":" + FormatCoord(rad);
        data = data + ",\"count\":" + itemCount.ToString();
        data = data + ",\"items\":[" + itemList + "]}";
        
        SendQueryResponse(commandId, data);
        Log("Sent nearby loot at position: " + itemCount.ToString() + " items");
    }
    
    protected void SendQueryResponse(string commandId, string data)
    {
        RestApi api = GetRestApi();
        if (!api)
        {
            Log("ERROR: SendQueryResponse - GetRestApi() null, cannot send");
            return;
        }
        RestContext ctx = api.GetRestContext(m_Config.ack_url);
        if (!ctx)
        {
            Log("ERROR: SendQueryResponse - GetRestContext null, cannot send");
            return;
        }
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&id=" + commandId + "&query=1";
        string payload = "{\"server_id\":\"" + m_Config.server_id;
        payload = payload + "\",\"command_id\":\"" + commandId;
        payload = payload + "\",\"data\":" + data + "}";
        ctx.POST(new CommandRelayAckCallback(commandId), path, payload);
    }
    
    protected void SendAck(string commandId)
    {
        // Use base URL for context, put api_key in the path
        RestContext ctx = GetRestApi().GetRestContext(m_Config.ack_url);
        if (!ctx) return;
        
        ctx.SetHeader("application/json");
        string path = "?api_key=" + m_Config.api_key;
        path = path + "&server_id=" + m_Config.server_id;
        path = path + "&id=" + commandId;
        string payload = "{\"server_id\":\"" + m_Config.server_id;
        payload = payload + "\",\"command_id\":\"" + commandId + "\"}";
        ctx.POST(new CommandRelayAckCallback(commandId), path, payload);
        Log("ACK: " + commandId);
    }
}

class CommandRelayCommand
{
    string id;
    string type;
    string player_id;
    string param_1;
    string param_2;
}

class CommandRelayResponse
{
    ref array<ref CommandRelayCommand> commands;
    
    void CommandRelayResponse()
    {
        commands = new array<ref CommandRelayCommand>();
    }
}

class CommandRelayCallback extends RestCallback
{
    protected CommandRelay m_Relay;
    
    void CommandRelayCallback(CommandRelay relay)
    {
        m_Relay = relay;
    }
    
    override void OnSuccess(string data, int dataSize)
    {
        CommandRelay.StaticLog("OnSuccess callback fired, size=" + dataSize.ToString());
        if (m_Relay) m_Relay.ProcessCommands(data);
    }
    
    override void OnError(int errorCode)
    {
        CommandRelay.StaticLog("OnError callback fired: " + errorCode.ToString());
    }
    
    override void OnTimeout()
    {
        CommandRelay.StaticLog("OnTimeout callback fired");
    }
}

class CommandRelayAckCallback extends RestCallback
{
    protected string m_CmdId;
    
    void CommandRelayAckCallback(string id)
    {
        m_CmdId = id;
    }
    
    override void OnSuccess(string data, int dataSize)
    {
        CommandRelay.StaticLog("Ack OK: " + m_CmdId);
    }
    
    override void OnError(int errorCode)
    {
        CommandRelay.StaticLog("Ack error: " + errorCode.ToString());
    }
    
    override void OnTimeout()
    {
        CommandRelay.StaticLog("Ack timeout");
    }
}

class CommandRelayEventCallback extends RestCallback
{
    protected string m_EventType;
    protected string m_PlayerId;
    
    void CommandRelayEventCallback(string eventType, string playerId)
    {
        m_EventType = eventType;
        m_PlayerId = playerId;
    }
    
    override void OnSuccess(string data, int dataSize)
    {
        CommandRelay.StaticLog("Event OK: " + m_EventType + " for " + m_PlayerId);
    }
    
    override void OnError(int errorCode)
    {
        CommandRelay.StaticLog("Event error (" + m_EventType + "): " + errorCode.ToString());
    }
    
    override void OnTimeout()
    {
        CommandRelay.StaticLog("Event timeout: " + m_EventType);
    }
}
