/**
 * CitadelAdmin Mod — Mission-level initialization.
 *
 * Hooks into the DayZ mission lifecycle to start the command runner,
 * player tracker, and event logger on server startup.
 */
modded class MissionServer
{
    protected ref CitadelCommandRunner m_CitadelCommandRunner;
    protected ref CitadelPlayerTracker m_CitadelPlayerTracker;

    override void OnInit()
    {
        super.OnInit();

        Print("[Citadel] Initializing CitadelAdmin mod...");

        m_CitadelCommandRunner = new CitadelCommandRunner();
        m_CitadelPlayerTracker = new CitadelPlayerTracker();

        Print("[Citadel] Mod initialized successfully");
    }

    override void OnMissionFinish()
    {
        Print("[Citadel] Shutting down...");

        m_CitadelCommandRunner = null;
        m_CitadelPlayerTracker = null;

        super.OnMissionFinish();
    }

    // ─── Event Hooks ─────────────────────────────────────

    override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
    {
        super.InvokeOnConnect(player, identity);

        if (identity)
        {
            CitadelEventLogger.LogConnect(identity.GetPlainId(), identity.GetName());
        }
    }

    override void InvokeOnDisconnect(PlayerBase player)
    {
        if (player)
        {
            PlayerIdentity identity = player.GetIdentity();
            if (identity)
            {
                // Estimate session time (not perfect, but functional)
                CitadelEventLogger.LogDisconnect(identity.GetPlainId(), identity.GetName(), 0);
            }
        }

        super.InvokeOnDisconnect(player);
    }

    override void PlayerKilled(PlayerBase player, Object killer)
    {
        super.PlayerKilled(player, killer);

        if (!player) return;

        PlayerIdentity victimId = player.GetIdentity();
        if (!victimId) return;

        string victimSteamId = victimId.GetPlainId();
        string victimName = victimId.GetName();

        // Check if killed by another player
        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (killerPlayer && killerPlayer != player)
        {
            PlayerIdentity killerId = killerPlayer.GetIdentity();
            if (killerId)
            {
                float distance = vector.Distance(player.GetPosition(), killerPlayer.GetPosition());
                string weapon = "Unknown";

                // Try to get the weapon
                EntityAI weaponInHands = killerPlayer.GetHumanInventory().GetEntityInHands();
                if (weaponInHands)
                    weapon = weaponInHands.GetType();

                CitadelEventLogger.LogKill(
                    killerId.GetPlainId(),
                    killerId.GetName(),
                    victimSteamId,
                    victimName,
                    distance,
                    weapon
                );
                return;
            }
        }

        // Self-inflicted death
        if (killer == player || !killer)
        {
            CitadelEventLogger.LogSuicide(victimSteamId, victimName);
        }
    }
};
