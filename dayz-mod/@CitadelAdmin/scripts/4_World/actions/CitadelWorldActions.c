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

    // ─── Extended World Actions ─────────────────────

    static bool SetFog(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float density = CitadelJson.ExtractFloat(params, "density");
        Weather weather = GetGame().GetWeather();
        if (!weather) { error = "Weather system unavailable"; return false; }
        if (weather.GetFog()) weather.GetFog().Set(density, density, density);
        Print("[Citadel] Set fog: " + density.ToString());
        return true;
    }

    static bool SetWind(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float speed = CitadelJson.ExtractFloat(params, "speed");
        Weather weather = GetGame().GetWeather();
        if (!weather) { error = "Weather system unavailable"; return false; }
        weather.SetWindSpeed(speed);
        Print("[Citadel] Set wind: " + speed.ToString());
        return true;
    }

    static bool FlattenTrees(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector center = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            if (obj.IsTree())
            {
                GetGame().ObjectDelete(obj);
                count++;
            }
        }

        Print("[Citadel] Flattened " + count.ToString() + " trees");
        return true;
    }

    static bool ClearZombies(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 100;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector center = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            ZombieBase zombie = ZombieBase.Cast(obj);
            if (zombie)
            {
                GetGame().ObjectDelete(zombie);
                count++;
            }
        }

        Print("[Citadel] Cleared " + count.ToString() + " zombies");
        return true;
    }

    static bool DeleteObjectsRadius(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        string objectType = CitadelJson.ExtractString(params, "objectType");
        if (radius <= 0) radius = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector center = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && entity != player)
            {
                if (objectType == "all" || objectType == "")
                {
                    GetGame().ObjectDelete(entity);
                    count++;
                }
            }
        }

        Print("[Citadel] Deleted " + count.ToString() + " objects in radius");
        return true;
    }

    // ─── Spawn Actions ───────────────────────────────

    static bool SpawnZombie(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        int count = CitadelJson.ExtractInt(params, "count");
        if (count <= 0) count = 1;
        if (count > 50) count = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector pos = player.GetPosition();
        for (int i = 0; i < count; i++)
        {
            vector spawnPos = pos;
            spawnPos[0] = spawnPos[0] + Math.RandomFloat(-10, 10);
            spawnPos[2] = spawnPos[2] + Math.RandomFloat(-10, 10);
            spawnPos[1] = GetGame().SurfaceY(spawnPos[0], spawnPos[2]);
            GetGame().CreateObjectEx("ZmbM_HermitSkinny_Base", spawnPos, ECE_PLACE_ON_SURFACE);
        }

        Print("[Citadel] Spawned " + count.ToString() + " zombies near " + steamId);
        return true;
    }

    static bool SpawnAnimal(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string animalType = CitadelJson.ExtractString(params, "animalType");
        if (animalType == "") animalType = "Animal_CervusElaphus";

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector pos = player.GetPosition();
        pos[0] = pos[0] + Math.RandomFloat(5, 15);
        pos[2] = pos[2] + Math.RandomFloat(5, 15);
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object obj = GetGame().CreateObjectEx(animalType, pos, ECE_PLACE_ON_SURFACE);
        if (!obj) { error = "Failed to spawn: " + animalType; return false; }

        Print("[Citadel] Spawned " + animalType + " near " + steamId);
        return true;
    }

    static bool SpawnVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string vehicleClass = CitadelJson.ExtractString(params, "vehicleClass");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }
        if (vehicleClass == "") { error = "vehicleClass required"; return false; }

        vector pos = player.GetPosition();
        pos[0] = pos[0] + 5;
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object obj = GetGame().CreateObjectEx(vehicleClass, pos, ECE_PLACE_ON_SURFACE);
        if (!obj) { error = "Failed to spawn: " + vehicleClass; return false; }

        Print("[Citadel] Spawned vehicle " + vehicleClass + " near " + steamId);
        return true;
    }

    static bool SpawnBuilding(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string buildingClass = CitadelJson.ExtractString(params, "buildingClass");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }
        if (buildingClass == "") { error = "buildingClass required"; return false; }

        vector pos = player.GetPosition();
        pos[0] = pos[0] + 5;
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object obj = GetGame().CreateObjectEx(buildingClass, pos, ECE_PLACE_ON_SURFACE);
        if (!obj) { error = "Failed to spawn: " + buildingClass; return false; }

        Print("[Citadel] Spawned building " + buildingClass);
        return true;
    }

    static bool SpawnHorde(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        int count = CitadelJson.ExtractInt(params, "count");
        if (count <= 0) count = 20;
        if (count > 100) count = 100;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector pos = player.GetPosition();
        for (int i = 0; i < count; i++)
        {
            vector spawnPos = pos;
            spawnPos[0] = spawnPos[0] + Math.RandomFloat(-20, 20);
            spawnPos[2] = spawnPos[2] + Math.RandomFloat(-20, 20);
            spawnPos[1] = GetGame().SurfaceY(spawnPos[0], spawnPos[2]);
            GetGame().CreateObjectEx("ZmbM_HermitSkinny_Base", spawnPos, ECE_PLACE_ON_SURFACE);
        }

        Print("[Citadel] Spawned horde of " + count.ToString() + " near " + steamId);
        return true;
    }

    static bool SpawnSupplyCrate(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string coords = CitadelJson.ExtractString(params, "coords");
        if (coords == "") { error = "coords required"; return false; }

        vector pos = coords.ToVector();
        if (pos[1] <= 0) pos[1] = GetGame().SurfaceY(pos[0], pos[2]);

        Object crate = GetGame().CreateObjectEx("SeaChest", pos, ECE_PLACE_ON_SURFACE);
        if (!crate) { error = "Failed to spawn supply crate"; return false; }

        Print("[Citadel] Spawned supply crate at " + pos.ToString());
        return true;
    }

    static bool SpawnLootPile(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        // Spawn a chest near player with some loot
        vector pos = player.GetPosition();
        pos[0] = pos[0] + 3;
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object crate = GetGame().CreateObjectEx("SeaChest", pos, ECE_PLACE_ON_SURFACE);
        if (!crate) { error = "Failed to spawn loot pile"; return false; }

        Print("[Citadel] Spawned loot pile near " + steamId);
        return true;
    }

    static bool SpawnItemAt(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string itemClass = CitadelJson.ExtractString(params, "itemClass");
        string coords = CitadelJson.ExtractString(params, "coords");
        if (itemClass == "" || coords == "") { error = "itemClass and coords required"; return false; }

        vector pos = coords.ToVector();
        if (pos[1] <= 0) pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object obj = GetGame().CreateObjectEx(itemClass, pos, ECE_PLACE_ON_SURFACE);
        if (!obj) { error = "Failed to spawn: " + itemClass; return false; }

        Print("[Citadel] Spawned " + itemClass + " at " + pos.ToString());
        return true;
    }

    static bool SpawnZombieAt(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string coords = CitadelJson.ExtractString(params, "coords");
        int count = CitadelJson.ExtractInt(params, "count");
        if (count <= 0) count = 1;
        if (coords == "") { error = "coords required"; return false; }

        vector pos = coords.ToVector();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        for (int i = 0; i < count; i++)
        {
            vector spawnPos = pos;
            spawnPos[0] = spawnPos[0] + Math.RandomFloat(-5, 5);
            spawnPos[2] = spawnPos[2] + Math.RandomFloat(-5, 5);
            GetGame().CreateObjectEx("ZmbM_HermitSkinny_Base", spawnPos, ECE_PLACE_ON_SURFACE);
        }

        Print("[Citadel] Spawned " + count.ToString() + " zombies at " + pos.ToString());
        return true;
    }

    static bool SpawnAnimalAt(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string animalType = CitadelJson.ExtractString(params, "animalType");
        string coords = CitadelJson.ExtractString(params, "coords");
        if (animalType == "") animalType = "Animal_CervusElaphus";
        if (coords == "") { error = "coords required"; return false; }

        vector pos = coords.ToVector();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object obj = GetGame().CreateObjectEx(animalType, pos, ECE_PLACE_ON_SURFACE);
        if (!obj) { error = "Failed to spawn: " + animalType; return false; }

        Print("[Citadel] Spawned " + animalType + " at " + pos.ToString());
        return true;
    }

    static bool SpawnFire(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector pos = player.GetPosition();
        pos[0] = pos[0] + 3;
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object fire = GetGame().CreateObjectEx("Fireplace", pos, ECE_PLACE_ON_SURFACE);
        if (!fire) { error = "Failed to spawn fire"; return false; }

        Print("[Citadel] Spawned fire near " + steamId);
        return true;
    }

    static bool SpawnSmoke(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        string color = CitadelJson.ExtractString(params, "color");
        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector pos = player.GetPosition();
        pos[0] = pos[0] + 3;
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]);

        string smokeClass = "RDG2SmokeGrenade_White";
        if (color == "red") smokeClass = "RDG2SmokeGrenade_Red";
        else if (color == "green") smokeClass = "RDG2SmokeGrenade_Green";
        else if (color == "black") smokeClass = "RDG2SmokeGrenade_Black";

        Object smoke = GetGame().CreateObjectEx(smokeClass, pos, ECE_PLACE_ON_SURFACE);
        if (!smoke) { error = "Failed to spawn smoke"; return false; }

        Print("[Citadel] Spawned smoke near " + steamId);
        return true;
    }

    static bool SpawnHeliCrash(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string coords = CitadelJson.ExtractString(params, "coords");
        if (coords == "") { error = "coords required"; return false; }

        vector pos = coords.ToVector();
        if (pos[1] <= 0) pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object heli = GetGame().CreateObjectEx("Wreck_UH1Y", pos, ECE_PLACE_ON_SURFACE);
        if (!heli) { error = "Failed to spawn heli crash"; return false; }

        Print("[Citadel] Spawned heli crash at " + pos.ToString());
        return true;
    }

    static bool SpawnGasZone(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string coords = CitadelJson.ExtractString(params, "coords");
        if (coords == "") { error = "coords required"; return false; }

        vector pos = coords.ToVector();
        if (pos[1] <= 0) pos[1] = GetGame().SurfaceY(pos[0], pos[2]);
        Object zone = GetGame().CreateObjectEx("ContaminatedArea_Dynamic", pos, ECE_PLACE_ON_SURFACE);
        if (!zone) { error = "Failed to spawn gas zone"; return false; }

        Print("[Citadel] Spawned gas zone at " + pos.ToString());
        return true;
    }

    // ─── Structure Actions ───────────────────────────

    static bool OpenDoors(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector center = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            Building building = Building.Cast(obj);
            if (building)
            {
                int doorCount = building.GetDoorCount();
                for (int i = 0; i < doorCount; i++)
                {
                    if (!building.IsDoorOpen(i))
                    {
                        building.OpenDoor(i);
                        count++;
                    }
                }
            }
        }

        Print("[Citadel] Opened " + count.ToString() + " doors");
        return true;
    }

    static bool CloseDoors(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector center = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            Building building = Building.Cast(obj);
            if (building)
            {
                int doorCount = building.GetDoorCount();
                for (int i = 0; i < doorCount; i++)
                {
                    if (building.IsDoorOpen(i))
                    {
                        building.CloseDoor(i);
                        count++;
                    }
                }
            }
        }

        Print("[Citadel] Closed " + count.ToString() + " doors");
        return true;
    }

    static bool LootMagnet(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player) { error = "Player not found: " + steamId; return false; }

        vector playerPos = player.GetPosition();
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(playerPos, radius, objects, proxyCargos);

        int count = 0;
        foreach (Object obj : objects)
        {
            ItemBase item = ItemBase.Cast(obj);
            if (item && item != player)
            {
                vector newPos = playerPos;
                newPos[0] = newPos[0] + Math.RandomFloat(-2, 2);
                newPos[2] = newPos[2] + Math.RandomFloat(-2, 2);
                item.SetPosition(newPos);
                count++;
            }
        }

        Print("[Citadel] Loot magnet pulled " + count.ToString() + " items to " + steamId);
        return true;
    }

    // ─── Item Actions ────────────────────────────────

    static bool DeleteItem(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string persistentId = CitadelJson.ExtractString(params, "persistentId");
        if (persistentId == "") { error = "persistentId required"; return false; }

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && CitGetNetworkIDString(entity) == persistentId)
            {
                GetGame().ObjectDelete(entity);
                Print("[Citadel] Deleted item: " + persistentId);
                return true;
            }
        }

        error = "Item not found: " + persistentId;
        return false;
    }

    static bool RepairItem(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string persistentId = CitadelJson.ExtractString(params, "persistentId");
        if (persistentId == "") { error = "persistentId required"; return false; }

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && CitGetNetworkIDString(entity) == persistentId)
            {
                entity.SetHealth(entity.GetMaxHealth("", "Health"));
                Print("[Citadel] Repaired item: " + persistentId);
                return true;
            }
        }

        error = "Item not found: " + persistentId;
        return false;
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
