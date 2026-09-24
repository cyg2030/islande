# VOYAGE.md

Notes techniques sur `voyage.html` (journal de voyage post-séjour) — comment il est construit, d'où viennent les données, et les règles/seuils utilisés. Ce fichier documente les décisions prises pour ce module ; `CLAUDE.md` reste la référence pour l'architecture générale du dépôt.

Ce dépôt est **public** — ne jamais committer de clé API, mot de passe ou jeton dans ce fichier ni ailleurs dans le dépôt.

## Vue d'ensemble

`voyage.html` est une page séparée de `preparation.html` (qui reste la carte de préparation). Elle retrace le voyage réellement effectué (4–19 septembre) : tracé GPS jour par jour, campings réels, arrêts marquants, kilométrage. Contrairement à `preparation.html`, ses données ne sont pas de simples tableaux tapés à la main : elles sont **calculées une fois** à partir des photos géolocalisées du voyage, puis figées (écrites en dur) dans le fichier — la page reste statique et ne recontacte ni Immich ni OSRM au chargement.

## Domaine personnalisé

La page est prévue pour être servie sur **`islande2026.itcg-consulting.com`** (fichier `CNAME` à la racine du dépôt, mécanisme standard de GitHub Pages — DNS à configurer côté `itcg-consulting.com`, hors de ce dépôt). Le libellé exact du sous-domaine n'a pas d'importance pour la logique qui suit (n'importe quel sous-domaine de `itcg-consulting.com` fonctionnerait) ; ce qui compte est que ce soit un **vrai enregistrement DNS CNAME** pointant vers `cyg2030.github.io` — pas une redirection HTTP ni un affichage en frame géré par l'hébergeur DNS, ce qui annulerait l'effet recherché (le script continuerait de s'exécuter dans le contexte `cyg2030.github.io`).

**Pourquoi ce domaine précisément** : Immich (photos) tourne sur `photo.itcg-consulting.com`. Le cookie de session d'Immich est posé en `SameSite=Lax` (comportement du serveur Immich, non configurable — voir plus bas). Un cookie `SameSite=Lax` n'est envoyé que pour des requêtes *same-site*, c'est-à-dire quand la page qui fait la requête et le domaine ciblé partagent le même domaine enregistré (eTLD+1). `cyg2030.github.io` (l'URL par défaut de GitHub Pages) est sur la liste des suffixes publics, donc traité comme un site à part — cross-site vis-à-vis d'Immich, cookie jamais envoyé. `islande2026.itcg-consulting.com` et `photo.itcg-consulting.com` partagent en revanche le même domaine racine `itcg-consulting.com` → same-site → le cookie de session Immich est envoyé, et les miniatures de photos (voir plus bas) peuvent se charger sans rien changer côté Immich.

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

**Position de nuit** (`nightPos`) : dernière photo géolocalisée du jour. Le nom du camping est déduit par plus-proche-voisin contre la base `CAMPEASY_CAMPINGS` de `preparation.html` ; `campUncertain:true` si la correspondance est à plus de 2 km (à confirmer manuellement).

