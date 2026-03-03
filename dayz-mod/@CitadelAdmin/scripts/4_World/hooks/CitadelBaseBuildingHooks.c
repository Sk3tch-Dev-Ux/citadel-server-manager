/**
 * CitadelBaseBuildingHooks — Base building lifecycle tracking.
 *
 * Hooks into BaseBuildingBase to track:
 * - Construction ownership (who built it)
 * - Placement and destruction events
 * - Persistent identification
 */
modded class BaseBuildingBase extends ItemBase
{
    private string m_CitOwnerSteamId = "";
    private string m_CitPersistentId = "";

    // ─── Lifecycle Hooks ──────────────────────────────

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackBaseBuilding()) return;

        // Generate a persistent ID for this base component
        if (m_CitPersistentId == "")
            m_CitPersistentId = CitGeneratePersistentId();

        GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] EEInit %1 (type=%2, id=%3)", this, GetType(), m_CitPersistentId));
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && GetCitadel().GetConfiguration().GetTrackBaseBuilding())
        {
            GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] EEDelete %1 (type=%2, owner=%3)", this, GetType(), m_CitOwnerSteamId));

            if (m_CitOwnerSteamId != "")
            {
                vector pos = GetPosition();
                CitadelEventLogger.LogBaseDestroyed(m_CitOwnerSteamId, GetType(), pos);
            }
        }

        super.EEDelete(parent);
    }

    // ─── Ownership ────────────────────────────────────

    void CitSetOwner(string steamId)
    {
        m_CitOwnerSteamId = steamId;
        GetCitadel().GetLogger().Debug(string.Format("[BaseBuilding] Owner set: %1 for %2", steamId, GetType()));
    }

    string CitGetOwner() { return m_CitOwnerSteamId; }
    string CitGetPersistentId() { return m_CitPersistentId; }

    // ─── Utility ──────────────────────────────────────

    protected string CitGeneratePersistentId()
    {
        // Generate a unique ID based on position + type + time
        vector pos = GetPosition();
        string raw = string.Format("%1_%2_%3_%4_%5", GetType(), pos[0].ToString(), pos[1].ToString(), pos[2].ToString(), GetGame().GetTime().ToString());
        return raw;
    }
};
