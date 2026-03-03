/**
 * CitadelDynamicEventHooks — World event tracking.
 *
 * Hooks into dynamic event entities (helicopter crashes, convoys, etc.)
 * to register/deregister them with CitadelCore for map display and telemetry.
 */

// ─── Helicopter Crashes ───────────────────────────────

modded class Wreck_UH1Y extends CrashBase
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "helicopter", this, "UH1Y Wreck");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "UH1Y Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "UH1Y Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

modded class Wreck_Mi8 extends CrashBase
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "helicopter", this, "Mi8 Wreck");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Mi8 Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Mi8 Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

modded class Wreck_Mi8_Crashed extends CrashBase
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "helicopter", this, "Mi8 Crash");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Mi8 Crash", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Mi8 Crash", GetPosition());
        }
        super.EEDelete(parent);
    }
};

// ─── Contaminated Areas ───────────────────────────────

modded class ContaminatedArea_Dynamic
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "biohazard", this, "Contaminated Zone");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Contaminated Zone", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Contaminated Zone", GetPosition());
        }
        super.EEDelete(parent);
    }
};
