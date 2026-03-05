/**
 * CitadelVehicleActions — In-game vehicle action execution.
 *
 * PERFORMANCE: FindVehicle() uses CitadelCore vehicle registry (O(n) on tracked
 * vehicles, typically ~20-50) instead of GetObjectsAtPosition() which does a
 * 15km radius world scan returning tens of thousands of objects (~20-100ms).
 */
class CitadelVehicleActions
{
    /**
     * Find a vehicle by network ID using the tracked vehicle registry.
     * Falls back to world scan only if registry lookup fails.
     */
    static CarScript FindVehicle(string vehicleId)
    {
        if (vehicleId == "")
            return null;

        // ─── Fast path: registry lookup (O(n) on ~20-50 tracked vehicles) ───
        if (GetCitadel())
        {
            CitadelTrackedVehicle tracked = GetCitadel().FindVehicleByNetId(vehicleId);
            if (tracked && tracked.Ref())
            {
                CarScript car = CarScript.Cast(tracked.Ref());
                if (car) return car;
            }
        }

        // ─── Slow fallback: world scan (only if vehicle wasn't in registry) ───
        // This handles edge cases where a vehicle exists but wasn't tracked
        // (e.g., spawned externally, or registry missed it)
        CarScript foundCar;
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object o : objects)
        {
            foundCar = CarScript.Cast(o);
            if (foundCar)
            {
                EntityAI entity = EntityAI.Cast(foundCar);
                if (entity && CitGetNetworkIDString(entity) == vehicleId)
                    return foundCar;
            }
        }

