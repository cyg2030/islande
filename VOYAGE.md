# VOYAGE.md

Notes techniques sur `voyage.html` (journal de voyage post-séjour) — comment il est construit, d'où viennent les données, et les règles/seuils utilisés. Ce fichier documente les décisions prises pour ce module ; `CLAUDE.md` reste la référence pour l'architecture générale du dépôt.

Ce dépôt est **public** — ne jamais committer de clé API, mot de passe ou jeton dans ce fichier ni ailleurs dans le dépôt.

## Vue d'ensemble

`voyage.html` est une page séparée de `index.html` (qui reste la carte de préparation). Elle retrace le voyage réellement effectué (4–19 septembre) : tracé GPS jour par jour, campings réels, arrêts marquants, kilométrage. Contrairement à `index.html`, ses données ne sont pas de simples tableaux tapés à la main : elles sont **calculées une fois** à partir des photos géolocalisées du voyage, puis figées (écrites en dur) dans le fichier — la page reste statique et ne recontacte ni Immich ni OSRM au chargement.

## Domaine personnalisé

La page est prévue pour être servie sur **`github.itcg-consulting.com`** (fichier `CNAME` à la racine du dépôt, mécanisme standard de GitHub Pages — DNS à configurer côté `itcg-consulting.com`, hors de ce dépôt). Le libellé exact du sous-domaine n'a pas d'importance pour la logique qui suit (n'importe quel sous-domaine de `itcg-consulting.com` fonctionnerait) ; ce qui compte est que ce soit un **vrai enregistrement DNS CNAME** pointant vers `cyg2030.github.io` — pas une redirection HTTP ni un affichage en frame géré par l'hébergeur DNS, ce qui annulerait l'effet recherché (le script continuerait de s'exécuter dans le contexte `cyg2030.github.io`).

**Pourquoi ce domaine précisément** : Immich (photos) tourne sur `photo.itcg-consulting.com`. Le cookie de session d'Immich est posé en `SameSite=Lax` (comportement du serveur Immich, non configurable — voir plus bas). Un cookie `SameSite=Lax` n'est envoyé que pour des requêtes *same-site*, c'est-à-dire quand la page qui fait la requête et le domaine ciblé partagent le même domaine enregistré (eTLD+1). `cyg2030.github.io` (l'URL par défaut de GitHub Pages) est sur la liste des suffixes publics, donc traité comme un site à part — cross-site vis-à-vis d'Immich, cookie jamais envoyé. `github.itcg-consulting.com` et `photo.itcg-consulting.com` partagent en revanche le même domaine racine `itcg-consulting.com` → same-site → le cookie de session Immich est envoyé, et les miniatures de photos (voir plus bas) peuvent se charger sans rien changer côté Immich.

## Source des données : Immich

L'album Immich `202609 - Islande` (partagé, ~2700 photos, dates 04–19/09) est la source de tout ce qui est calculé dans `voyage.html` :

- **Filtrage par appareil** : seules les photos du téléphone du conducteur (`exifInfo.model = "OnePlus 12"`) sont utilisées pour les traces/arrêts/nuits — l'album contient aussi les photos d'un second appareil, exclues.
- **Filtrage géographique** : les photos hors de la bounding box Islande (lat 62–67, lon -26 à -12) sont ignorées pour le tracé — utile pour J0 (aéroport de départ en France) et J15 (voir plus bas).
- **Accès en lecture seule** : une clé API Immich dédiée au débogage (lecture seule, provenance : session de travail sur un autre projet du même compte) a été utilisée *ponctuellement*, en local, pour interroger l'API et générer les données figées dans `voyage.html`. **Cette clé n'apparaît jamais dans ce dépôt** et n'est pas nécessaire pour faire fonctionner la page — seulement pour la régénérer si les données doivent être recalculées (nouvelles photos, correction d'un arrêt, etc.).
- Endpoints Immich utilisés lors de cette génération : `POST /api/search/metadata` (params `albumIds`, `withExif`, pagination) pour récupérer position/heure/appareil de chaque photo ; `GET /api/assets/{id}/thumbnail` pour les miniatures (voir "Limites" plus bas).

## Reconstruction des traces jour par jour

Pour chaque jour (`DAYS[i].segments`), les photos du téléphone du conducteur, triées chronologiquement, sont découpées en segments classés **route** ou **à pied** :

