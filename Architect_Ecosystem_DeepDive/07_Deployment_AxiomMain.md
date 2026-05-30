# 07 — The Deployment: "Axiom Main" (DayZ server)

Everything in Tiers 1–3 exists to run **Tier 4** — one concrete DayZ dedicated server. It lives at:

```
C:\Program Files (x86)\CFTools Software GmbH\Architect\Agent\deployments\AxiomMain\
```

A "deployment" is a self-contained DayZ server install plus its mods, configs, profiles, and the Agent's server-side metadata. The Agent's SERVER OBSERVER supervises the `DayZServer_x64.exe` inside it.

---

## 1. Identity (`serverDZ.cfg`)

```
hostname  = "Axiom Main | US Hosted | Vanilla+ "
description = "Where Vanilla Meets Quality of Life"
maxPlayers = 60
mission   = dayzOffline.chernarusplus      (class Missions/DayZ template)
instanceId = 1
```

Key engine settings:
| Setting | Value | Effect |
|---------|-------|--------|
| `verifySignatures` | `2` | Strict PBO signature checking (anti-tamper; requires mod `.bikey`s in `keys\`). |
| `forceSameBuild` | `1` | Clients must match the server build exactly. |
| `disable3rdPerson` | `1` | First-person-only server. |
| `disableCrosshair` | `1` | No crosshair (hardcore aim). |
| `serverTimeAcceleration` | `4.66` | Day length ~ (24/4.66) h. |
| `serverNightTimeAcceleration` | `4.28` | Night runs slightly slower than day-accel. |
| `serverTimePersistent` | `1` | Time persists across restarts. |
| `loginQueueConcurrentPlayers` / `loginQueueMaxPlayers` | `5` / `500` | Login throttling — works with the Agent's priority queue. |
| `disableVoN` | `0`, `vonCodecQuality` `20` | Voice-over-network on, high quality. |
| `steamQueryPort` | `2303` | A2S query port (matches Agent's server config). |
| `storageAutoFix` | `1` | Auto-repair corrupted persistence. |

Three maps are staged in `mpmissions\` (`dayzOffline.chernarusplus`, `dayzOffline.enoch` = Livonia, `dayzOffline.sakhal`); the cfg boots **Chernarus**.

---

## 2. The mod stack (17 Workshop mods)

Mods are stored as `@<publishedid>\` folders, each with `addons\`, `keys\`, `meta.cpp`, `mod.cpp`. The Agent's TITLE MANAGER runs a **Mod Observer** per id and version-syncs them.

| Folder (Workshop id) | Mod | Role in the stack |
|----------------------|-----|-------------------|
| `@1559212036` | **Community Framework (CF)** | Base dependency for almost everything. |
| `@2545327648` | **Dabs Framework** | Dependency (Expansion-adjacent). |
| `@1564026768` | **Community Online Tools (COT)** | In-game admin/permissions toolkit. |
| `@2464526692` | **GameLabs** | Telemetry + admin hooks; **feeds the Agent's in-game metrics** (see §4). |
| `@2291785308` | **DayZ-Expansion-Core** | Expansion foundation. |
| `@2116157322` | **DayZ-Expansion-Licensed** | Expansion licensed assets. |
| `@2572331007` | **DayZ-Expansion-Bundle** | Main Expansion feature bundle. |
| `@2792982069` | **DayZ-Expansion-AI** | AI factions / patrols. |
| `@2792984177` | **DayZ-Expansion-Missions** | Dynamic missions / airdrops. |
| `@2828486817` | **DayZ-Expansion-Quests** | Quest/NPC system. |
| `@1646187754` | **CodeLock** | Combination-lock base raiding. |
| `@3514469093` | **BS KeyRoom** | Keycard-gated loot rooms. |
| `@3210162677` | **MMG Base Storage** | Extra base storage containers. |
| `@3682890365` | **Survival Tweaks** | QoL survival adjustments. |
| `@1832448183` | **FlipTransport** | Right-click flip stuck vehicles. |
| `@3700815342` | **MWGSM_Road_Spawner** | Road-network / AI road spawning. |
| `@3700436870` | **Axiom Core** | **The server's own custom mod** — the "Axiom" identity/glue. |

**Load order** matters in DayZ (`-mod=` chain): frameworks first (CF, Dabs), then Expansion Core → Licensed → Bundle → AI/Missions/Quests, then feature mods (CodeLock, KeyRoom, storage), then the custom **Axiom Core** last so it can override. The Agent assembles this chain from the `mod_server_bindings` table.

Server-side-only mods (no client download) would be bound separately (the Agent distinguishes client `-mod=` vs server `-servermod=`).

---

## 3. Engine auto-tuning by Architect (`dayzsetting.xml`)

This file carries a telltale comment proving the **Agent writes engine config**, not just launches the binary:

```xml
<jobsystem globalqueue="24576" threadqueue="12288">
  <!--These values have been automatically adjusted by Architect, please revise with care.-->
  <pc maxcores="24" reservedcores="12"></pc>
</jobsystem>
```

Architect detected the host CPU and tuned the DayZ engine's **job system** (24 max cores, 12 reserved, queue sizes) for this box. This is part of why it performs well — the platform tunes the engine to the hardware automatically. (`video`/`render` blocks are server-irrelevant leftovers.)

---

## 4. GameLabs metrics wiring (`profiles\gamelabs.cfg`)

```jsonc
{
  "serverId": "085d1ba5-fe51-406a-b07a-11d2e99cae90",
  "apiKey":   "fkBTZbMn...=",      // GameLabs/CFTools key
  "enableMetricsDump": 1,           // ← writes gamelabs_metrics.json
  "preventDynamicItemPopulation": 0,
  "advancedChatInterface": 0,
  ...
}
```

`enableMetricsDump = 1` makes the **GameLabs** mod write `profiles\gamelabs_metrics.json`, which the **Agent's per-server collector samples every 5 s** to obtain *in-game* stats (server FPS, AI count, entity count, tick time) — these end up in the `AxiomMain_metrics` SQLite table and the Manager's charts. This is the bridge between "OS-level metrics" and "what's actually happening inside the game world."

---

## 5. The `profiles\` directory (runtime state & logs)

Each subsystem/mod writes here. Observed:
- **DayZ engine logs:** `*.RPT` (script/engine log), `*.ADM` (admin/player log), `script_*.log`, `crash_*.log`, `server_console.log`, `info_*.log`.
- **Per-mod state/logs:** `ExpansionMod\`, `CodeLock\`, `BS_KeyRoom\`, `MMG_Storage\`, `LBmaster\`, `CommunityOnlineTools\`, `PermissionsFramework\`, `SurvivalTweaks\`, `Zenarchist\`, `FlashlightPlus\`, `CombineKits\`, `BVP_DoorPeek\`, `MWGSM_RoadAI\`, `@GameLabsStorage\`, `@Logging\`, `EventManagerLog\`, `WebApiLog\`, `DataCache\`.
- **GameLabs:** `gamelabs.cfg`, `gamelabs_metrics.json`.
- **Users / permissions:** `Users\`, `PermissionsFramework\`.

> Note: the Agent does **not** ingest RPT/ADM into its DB — those stay on disk in `profiles\`. The DB stores numeric telemetry only.

---

## 6. Anti-cheat & access control

- **BattlEye:** `battleye\` holds `BEServer_x64.dll`, `beserver_x64.so`, `EULA`. RCON (port 2305) is how the Agent broadcasts and controls the live server. `verifySignatures=2` + the `.bikey`s in each mod's `keys\` (and the deployment `keys\`) enforce signed content.
- **Access lists (engine-level, separate from Agent RBAC):**
  - `whitelist.txt` — empty + instructional header (whitelist disabled; `enableWhitelist=0`).
  - `ban.txt` — engine ban list (player IDs).
  - `priority.txt` — empty; the **Agent's cloud Priorities provider supersedes the static file** (it pushes the reserved-slot list dynamically).

---

## 7. Steam plumbing

- `steam_appid.txt` (`223350` = DayZ Server), `steam_api64.dll`, `steamclient64.dll`, `config\config.vdf` (Steam CM endpoints/cache). The Agent's `[steam_servers]` config tunes how mod content is pulled through these.

---

## 8. Vestigial / stock files

- `server_manager\Server_manager.ps1` — **Bohemia's stock 2018 server-manager script** (60 KB). It is *not* what runs the server; the Go Agent's SERVER OBSERVER does. It ships with the DayZ server template and is inert here.
- `lifecycle_hooks\` — empty (a place for custom pre/post lifecycle scripts).
- `dayz.gproj` — the DayZ engine project descriptor (script module layout: `1_Core`→`5_Mission`); informational.

---

## 9. The companion analysis docs already on disk

The deployment folder also contains operator-authored design/audit docs (`Axiom_Main_AI_Deep_Dive.docx`, `Axiom_Main_Loot_Guide.md`, `Axiom_Main_Keycard_Guide.md`, `Axiom_Main_Raid_Guide.md`, changelogs, pre-launch audits). These describe the *gameplay* tuning of Axiom Main (loot, AI, keycards, raids) and complement this *platform* analysis. For config-tuning work on those, the host has a dedicated `dayz-edit` workflow.

Continue with `08_Lifecycle_Flows.md`.
