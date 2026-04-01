# Hand Tracker

Application web de suivi des mains en temps réel avec mode dessin dans les airs, propulsée par MediaPipe et React.

## Fonctionnalités

- **Suivi en temps réel** — détecte jusqu'à 2 mains simultanément via la webcam
- **Squelette des mains** — affiche les 21 points de repère et les connexions entre les doigts
- **Comptage des doigts** — détecte quels doigts sont levés
- **Mode dessin** — dessine dans les airs avec ton index
- **Gestes de contrôle** — 1 doigt pour dessiner, 3+ doigts pour faire une pause
- **Palette de couleurs** — 9 couleurs disponibles
- **Tailles de pinceau** — 4 tailles au choix
- **Gomme, Annuler, Effacer**
- **Affichage FPS** — indicateur de performance en temps réel

## Stack technique

- **React + Vite** — interface utilisateur
- **MediaPipe Hands** — modèle de détection des mains (WebAssembly + WebGL)
- **Canvas API** — rendu des squelettes et du dessin
- **Tailwind CSS** — styles
- **TypeScript**
- **pnpm workspaces** — monorepo

## Prérequis

- Node.js 18+
- pnpm

## Installation

```bash
# Cloner le dépôt
git clone <url-du-repo>
cd <nom-du-dossier>

# Installer les dépendances
pnpm install
```

## Lancer le projet

```bash
# Lancer uniquement le hand tracker
pnpm --filter @workspace/hand-tracker run dev
```

Ouvre ensuite [http://localhost:21671](http://localhost:21671) dans ton navigateur.

Pour lancer aussi le serveur API :

```bash
pnpm --filter @workspace/api-server run dev
```

## Utilisation

### Mode Suivi (Track)

Place ta main devant la caméra. Le squelette s'affiche en temps réel avec les doigts levés mis en évidence en vert.

### Mode Dessin (Draw)

1. Clique sur **Draw** dans la barre du bas
2. **☝ Lève uniquement l'index** pour dessiner
3. **✋ Lève 3 doigts ou plus** pour faire une pause sans dessiner
4. Utilise la barre d'outils flottante pour changer la couleur, la taille du pinceau ou utiliser la gomme

## Structure du projet

```
artifacts/
└── hand-tracker/        # Application React + Vite
    └── src/
        ├── pages/
        │   └── HandTrackerPage.tsx   # Composant principal
        ├── hooks/
        │   └── useHandTracking.ts    # Utilitaires de détection
        └── index.css                 # Thème global
lib/
├── api-spec/            # Spécification OpenAPI
├── api-client-react/    # Hooks React Query générés
├── api-zod/             # Schémas Zod générés
└── db/                  # Schéma base de données (Drizzle)
artifacts/
└── api-server/          # Serveur Express
```
