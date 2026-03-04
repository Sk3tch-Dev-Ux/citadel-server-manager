/**
 * CitadelCore — Central singleton managing all Citadel subsystems.
 *
 * Initialized at game level (3_Game) so it's available to all subsequent layers.
 * Manages: configuration, logging, player statistics, entity registries,
 * server metrics, and lifecycle state.
 *
 * Access via global function: GetCitadel()
 */
class CitadelCore
{
    private static const string VERSION = "2.0.0";
    private static const string STORAGE_DIR = "$profile:Citadel";

    private ref CitadelLogger m_Logger;
    private ref CitadelConfiguration m_Configuration;

    private bool m_IsServer;
    private bool m_BlockProcessing;

    // Player tracking
    private ref map<string, ref CitadelPlayerStats> m_PlayerStats;
    private ref map<string, int> m_PlayerSessionStart;
    private ref map<string, Man> m_ActivePlayers;

    // Entity registries
    private ref array<ref CitadelTrackedAI> m_TrackedAI;
    private ref array<ref CitadelTrackedVehicle> m_TrackedVehicles;
    private ref array<ref CitadelTrackedEvent> m_TrackedEvents;

    // Server metrics
    private int m_ServerFPS;
    private int m_TickCount;
    private float m_TickTimeAvg;
    private float m_TickTimeLow;
    private float m_TickTimeHigh;

    // Entity counts (incremented/decremented by hooks for efficiency)
    private int m_AICount;
    private int m_AnimalCount;
    private int m_VehicleCount;
    private int m_EntityCount;

    void CitadelCore()
    {
        m_IsServer = GetGame().IsDedicatedServer();
        m_BlockProcessing = false;

        m_PlayerStats = new map<string, ref CitadelPlayerStats>;
        m_PlayerSessionStart = new map<string, int>;
        m_ActivePlayers = new map<string, Man>;

        m_TrackedAI = new array<ref CitadelTrackedAI>;
        m_TrackedVehicles = new array<ref CitadelTrackedVehicle>;
        m_TrackedEvents = new array<ref CitadelTrackedEvent>;

        m_ServerFPS = 0;
        m_TickCount = 0;
        m_TickTimeAvg = 0;
        m_TickTimeLow = 0;
        m_TickTimeHigh = 0;
        m_AICount = 0;
        m_AnimalCount = 0;
        m_VehicleCount = 0;
        m_EntityCount = 0;

        // Load configuration
        m_Configuration = new CitadelConfiguration();
        if (m_Configuration.CheckDiskPresence())
        {
            m_Configuration.LoadFromDisk();
        }
        else if (m_IsServer)
        {
            m_Configuration.SaveDefaults();
        }

        // Initialize logger
        m_Logger = new CitadelLogger("Citadel", m_Configuration.GetDebugEnabled());
        m_Logger.Info(string.Format("CitadelAdmin v%1 initializing (server=%2)", VERSION, m_IsServer.ToString()));

        // Ensure storage directories
        if (!FileExist(STORAGE_DIR))
        {
            MakeDirectory(STORAGE_DIR);
            m_Logger.Info("Created storage directory: " + STORAGE_DIR);
        }

        string cmdDir = STORAGE_DIR + "/commands";
        string resDir = STORAGE_DIR + "/responses";
        if (!FileExist(cmdDir))
            MakeDirectory(cmdDir);
        if (!FileExist(resDir))
            MakeDirectory(resDir);

        m_Logger.Info("CitadelCore initialized successfully");
    }

    // ─── Lifecycle ────────────────────────────────────

    void Exit()
    {
        m_BlockProcessing = true;
        if (m_Logger) m_Logger.Info("(Core) Attempting graceful exit");
        m_TrackedAI.Clear();
        m_TrackedVehicles.Clear();
        m_TrackedEvents.Clear();
        m_PlayerStats.Clear();
        m_PlayerSessionStart.Clear();
        m_ActivePlayers.Clear();
        if (m_Logger) m_Logger.Debug("(Core) All buffers cleared");
    }

    bool IsProcessingBlocked() { return m_BlockProcessing; }
    bool IsServer() { return m_IsServer; }
    string GetVersion() { return VERSION; }

    // ─── Module Access ────────────────────────────────

    CitadelLogger GetLogger() { return m_Logger; }
    CitadelConfiguration GetConfiguration() { return m_Configuration; }

    // ─── Player Statistics ────────────────────────────

    void RegisterPlayer(string steamId, Man player)
    {
        if (!m_IsServer) return;
        if (!m_PlayerStats.Contains(steamId))
        {
            m_PlayerStats.Set(steamId, new CitadelPlayerStats());
            m_PlayerSessionStart.Set(steamId, GetGame().GetTime());
        }
        if (player)
            m_ActivePlayers.Set(steamId, player);
        m_Logger.Debug("RegisterPlayer: " + steamId);
    }

