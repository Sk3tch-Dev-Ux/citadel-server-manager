/**
 * CitadelQueryActions — Data query actions for the command runner.
 *
 * All query methods return data via the `responseData` out parameter as JSON strings.
 * Player queries take the raw command JSON and extract steamId from params.
 * Data queries operate on the global game state.
 */
class CitadelQueryActions
{
    // ─── Player Queries ─────────────────────────────────

    static bool GetPlayerPosition(string cmdJson, out string error, out string responseData)
    {
        if (!GetCitadel()) { error = "CitadelCore not initialized"; return false; }
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector pos = player.GetPosition();
        int direction = CitGetPlayerDirection(player);

        responseData = "{\"position\":" + CitVectorToJson(pos) + ",\"direction\":" + direction.ToString() + "}";
        return true;
    }

    static bool GetPlayerInfo(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector pos = player.GetPosition();
        float health = player.GetHealth("GlobalHealth", "Health");
        float blood = player.GetHealth("GlobalHealth", "Blood");
        float shock = player.GetHealth("GlobalHealth", "Shock");
        float water = 0;
        float energy = 0;
        if (player.GetStatWater()) water = player.GetStatWater().Get();
        if (player.GetStatEnergy()) energy = player.GetStatEnergy().Get();
        int direction = CitGetPlayerDirection(player);
        bool inVehicle = player.CitIsInVehicle();
        int sessionDuration = GetCitadel().GetPlayerSessionDuration(steamId);

        string name = "Survivor";
        if (player.GetIdentity())
            name = player.GetIdentity().GetName();

        string aliveStr = "false";
        if (player.IsAlive()) aliveStr = "true";
        string vehStr = "false";
        if (inVehicle) vehStr = "true";

        responseData = "{";
        responseData += "\"steamId\":\"" + steamId + "\",";
        responseData += "\"name\":\"" + CitJsonEscape(name) + "\",";
        responseData += "\"position\":" + CitVectorToJson(pos) + ",";
        responseData += "\"direction\":" + direction.ToString() + ",";
        responseData += "\"health\":" + CitFloatToStr(health, 1) + ",";
        responseData += "\"blood\":" + CitFloatToStr(blood, 1) + ",";
        responseData += "\"shock\":" + CitFloatToStr(shock, 1) + ",";
        responseData += "\"water\":" + CitFloatToStr(water, 1) + ",";
        responseData += "\"energy\":" + CitFloatToStr(energy, 1) + ",";
        responseData += "\"alive\":" + aliveStr + ",";
        responseData += "\"inVehicle\":" + vehStr + ",";
        responseData += "\"sessionSeconds\":" + sessionDuration.ToString();
        responseData += "}";
        return true;
    }

    static bool GetPlayerGear(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        responseData = "{\"slots\":{";
        // Check common attachment slots
        string slots = "";
        int slotCount = player.GetInventory().GetAttachmentSlotsCount();
        bool first = true;
        for (int i = 0; i < slotCount; i++)
        {
            int slotId = player.GetInventory().GetAttachmentSlotId(i);
            EntityAI attachment = player.GetInventory().FindAttachment(slotId);
            string slotName = InventorySlots.GetSlotName(slotId);
            if (attachment)
            {
                if (!first) slots += ",";
                first = false;
                slots += "\"" + slotName + "\":\"" + attachment.GetType() + "\"";
            }
        }
        responseData += slots + "}}";
        return true;
    }

    static bool GetPlayerInventory(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);

