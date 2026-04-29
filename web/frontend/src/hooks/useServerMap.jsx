import { useMemo } from 'react';
import { useServers } from '../contexts/ServersContext';

/**
 * Hook that returns the map key for a given server.
 * Falls back to 'chernarusplus' if the server config doesn't specify a map.
 *
 * Usage:
 *   const mapName = useServerMap(serverId);
 *   <InteractiveMap mapName={mapName} ... />
 */
export default function useServerMap(serverId) {
  const { servers } = useServers();
  return useMemo(() => {
    const srv = servers.find(s => s.id === serverId);
    return srv?.map || 'chernarusplus';
  }, [servers, serverId]);
}
