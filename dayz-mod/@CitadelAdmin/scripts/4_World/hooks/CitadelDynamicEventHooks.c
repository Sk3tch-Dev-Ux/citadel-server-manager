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

// ─── Locked Containers ──────────────────────────────────

modded class Land_ContainerLocked_Blue_DE
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "container-storage", this, "Locked Container");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Locked Container", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Locked Container", GetPosition());
        }
        super.EEDelete(parent);
    }
};

modded class Land_ContainerLocked_Yellow_DE
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "container-storage", this, "Locked Container");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Locked Container", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Locked Container", GetPosition());
        }
        super.EEDelete(parent);
    }
};

modded class Land_ContainerLocked_Orange_DE
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "container-storage", this, "Locked Container");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Locked Container", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Locked Container", GetPosition());
        }
        super.EEDelete(parent);
    }
};

modded class Land_ContainerLocked_Red_DE
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "container-storage", this, "Locked Container");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Locked Container", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Locked Container", GetPosition());
        }
        super.EEDelete(parent);
    }
};

// ─── Scientific Briefcase ───────────────────────────────

modded class ScientificBriefcase
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;
        if (IsOpen()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "briefcase", this, "Locked Scientific Briefcase");
        GetCitadel().RegisterEvent(m_CitEvent);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Locked Scientific Briefcase", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Locked Scientific Briefcase", GetPosition());
        }
        super.EEDelete(parent);
    }

    override void Open()
    {
        super.Open();
        if (!GetGame().IsServer()) return;
        if (m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("opened", GetType(), "Locked Scientific Briefcase", GetPosition());
            m_CitEvent = null;
        }
    }
};

// ─── Military Convoys ───────────────────────────────────
// These are engine-defined types without script classes — use class..extends House

class Land_Wreck_V3S_DE extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "bolt", this, "Military Convoy");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Military Convoy", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Military Convoy", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class StaticObj_Wreck_BRDM_DE extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "bolt", this, "Military Convoy");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Military Convoy", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Military Convoy", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_offroad02_aban1_DE extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "bolt", this, "Military Convoy");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Military Convoy", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Military Convoy", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_offroad02_aban2_DE extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "bolt", this, "Military Convoy");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Military Convoy", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Military Convoy", GetPosition());
        }
        super.EEDelete(parent);
    }
};

// ─── Police Convoy (Primary Marker) ─────────────────────

class StaticObj_Wreck_Decal_Small1 extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "bolt", this, "Police Convoy");
        GetCitadel().RegisterEventRadiusExclusive(m_CitEvent, 100.0);
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Convoy", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Convoy", GetPosition());
        }
        super.EEDelete(parent);
    }
};

// ─── Police Wrecks (Secondary — suppressed near convoy) ─

class Land_Wreck_hb01_aban1_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_hb01_aban2_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_sed01_aban1_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_sed01_aban2_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_sed02_aban1_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_sed02_aban2_police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};

class Land_Wreck_Volha_Police extends House
{
    private ref CitadelTrackedEvent m_CitEvent;

    override void EEInit()
    {
        super.EEInit();
        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackDynamicEvents()) return;

        vector pos = GetPosition();
        if (pos[0] <= 0 && pos[1] <= 0 && pos[2] <= 0) return;

        m_CitEvent = new CitadelTrackedEvent(GetType(), "car", this, "Police Wreck");
        GetCitadel().RegisterEventRadiusExclusiveSecondary(m_CitEvent, 50.0, "StaticObj_Wreck_Decal_Small1");
        CitadelEventLogger.LogDynamicEvent("spawn", GetType(), "Police Wreck", pos);
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitEvent)
        {
            GetCitadel().RemoveEvent(m_CitEvent);
            CitadelEventLogger.LogDynamicEvent("despawn", GetType(), "Police Wreck", GetPosition());
        }
        super.EEDelete(parent);
    }
};
