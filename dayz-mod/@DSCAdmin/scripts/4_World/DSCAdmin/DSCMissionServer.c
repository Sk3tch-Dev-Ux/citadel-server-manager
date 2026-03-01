/**
 * DSCAdmin Mod — Mission-level initialization.
 *
 * Hooks into the DayZ mission lifecycle to start the command runner,
 * player tracker, and event logger on server startup.
 */
modded class MissionServer
{
    protected ref DSCCommandRunner m_DSCCommandRunner;
    protected ref DSCPlayerTracker m_DSCPlayerTracker;

    override void OnInit()
    {
        super.OnInit();

        Print("[DSCAdmin] Initializing DSCAdmin mod...");

        m_DSCCommandRunner = new DSCCommandRunner();
        m_DSCPlayerTracker = new DSCPlayerTracker();

        Print("[DSCAdmin] Mod initialized successfully");
    }

    override void OnMissionFinish()
    {
        Print("[DSCAdmin] Shutting down...");

        m_DSCCommandRunner = null;
        m_DSCPlayerTracker = null;

        super.OnMissionFinish();
    }

    // ─── Event Hooks ─────────────────────────────────────

    override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
    {
        super.InvokeOnConnect(player, identity);

        if (identity)
        {
            DSCEventLogger.LogConnect(identity.GetPlainId(), identity.GetName());
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
                DSCEventLogger.LogDisconnect(identity.GetPlainId(), identity.GetName(), 0);
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

                DSCEventLogger.LogKill(
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
            DSCEventLogger.LogSuicide(victimSteamId, victimName);
        }
    }
};
