// =============================================================================
// CommandRelayInit.c - Server entry point for the Command Relay
// Hooks into MissionServer to start polling on server startup
// =============================================================================

modded class MissionServer
{
    protected ref CommandRelay m_CommandRelay;
    
    override void OnInit()
    {
        super.OnInit();
        
        // Only run on dedicated server
        if (GetGame().IsDedicatedServer())
        {
            m_CommandRelay = new CommandRelay();
            m_CommandRelay.Start();
        }
    }
    
    override void OnMissionFinish()
    {
        // Clean up when server shuts down
        if (m_CommandRelay)
        {
            m_CommandRelay.Stop();
            m_CommandRelay = null;
        }
        
        super.OnMissionFinish();
    }
    
    // Track player session time on connect
    override void InvokeOnConnect(PlayerBase player, PlayerIdentity identity)
    {
        super.InvokeOnConnect(player, identity);
        
        if (m_CommandRelay && identity)
        {
            m_CommandRelay.OnPlayerConnect(player, identity);
        }
    }
    
    // Clean up session tracking on disconnect
    override void InvokeOnDisconnect(PlayerBase player)
    {
        if (m_CommandRelay && player)
        {
            m_CommandRelay.OnPlayerDisconnect(player);
        }
        
        super.InvokeOnDisconnect(player);
    }
    
}