    void UnregisterPlayer(string steamId)
    {
        if (!m_IsServer) return;
        m_PlayerStats.Remove(steamId);
        m_PlayerSessionStart.Remove(steamId);
        m_ActivePlayers.Remove(steamId);
        m_Logger.Debug("UnregisterPlayer: " + steamId);
    }

    map<string, Man> GetActivePlayers() { return m_ActivePlayers; }
    int GetActivePlayerCount() { return m_ActivePlayers.Count(); }

    CitadelPlayerStats GetPlayerStats(string steamId)
    {
        if (!m_PlayerStats.Contains(steamId))
            return null;
        return m_PlayerStats.Get(steamId);
    }

    int GetPlayerSessionDuration(string steamId)
    {
        if (!m_PlayerSessionStart.Contains(steamId))
            return 0;
        return (GetGame().GetTime() - m_PlayerSessionStart.Get(steamId)) / 1000;
    }

    // ─── Server Metrics ──────────────────────────────

    int GetServerFPS() { return m_ServerFPS; }
    void SetServerFPS(int fps) { m_ServerFPS = fps; }

    float GetTickTimeAvg() { return m_TickTimeAvg; }
    float GetTickTimeLow() { return m_TickTimeLow; }
    float GetTickTimeHigh() { return m_TickTimeHigh; }
    void SetTickTimes(float avg, float low, float high)
    {
        m_TickTimeAvg = avg;
        m_TickTimeLow = low;
        m_TickTimeHigh = high;
    }

    int GetTickCount() { return m_TickCount; }
    void SetTickCount(int count) { m_TickCount = count; }

    void DebugTickTimes()
    {
        string tickTimes = string.Format("TickTimesSnapshot[average=%1; low=%2; high=%3; totalTicks=%4; serverFps=%5;]", m_TickTimeAvg, m_TickTimeLow, m_TickTimeHigh, m_TickCount, m_ServerFPS);
        m_Logger.Debug(tickTimes);
    }

    void HandleMissionLoaded()
    {
        DayZGame dzg = DayZGame.Cast(GetGame());
        if (dzg)
            dzg.CitSetMissionLoaded();
        float tickTime = GetGame().GetTickTime();
        m_Logger.Info(string.Format("Mission fully loaded in %1s. Server ready for connections.", tickTime));
    }

    // ─── Entity Counts ───────────────────────────────

    int GetAICount() { return m_AICount; }
    void IncrAICount() { m_AICount++; }
    void DecrAICount() { m_AICount--; }

    int GetAnimalCount() { return m_AnimalCount; }
    void IncrAnimalCount() { m_AnimalCount++; }
    void DecrAnimalCount() { m_AnimalCount--; }

    int GetVehicleCount() { return m_VehicleCount; }
    void IncrVehicleCount() { m_VehicleCount++; }
    void DecrVehicleCount() { m_VehicleCount--; }

    int GetEntityCount() { return m_EntityCount; }
    void IncrEntityCount() { m_EntityCount++; }
    void DecrEntityCount() { m_EntityCount--; }

    int GetActiveAICount()
    {
        int count = 0;
        for (int i = 0; i < m_TrackedAI.Count(); i++)
        {
            CitadelTrackedAI ai = m_TrackedAI.Get(i);
            if (ai && ai.IsInfected() && ai.IsActive())
                count++;
        }
        return count;
    }

    int GetActiveAnimalCount()
    {
        int count = 0;
        for (int i = 0; i < m_TrackedAI.Count(); i++)
        {
            CitadelTrackedAI ai = m_TrackedAI.Get(i);
            if (ai && !ai.IsInfected() && ai.IsActive())
                count++;
        }
        return count;
    }

    // ─── AI Registry ─────────────────────────────────

    array<ref CitadelTrackedAI> GetTrackedAI() { return m_TrackedAI; }

    void RegisterAI(CitadelTrackedAI tracked)
    {
        if (!tracked || !tracked.Ref() || IsProcessingBlocked()) return;
        m_TrackedAI.Insert(tracked);
        string aiType = "animal";
        if (tracked.IsInfected()) aiType = "infected";
        m_Logger.Debug(string.Format("RegisterAI(%1) - %2", tracked.Ref().GetType(), aiType));
    }

    void RemoveAI(CitadelTrackedAI tracked)
    {
        if (!tracked || IsProcessingBlocked()) return;
        int idx = m_TrackedAI.Find(tracked);
        if (idx >= 0)
        {
            string typeName = "unknown";
            if (tracked.Ref())
                typeName = tracked.Ref().GetType();
            m_TrackedAI.Remove(idx);
            m_Logger.Debug(string.Format("RemoveAI(%1) - success", typeName));
        }
    }

    // ─── Vehicle Registry ────────────────────────────

    array<ref CitadelTrackedVehicle> GetTrackedVehicles() { return m_TrackedVehicles; }

