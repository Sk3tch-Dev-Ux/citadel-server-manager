/**
 * CitadelClasses — Core data structures used across all script layers.
 *
 * Loaded first in 3_Game so they are available to 4_World hooks and 5_Mission logic.
 */

class CitadelPlayerStats
{
    int shotsFired          = 0;
    int shotsHit            = 0;
    int shotsHitPlayers     = 0;
    int shotsHitBaseObjects = 0;
    int shotsHitInfected    = 0;
    int shotsHitAnimals     = 0;
    int shotsHitVehicles    = 0;

    int killsPlayers        = 0;
    int killsInfected       = 0;
    int killsAnimals        = 0;

    float startingDistance  = 0.0;
    float distance          = 0.0;
    float vehicleDistance   = 0.0;

    int itemsDropped        = 0;
    int itemsPickedUp       = 0;
    int weaponsLooted       = 0;
    int grenadesUsed        = 0;

    int bleedsFixed         = 0;
    int healthItemsUsed     = 0;
    int playerRespawns      = 0;

    int foodItemsConsumed   = 0;
    float foodWeightConsumed = 0.0;
    int drinkItemsConsumed  = 0;
    float drinkVolumeConsumed = 0.0;

    int sessionStartTime    = 0;

    string ToJson()
    {
        string json = "{";
        json += "\"shotsFired\":" + shotsFired.ToString() + ",";
        json += "\"shotsHit\":" + shotsHit.ToString() + ",";
        json += "\"shotsHitPlayers\":" + shotsHitPlayers.ToString() + ",";
        json += "\"shotsHitInfected\":" + shotsHitInfected.ToString() + ",";
        json += "\"shotsHitAnimals\":" + shotsHitAnimals.ToString() + ",";
        json += "\"shotsHitVehicles\":" + shotsHitVehicles.ToString() + ",";
        json += "\"shotsHitBaseObjects\":" + shotsHitBaseObjects.ToString() + ",";
        json += "\"killsPlayers\":" + killsPlayers.ToString() + ",";
        json += "\"killsInfected\":" + killsInfected.ToString() + ",";
        json += "\"killsAnimals\":" + killsAnimals.ToString() + ",";
        json += "\"distance\":" + distance.ToString() + ",";
        json += "\"vehicleDistance\":" + vehicleDistance.ToString() + ",";
        json += "\"itemsPickedUp\":" + itemsPickedUp.ToString() + ",";
        json += "\"itemsDropped\":" + itemsDropped.ToString() + ",";
        json += "\"weaponsLooted\":" + weaponsLooted.ToString() + ",";
        json += "\"grenadesUsed\":" + grenadesUsed.ToString() + ",";
        json += "\"bleedsFixed\":" + bleedsFixed.ToString() + ",";
        json += "\"healthItemsUsed\":" + healthItemsUsed.ToString() + ",";
        json += "\"foodItemsConsumed\":" + foodItemsConsumed.ToString() + ",";
        json += "\"drinkItemsConsumed\":" + drinkItemsConsumed.ToString() + ",";
        json += "\"playerRespawns\":" + playerRespawns.ToString();
        json += "}";
        return json;
    }
};

class CitadelTrackedAI
{
    private Object m_Reference;
    private vector m_LastPos;
    private bool m_IsInfected;

    void CitadelTrackedAI(Object __reference, bool infected)
    {
        m_Reference = __reference;
        m_IsInfected = infected;
        if (m_Reference)
            m_LastPos = m_Reference.GetPosition();
    }

    Object Ref() { return m_Reference; }
    bool IsInfected() { return m_IsInfected; }

    bool IsActive()
    {
        if (!m_Reference) return false;
        vector currentPos = m_Reference.GetPosition();
        if (currentPos != m_LastPos)
        {
            m_LastPos = currentPos;
            return true;
        }
        return false;
    }
};

class CitadelTrackedVehicle
{
    private string m_Id;
    private string m_ClassName;
    private string m_Icon;
    private string m_VehicleType;
    private vector m_LastPos;
    private Object m_Reference;

    void CitadelTrackedVehicle(Object __reference, string icon, string vehicleType)
    {
        m_Reference = __reference;
        m_Icon = icon;
        m_VehicleType = vehicleType;
        if (m_Reference)
        {
            m_ClassName = m_Reference.GetType();
            m_LastPos = m_Reference.GetPosition();
            EntityAI entity = EntityAI.Cast(m_Reference);
            if (entity)
                m_Id = entity.GetNetworkIDString();
        }
    }

    string GetID() { return m_Id; }
    string GetClassName() { return m_ClassName; }
    string GetIcon() { return m_Icon; }
    string GetVehicleType() { return m_VehicleType; }
    Object Ref() { return m_Reference; }

    bool HasUpdated()
    {
        if (!m_Reference) return true;
        vector currentPos = m_Reference.GetPosition();
        if (currentPos != m_LastPos)
        {
            m_LastPos = currentPos;
            return true;
        }
        return false;
    }
};

class CitadelTrackedEvent
{
    private string m_Id;
    private string m_ClassName;
    private string m_Icon;
    private string m_DisplayName;
    private Object m_Reference;

    void CitadelTrackedEvent(string className, string icon, Object __reference, string displayName = "")
    {
        m_ClassName = className;
        m_Icon = icon;
        m_Reference = __reference;
        m_DisplayName = displayName;
        if (m_DisplayName == "")
            m_DisplayName = className;
        EntityAI entity = EntityAI.Cast(m_Reference);
        if (entity)
            m_Id = entity.GetNetworkIDString();
    }

    string GetID() { return m_Id; }
    string GetClassName() { return m_ClassName; }
    string GetDisplayName() { return m_DisplayName; }
    void SetDisplayName(string name) { m_DisplayName = name; }
    string GetIcon() { return m_Icon; }
    Object Ref() { return m_Reference; }

    bool Equals(CitadelTrackedEvent other)
    {
        if (!m_Reference || !other.Ref()) return false;
        return m_Reference.GetPosition() == other.Ref().GetPosition();
    }
};