**Cas particuliers** :
- **J0** (arrivée) : affiché par défaut (`defaultOn:true`) malgré son caractère atypique (vol + trajet court).
- **J15** (retour) : le tracé s'arrête à la dernière position avant l'aéroport (troncature manuelle des points post-décollage, qui autrement traceraient un trajet aberrant depuis l'avion). Pas de camping ce jour-là : marqueur ✈️ dédié (`endType:"airport"`) au lieu de 🌙.

## Détection des arrêts (clustering)

Les arrêts sont des regroupements de photos proches dans l'espace et le temps — pas un simple seuil de nombre de photos :

1. **Clustering séquentiel** : les photos triées chronologiquement sont regroupées tant qu'elles restent à ≤ **250 m** (`CLUSTER_RADIUS_KM = 0.25`) du centre du groupe en cours.
2. **Fusion** : deux groupes voisins sont recollés si l'écart est ≤ **20 min** (`MERGE_GAP_MIN`) ET ≤ **600 m** (`MERGE_DIST_KM`).
3. **Deux niveaux** (le dernier groupe du jour, qui correspond à la nuit, est toujours exclu des deux) :
   - **`STOPS`** (arrêts marquants, 107) : ≥ 4 photos ET ≥ 3 min de présence.
   - **`STOPS_MINOR`** (arrêts secondaires, 128) : tout le reste des groupes, dès 2 photos, sans contrainte de durée — désactivé par défaut (menu 📸 → 🔹), car nettement plus dense.
4. **Nom** : plus proche lieu connu (POI ou camping de `preparation.html`, si à ≤ 600 m) sinon `Arrêt près de <ville EXIF>` sinon `Arrêt (à nommer)` — `matched:false` déclenche un badge ⚠️ dans le popup.

**Exception manuelle** : `m106` (14/09, "Aurores boréales - Vík Campsite") est le dernier groupe du jour (normalement toujours exclu, voir ci-dessous) ajouté à la main à `STOPS` sur demande explicite, parce qu'il contenait une photo marquante (aurores boréales) à rendre trouvable sur la carte sans la confondre avec le marqueur 🌙 de nuit. `uid` n'est qu'une clé de lookup (`STOP_BY_UID`), pas un index de tableau — ajouter une entrée en fin de tableau est sans risque, mais **ne pas oublier la virgule de fin de ligne sur l'ancien dernier élément** (il n'en avait pas besoin tant qu'il était le dernier).

## Kilométrage

`KM_INITIAL` (compteur avant J0) et `KM_LOG` (compteur relevé chaque soir, par date) sont saisis manuellement — aucune donnée automatique ici, ce sont les relevés fournis par l'utilisateur. Le popup de nuit et le panneau "Programme jour par jour" (bouton 📋) calculent la distance du jour (`KM_LOG[jour] - KM_LOG[veille]`) et le cumul à partir de ces deux structures ; une date sans valeur affiche simplement "à compléter", pas d'erreur.

## Liens et miniatures Immich dans les popups d'arrêts

Chaque arrêt porte la liste complète de ses photos (`photos:[[id,"HH:MM"], ...]`, triées chronologiquement) — pas seulement une photo représentative :

- **Miniature + navigation** : la première photo du groupe s'affiche par défaut. Si l'arrêt a plusieurs photos, deux flèches (‹ ›) apparaissent sur les bords de l'image ; `navStopPhoto(uid, ±1)` fait défiler la liste (avec retour au début/fin en boucle), met à jour l'image, l'heure affichée dans le coin (`HH:MM · position/total`) et le lien Immich en même temps. `STOP_BY_UID` (rempli par `registerStops()`) est le registre qui relie chaque bouton à son objet `stop` et à l'index courant (`s._idx`).
- **Miniature** `${IMMICH_BASE_URL}/api/assets/<id>/thumbnail?size=thumbnail` — chargée en `<img>` simple. En cas d'échec (`onerror`), c'est **tout le bloc** (image + heure + flèches) qui se masque, pas seulement l'image seule — sinon les flèches et le badge d'heure restent affichés flottants sans image derrière. Repli entièrement silencieux si l'utilisateur n'est pas connecté à Immich dans ce navigateur ou si le domaine `itcg-consulting.com` n'est pas utilisé (voir "Domaine personnalisé" ci-dessus).
- **Lien** `${IMMICH_BASE_URL}/photos/<id>` — route confirmée en inspectant le bundle JS du client web Immich (c'est la route réellement utilisée par l'app pour ouvrir une photo). Ouvre la photo affichée dans la timeline du compte connecté, sans écriture ni clé API.

### Limite connue (déjà explorée, pas de solution simple)

La recherche Immich (filtre par plage horaire, `takenAfter`/`takenBefore`) ne lit **aucun paramètre d'URL** au chargement dans cette version (vérifié dans le bundle JS du client web) — impossible de créer un lien qui pré-filtre une liste de photos par heure. La seule façon d'obtenir une vraie galerie filtrée serait un "shared link" Immich (écriture via l'API, un par arrêt) — **délibérément écarté** : la clé API utilisée est documentée comme lecture seule, et créer ~100+ liens partagés publics n'a pas été jugé souhaitable.

## Mode édition (local, sans backend)

Bouton ✏️ dédié dans les contrôles (au même niveau que 🗓️/📸/⚙️). Une fois activé, les popups d'arrêts et de nuit affichent un champ texte pour corriger le nom du lieu, et un bouton ☆/⭐ sous la photo affichée (arrêts uniquement) pour la définir comme photo principale — utilise la photo actuellement affichée par les flèches de navigation, pas forcément `photos[0]`.

- **Stockage** : `localStorage` du navigateur uniquement (clé `voyage_edits_v1`), jamais envoyé à un serveur. Format : `{"stop:<uid>": {name, favoriteAssetId}, "day:<date>": {campName}}`.
- **Pourquoi pas de backend** : le site est public — n'importe qui peut activer le mode édition. Sans backend d'écriture, ce n'est pas un problème (chaque modification reste dans le navigateur de la personne qui l'a faite) ; un vrai endpoint d'écriture aurait nécessité une authentification pour éviter que n'importe quel visiteur modifie les données partagées.
- **Application immédiate côté affichage** : les popups (`stopPop`/`dayPop`) sont liées via `bindPopup(() => ...)` (fonction, pas chaîne) pour se régénérer à chaque ouverture et refléter `EDITS`/`editMode` à jour sans recharger la page.
- **Export** : menu ✏️ → "Envoyer par email" (lien `mailto:` avec le JSON des modifications dans le corps, destinataire laissé vide à remplir par l'utilisateur) ou "Copier" (presse-papier, avec repli si l'API Clipboard échoue). "Effacer mes modifications" vide `EDITS` et le `localStorage` après confirmation.
### Procédure — appliquer un JSON exporté du mode édition

Quand l'utilisateur colle un JSON de ce type (une ou plusieurs clés) :

```json
{
  "stop:m91": {"favoriteAssetId": "8575ce28-...", "name": "Nouveau nom"},
  "day:2026-09-05": {"campName": "Nouveau nom de camping"}
}
```

**C'est une opération purement locale sur `voyage.html` — pas besoin de recontacter Immich, de relancer OSRM, ni de recalculer le clustering des arrêts.** Toutes les données existent déjà, figées, dans le fichier. Procédure :

1. **Identifier la clé.**
   - `stop:<uid>` → l'entrée est dans `const STOPS = [...]` si `uid` commence par `m`, ou dans `const STOPS_MINOR = [...]` si `uid` commence par `n` (index de l'arrêt dans son tableau respectif, ex. `m91` = 92ᵉ élément de `STOPS`).
   - `day:<date>` (`YYYY-MM-DD`) → l'entrée est dans `const DAYS = [...]`, à faire correspondre via son champ `date`.
   - Chaque entrée tient sur **une seule ligne** (fichier généré, pas formaté à la main) — la retrouver avec `grep -n '"uid:<uid>"'` ou `grep -n '"date":"YYYY-MM-DD"'` plutôt que d'ouvrir la ligne complète avec l'outil `Read` (elle peut faire des dizaines de Ko à cause du tracé GPS ou de la liste de photos, et fait dépasser les limites de lecture).
   - Faire l'édition avec des scripts Python/`sed` ciblés (regex sur `re.escape(uid)`), pas avec l'outil `Edit` sur la ligne entière — c'est ce qui a été fait pour les 10 premières mises à jour, voir l'historique git (commit `c3af65f`) pour un script de référence directement réutilisable.

