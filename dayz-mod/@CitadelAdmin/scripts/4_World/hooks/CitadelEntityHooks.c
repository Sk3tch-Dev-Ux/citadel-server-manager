/**
 * CitadelEntityHooks — Vehicle and AI entity lifecycle tracking.
 *
 * Hooks into CarScript, ZombieBase, and AnimalBase to register/deregister
 * entities with CitadelCore for accurate count tracking and position monitoring.
 */

// ─── Vehicle Tracking ─────────────────────────────────

modded class CarScript
{
    private ref CitadelTrackedVehicle m_CitTracked;

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackVehicles()) return;

        // Determine vehicle icon/type
        string icon = "car";
        string vType = "land";

        string className = GetType();
        className.ToLower();

        if (className.Contains("truck") || className.Contains("v3s"))
        {
            icon = "truck";
            vType = "truck";
        }
        else if (className.Contains("hatchback") || className.Contains("sedan") || className.Contains("golf"))
        {
            icon = "car";
            vType = "car";
        }
        else if (className.Contains("offroad"))
        {
            icon = "car";
            vType = "offroad";
        }

        m_CitTracked = new CitadelTrackedVehicle(this, icon, vType);
        GetCitadel().RegisterVehicle(m_CitTracked);
        GetCitadel().IncrVehicleCount();
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitTracked)
        {
            GetCitadel().RemoveVehicle(m_CitTracked);
            GetCitadel().DecrVehicleCount();
        }

        super.EEDelete(parent);
    }
};

// ─── Infected (Zombie) Tracking ───────────────────────

modded class ZombieBase extends DayZInfected
{
    private ref CitadelTrackedAI m_CitTracked;

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;

        m_CitTracked = new CitadelTrackedAI(this, true);
        GetCitadel().RegisterAI(m_CitTracked);
        GetCitadel().IncrAICount();
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitTracked)
        {
            GetCitadel().RemoveAI(m_CitTracked);
            GetCitadel().DecrAICount();
        }

        super.EEDelete(parent);
    }

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        // Credit the kill to the player
        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (!killerPlayer)
        {
            // Killer might be a weapon — resolve to owner
            EntityAI killerEntity = EntityAI.Cast(killer);
            if (killerEntity)
            {
                Man ownerMan = killerEntity.GetHierarchyRootPlayer();
                if (ownerMan)
                    killerPlayer = PlayerBase.Cast(ownerMan);
            }
        }

        if (killerPlayer)
        {
            string steamId = killerPlayer.GetCitSteamId();
            if (steamId != "")
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                if (stats)
                    stats.killsInfected++;
            }
        }
    }
};

// ─── Animal Tracking ──────────────────────────────────

modded class AnimalBase extends DayZAnimal
{
    private ref CitadelTrackedAI m_CitTracked;

    override void EEInit()
    {
        super.EEInit();

        if (!GetGame().IsServer()) return;

        m_CitTracked = new CitadelTrackedAI(this, false);
        GetCitadel().RegisterAI(m_CitTracked);
        GetCitadel().IncrAnimalCount();
    }

    override void EEDelete(EntityAI parent)
    {
        if (GetGame().IsServer() && m_CitTracked)
        {
            GetCitadel().RemoveAI(m_CitTracked);
            GetCitadel().DecrAnimalCount();
        }

        super.EEDelete(parent);
    }

    override void EEKilled(Object killer)
    {
        super.EEKilled(killer);

        if (!GetGame().IsServer()) return;
        if (!GetCitadel().GetConfiguration().GetTrackPlayerStats()) return;

        PlayerBase killerPlayer = PlayerBase.Cast(killer);
        if (!killerPlayer)
        {
            EntityAI killerEntity = EntityAI.Cast(killer);
            if (killerEntity)
            {
                Man ownerMan = killerEntity.GetHierarchyRootPlayer();
                if (ownerMan)
                    killerPlayer = PlayerBase.Cast(ownerMan);
            }
        }

        if (killerPlayer)
        {
            string steamId = killerPlayer.GetCitSteamId();
            if (steamId != "")
            {
                CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
                if (stats)
                    stats.killsAnimals++;
            }
        }
    }
};