        return null;
    }

    static bool DeleteVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        GetGame().ObjectDelete(vehicle);
        Print("[Citadel] Deleted vehicle: " + vehicleId);
        return true;
    }

    static bool RepairVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Comprehensive repair matching GameLabs pattern
        // Base entity health
        EntityAI vehicleEntityAI = EntityAI.Cast(vehicle);
        vehicleEntityAI.SetHealthMax("", "Health");
        vehicleEntityAI.SetHealthMax();

        // Refill all fluids (GameLabs does this as part of repair)
        float fuel = vehicle.GetFluidCapacity(CarFluid.FUEL) - (vehicle.GetFluidCapacity(CarFluid.FUEL) * vehicle.GetFluidFraction(CarFluid.FUEL));
        float oil = vehicle.GetFluidCapacity(CarFluid.OIL) - (vehicle.GetFluidCapacity(CarFluid.OIL) * vehicle.GetFluidFraction(CarFluid.OIL));
        float coolant = vehicle.GetFluidCapacity(CarFluid.COOLANT) - (vehicle.GetFluidCapacity(CarFluid.COOLANT) * vehicle.GetFluidFraction(CarFluid.COOLANT));
        float brake = vehicle.GetFluidCapacity(CarFluid.BRAKE) - (vehicle.GetFluidCapacity(CarFluid.BRAKE) * vehicle.GetFluidFraction(CarFluid.BRAKE));
        vehicle.Fill(CarFluid.FUEL, fuel);
        vehicle.Fill(CarFluid.OIL, oil);
        vehicle.Fill(CarFluid.COOLANT, coolant);
        vehicle.Fill(CarFluid.BRAKE, brake);
        vehicle.SetSynchDirty();
        vehicle.Synchronize();

        // Repair all damage zones (GameLabs reads from config)
        string cfg_path = string.Format("%1 %2 DamageSystem", CFG_VEHICLESPATH, vehicle.GetType());
        if (GetGame().ConfigIsExisting(cfg_path))
        {
            string child_zone;
            string child_class;
            array<string> damaged_zones = new array<string>;

            int zone_count = GetGame().ConfigGetChildrenCount(cfg_path);
            if (zone_count > 0)
            {
                for (int x = 0; x < zone_count; ++x)
                {
                    GetGame().ConfigGetChildName(cfg_path, x, child_class);
                    child_class.ToLower();
                    if (child_class == "damagezones")
                    {
                        for (int y = 0; y < GetGame().ConfigGetChildrenCount(string.Format("%1 DamageZones", cfg_path)); ++y)
                        {
                            GetGame().ConfigGetChildName(string.Format("%1 DamageZones", cfg_path), y, child_zone);
                            damaged_zones.Insert(child_zone);
                        }
                    }
                }
            }

            if (damaged_zones.Count() > 0)
            {
                foreach (string zone : damaged_zones)
                {
                    vehicleEntityAI.SetHealthMax(zone, "Health");
                }
            }
        }

        Print("[Citadel] Repaired vehicle: " + vehicleId);
        return true;
    }

    static bool RefuelVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Fill calculates delta to avoid overfilling (GameLabs pattern: capacity - (capacity * fraction))
        float fuel = vehicle.GetFluidCapacity(CarFluid.FUEL) - (vehicle.GetFluidCapacity(CarFluid.FUEL) * vehicle.GetFluidFraction(CarFluid.FUEL));
        float oil = vehicle.GetFluidCapacity(CarFluid.OIL) - (vehicle.GetFluidCapacity(CarFluid.OIL) * vehicle.GetFluidFraction(CarFluid.OIL));
        float brake = vehicle.GetFluidCapacity(CarFluid.BRAKE) - (vehicle.GetFluidCapacity(CarFluid.BRAKE) * vehicle.GetFluidFraction(CarFluid.BRAKE));
        float coolant = vehicle.GetFluidCapacity(CarFluid.COOLANT) - (vehicle.GetFluidCapacity(CarFluid.COOLANT) * vehicle.GetFluidFraction(CarFluid.COOLANT));
        vehicle.Fill(CarFluid.FUEL, fuel);
        vehicle.Fill(CarFluid.OIL, oil);
        vehicle.Fill(CarFluid.BRAKE, brake);
        vehicle.Fill(CarFluid.COOLANT, coolant);

        Print("[Citadel] Refueled vehicle: " + vehicleId);
        return true;
    }

    static bool UnstuckVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vector pos = vehicle.GetPosition();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]) + 1.0;
        vehicle.SetPosition(pos);

        vector orient = vehicle.GetOrientation();
        orient[1] = 0;
        orient[2] = 0;
        vehicle.SetOrientation(orient);

        Print("[Citadel] Unstuck vehicle: " + vehicleId);
        return true;
    }

    static bool ExplodeVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vehicle.Explode(DT_EXPLOSION, "LandFuelFeed_Ammo");

        Print("[Citadel] Exploded vehicle: " + vehicleId);
        return true;
    }

    static bool KillEngine(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        vehicle.SetHealth("Engine", "Health", 0);

        Print("[Citadel] Killed engine: " + vehicleId);
        return true;
    }

    static bool EjectDriver(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        int c;
        Human crew;
        PlayerBase player;
        HumanCommandVehicle vehCommand;
        for (c = 0; c < vehicle.CrewSize(); c++)
        {
            crew = vehicle.CrewMember(c);
            if (!crew) continue;

            if (Class.CastTo(player, crew))
            {
                if (vehicle.CrewMemberIndex(player) == DayZPlayerConstants.VEHICLESEAT_DRIVER)
                {
                    // Use GetOutVehicle() via HumanCommandVehicle (GameLabs pattern)
                    vehCommand = player.GetCommand_Vehicle();
                    if (vehCommand)
                        vehCommand.GetOutVehicle();
                    Print("[Citadel] Ejected driver from vehicle: " + vehicleId);
                    return true;
                }
            }
        }

        Print("[Citadel] No driver found in vehicle: " + vehicleId);
        return true;
    }

    static bool TeleportVehicle(string cmdJson, out string error)
    {
        string params = CitadelJson.ExtractParams(cmdJson);
        string vehicleId = CitadelJson.ExtractString(params, "vehicleId");
        float x = CitadelJson.ExtractFloat(params, "x");
        float y = CitadelJson.ExtractFloat(params, "y");
        float z = CitadelJson.ExtractFloat(params, "z");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        if (y <= 0)
            y = GetGame().SurfaceY(x, z) + 1.0;

        vector pos = Vector(x, y, z);
        vehicle.SetPosition(pos);

        Print("[Citadel] Teleported vehicle " + vehicleId + " to " + pos.ToString());
        return true;
    }
};
