/**
 * CitadelVehicleActions — In-game vehicle action execution.
 */
class CitadelVehicleActions
{
    static CarScript FindVehicle(string vehicleId)
    {
        if (vehicleId == "")
            return null;

        CarScript car;

        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object o : objects)
        {
            car = CarScript.Cast(o);
            if (car)
            {
                EntityAI entity = EntityAI.Cast(car);
                if (entity && CitGetNetworkIDString(entity) == vehicleId)
                    return car;
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
};
