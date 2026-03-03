/**
 * CitadelActionHooks — Player action hooks for stat tracking.
 *
 * Hooks into bandage, eat, drink, and grenade actions to populate
 * CitadelPlayerStats fields that would otherwise remain at zero.
 */

// ─── Bandage Actions ─────────────────────────────────

modded class ActionBandageSelf
{
    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
        {
            stats.bleedsFixed++;
            stats.healthItemsUsed++;
        }
    }
};

modded class ActionBandageTarget
{
    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
        {
            stats.bleedsFixed++;
            stats.healthItemsUsed++;
        }
    }
};

// ─── Food Consumption ────────────────────────────────

modded class ActionEatBig
{
    override void OnStartServer(ActionData action_data)
    {
        super.OnStartServer(action_data);

        ItemBase item = ItemBase.Cast(action_data.m_MainItem);
        if (item)
            item.m_CitStartQty = item.GetQuantity();
    }

    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        ItemBase item = ItemBase.Cast(action_data.m_MainItem);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
        {
            stats.foodItemsConsumed++;

            if (item)
            {
                float startQty = item.m_CitStartQty;
                float nowQty = item.GetQuantity();
                if (startQty > 0 && nowQty >= 0)
                {
                    float delta = Math.Max(0, startQty - nowQty);
                    stats.foodWeightConsumed += delta / 1000.0;
                }
            }
        }
    }
};

// ─── Drink Consumption ───────────────────────────────

modded class ActionDrink
{
    override void OnStartServer(ActionData action_data)
    {
        super.OnStartServer(action_data);

        ItemBase item = ItemBase.Cast(action_data.m_MainItem);
        if (item)
            item.m_CitStartQty = item.GetQuantity();
    }

    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        ItemBase item = ItemBase.Cast(action_data.m_MainItem);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
        {
            stats.drinkItemsConsumed++;

            if (item)
            {
                float startQty = item.m_CitStartQty;
                float nowQty = item.GetQuantity();
                if (startQty > 0 && nowQty >= 0)
                {
                    float delta = Math.Max(0, startQty - nowQty);
                    stats.drinkVolumeConsumed += delta / 1000.0;
                }
            }
        }
    }
};

modded class ActionDrinkPondContinuous
{
    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
            stats.drinkItemsConsumed++;
    }
};

modded class ActionDrinkWellContinuous
{
    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        if (!player) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
            stats.drinkItemsConsumed++;
    }
};

// ─── Grenade Usage ───────────────────────────────────

modded class ActionPin
{
    override void OnEndServer(ActionData action_data)
    {
        super.OnEndServer(action_data);

        PlayerBase player = PlayerBase.Cast(action_data.m_Player);
        if (!player) return;

        Grenade_Base grenade = Grenade_Base.Cast(action_data.m_MainItem);
        if (!grenade) return;

        string steamId = player.GetCitSteamId();
        if (steamId == "") return;

        CitadelPlayerStats stats = GetCitadel().GetPlayerStats(steamId);
        if (stats)
            stats.grenadesUsed++;
    }
};
