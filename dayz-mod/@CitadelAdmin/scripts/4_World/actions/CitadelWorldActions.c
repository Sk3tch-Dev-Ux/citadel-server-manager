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

        // GameLabs pattern: Set(value, value, value) — proven to work
        if (params.IndexOf("\"overcast\"") >= 0)
        {
            if (weather.GetOvercast())
                weather.GetOvercast().Set(overcast, overcast, overcast);
        }

        if (params.IndexOf("\"rain\"") >= 0)
        {
            if (weather.GetRain())
                weather.GetRain().Set(rain, rain, rain);
        }

        if (params.IndexOf("\"fog\"") >= 0)
        {
            if (weather.GetFog())
                weather.GetFog().Set(fog, fog, fog);
        }

        if (params.IndexOf("\"snow\"") >= 0)
        {
            if (weather.GetSnowfall())
                weather.GetSnowfall().Set(snow, snow, snow);
        }

        if (params.IndexOf("\"wind\"") >= 0)
        {
            weather.SetWindSpeed(wind);
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

        // GameLabs pattern: Set(0.0, 0.0, 0.0) for clear sky
        if (weather.GetOvercast()) weather.GetOvercast().Set(0.0, 0.0, 0.0);
        if (weather.GetRain()) weather.GetRain().Set(0.0, 0.0, 0.0);
        if (weather.GetFog()) weather.GetFog().Set(0.0, 0.0, 0.0);
        if (weather.GetSnowfall()) weather.GetSnowfall().Set(0.0, 0.0, 0.0);
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

        // Broadcast via RPC to all connected players (use Citadel registry for reliability)
        string fullMsg = "[Citadel] " + text;
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();

        for (int i = 0; i < activePlayers.Count(); i++)
        {
            Man man = activePlayers.GetElement(i);
            if (!man) continue;

            PlayerIdentity identity = man.GetIdentity();
            if (!identity) continue;

            Param1<string> msgParam = new Param1<string>(fullMsg);
            GetGame().RPCSingleParam(man, ERPCs.RPC_USER_ACTION_MESSAGE, msgParam, true, identity);
        }

        Print("[Citadel] Broadcast: " + text);
        return true;
    }
};
