#!/bin/sh
# Orbis — point d'entrée du conteneur
#  1. Applique les migrations Prisma
#  2. Ne seed QUE si la base est vide (évite les doublons au redémarrage)
#  3. Lance le serveur
set -e

echo "→ Application des migrations…"
./node_modules/.bin/prisma migrate deploy

# Seed uniquement si la base ne contient aucun utilisateur
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
