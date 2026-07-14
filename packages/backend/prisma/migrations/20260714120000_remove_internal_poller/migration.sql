-- Retire uniquement les collectors synthétiques créés par l'ancien poller.
-- Les collectors clients et leurs runs restent inchangés.
DELETE FROM "DiscoveryCollector"
WHERE "name" = 'Internal Poller'
  AND "tokenHash" = 'internal-no-token';