- Pour chaque paire de photos consécutives : distance à vol d'oiseau `d_km` et vitesse implicite `speed_kmh = d_km / durée`.
- **Segment "route"** si `d_km > 1.5` OU `speed_kmh > 15` — sinon **"à pied"** (marche, visite d'un site, hors-route).
- Les segments "route" consécutifs sont chaînés puis envoyés à l'API OSRM publique (`router.project-osrm.org/route/v1/driving/...`) pour être recalculés sur le réseau routier réel (géométrie complète, pas une ligne droite).
- Les segments "à pied" gardent la trace GPS brute (affichés en pointillés dans la légende).
- Ce découpage est **figé** dans `DAYS[i].segments` — il n'y a plus d'appel OSRM au chargement de la page.

**Position de nuit** (`nightPos`) : dernière photo géolocalisée du jour. Le nom du camping est déduit par plus-proche-voisin contre la base `CAMPEASY_CAMPINGS` d'`index.html` ; `campUncertain:true` si la correspondance est à plus de 2 km (à confirmer manuellement).

**Cas particuliers** :
- **J0** (arrivée) : affiché par défaut (`defaultOn:true`) malgré son caractère atypique (vol + trajet court).
- **J15** (retour) : le tracé s'arrête à la dernière position avant l'aéroport (troncature manuelle des points post-décollage, qui autrement traceraient un trajet aberrant depuis l'avion). Pas de camping ce jour-là : marqueur ✈️ dédié (`endType:"airport"`) au lieu de 🌙.

## Détection des arrêts (clustering)

Les arrêts sont des regroupements de photos proches dans l'espace et le temps — pas un simple seuil de nombre de photos :

1. **Clustering séquentiel** : les photos triées chronologiquement sont regroupées tant qu'elles restent à ≤ **250 m** (`CLUSTER_RADIUS_KM = 0.25`) du centre du groupe en cours.
2. **Fusion** : deux groupes voisins sont recollés si l'écart est ≤ **20 min** (`MERGE_GAP_MIN`) ET ≤ **600 m** (`MERGE_DIST_KM`).
3. **Deux niveaux** (le dernier groupe du jour, qui correspond à la nuit, est toujours exclu des deux) :
   - **`STOPS`** (arrêts marquants, 106) : ≥ 4 photos ET ≥ 3 min de présence.
   - **`STOPS_MINOR`** (arrêts secondaires, 128) : tout le reste des groupes, dès 2 photos, sans contrainte de durée — désactivé par défaut (menu 📸 → 🔹), car nettement plus dense.
4. **Nom** : plus proche lieu connu (POI ou camping d'`index.html`, si à ≤ 600 m) sinon `Arrêt près de <ville EXIF>` sinon `Arrêt (à nommer)` — `matched:false` déclenche un badge ⚠️ dans le popup.

## Kilométrage

`KM_INITIAL` (compteur avant J0) et `KM_LOG` (compteur relevé chaque soir, par date) sont saisis manuellement — aucune donnée automatique ici, ce sont les relevés fournis par l'utilisateur. Le popup de nuit et le panneau "Programme jour par jour" (bouton 📋) calculent la distance du jour (`KM_LOG[jour] - KM_LOG[veille]`) et le cumul à partir de ces deux structures ; une date sans valeur affiche simplement "à compléter", pas d'erreur.

## Liens et miniatures Immich dans les popups d'arrêts

Chaque arrêt porte l'id de sa **photo représentative** (la première du groupe, chronologiquement) :

- **Lien** `${IMMICH_BASE_URL}/photos/<id>` — route confirmée en inspectant le bundle JS du client web Immich (c'est la route réellement utilisée par l'app pour ouvrir une photo). Ouvre la photo dans la timeline du compte connecté, sans écriture ni clé API.
- **Miniature** `${IMMICH_BASE_URL}/api/assets/<id>/thumbnail?size=thumbnail` — chargée en `<img>` simple, avec repli silencieux (`onerror` masque l'image) si elle ne charge pas. Elle dépend entièrement du cookie de session du navigateur (voir "Domaine personnalisé" ci-dessus) — sans le domaine `itcg-consulting.com`, ou si l'utilisateur n'est pas connecté à Immich dans ce navigateur, l'image reste masquée mais rien ne casse.

### Limite connue (déjà explorée, pas de solution simple)

La recherche Immich (filtre par plage horaire, `takenAfter`/`takenBefore`) ne lit **aucun paramètre d'URL** au chargement dans cette version (vérifié dans le bundle JS du client web) — impossible de créer un lien qui pré-filtre une liste de photos par heure. La seule façon d'obtenir une vraie galerie filtrée serait un "shared link" Immich (écriture via l'API, un par arrêt) — **délibérément écarté** : la clé API utilisée est documentée comme lecture seule, et créer ~100+ liens partagés publics n'a pas été jugé souhaitable.

## Sécurité — à respecter si ce module est régénéré ou étendu

- Ne jamais écrire une clé API Immich (ni aucun secret) dans ce dépôt, y compris dans des commentaires ou des scripts de génération commités.
- Ne pas créer de "shared links" Immich en masse sans en discuter explicitly — ça laisse des artefacts persistants et publics côté Immich.
- Le cookie `SameSite` d'Immich (`lax`, en dur dans `respondWithCookie`, `utils/response.js` du serveur Immich) n'a pas été modifié — c'est le domaine personnalisé qui contourne le problème, pas une reconfiguration d'Immich.
