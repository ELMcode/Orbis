#!/bin/sh
# Orbis - container entrypoint
#  1. Applique les migrations Prisma
#  2. Seed only when the database is empty (prevents duplicates on restart).
#  3. Lance le serveur
set -e

echo "→ Application des migrations…"
./node_modules/.bin/prisma migrate deploy

# Seed only when the database contains no users.
if [ "$SEED_ON_START" != "false" ]; then
  USER_COUNT=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);return p.\$disconnect();}).catch(()=>{console.log(0);})")
  if [ "$USER_COUNT" = "0" ]; then
    echo "→ Base vide : exécution du seed initial…"
    ./node_modules/.bin/prisma db seed
  else
    echo "→ Base non vide ($USER_COUNT utilisateurs) : seed ignoré."
  fi
fi

echo "→ Démarrage du serveur Orbis…"
exec node dist/server.js
