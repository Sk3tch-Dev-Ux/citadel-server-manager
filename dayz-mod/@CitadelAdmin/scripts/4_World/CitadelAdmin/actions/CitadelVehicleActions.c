/**
 * CitadelVehicleActions — In-game vehicle action execution.
 *
 * Vehicle IDs are the network IDs assigned by the game engine.
 * The player tracker includes vehicle data; the sidecar maps networkId → vehicle.
 */
class CitadelVehicleActions
{
    /**
     * Find a vehicle entity by its network ID string.
     */
    static CarScript FindVehicle(string vehicleId)
    {
        // Try to find by persisted ID or network ID
        int netId = vehicleId.ToInt();
        if (netId <= 0)
            return null;

        // Iterate all vehicles in the world
        ref array<CarScript> vehicles = new array<CarScript>();
        // GetGame doesn't have a direct vehicle list — iterate all objects near each player's area
        // A more robust approach: iterate the object pool
        Object obj;
        CarScript car;

        // Search within a large radius from world center
        ref array<Object> objects = new array<Object>();
        ref array<CargoBase> proxyCargos = new array<CargoBase>();
        GetGame().GetObjectsAtPosition(Vector(7500, 0, 7500), 15000, objects, proxyCargos);

        foreach (Object o : objects)
        {
            car = CarScript.Cast(o);
            if (car)
            {
                // Compare network ID
                if (car.GetNetworkID().ToString() == vehicleId)
                    return car;
            }
        }

        return null;
    }

    static bool DeleteVehicle(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

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
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Restore all zones to full health
        ref array<string> zones = new array<string>();
        vehicle.GetDamageZones(zones);

        foreach (string zone : zones)
        {
            vehicle.SetHealth(zone, "Health", vehicle.GetMaxHealth(zone, "Health"));
        }

        // Also repair engine, fuel tank, radiator
        vehicle.SetHealth("Engine", "Health", vehicle.GetMaxHealth("Engine", "Health"));

        Print("[Citadel] Repaired vehicle: " + vehicleId);
        return true;
    }

    static bool RefuelVehicle(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Fill fuel to max capacity
        vehicle.Fill(CarFluid.FUEL, vehicle.GetFluidCapacity(CarFluid.FUEL));
        vehicle.Fill(CarFluid.OIL, vehicle.GetFluidCapacity(CarFluid.OIL));
        vehicle.Fill(CarFluid.BRAKE, vehicle.GetFluidCapacity(CarFluid.BRAKE));
        vehicle.Fill(CarFluid.COOLANT, vehicle.GetFluidCapacity(CarFluid.COOLANT));

        Print("[Citadel] Refueled vehicle: " + vehicleId);
        return true;
    }

    static bool UnstuckVehicle(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Move vehicle slightly up and reset physics
        vector pos = vehicle.GetPosition();
        pos[1] = GetGame().SurfaceY(pos[0], pos[2]) + 1.0;
        vehicle.SetPosition(pos);

        // Reset orientation to upright
        vector orient = vehicle.GetOrientation();
        orient[1] = 0; // Remove pitch
        orient[2] = 0; // Remove roll
        vehicle.SetOrientation(orient);

        Print("[Citadel] Unstuck vehicle: " + vehicleId);
        return true;
    }

    static bool ExplodeVehicle(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Destroy vehicle
        vehicle.Explode(DamageType.EXPLOSION);

        Print("[Citadel] Exploded vehicle: " + vehicleId);
        return true;
    }

    static bool KillEngine(string cmdJson, out string error)
    {
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

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
        string params = CitadelCommandRunner.ExtractParams(cmdJson);
        string vehicleId = CitadelCommandRunner.ExtractJsonString(params, "vehicleId");

        CarScript vehicle = FindVehicle(vehicleId);
        if (!vehicle)
        {
            error = "Vehicle not found: " + vehicleId;
            return false;
        }

        // Get crew and eject them
        Human driver = vehicle.CrewMember(DayZPlayerConstants.VEHICLESEAT_DRIVER);
        if (driver)
        {
            // Force player out of vehicle
            vehicle.CrewGetOut(DayZPlayerConstants.VEHICLESEAT_DRIVER);
        }

        Print("[Citadel] Ejected driver from vehicle: " + vehicleId);
        return true;
    }
};
