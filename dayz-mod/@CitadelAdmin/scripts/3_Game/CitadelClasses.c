/**
 * CitadelClasses — Core data structures used across all script layers.
 *
 * Loaded first in 3_Game so they are available to 4_World hooks and 5_Mission logic.
 */

// Helper: Build a string network ID from EntityAI (vanilla has no GetNetworkIDString)
static string CitGetNetworkIDString(EntityAI entity)
{
    if (!entity) return "";
    int lo, hi;
    entity.GetNetworkID(lo, hi);
    return hi.ToString() + ":" + lo.ToString();
}

// Helper: Format a float to string with specified decimal places (for JSON output)
static string CitFloatToStr(float value, int places)
{
    string sign = "";
    if (value < 0)
    {
        sign = "-";
        value = -value;
    }
    int whole = (int)value;
    float remainder = value - whole;
    int multiplier = 1;
    for (int i = 0; i < places; i++)
        multiplier = multiplier * 10;
    int frac = (int)(remainder * multiplier + 0.5);
    if (frac >= multiplier)
    {
        frac = 0;
        whole = whole + 1;
    }
    string fracStr = frac.ToString();
    while (fracStr.Length() < places)
        fracStr = "0" + fracStr;
    return sign + whole.ToString() + "." + fracStr;
}

// Helper: Format vector as JSON object {"x":..,"y":..,"z":..}
static string CitVectorToJson(vector pos)
{
    return "{\"x\":" + CitFloatToStr(pos[0], 2) + ",\"y\":" + CitFloatToStr(pos[1], 2) + ",\"z\":" + CitFloatToStr(pos[2], 2) + "}";
}

// Helper: Escape string for safe JSON output (handles quotes, backslashes, control chars)
static string CitJsonEscape(string input)
{
    if (input == "") return "";
    int len = input.Length();
    bool needsEscape = false;
    int i;
    for (i = 0; i < len; i++)
    {
        int cc = input.Get(i).ToAscii();
        if (cc == 34 || cc == 92 || cc < 32)
        {
            needsEscape = true;
            break;
        }
    }
    if (!needsEscape) return input;
    string result = "";
    for (i = 0; i < len; i++)
    {
        string ch = input.Get(i);
        int charCode = ch.ToAscii();
        if (charCode == 34) result += "\\\"";
        else if (charCode == 92) result += "\\\\";
        else if (charCode == 10) result += "\\n";
        else if (charCode == 13) result += "\\r";
        else if (charCode == 9) result += "\\t";
        else if (charCode < 32) result += "";
        else result += ch;
    }
    return result;
}

// Helper: Get player compass direction (0-359 degrees)
static int CitGetPlayerDirection(PlayerBase player)
{
    if (!player) return 0;
    vector dir = player.GetDirection();
    float angle = Math.Atan2(dir[0], dir[2]) * Math.RAD2DEG;
    if (angle < 0) angle += 360;
    return (int)angle;
}

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
    int playersLooted       = 0;
    int aiLooted            = 0;
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
        return JsonFileLoader<CitadelPlayerStats>.JsonMakeData(this);
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
                m_Id = CitGetNetworkIDString(entity);
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
            m_Id = CitGetNetworkIDString(entity);
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
