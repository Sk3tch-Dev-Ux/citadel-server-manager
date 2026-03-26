// =============================================================================
// CommandRelayPlayerBase.c - Modded PlayerBase for death event tracking
// Caches last hit info in EEHitBy, fires death event in EEKilled
// =============================================================================

modded class PlayerBase
{
    // Cache the last hit details so we have them when EEKilled fires
    protected string m_CR_LastHitZone;
    protected string m_CR_LastHitAmmo;
    protected int m_CR_LastHitDamageType;
    protected EntityAI m_CR_LastHitSource;
    
    override void EEHitBy(TotalDamageResult damageResult, int damageType, EntityAI source, int component, string dmgZone, string ammo, vector modelPos, float speedCoef)
    {
        super.EEHitBy(damageResult, damageType, source, component, dmgZone, ammo, modelPos, speedCoef);
        
        // Only track on server
        if (!GetGame().IsDedicatedServer())
        {
            return;
        }
        
        // Cache hit details for use in EEKilled
        m_CR_LastHitZone = dmgZone;
        m_CR_LastHitAmmo = ammo;
        m_CR_LastHitDamageType = damageType;
        m_CR_LastHitSource = source;
    }
    
    override void EEKilled(Object killer)
    {
        // Fire death event before super (which may clean up state we need)
        if (GetGame().IsDedicatedServer())
        {
            CommandRelay relay = CommandRelay.s_Instance;
            if (relay)
            {
                relay.OnPlayerDeath(this, killer, m_CR_LastHitZone, m_CR_LastHitAmmo, m_CR_LastHitDamageType, m_CR_LastHitSource);
            }
        }
        
        super.EEKilled(killer);
    }
}
