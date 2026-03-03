/**
 * CitadelMissionServer — Mission-level lifecycle management.
 *
 * Properly placed in 5_Mission layer. Initializes all subsystems on server
 * startup, hooks into player connect/disconnect/kill/chat events, and
 * manages graceful shutdown.
 */
modded class MissionServer
{
    protected ref CitadelCommandRunner m_CitCommandRunner;
    protected ref CitadelPlayerTracker m_CitPlayerTracker;
    protected ref CitadelMetricsTracker m_CitMetricsTracker;
    protected ref CitadelReporter m_CitReporter;

    override void OnInit()
    {
        super.OnInit();

        // CitadelCore initializes itself as a 3_Game singleton via GetCitadel()
        GetCitadel().GetLogger().Info("MissionServer.OnInit() — starting subsystems");

        m_CitCommandRunner = new CitadelCommandRunner();
        m_CitPlayerTracker = new CitadelPlayerTracker();
        m_CitMetricsTracker = new CitadelMetricsTracker();
        m_CitReporter = new CitadelReporter();

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