    void RegisterVehicle(CitadelTrackedVehicle tracked)
    {
        if (!tracked || IsProcessingBlocked()) return;
        m_TrackedVehicles.Insert(tracked);
        m_Logger.Debug(string.Format("RegisterVehicle(%1<%2>) - success", tracked.GetID(), tracked.GetClassName()));
    }

    void RemoveVehicle(CitadelTrackedVehicle tracked)
    {
        if (!tracked || IsProcessingBlocked()) return;
        int idx = m_TrackedVehicles.Find(tracked);
        if (idx >= 0)
        {
            m_TrackedVehicles.Remove(idx);
            m_Logger.Debug(string.Format("RemoveVehicle(%1) - success", tracked.GetID()));
        }
    }

    CitadelTrackedVehicle FindVehicleByNetId(string netId)
    {
        for (int i = 0; i < m_TrackedVehicles.Count(); i++)
        {
            if (m_TrackedVehicles.Get(i).GetID() == netId)
                return m_TrackedVehicles.Get(i);
        }
        return null;
    }

    // ─── Event Registry ──────────────────────────────

    array<ref CitadelTrackedEvent> GetTrackedEvents() { return m_TrackedEvents; }

    void RegisterEvent(CitadelTrackedEvent tracked)
    {
        if (!tracked || IsProcessingBlocked()) return;

        // Duplicate check
        for (int i = 0; i < m_TrackedEvents.Count(); i++)
        {
            if (m_TrackedEvents.Get(i).Equals(tracked))
            {
                m_Logger.Debug(string.Format("RegisterEvent(%1) - duplicate, skipping", tracked.GetClassName()));
                return;
            }
        }

        m_TrackedEvents.Insert(tracked);
        m_Logger.Debug(string.Format("RegisterEvent(%1<%2>) - success", tracked.GetClassName(), tracked.GetDisplayName()));
    }

    void RegisterEventRadiusExclusive(CitadelTrackedEvent tracked, float radius)
    {
        if (!tracked || !tracked.Ref() || IsProcessingBlocked()) return;

        for (int i = 0; i < m_TrackedEvents.Count(); i++)
        {
            CitadelTrackedEvent existing = m_TrackedEvents.Get(i);
            if (existing.Equals(tracked))
            {
                m_Logger.Debug(string.Format("RegisterEventRadiusExclusive(%1) - duplicate", tracked.GetClassName()));
                return;
            }
            if (existing.Ref() && existing.Ref().GetType() == tracked.Ref().GetType())
            {
                float dist = vector.Distance(existing.Ref().GetPosition(), tracked.Ref().GetPosition());
                if (dist <= radius)
                {
                    m_Logger.Debug(string.Format("RegisterEventRadiusExclusive(%1) - too close (%2m)", tracked.GetClassName(), dist.ToString()));
                    return;
                }
            }
        }

        m_TrackedEvents.Insert(tracked);
        m_Logger.Debug(string.Format("RegisterEventRadiusExclusive(%1<%2>) - success", tracked.GetClassName(), tracked.GetDisplayName()));
    }

    void RegisterEventRadiusExclusiveSecondary(CitadelTrackedEvent tracked, float radius, string blocker)
    {
        if (!tracked || !tracked.Ref() || IsProcessingBlocked()) return;

        for (int i = 0; i < m_TrackedEvents.Count(); i++)
        {
            CitadelTrackedEvent existing = m_TrackedEvents.Get(i);
            if (existing.Equals(tracked))
            {
                m_Logger.Debug(string.Format("RegisterEventRadiusExclusiveSecondary(%1) - duplicate", tracked.GetClassName()));
                return;
            }
            if (existing.Ref() && existing.Ref().GetType() == blocker)
            {
                float dist = vector.Distance(existing.Ref().GetPosition(), tracked.Ref().GetPosition());
                if (dist <= radius)
                {
                    m_Logger.Debug(string.Format("RegisterEventRadiusExclusiveSecondary(%1) - blocker %2 within %3m", tracked.GetClassName(), blocker, dist.ToString()));
                    return;
                }
            }
        }

        m_TrackedEvents.Insert(tracked);
        m_Logger.Debug(string.Format("RegisterEventRadiusExclusiveSecondary(%1<%2>) - success", tracked.GetClassName(), tracked.GetDisplayName()));
    }

    void RemoveEvent(CitadelTrackedEvent tracked)
    {
        if (!tracked || IsProcessingBlocked()) return;
        int idx = m_TrackedEvents.Find(tracked);
        if (idx >= 0)
        {
            m_TrackedEvents.Remove(idx);
            m_Logger.Debug(string.Format("RemoveEvent(%1) - success", tracked.GetClassName()));
        }
    }
};

// ─── Global Singleton Access ─────────────────────────

private static ref CitadelCore g_CitadelCore;

static ref CitadelCore GetCitadel()
{
    if (!g_CitadelCore)
    {
        g_CitadelCore = new CitadelCore();
    }
    return g_CitadelCore;
};