2. **Champ `favoriteAssetId` (arrêts uniquement)** :
   - Extraire la liste `photos:[["id","HH:MM"], ...]` de la ligne concernée.
   - Vérifier que l'id donné existe bien dans cette liste — sinon, s'arrêter et signaler l'incohérence à l'utilisateur plutôt que de deviner.
   - Réordonner : la photo choisie passe en tête (`photos[0]`), le reste garde son ordre relatif d'origine. Ne rien changer d'autre sur cette entrée.

3. **Champ `name` (arrêts) / `campName` (jours)** :
   - Remplacer directement la valeur de `name:"..."` (ou `campName:"..."`) sur la ligne concernée.
   - Mettre aussi `matched:true` pour un arrêt (supprime le badge ⚠️ "non identifié") — et `campUncertain:false` pour un jour si la correction porte sur le nom du camping (supprime le badge ⚠️ de distance incertaine). Ce sont des noms confirmés manuellement, donc les avertissements automatiques n'ont plus lieu d'être.

4. **Vérifier** : recharger `voyage.html` (`python3 -m http.server` + navigateur/CDP comme pour les sessions précédentes) et confirmer que la ligne modifiée est toujours un JS valide (pas de guillemet cassé) — un contrôle léger, pas une nouvelle investigation.

5. **Committer et pousser** directement (pas besoin de redemander confirmation à l'utilisateur pour ce type de mise à jour de données ponctuelle — c'est le mode de fonctionnement établi sur ce projet), avec un message citant les `uid`/dates concernés.

Aucune de ces étapes ne nécessite de ressortir la clé API Immich, de relire ce fichier en entier, ni de redériver l'algorithme de clustering — tout est déjà là, il s'agit uniquement de chirurgie de texte ciblée.

## Sécurité — à respecter si ce module est régénéré ou étendu

- Ne jamais écrire une clé API Immich (ni aucun secret) dans ce dépôt, y compris dans des commentaires ou des scripts de génération commités.
- Ne pas créer de "shared links" Immich en masse sans en discuter explicitly — ça laisse des artefacts persistants et publics côté Immich.
- Le cookie `SameSite` d'Immich (`lax`, en dur dans `respondWithCookie`, `utils/response.js` du serveur Immich) n'a pas été modifié — c'est le domaine personnalisé qui contourne le problème, pas une reconfiguration d'Immich.
