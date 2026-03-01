/**
 * CitadelWorldActions — In-game world/environment action execution.
 *
 * Controls time, weather, entity cleanup, and world-space item spawning.
 */
class CitadelWorldActions
{
    /**
     * Set the in-game world time.
     */
    static bool SetTime(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        int hour = CitadelCommandRunner.ExtractJsonInt(params, "hour");
        int minute = CitadelCommandRunner.ExtractJsonInt(params, "minute");

        // Validate
        if (hour < 0 || hour > 23)
        {
            error = "Invalid hour: " + hour.ToString();
            return false;
        }
        if (minute < 0 || minute > 59)
            minute = 0;

        // Get current date and change time
        int year, month, day, currentHour, currentMinute;
        GetGame().GetWorld().GetDate(year, month, day, currentHour, currentMinute);
        GetGame().GetWorld().SetDate(year, month, day, hour, minute);

        Print("[Citadel] Set time to " + hour.ToString() + ":" + minute.ToString());
        return true;
    }

    /**
     * Set weather parameters.
     * Values are 0.0 to 1.0 floats.
     */
    static bool SetWeather(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);

        Weather weather = GetGame().GetWeather();
        if (!weather)
        {
            error = "Weather system unavailable";
            return false;
        }

        // Each parameter is optional — only set what's provided
        float overcast = CitadelCommandRunner.ExtractJsonFloat(params, "overcast");
        float rain = CitadelCommandRunner.ExtractJsonFloat(params, "rain");
        float fog = CitadelCommandRunner.ExtractJsonFloat(params, "fog");
        float snow = CitadelCommandRunner.ExtractJsonFloat(params, "snow");
        float wind = CitadelCommandRunner.ExtractJsonFloat(params, "wind");

        // Check if params were actually in the JSON (not just defaulting to 0)
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
            // Wind speed: scale 0-1 to magnitude
            float windMag = Math.Clamp(wind, 0, 1) * 20.0; // 0-20 m/s
            weather.SetWindSpeed(windMag);
        }

        Print("[Citadel] Weather updated");
        return true;
    }

    /**
     * Reset weather to clear/sunny.
     */
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

    /**
     * Delete all AI entities (zombies, animals).
     */
    static bool WipeAI(out string error)
    {
        int count = 0;

        // Delete all zombie/infected entities
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

    /**
     * Delete all vehicle entities.
     */
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

    /**
     * Spawn an item at a world position.
     */
    static bool SpawnItemWorld(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string itemClass = CitadelCommandRunner.ExtractJsonString(params, "itemClass");
        float x = CitadelCommandRunner.ExtractJsonFloat(params, "x");
        float y = CitadelCommandRunner.ExtractJsonFloat(params, "y");
        float z = CitadelCommandRunner.ExtractJsonFloat(params, "z");

        if (itemClass == "")
        {
            error = "itemClass required";
            return false;
        }

        // If altitude is 0, use ground level
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
};
