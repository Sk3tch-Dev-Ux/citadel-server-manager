/**
 * CitadelMissionServer — Mission-level lifecycle management.
 *
 * Properly placed in 5_Mission layer. Initializes all subsystems on server
 * startup, hooks into player connect/disconnect/kill/chat events, and
 * manages graceful shutdown.
 *
 * Also handles a grid-based scan of static world objects to register
 * configurable map markers for entities already present at server start.
 */
modded class MissionServer
{
    protected ref CitadelCommandRunner m_CitCommandRunner;
    protected ref CitadelPlayerTracker m_CitPlayerTracker;
    protected ref CitadelMetricsTracker m_CitMetricsTracker;
    protected ref CitadelReporter m_CitReporter;

    // Grid scan state for static object marker registration
    protected int m_ScanGridX;
    protected int m_ScanGridY;
    protected bool m_StaticObjectsScanned;
    protected float m_ScanStartTime;
    static const int GRID_SIZE = 10;

    override void OnInit()
    {
        super.OnInit();

        // CitadelCore initializes itself as a 3_Game singleton via GetCitadel()
        GetCitadel().GetLogger().Info("MissionServer.OnInit() — starting subsystems");

        // Initialize map marker manager (loads MapMarkers.json)
        if (GetCitadel().GetConfiguration().GetTrackMapMarkers())
        {
            GetMarkerManager();
            GetCitadel().GetLogger().Info(string.Format("MapMarkerManager ready (%1 definitions)", GetMarkerManager().GetConfigCount().ToString()));
        }

        m_CitCommandRunner = new CitadelCommandRunner();
        m_CitPlayerTracker = new CitadelPlayerTracker();
        m_CitMetricsTracker = new CitadelMetricsTracker();
        m_CitReporter = new CitadelReporter();

        // Init grid scan state
        m_ScanGridX = 0;
        m_ScanGridY = 0;
        m_StaticObjectsScanned = false;
        m_ScanStartTime = 0;

        // Signal FPS tracker that mission is loaded — enables tick time measurement
        GetDayZGame().CitSetMissionLoaded();

        float bootTime = GetGame().GetTickTime();
        GetCitadel().GetLogger().Info(string.Format("CitadelAdmin v%1 fully initialized in %2s", GetCitadel().GetVersion(), bootTime.ToString()));
    }

    override void OnMissionFinish()
    {
        GetCitadel().GetLogger().Info("MissionServer.OnMissionFinish() — shutting down");

        // Flush any remaining data before shutdown
        if (m_CitReporter)
            m_CitReporter.FlushAll();

        // Clean up subsystems
        m_CitCommandRunner = null;
        m_CitPlayerTracker = null;
        m_CitMetricsTracker = null;
        m_CitReporter = null;

        // Signal core to stop processing
        GetCitadel().Exit();

        super.OnMissionFinish();
    }

    // ─── Grid Scan for Static Objects ────────────────────

    override void OnUpdate(float timeslice)
    {
        super.OnUpdate(timeslice);

        if (m_StaticObjectsScanned) return;
        if (!GetCitadel().GetConfiguration().GetTrackMapMarkers()) return;
        if (GetMarkerManager().GetConfigCount() == 0) return;

        // Wait 30 seconds after mission start before scanning
        float gameTime = GetGame().GetTickTime();
        if (gameTime < 30.0) return;

        if (m_ScanStartTime == 0)
        {
            m_ScanStartTime = gameTime;
            GetCitadel().GetLogger().Info(string.Format("Starting static object grid scan (%1x%1 sectors)", GRID_SIZE.ToString()));
        }

        ProcessNextScanGrid();
    }

    protected void ProcessNextScanGrid()
    {
        // Calculate world size — use a safe large default
        float worldSize = GetGame().GetWorld().GetWorldSize();
        if (worldSize <= 0) worldSize = 15360;

        float sectorSize = worldSize / GRID_SIZE;

        // Calculate sector bounds
        float minX = m_ScanGridX * sectorSize;
        float minZ = m_ScanGridY * sectorSize;
        float maxX = minX + sectorSize;
        float maxZ = minZ + sectorSize;

        vector mins = Vector(minX, -1500, minZ);
        vector maxs = Vector(maxX, 1500, maxZ);

        // Query entities in this sector
        array<Object> sceneObjects = new array<Object>;
        array<Object> physicsObjects = new array<Object>;
        array<CargoBase> proxyCargos = new array<CargoBase>;

        GetGame().GetObjectsAtPosition3D(mins, maxs - mins, sceneObjects, proxyCargos);

        // Merge both lists
        for (int p = 0; p < physicsObjects.Count(); p++)
        {
            Object phys = physicsObjects.Get(p);
            if (phys && sceneObjects.Find(phys) < 0)
                sceneObjects.Insert(phys);
        }

        // Process entities in this sector
        for (int i = 0; i < sceneObjects.Count(); i++)
        {
            Object obj = sceneObjects.Get(i);
            if (!obj) continue;

            // Skip ItemBase — handled by CitadelItemHooks
            if (obj.IsInherited(ItemBase)) continue;

            string className = obj.GetType();
            if (className == "") continue;

            // Check if this class is in our marker config
            CitadelMapMarkerEntry config = GetMarkerManager().GetConfig(className);
            if (!config) continue;

            // Check if already registered
            string objectId = className + "_" + obj.GetPosition().ToString();
            if (GetMarkerManager().IsRegistered(objectId)) continue;

            // Register as a tracked event
            string displayName = config.displayName;
            if (displayName == "")
                displayName = className;

            CitadelTrackedEvent tracked = new CitadelTrackedEvent(className, config.icon, obj, displayName);
            GetCitadel().RegisterEvent(tracked);
            GetMarkerManager().MarkRegistered(objectId);
        }

        // Advance to next sector
        m_ScanGridX++;
        if (m_ScanGridX >= GRID_SIZE)
        {
            m_ScanGridX = 0;
            m_ScanGridY++;
        }

        // Check if scan is complete
        if (m_ScanGridY >= GRID_SIZE)
        {
            m_StaticObjectsScanned = true;
            float elapsed = GetGame().GetTickTime() - m_ScanStartTime;
            GetCitadel().GetLogger().Info(string.Format("Static object scan complete in %1s", elapsed.ToString()));
        }
    }

    // ─── Player Connect ───────────────────────────────

    override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
    {
        super.InvokeOnConnect(player, identity);

        if (!identity) return;

        string steamId = identity.GetPlainId();
        string name = identity.GetName();

        // Register in core (tracks entity ref, stats, session start)
        GetCitadel().RegisterPlayer(steamId, player);

        // Set identity on the player hooks
        player.CitSetIdentity(steamId, name);

        // Log the connection event
        CitadelEventLogger.LogConnect(steamId, name);

        GetCitadel().GetLogger().Info(string.Format("Player connected: %1 (%2)", name, steamId));
    }

    // ─── Player Disconnect ────────────────────────────

    override void InvokeOnDisconnect(PlayerBase player)
    {
        if (player)
        {
            string steamId = player.GetCitSteamId();
            string name = player.GetCitName();

            if (steamId != "")
            {
                // Calculate session duration
                int sessionDuration = GetCitadel().GetPlayerSessionDuration(steamId);

                // Log disconnect with session time
                CitadelEventLogger.LogDisconnect(steamId, name, sessionDuration);

                // Dump full session statistics
                if (GetCitadel().GetConfiguration().GetTrackPlayerStats())
                {
                    CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                    if (stats)
                    {
                        CitadelEventLogger.LogSession(steamId, name, sessionDuration, stats.ToJson());
                    }
                }

                // Cleanup player from core registries
                GetCitadel().UnregisterPlayer(steamId);

                GetCitadel().GetLogger().Info(string.Format("Player disconnected: %1 (%2) after %3s", name, steamId, sessionDuration.ToString()));
            }
        }

        super.InvokeOnDisconnect(player);
    }

    // ─── Chat Events ──────────────────────────────────

    override void OnEvent(EventType eventTypeId, Param params)
    {
        super.OnEvent(eventTypeId, params);

        if (eventTypeId == ChatMessageEventTypeID)
        {
            ChatMessageEventParams chatParams = ChatMessageEventParams.Cast(params);
            if (chatParams)
            {
                int channel = chatParams.param1;
                string senderName = chatParams.param2;
                string messageText = chatParams.param3;

                // BattlEye join/leave sanitization
                if (GetCitadel().GetConfiguration().GetChatSanitizeBattlEyeJoinLeave())
                {
                    if (messageText.Contains("connected") || messageText.Contains("disconnected"))
                        return;
                }

                // BattlEye admin prefix sanitization
                if (GetCitadel().GetConfiguration().GetChatSanitizeBattlEyePrefix())
                {
                    if (senderName.Contains("Admin"))
                    {
                        senderName.Replace("(Admin) ", "");
                        senderName.Replace("Admin: ", "");
                    }
                }

                // Find the player who sent the message using our own registry
                string senderSteamId = "";
                map<string, PlayerBase> chatPlayers = GetCitadel().GetActivePlayers();
                for (int ci = 0; ci < chatPlayers.Count(); ci++)
                {
                    PlayerBase chatPlayer = chatPlayers.GetElement(ci);
                    if (chatPlayer && chatPlayer.GetIdentity())
                    {
                        if (chatPlayer.GetIdentity().GetName() == senderName)
                        {
                            senderSteamId = chatPlayer.GetIdentity().GetPlainId();
                            break;
                        }
                    }
                }

                string channelName = "global";
                if (channel == 1)
                    channelName = "direct";
                else if (channel == 2)
                    channelName = "vehicle";
                else if (channel == 3)
                    channelName = "faction";
                else if (channel == 4)
                    channelName = "admin";

                CitadelEventLogger.LogChat(senderSteamId, senderName, messageText, channelName);
            }
        }
    }
};
