# 🏰 Citadel v2.0.0 — Command Engine Overhaul

> The biggest update in Citadel's history. Over **100 new admin commands**, a fully interactive spawn system on the Live Map, and a massively expanded player management panel.

---

## 🗺️ Live Map — Spawn & World Tools

The Live Map is now a full admin workbench. Open **World Controls** and you'll find:

**🎯 Click-to-Place Spawning**
Select an entity type → configure it → click **"Click to Place"** → click anywhere on the map. Your entity spawns at that exact position. Spawn mode stays active for rapid placement.

- **Zombies** — set count (1-50), click to spawn a group
- **Animals** — choose species (Deer, Wolf, Bear, Boar, Chicken, Goat, Roe Deer)
- **Vehicles** — enter any vehicle class name (e.g. `OffroadHatchback`)
- **Buildings** — enter any building class name
- **Items** — enter any item class name (e.g. `M4A1`)

**⚡ World Events**
One-click spawn mode for dynamic events:
- Helicopter Crash Sites
- Gas Zones
- Supply Crates

**🌲 Area Effects**
Set a radius and use your cursor position to:
- Flatten Trees
- Clear Zombies
- Delete Objects

**🌫️ Atmosphere**
Fine-tune the environment with Fog Density and Wind Speed controls alongside the existing Time & Weather panel.

---

## 👥 Player Management — 32 Actions

The player action menu has been completely reorganized into labeled groups:

**💚 Healing** — Heal, Dry, Cure, Force Drink, Force Eat, Stop Bleeding, Wake, Knockout
**🛡️ Admin Powers** — God Mode, Invisibility, Infinite Stamina (all toggle on/off)
**🎒 Inventory** — Spawn Item, Fill Magazines, Drop Gear, Clear Inventory, Loot Magnet
**🚀 Movement** — Teleport, Teleport to Player, Freeze, Message
**⚖️ Moderation** — Kick, Ban
**💀 Harmful** — Kill, Explode, Break Legs, Make Sick, Launch, Ragdoll, Respawn

All destructive actions require confirmation dialogs.

---

## 📊 In-Game Data Queries

22 new query commands return live data from the game server:

- Player position, gear, inventory, stats, full profile
- Online/offline player lists with session history
- Nearby vehicles, players, loot, and entities
- Base objects, storage contents, and container scanning
- Server info and performance metrics

---

## 💀 Death Event Tracking

Full kill feed with detailed context:
- PvP kills with killer name, weapon, distance, and hit zone
- Suicide, environmental, AI, and vehicle death detection
- All death events logged and available via API

---

## 🔧 Under the Hood

```
103  Action Types
108  Sidecar API Endpoints
97   Provider Methods
79   Backend API Routes
25   Mod Script Files
7,500+ Lines of Enforce Script
```

The entire command pipeline flows through:
```
Frontend → Backend API → Provider → Sidecar → File Queue → DayZ Mod
```

Every admin action is audit-logged with user, timestamp, and action details.

---

*This update lays the foundation for Citadel to be the most powerful DayZ server management platform available. More to come.*
