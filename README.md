# brat lyrics

Générateur de typographie façon *brat* (mode fond blanc), pensé pour créer des visuels de paroles synchronisables en montage vidéo (TikTok, Reels…).

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de production dans dist/
```

## Fonctionnalités

### Phase 1 — Affichage brat
Zone d'aperçu carrée (ce qui est exporté) + champ de saisie. Le texte est en
minuscules, justifié (dernière ligne comprise), légèrement flouté, et sa taille
s'ajuste automatiquement pour remplir le cadre. À chaque lettre/mot, l'agencement
se recompose — comme sur bratgenerator.com. Aucun mot n'est jamais coupé : la
police rétrécit pour que le mot le plus long tienne dans la largeur.

### Phase 2 — Export de séquence
Onglet **Export séquence**. Génère automatiquement une suite d'images (`.zip`,
numérotées `frame_001…`) prêtes à importer dans un logiciel de montage :
- **Cumulatif** : +1 mot (ou +1 lettre) par image → effet karaoké / build-up.
- **Mot par mot** : une image par mot isolé.
- **Ligne par ligne** : cumul ligne à ligne (lignes détectées sur le rendu réel).
- Formats : 1080×1920 (TikTok/Reels), 1080×1080, 1920×1080.
- Option fond transparent (PNG à canal alpha).

### Phase 3 — Personnalisation
Onglet **Style** : police, flou, graisse, interlettrage, interligne, largeur du
bloc, taille auto/fixe, minuscules, justification de la dernière ligne, couleur
du texte et du fond. Les réglages sont mémorisés (localStorage).

## Pile technique
Vite + TypeScript, `html-to-image` (rendu DOM → PNG, filtres CSS inclus),
`jszip` (archive de la séquence). Tout tourne côté client, aucune dépendance
réseau.