        responseData = "{\"items\":[";
        bool first = true;
        for (int i = 0; i < items.Count(); i++)
        {
            EntityAI item = items.Get(i);
            if (!item || item == player) continue;

            if (!first) responseData += ",";
            first = false;

            float hp = item.GetHealth("", "Health");
            float maxHp = item.GetMaxHealth("", "Health");
            int qty = 1;
            ItemBase itemBase = ItemBase.Cast(item);
            if (itemBase && itemBase.HasQuantity())
                qty = itemBase.GetQuantity();

            responseData += "{\"className\":\"" + item.GetType() + "\",\"health\":" + CitFloatToStr(hp, 1) + ",\"maxHealth\":" + CitFloatToStr(maxHp, 1) + ",\"quantity\":" + qty.ToString() + "}";
        }
        responseData += "],\"count\":" + items.Count().ToString() + "}";
        return true;
    }

    static bool GetPlayerStats(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (!stats)
        {
            error = "No stats for player: " + steamId;
            return false;
        }

        responseData = "{";
        responseData += "\"shotsFired\":" + stats.shotsFired.ToString() + ",";
        responseData += "\"shotsHit\":" + stats.shotsHit.ToString() + ",";
        responseData += "\"shotsHitPlayers\":" + stats.shotsHitPlayers.ToString() + ",";
        responseData += "\"killsPlayers\":" + stats.killsPlayers.ToString() + ",";
        responseData += "\"killsInfected\":" + stats.killsInfected.ToString() + ",";
        responseData += "\"killsAnimals\":" + stats.killsAnimals.ToString() + ",";
        responseData += "\"distance\":" + CitFloatToStr(stats.distance, 1) + ",";
        responseData += "\"vehicleDistance\":" + CitFloatToStr(stats.vehicleDistance, 1) + ",";
        responseData += "\"itemsPickedUp\":" + stats.itemsPickedUp.ToString() + ",";
        responseData += "\"itemsDropped\":" + stats.itemsDropped.ToString() + ",";
        responseData += "\"playerRespawns\":" + stats.playerRespawns.ToString();
        responseData += "}";
        return true;
    }

    static bool GetPlayerFull(string cmdJson, out string error, out string responseData)
    {
        // Combine info + stats + gear into one response
        string infoData, statsData, gearData;
        string infoErr, statsErr, gearErr;

        bool infoOk = GetPlayerInfo(cmdJson, infoErr, infoData);
        if (!infoOk)
        {
            error = infoErr;
            return false;
        }

        // Stats may not exist (player just connected) — that's ok
        bool statsOk = GetPlayerStats(cmdJson, statsErr, statsData);
        if (!statsOk) statsData = "null";

        bool gearOk = GetPlayerGear(cmdJson, gearErr, gearData);
        if (!gearOk) gearData = "null";

        responseData = "{\"info\":" + infoData + ",\"stats\":" + statsData + ",\"gear\":" + gearData + "}";
        return true;
    }

    static bool GetPlayerGearFull(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        responseData = "{\"slots\":{";
        string slotsJson = "";
        int slotCount = player.GetInventory().GetAttachmentSlotsCount();
        bool firstSlot = true;
        for (int i = 0; i < slotCount; i++)
        {
            int slotId = player.GetInventory().GetAttachmentSlotId(i);
            EntityAI attachment = player.GetInventory().FindAttachment(slotId);
            if (attachment)
            {
                if (!firstSlot) slotsJson += ",";
                firstSlot = false;
                string slotName = InventorySlots.GetSlotName(slotId);
                slotsJson += "\"" + slotName + "\":" + BuildItemDetailJson(attachment, 0);
            }
        }
        responseData += slotsJson + "},\"inventory\":[";

        array<EntityAI> items = new array<EntityAI>();
        player.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);

        bool first = true;
        for (int i = 0; i < items.Count(); i++)
        {
            EntityAI item = items.Get(i);
            if (!item || item == player) continue;

            if (!first) responseData += ",";
            first = false;

            responseData += BuildItemDetailJson(item, 0);
        }
        responseData += "],\"count\":" + items.Count().ToString() + "}";
        return true;
    }

    private static string BuildItemDetailJson(EntityAI item, int depth)
    {
        if (!item || depth > 5) return "null";

        float hp = item.GetHealth("", "Health");
        float maxHp = item.GetMaxHealth("", "Health");
        float healthPercent = maxHp > 0 ? (hp / maxHp) * 100.0 : 0;
        string persistentId = CitGetNetworkIDString(item);
        string displayName = item.GetDisplayName();

        int qty = 1;
        int maxQty = 1;
        ItemBase itemBase = ItemBase.Cast(item);
        if (itemBase && itemBase.HasQuantity())
        {
            qty = itemBase.GetQuantity();
            maxQty = itemBase.GetQuantityMax();
        }

        string json = "{";
        json += "\"className\":\"" + item.GetType() + "\",";
        json += "\"displayName\":\"" + CitJsonEscape(displayName) + "\",";
        json += "\"persistentId\":\"" + persistentId + "\",";
        json += "\"health\":" + CitFloatToStr(hp, 1) + ",";
        json += "\"maxHealth\":" + CitFloatToStr(maxHp, 1) + ",";
        json += "\"healthPercent\":" + CitFloatToStr(healthPercent, 1) + ",";
        json += "\"quantity\":" + qty.ToString() + ",";
        json += "\"maxQuantity\":" + maxQty.ToString();

        Magazine magazine = Magazine.Cast(item);
        if (magazine)
        {
            int ammoCount = magazine.GetAmmoCount();
            int ammoMax = magazine.GetAmmoMax();
            string ammoType = magazine.GetAmmoType();
            json += ",\"magazine\":{";
            json += "\"ammoCount\":" + ammoCount.ToString() + ",";
            json += "\"ammoMax\":" + ammoMax.ToString() + ",";
            json += "\"ammoType\":\"" + ammoType + "\"";
            json += "}";
        }

        Weapon_Base weapon = Weapon_Base.Cast(item);
        if (weapon)
        {
            int muzzleCount = weapon.GetMuzzleCount();
            int currentMode = weapon.GetCurrentMode(0);
            int chamberedRounds = 0;
            for (int wi = 0; wi < muzzleCount; wi++)
            {
                if (weapon.IsChamberFull(wi)) chamberedRounds++;
            }

            json += ",\"weapon\":{";
            json += "\"currentMode\":" + currentMode.ToString() + ",";
            json += "\"muzzleCount\":" + muzzleCount.ToString() + ",";
            json += "\"chamberedRounds\":" + chamberedRounds.ToString();
            json += "}";
        }

        if (depth < 5)
        {
            array<EntityAI> attachments = new array<EntityAI>();
            int attachSlotCount = item.GetInventory().GetAttachmentSlotsCount();
            if (attachSlotCount > 0)
            {
                for (int i = 0; i < attachSlotCount; i++)
                {
                    int aSlotId = item.GetInventory().GetAttachmentSlotId(i);
                    EntityAI attachment = item.GetInventory().FindAttachment(aSlotId);
                    if (attachment)
                        attachments.Insert(attachment);
                }

                if (attachments.Count() > 0)
                {
                    json += ",\"attachments\":[";
                    bool first = true;
                    for (int i = 0; i < attachments.Count(); i++)
                    {
                        if (!first) json += ",";
                        first = false;
                        json += BuildItemDetailJson(attachments.Get(i), depth + 1);
                    }
                    json += "]";
                }
            }
        }

        json += "}";
        return json;
    }

    static bool GetPlayerHandsData(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        EntityAI handsItem = player.GetHumanInventory().GetEntityInHands();
        if (!handsItem)
        {
            responseData = "{\"hasItem\":false}";
            return true;
        }

        float hp = handsItem.GetHealth("", "Health");
        float maxHp = handsItem.GetMaxHealth("", "Health");
        float healthPercent = maxHp > 0 ? (hp / maxHp) * 100.0 : 0;
        string displayName = handsItem.GetDisplayName();
        string persistentId = CitGetNetworkIDString(handsItem);

        responseData = "{\"hasItem\":true,";
        responseData += "\"className\":\"" + handsItem.GetType() + "\",";
        responseData += "\"displayName\":\"" + CitJsonEscape(displayName) + "\",";
        responseData += "\"persistentId\":\"" + persistentId + "\",";
        responseData += "\"health\":" + CitFloatToStr(hp, 1) + ",";
        responseData += "\"maxHealth\":" + CitFloatToStr(maxHp, 1) + ",";
        responseData += "\"healthPercent\":" + CitFloatToStr(healthPercent, 1);

        Weapon_Base weapon = Weapon_Base.Cast(handsItem);
        if (weapon)
        {
            int muzzleCount = weapon.GetMuzzleCount();
            int currentMode = weapon.GetCurrentMode(0);
            int chamberedRounds = 0;
            for (int wi = 0; wi < muzzleCount; wi++)
            {
                if (weapon.IsChamberFull(wi)) chamberedRounds++;
            }

            responseData += ",\"weapon\":{";
            responseData += "\"currentMode\":" + currentMode.ToString() + ",";
            responseData += "\"muzzleCount\":" + muzzleCount.ToString() + ",";
            responseData += "\"chamberedRounds\":" + chamberedRounds.ToString();

            Magazine magazine = weapon.GetMagazine(0);
            if (magazine)
            {
                int ammoCount = magazine.GetAmmoCount();
                int ammoMax = magazine.GetAmmoMax();
                string ammoType = magazine.GetAmmoType();
                responseData += ",\"magazine\":{";
                responseData += "\"ammoCount\":" + ammoCount.ToString() + ",";
                responseData += "\"ammoMax\":" + ammoMax.ToString() + ",";
                responseData += "\"ammoType\":\"" + ammoType + "\"";
                responseData += "}";
            }
            responseData += "}";
        }

        responseData += "}";
        return true;
    }

    // ─── Data Queries ───────────────────────────────────

    static bool GetOnlinePlayers(out string error, out string responseData)
    {
        if (!GetCitadel()) { error = "CitadelCore not initialized"; return false; }
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();

        responseData = "{\"players\":[";
        bool first = true;
        for (int i = 0; i < activePlayers.Count(); i++)
        {
            string steamId = activePlayers.GetKey(i);
            PlayerBase player = PlayerBase.Cast(activePlayers.GetElement(i));
            if (!player) continue;

            if (!first) responseData += ",";
            first = false;

            string name = "Survivor";
            if (player.GetIdentity())
                name = player.GetIdentity().GetName();

            vector pos = player.GetPosition();
            string aliveStr = "false";
            if (player.IsAlive()) aliveStr = "true";

            responseData += "{\"steamId\":\"" + steamId + "\",\"name\":\"" + CitJsonEscape(name) + "\",\"position\":" + CitVectorToJson(pos) + ",\"alive\":" + aliveStr + "}";
        }
        responseData += "],\"count\":" + activePlayers.Count().ToString() + "}";
        return true;
    }

    static bool GetAllPlayers(out string error, out string responseData)
    {
        if (!GetCitadel()) { error = "CitadelCore not initialized"; return false; }
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();

        responseData = "{\"players\":[";
        bool first = true;
        for (int i = 0; i < activePlayers.Count(); i++)
        {
            string steamId = activePlayers.GetKey(i);
            PlayerBase player = PlayerBase.Cast(activePlayers.GetElement(i));
            if (!player) continue;

            if (!first) responseData += ",";
            first = false;

            string name = "Survivor";
            if (player.GetIdentity())
                name = player.GetIdentity().GetName();

            vector pos = player.GetPosition();
            float health = player.GetHealth("GlobalHealth", "Health");
            float blood = player.GetHealth("GlobalHealth", "Blood");
            float shock = player.GetHealth("GlobalHealth", "Shock");
            int direction = CitGetPlayerDirection(player);
            string aliveStr = "false";
            if (player.IsAlive()) aliveStr = "true";
            int sessionDuration = GetCitadel().GetPlayerSessionDuration(steamId);

            responseData += "{\"steamId\":\"" + steamId + "\",\"name\":\"" + CitJsonEscape(name) + "\",\"position\":" + CitVectorToJson(pos) + ",\"direction\":" + direction.ToString() + ",\"health\":" + CitFloatToStr(health, 1) + ",\"blood\":" + CitFloatToStr(blood, 1) + ",\"shock\":" + CitFloatToStr(shock, 1) + ",\"alive\":" + aliveStr + ",\"sessionSeconds\":" + sessionDuration.ToString() + "}";
        }
        responseData += "],\"count\":" + activePlayers.Count().ToString() + "}";
        return true;
    }

    static bool GetServerInfo(out string error, out string responseData)
    {
        if (!GetCitadel()) { error = "CitadelCore not initialized"; return false; }
        int fps = GetCitadel().GetServerFPS();
        int playerCount = GetCitadel().GetActivePlayerCount();
        int aiCount = GetCitadel().GetAICount();
        int activeAi = GetCitadel().GetActiveAICount();
        int animalCount = GetCitadel().GetAnimalCount();
        int vehicleCount = GetCitadel().GetVehicleCount();
        int entityCount = GetCitadel().GetEntityCount();
        float tickAvg = GetCitadel().GetTickTimeAvg();
        float tickLow = GetCitadel().GetTickTimeLow();
        float tickHigh = GetCitadel().GetTickTimeHigh();
        int eventCount = GetCitadel().GetEventCount();

        string mapName = "Unknown";
        float worldSize = 15360;
        if (GetGame().GetWorld())
        {
            string worldName;
            GetGame().GetWorldName(worldName);
            mapName = worldName;
        }

        Weather weather = GetGame().GetWeather();
        float overcast = 0;
        float rain = 0;
        float fog = 0;
        float snowfall = 0;
        float windDirection = 0;
        float windMagnitude = 0;
        if (weather)
        {
            overcast = weather.GetOvercast().GetActual();
            rain = weather.GetRain().GetActual();
            fog = weather.GetFog().GetActual();
            snowfall = weather.GetSnowfall().GetActual();
            windDirection = weather.GetWindDirection().GetActual();
            windMagnitude = weather.GetWindMagnitude().GetActual();
        }

        int gameTime = GetGame().GetTime();
        bool isNight = (gameTime >= 18000) || (gameTime < 6000);
        string isNightStr = "false";
        if (isNight) isNightStr = "true";

        int serverUptime = GetGame().GetTickTime();
        int uptimeHours = serverUptime / 3600;
        int uptimeMinutes = (serverUptime % 3600) / 60;
        int uptimeSeconds = serverUptime % 60;

        responseData = "{";
        responseData += "\"fps\":" + fps.ToString() + ",";
        responseData += "\"playerCount\":" + playerCount.ToString() + ",";
        responseData += "\"aiCount\":" + aiCount.ToString() + ",";
        responseData += "\"activeAi\":" + activeAi.ToString() + ",";
        responseData += "\"animalCount\":" + animalCount.ToString() + ",";
        responseData += "\"vehicleCount\":" + vehicleCount.ToString() + ",";
        responseData += "\"entityCount\":" + entityCount.ToString() + ",";
        responseData += "\"eventCount\":" + eventCount.ToString() + ",";
        responseData += "\"tickTimeAvg\":" + CitFloatToStr(tickAvg, 3) + ",";
        responseData += "\"tickTimeLow\":" + CitFloatToStr(tickLow, 3) + ",";
        responseData += "\"tickTimeHigh\":" + CitFloatToStr(tickHigh, 3) + ",";
        responseData += "\"mapName\":\"" + mapName + "\",";
        responseData += "\"worldSize\":" + CitFloatToStr(worldSize, 1) + ",";
        responseData += "\"isNight\":" + isNightStr + ",";
        responseData += "\"time\":" + gameTime.ToString() + ",";
        responseData += "\"weather\":{";
        responseData += "\"overcast\":" + CitFloatToStr(overcast, 2) + ",";
        responseData += "\"rain\":" + CitFloatToStr(rain, 2) + ",";
        responseData += "\"fog\":" + CitFloatToStr(fog, 2) + ",";
        responseData += "\"snowfall\":" + CitFloatToStr(snowfall, 2) + ",";
        responseData += "\"windDirection\":" + CitFloatToStr(windDirection, 1) + ",";
        responseData += "\"windMagnitude\":" + CitFloatToStr(windMagnitude, 2);
        responseData += "},";
        responseData += "\"uptime\":{";
        responseData += "\"hours\":" + uptimeHours.ToString() + ",";
        responseData += "\"minutes\":" + uptimeMinutes.ToString() + ",";
        responseData += "\"seconds\":" + uptimeSeconds.ToString();
        responseData += "},";
        responseData += "\"version\":\"" + GetCitadel().GetVersion() + "\"";
        responseData += "}";
        return true;
    }

    static bool GetNearbyVehicles(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float x = CitadelJson.ExtractFloat(params, "x");
        float z = CitadelJson.ExtractFloat(params, "z");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 100;
        if (radius > 1000) radius = 1000;

        vector center = Vector(x, 0, z);
        array<ref CitadelTrackedVehicle> vehicles = GetCitadel().GetTrackedVehicles();

        responseData = "{\"vehicles\":[";
        bool first = true;
        int count = 0;
        for (int i = 0; i < vehicles.Count(); i++)
        {
            CitadelTrackedVehicle veh = vehicles.Get(i);
            if (!veh || !veh.Ref()) continue;

            vector vPos = veh.Ref().GetPosition();
            float dist = vector.Distance(center, vPos);
            if (dist > radius) continue;

            if (!first) responseData += ",";
            first = false;

            EntityAI vehEntity = EntityAI.Cast(veh.Ref());
            float hp = 0;
            float maxHp = 0;
            if (vehEntity)
            {
                hp = vehEntity.GetHealth("", "Health");
                maxHp = vehEntity.GetMaxHealth("", "Health");
            }

            responseData += "{\"id\":\"" + veh.GetID() + "\",\"className\":\"" + veh.GetClassName() + "\",\"type\":\"" + veh.GetVehicleType() + "\",\"position\":" + CitVectorToJson(vPos) + ",\"health\":" + CitFloatToStr(hp, 1) + ",\"maxHealth\":" + CitFloatToStr(maxHp, 1) + ",\"distance\":" + CitFloatToStr(dist, 1) + "}";
            count++;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }

    static bool GetVehicleInfo(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CitadelTrackedVehicle veh = GetCitadel().FindVehicleByNetId(vehicleId);
        if (!veh || !veh.Ref())
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vector pos = veh.Ref().GetPosition();
        EntityAI vehEntity = EntityAI.Cast(veh.Ref());
        float hp = 0;
        float maxHp = 0;
        if (vehEntity)
        {
            hp = vehEntity.GetHealth("", "Health");
            maxHp = vehEntity.GetMaxHealth("", "Health");
        }

        responseData = "{\"id\":\"" + veh.GetID() + "\",\"className\":\"" + veh.GetClassName() + "\",\"type\":\"" + veh.GetVehicleType() + "\",\"position\":" + CitVectorToJson(pos) + ",\"health\":" + CitFloatToStr(hp, 1) + ",\"maxHealth\":" + CitFloatToStr(maxHp, 1) + "}";
        return true;
    }

    static bool GetItemDetails(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string objectId = CitadelJson.ExtractString(params, "objectId");

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && CitGetNetworkIDString(entity) == objectId)
            {
                vector pos = entity.GetPosition();
                float hp = entity.GetHealth("", "Health");
                float maxHp = entity.GetMaxHealth("", "Health");

                responseData = "{\"id\":\"" + objectId + "\",\"className\":\"" + entity.GetType() + "\",\"position\":" + CitVectorToJson(pos) + ",\"health\":" + CitFloatToStr(hp, 1) + ",\"maxHealth\":" + CitFloatToStr(maxHp, 1) + "}";
                return true;
            }
        }

        error = "Item not found: " + objectId;
        return false;
    }

    static bool GetBaseObjects(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float x = CitadelJson.ExtractFloat(params, "x");
        float z = CitadelJson.ExtractFloat(params, "z");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;
        if (radius > 500) radius = 500;

        vector center = Vector(x, 0, z);
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        responseData = "{\"objects\":[";
        bool first = true;
        int count = 0;
        foreach (Object obj : objects)
        {
            // Filter for base building objects
            if (!obj.IsInherited(BaseBuildingBase)) continue;

            EntityAI entity = EntityAI.Cast(obj);
            if (!entity) continue;

            if (!first) responseData += ",";
            first = false;

            vector pos = entity.GetPosition();
            float hp = entity.GetHealth("", "Health");
            float maxHp = entity.GetMaxHealth("", "Health");

            responseData += "{\"id\":\"" + CitGetNetworkIDString(entity) + "\",\"className\":\"" + entity.GetType() + "\",\"position\":" + CitVectorToJson(pos) + ",\"health\":" + CitFloatToStr(hp, 1) + ",\"maxHealth\":" + CitFloatToStr(maxHp, 1) + "}";
            count++;
            if (count >= 50) break;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }

    static bool GetStorageContents(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string objectId = CitadelJson.ExtractString(params, "objectId");

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (entity && CitGetNetworkIDString(entity) == objectId)
            {
                array<EntityAI> items = new array<EntityAI>();
                entity.GetInventory().EnumerateInventory(InventoryTraversalType.LEVELORDER, items);

                responseData = "{\"containerId\":\"" + objectId + "\",\"containerType\":\"" + entity.GetType() + "\",\"items\":[";
                bool first = true;
                for (int i = 0; i < items.Count(); i++)
                {
                    EntityAI item = items.Get(i);
                    if (!item || item == entity) continue;

                    if (!first) responseData += ",";
                    first = false;

                    responseData += "{\"className\":\"" + item.GetType() + "\",\"health\":" + CitFloatToStr(item.GetHealth("", "Health"), 1) + "}";
                }
                responseData += "],\"itemCount\":" + items.Count().ToString() + "}";
                return true;
            }
        }

        error = "Container not found: " + objectId;
        return false;
    }

    static bool GetAllStorageObjects(out string error, out string responseData)
    {
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        responseData = "{\"storageObjects\":[";
        bool first = true;
        int count = 0;
        foreach (Object obj : objects)
        {
            // Filter for storage containers (tents, barrels, crates, etc.)
            EntityAI entity = EntityAI.Cast(obj);
            if (!entity) continue;
            if (!entity.GetInventory()) continue;
            if (!entity.GetInventory().GetCargo()) continue;

            // Skip players
            if (entity.IsMan()) continue;

            if (!first) responseData += ",";
            first = false;

            vector pos = entity.GetPosition();
            responseData += "{\"id\":\"" + CitGetNetworkIDString(entity) + "\",\"className\":\"" + entity.GetType() + "\",\"position\":" + CitVectorToJson(pos) + "}";
            count++;
            if (count >= 100) break;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }

    static bool GetNearbyPlayers(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 100;
        if (radius > 1000) radius = 1000;

        PlayerBase sourcePlayer = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!sourcePlayer)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector center = sourcePlayer.GetPosition();
        map<string, Man> activePlayers = GetCitadel().GetActivePlayers();

        responseData = "{\"players\":[";
        bool first = true;
        int count = 0;
        for (int i = 0; i < activePlayers.Count(); i++)
        {
            string pSteamId = activePlayers.GetKey(i);
            if (pSteamId == steamId) continue;

            PlayerBase player = PlayerBase.Cast(activePlayers.GetElement(i));
            if (!player) continue;

            float dist = vector.Distance(center, player.GetPosition());
            if (dist > radius) continue;

            if (!first) responseData += ",";
            first = false;

            string name = "Survivor";
            if (player.GetIdentity())
                name = player.GetIdentity().GetName();

            responseData += "{\"steamId\":\"" + pSteamId + "\",\"name\":\"" + CitJsonEscape(name) + "\",\"distance\":" + CitFloatToStr(dist, 1) + ",\"position\":" + CitVectorToJson(player.GetPosition()) + "}";
            count++;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }

    static bool GetNearbyLoot(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 25;
        if (radius > 200) radius = 200;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector center = player.GetPosition();
        return _GetLootAtPosition(center, radius, error, responseData);
    }

    static bool GetNearbyEntities(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string steamId = CitadelJson.ExtractString(params, "steamId");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;
        if (radius > 500) radius = 500;

        PlayerBase player = CitadelPlayerActions.FindPlayerBySteamId(steamId);
        if (!player)
        {
            error = "Player not found: " + steamId;
            return false;
        }

        vector center = player.GetPosition();
        return _GetEntitiesAtPosition(center, radius, error, responseData);
    }

    static bool GetNearbyEntitiesAt(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float x = CitadelJson.ExtractFloat(params, "x");
        float z = CitadelJson.ExtractFloat(params, "z");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 50;
        if (radius > 500) radius = 500;

        vector center = Vector(x, 0, z);
        return _GetEntitiesAtPosition(center, radius, error, responseData);
    }

    static bool GetNearbyLootAt(string cmdJson, out string error, out string responseData)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        float x = CitadelJson.ExtractFloat(params, "x");
        float z = CitadelJson.ExtractFloat(params, "z");
        float radius = CitadelJson.ExtractFloat(params, "radius");
        if (radius <= 0) radius = 25;
        if (radius > 200) radius = 200;

        vector center = Vector(x, 0, z);
        return _GetLootAtPosition(center, radius, error, responseData);
    }

    // ─── Internal Helpers ───────────────────────────────

    private static bool _GetEntitiesAtPosition(vector center, float radius, out string error, out string responseData)
    {
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        responseData = "{\"entities\":[";
        bool first = true;
        int count = 0;
        foreach (Object obj : objects)
        {
            EntityAI entity = EntityAI.Cast(obj);
            if (!entity) continue;

            if (!first) responseData += ",";
            first = false;

            string entityType = "object";
            if (entity.IsMan()) entityType = "player";
            else if (entity.IsInherited(ZombieBase)) entityType = "infected";
            else if (entity.IsInherited(AnimalBase)) entityType = "animal";
            else if (entity.IsInherited(Transport)) entityType = "vehicle";
            else if (entity.IsInherited(BaseBuildingBase)) entityType = "basebuilding";

            vector pos = entity.GetPosition();
            float dist = vector.Distance(center, pos);

            responseData += "{\"id\":\"" + CitGetNetworkIDString(entity) + "\",\"className\":\"" + entity.GetType() + "\",\"type\":\"" + entityType + "\",\"position\":" + CitVectorToJson(pos) + ",\"distance\":" + CitFloatToStr(dist, 1) + "}";
            count++;
            if (count >= 100) break;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }

    private static bool _GetLootAtPosition(vector center, float radius, out string error, out string responseData)
    {
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(center, radius, objects, proxyCargos);

        responseData = "{\"items\":[";
        bool first = true;
        int count = 0;
        foreach (Object obj : objects)
        {
            ItemBase item = ItemBase.Cast(obj);
            if (!item) continue;

            // Skip items attached to players
            Man owner = item.GetHierarchyRootPlayer();
            if (owner) continue;

            if (!first) responseData += ",";
            first = false;

            vector pos = item.GetPosition();
            float dist = vector.Distance(center, pos);

            responseData += "{\"className\":\"" + item.GetType() + "\",\"position\":" + CitVectorToJson(pos) + ",\"distance\":" + CitFloatToStr(dist, 1) + "}";
            count++;
            if (count >= 100) break;
        }
        responseData += "],\"count\":" + count.ToString() + "}";
        return true;
    }
};
