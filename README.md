# Site du mariage — FAMILLES OUATTARA & KANTÉ

Faire-part numérique, programme, confirmation de présence (RSVP) et espace organisateurs sécurisé.
Hébergement **100 % gratuit** : Netlify (site) + Supabase (base de données et connexion des organisateurs).

---

## 1. Architecture

```
Invité (WhatsApp / navigateur)          Organisateur
        │                                      │
        ▼                                      ▼
  Netlify (HTTPS, gratuit)  ── pages statiques : accueil, programme, RSVP, /admin/
        │                                      │
        └──── appels sécurisés ───► Supabase (PostgreSQL + Auth, gratuit)
                                     • fonctions submit_rsvp / get_my_rsvp / get_public_info (invités)
                                     • fonctions admin_* (organisateurs connectés uniquement)
                                     • tables verrouillées (RLS) : aucun accès direct
```

| Élément | Choix | Pourquoi |
|---|---|---|
| Pages | HTML / CSS / JavaScript sans framework | Très léger (≈ 190 Ko par page, polices comprises), rapide sur réseau mobile, rien à maintenir |
| Base de données | Supabase PostgreSQL | Centralisée, persistante, offre gratuite suffisante pour 300 invités |
| Sécurité | RLS + fonctions `SECURITY DEFINER` | Toute validation se fait **côté serveur** ; un visiteur ne peut lire aucune réponse |
| Connexion admin | Supabase Auth (e-mail + mot de passe) + table `admins` | Seuls les comptes listés dans `admins` accèdent aux données |
| Programme | Stocké en base, modifiable depuis l'admin | Les « À confirmer » se mettent à jour **sans redéployer** (un déploiement coûte des crédits Netlify) |

### Pages

