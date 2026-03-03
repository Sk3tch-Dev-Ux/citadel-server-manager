/**
 * CitadelWorldActions — In-game world/environment action execution.
 *
 * Controls time, weather, entity cleanup, world-space item spawning, and broadcasts.
 */
class CitadelWorldActions
{
    static bool SetTime(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        int hour = CitadelJson.ExtractInt(params, "hour");
        int minute = CitadelJson.ExtractInt(params, "minute");

        if (hour < 0 || hour > 23)
        {
            error = "Invalid hour: " + hour.ToString();
            return false;
        }
        if (minute < 0 || minute > 59)
            minute = 0;

        int year, month, day, currentHour, currentMinute;
        GetGame().GetWorld().GetDate(year, month, day, currentHour, currentMinute);
        GetGame().GetWorld().SetDate(year, month, day, hour, minute);

        Print("[Citadel] Set time to " + hour.ToString() + ":" + minute.ToString());
        return true;
    }

    static bool SetWeather(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);

        Weather weather = GetGame().GetWeather();
        if (!weather)
        {
            error = "Weather system unavailable";
            return false;
        }

        float overcast = CitadelJson.ExtractFloat(params, "overcast");
        float rain = CitadelJson.ExtractFloat(params, "rain");
        float fog = CitadelJson.ExtractFloat(params, "fog");
        float snow = CitadelJson.ExtractFloat(params, "snow");
        float wind = CitadelJson.ExtractFloat(params, "wind");

        if (params.IndexOf("\"overcast\"") >= 0)
            weather.GetOvercast().Set(Math.Clamp(overcast, 0, 1), 0, 300);

        if (params.IndexOf("\"rain\"") >= 0)
            weather.GetRain().Set(Math.Clamp(rain, 0, 1), 0, 300);

        if (params.IndexOf("\"fog\"") >= 0)
            weather.GetFog().Set(Math.Clamp(fog, 0, 1), 0, 300);

        if (params.IndexOf("\"snow\"") >= 0)
            weather.GetSnowfall().Set(Math.Clamp(snow, 0, 1), 0, 300);

        if (params.IndexOf("\"wind\"") >= 0)
        {
            float windMag = Math.Clamp(wind, 0, 1) * 20.0;
            weather.SetWindSpeed(windMag);
        }

        Print("[Citadel] Weather updated");
        return true;
    }

    static bool ClearWeather(out string error)
    {
        Weather weather = GetGame().GetWeather();
        if (!weather)
        {
            error = "Weather system unavailable";
            return false;
        }

        weather.GetOvercast().Set(0, 0, 300);
        weather.GetRain().Set(0, 0, 60);
        weather.GetFog().Set(0, 0, 60);
        weather.GetSnowfall().Set(0, 0, 60);
        weather.SetWindSpeed(0);

        Print("[Citadel] Weather cleared (sunny)");
        return true;
    }

    static bool WipeAI(out string error)
    {
        int count = 0;

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            ZombieBase zombie = ZombieBase.Cast(obj);
            if (zombie)
            {
                GetGame().ObjectDelete(zombie);
                count++;
                continue;
            }

            AnimalBase animal = AnimalBase.Cast(obj);
            if (animal)
            {
                GetGame().ObjectDelete(animal);
                count++;
            }
        }

        Print("[Citadel] Wiped " + count.ToString() + " AI entities");
        return true;
    }

    static bool WipeVehicles(out string error)
    {
        int count = 0;

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            CarScript car = CarScript.Cast(obj);
            if (car)
            {
                GetGame().ObjectDelete(car);
                count++;
            }
        }

        Print("[Citadel] Wiped " + count.ToString() + " vehicles");
        return true;
    }

    static bool SpawnItemWorld(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string itemClass = CitadelJson.ExtractString(params, "itemClass");
        float x = CitadelJson.ExtractFloat(params, "x");
        float y = CitadelJson.ExtractFloat(params, "y");
        float z = CitadelJson.ExtractFloat(params, "z");

        if (itemClass == "")
        {
            error = "itemClass required";
            return false;
        }

        if (y <= 0)
            y = GetGame().SurfaceY(x, z);

        vector pos = Vector(x, y, z);
        EntityAI item = EntityAI.Cast(GetGame().CreateObjectEx(itemClass, pos, ECE_PLACE_ON_SURFACE));

        if (!item)
        {
            error = "Failed to spawn: " + itemClass;
            return false;
        }

        Print("[Citadel] Spawned " + itemClass + " at " + pos.ToString());
        return true;
    }

    /**
     * Broadcast a message to all connected players.
     */
    static bool BroadcastMessage(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string text = CitadelJson.ExtractString(params, "text");

        if (text == "")
        {
            error = "Message text is required";
            return false;
        }

        // Broadcast via server admin chat (visible to all)
        GetGame().ChatPlayer("[Citadel] " + text);

        Print("[Citadel] Broadcast: " + text);
        return true;
    }
};