| Adresse | Contenu |
|---|---|
| `/` | Accueil : titre, formule d'accueil, dates, compte à rebours vers la réception, boutons « Confirmer ma présence » et « Découvrir le programme », partage WhatsApp |
| `/programme.html` | Cartes des 3 événements (date, heure, lieu, adresse, itinéraire Google Maps dès qu'il est renseigné) |
| `/rsvp.html` | Formulaire de confirmation, remerciement, lien personnel de modification |
| `/admin/` | Espace organisateurs : tableau de bord, invités, programme, réglages |

### Arborescence

```
supabase/schema.sql      ← base de données complète (à exécuter une fois)
src/                     ← sources du site (pages, styles, scripts, polices, images)
  partials/              ← en-tête, pied de page et <head> communs
  admin/index.html       ← espace organisateurs
scripts/build.mjs        ← construit dist/ et injecte les variables d'environnement
tests/                   ← tests base de données + tests navigateur
netlify.toml             ← configuration Netlify
.github/workflows/       ← maintien de la base active (facultatif)
```

### Informations affichées

Seules les informations confirmées figurent sur le site. Tout le reste s'affiche **« À confirmer »** :
- Cérémonie religieuse : 24 décembre 2026, Daloa — lieu précis, heure et adresse à confirmer.
- Prêche : Mosquée du Nouveau Quartier, Yopougon — date et heure à confirmer ; **confirmation de présence désactivée** jusqu'à ce que vous l'ouvriez depuis l'admin.
- Réception : 3 janvier 2027, Yopougon Nouveau Quartier, Abidjan — terrain à environ 15 mètres de la mosquée ; heure à confirmer.

Les prénoms des mariés n'apparaissent nulle part.

---

## 2. Limites des offres gratuites (vérifiées en novembre 2026)

**Supabase (gratuit)** : largement suffisant (300 invités ≈ quelques centaines de lignes).
⚠ Un projet gratuit **se met en pause après environ une semaine sans activité**. Les données sont conservées et le projet se réactive depuis le tableau de bord Supabase. Pour éviter toute pause, activez le petit automatisme `.github/workflows/keepalive.yml` (voir §7) ou ouvrez l'espace admin régulièrement.

**Netlify (gratuit)** : 300 crédits par mois. Un déploiement en production coûte ~15 crédits, 1 Go de trafic ~20 crédits. Ce site est très léger : 300 invités qui consultent 3 pages représentent bien moins de 1 Go. ⚠ Si les crédits sont épuisés, le site est suspendu jusqu'au mois suivant : **évitez les déploiements inutiles** et modifiez le programme depuis l'espace admin (aucun déploiement nécessaire).

---

## 3. Prérequis

- Un compte gratuit **Supabase** : <https://supabase.com>
- Un compte gratuit **Netlify** : <https://www.netlify.com>
- (Recommandé) un compte gratuit **GitHub** pour déployer automatiquement
- Pour construire ou tester sur ordinateur : **Node.js 18 ou plus récent**

---

## 4. Configuration de la base de données (Supabase)

1. Sur Supabase : **New project**. Région conseillée : la plus proche (ex. Europe). Notez le mot de passe de la base.
2. Menu **SQL Editor** → **New query** → collez **tout** le contenu de `supabase/schema.sql` → **Run**.
   Le message « Success. No rows returned » confirme l'installation (le script peut être relancé sans perte de données).
3. Menu **Authentication → Sign In / Providers** (ou *Providers → Email*) : **désactivez « Allow new users to sign up »**. Ainsi, personne ne peut créer de compte de lui-même.
4. Menu **Project Settings → API** (ou *API Keys*) : notez
   - l'**URL du projet** (`https://xxxx.supabase.co`) ;
   - la **clé publique** : « anon public » (commence par `eyJ…`) ou « publishable » (`sb_publishable_…`).
   ⚠ N'utilisez **jamais** la clé `service_role` / `secret` : le script de construction la refuse.
5. Vérifiez que l'**API de données (Data API)** est activée pour le schéma `public` (activée par défaut).

### Créer le premier compte administrateur

1. **Authentication → Users → Add user → Create new user** : e-mail + mot de passe solide, cochez *Auto Confirm User*.
2. **SQL Editor**, exécutez (en remplaçant l'e-mail) :
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'organisateur@exemple.com';
   ```
3. Pour ajouter d'autres organisateurs : répétez ces deux étapes. Pour retirer un accès :
   ```sql
   delete from public.admins where email = 'organisateur@exemple.com';
   ```

---

## 5. Variables d'environnement

| Variable | Obligatoire | Valeur |
|---|---|---|
| `SUPABASE_URL` | oui | URL du projet Supabase |
| `SUPABASE_ANON_KEY` | oui | Clé **publique** anon / publishable |
| `SITE_URL` | non | Adresse publique du site (Netlify la fournit automatiquement) ; utilisée pour les aperçus WhatsApp/Facebook et le lien de modification |

La clé publique apparaît dans le code du site : c'est **normal et prévu par Supabase**. La sécurité repose sur la base de données (tables verrouillées, fonctions contrôlées). Aucun mot de passe ni clé secrète ne figure dans le code.

Sur ordinateur : copiez `.env.example` en `.env` et remplissez-le (ce fichier n'est jamais publié).

---

## 6. Déploiement sur Netlify (adresse gratuite `https://….netlify.app`)

### Méthode A — avec GitHub (recommandée)
1. Publiez ce dossier dans un dépôt GitHub (privé possible).
2. Netlify → **Add new project → Import an existing project** → GitHub → choisissez le dépôt.
   Les réglages sont lus dans `netlify.toml` (commande `npm run build`, dossier `dist`).
3. **Project configuration → Environment variables** : ajoutez `SUPABASE_URL` et `SUPABASE_ANON_KEY`.
4. **Deploys → Trigger deploy**.
5. **Domain management** : renommez l'adresse, par ex. `mariage-ouattara-kante.netlify.app` (gratuit, HTTPS inclus). Si vous changez de nom après le premier déploiement, relancez un déploiement pour mettre à jour les aperçus WhatsApp.

### Méthode B — glisser-déposer (sans GitHub)
1. Sur votre ordinateur : `npm install` puis `npm run build` (avec le fichier `.env` rempli, et `SITE_URL` = l'adresse Netlify choisie).
2. Glissez le dossier **`dist`** sur <https://app.netlify.com/drop>.

### Après le déploiement
- Ouvrez `https://VOTRE-SITE.netlify.app/admin/` et connectez-vous.
- Dans **Supabase → Authentication → URL Configuration**, mettez l'adresse du site dans *Site URL*.
- Testez l'aperçu WhatsApp en envoyant le lien à vous-même (si l'aperçu est ancien : <https://developers.facebook.com/tools/debug/> → « Scrape Again »).

---

## 7. Maintenir la base active (facultatif, gratuit)

Si le code est sur GitHub : **Settings → Secrets and variables → Actions** → ajoutez `SUPABASE_URL` et `SUPABASE_ANON_KEY`. Le fichier `.github/workflows/keepalive.yml` interroge alors la base deux fois par semaine (onglet **Actions** pour vérifier ou lancer manuellement).

---

## 8. Utilisation au quotidien (organisateurs)

- **Tableau de bord** : réponses reçues, présents, absents, en attente (invitations prévues − réponses), personnes attendues accompagnants compris, graphiques par catégorie, par événement et dans le temps. Actualisation automatique toutes les 30 s.
- **Invités** : recherche (nom ou numéro), filtres par catégorie et par réponse, ajout manuel (un invité ajouté « En attente » sera complété automatiquement quand il répondra avec le même numéro), modification, suppression avec confirmation, **export CSV et Excel**. Le numéro est cliquable pour écrire sur WhatsApp.
- **Programme** : renseignez date, heure, lieu, adresse, lien Google Maps (bouton d'itinéraire), note. Un champ vide affiche « À confirmer ». Cochez **« Confirmation ouverte »** sur le prêche quand sa date sera connue.
- **Réglages** : nombre d'invitations prévues (300 par défaut, ce n'est pas une limite), ouverture/fermeture des confirmations, date limite facultative.
- **Sauvegarde** : exportez régulièrement en Excel depuis l'onglet Invités.

### Côté invité
- Un numéro WhatsApp = une réponse (anti-doublon). Les numéros ivoiriens sont reconnus avec ou sans `+225`.
- Après l'envoi, l'invité reçoit un **lien personnel secret** (à copier ou à s'envoyer sur WhatsApp) pour modifier sa réponse. Le même téléphone retrouve aussi sa réponse automatiquement.
- « Merci pour votre réponse » n'apparaît **que si la base a confirmé l'enregistrement** ; en cas de coupure réseau, un message l'indique clairement.

---

## 9. Sécurité — résumé

- RLS activée sur toutes les tables, aucun privilège direct pour les visiteurs ni pour les comptes non organisateurs.
- Validation de toutes les données côté serveur (nom, téléphone, catégorie, nombre de personnes 1–20, événements ouverts uniquement, liens Maps en `https://`).
- Anti-abus : champ piège invisible pour les robots + limite de 40 réponses par 10 minutes et par connexion.
- Liens de modification : jeton aléatoire stocké uniquement sous forme d'empreinte SHA-256.
- En-têtes de sécurité stricts (CSP, anti-iframe, HSTS), espace admin exclu des moteurs de recherche.

---

## 10. Tests

```bash
npm install
npm test                 # 11 tests de la base : droits d'accès, validation, doublons, modification, anti-abus, admin
CHROME_PATH=/chemin/vers/chrome npm run test:e2e   # 17 parcours dans un vrai navigateur (mobile + ordinateur)
npm run dev              # site complet sur http://localhost:8888 avec une base temporaire (identifiants affichés)
```

Les tests utilisent une base PostgreSQL **locale et temporaire** chargée avec le vrai `schema.sql` : ils n'écrivent jamais dans votre base Supabase, et le tableau de bord de production ne contient aucune fausse donnée.

---

## 11. Personnalisation

- **Couleurs** : `src/assets/css/style.css`, variables en tête de fichier (`--night: #101B3D`, `--yellow: #F9E000`). La photographie de référence du jaune n'a pas été reçue : la teinte indicative `#F9E000` est utilisée ; il suffit de modifier `--yellow` (et `scripts/make-images.mjs` pour l'image d'aperçu).
- **Photo d'ouverture** (facultatif) : ajoutez `src/assets/img/hero.jpg` (≤ 200 Ko) puis, dans `style.css`, donnez à `.hero-photo` : `background-image: url('../img/hero.jpg');`.
- **Textes** : directement dans `src/index.html`, `src/programme.html`, `src/rsvp.html`.
- Toute modification de fichier nécessite un redéploiement (≈ 15 crédits Netlify) ; les infos du programme, elles, se changent depuis l'admin.
